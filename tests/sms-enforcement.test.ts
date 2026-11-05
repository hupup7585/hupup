import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { and, eq } from "drizzle-orm";

/*
 * Abram's "SMS Terms final update and enforcement". Runs against a throwaway in-memory Postgres (PGlite) with every
 * migration applied, so the real SQL, triggers and constraints are exercised. No real database is touched.
 */

vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema, closeDb: async () => {} };
});

const { db, schema } = await import("@/lib/db");
const { setTwilioForTests } = await import("@/lib/twilio-client");
const sms = await import("@/lib/sms");
const consent = await import("@/lib/sms-consent");
const copy = await import("@/lib/sms-consent-copy");
const { handleInboundSms } = await import("@/lib/sms-inbound");
const { sendOrderText } = await import("@/lib/notify");
const { upsertCustomer } = await import("@/lib/orders");

/* ---- fake Twilio: records sends and cancels ---- */
const sent: { to: string; body: string; sid: string }[] = [];
const canceledSids: string[] = [];
let seq = 0;
const fakeMessages = Object.assign((sid: string) => ({ update: async () => (canceledSids.push(sid), {}) }), {
  create: async (p: { to: string; body: string }) => {
    const sid = `SM${++seq}`;
    sent.push({ to: p.to, body: p.body, sid });
    return { sid, status: "queued" };
  },
});

let n = 0;
const newPhone = () => `+1845555${String(1000 + ++n)}`;
const MIDDAY = new Date("2026-07-01T16:00:00Z"); // 12 PM Eastern
const LATE = new Date("2026-07-02T03:00:00Z"); // 11 PM Eastern

beforeAll(() => {
  process.env.TWILIO_PHONE_NUMBER = "+18454157585";
  setTwilioForTests({ messages: fakeMessages });
});
beforeEach(() => {
  sent.length = 0;
  canceledSids.length = 0;
});
afterEach(() => {
  vi.useRealTimers();
});

const inbound = (phone: string, body: string) => handleInboundSms({ From: phone, Body: body, MessageSid: `SMin${++seq}` });
const customer = async (phone: string) => (await db.select().from(schema.customers).where(eq(schema.customers.phone, phone)))[0];
const consents = (phone: string) => db.select().from(schema.smsConsents).where(eq(schema.smsConsents.phone, phone));
const pendingRequests = (phone: string) => db.select().from(schema.smsReenrollRequests).where(eq(schema.smsReenrollRequests.phone, phone));
const optIn = (phone: string, scope: "transactional" | "marketing", source: "web" | "phone" = "web") =>
  consent.recordConsent({ phone, scope, action: "opt_in", source, method: source === "web" ? "checkbox" : "keypad", wording: `W-${scope}`, wordingVersion: "v1" });
const holdPromo = async (phone: string) => {
  const r = await sms.sendMessage({ to: phone, body: "Spring sale", kind: "marketing", now: LATE });
  expect(r.held).toBe(true);
  return r.messageId!;
};
const msgStatus = async (id: number) => (await db.select().from(schema.messages).where(eq(schema.messages.id, id)))[0].status;

describe("2A. order/service and promotional consent are separate; every send checks its category", () => {
  it("stored as separate records; one program never implies the other", async () => {
    const p = newPhone();
    await optIn(p, "transactional");
    const s = await consent.consentState(p);
    expect(s.transactional?.action).toBe("opt_in");
    expect(s.marketing).toBeNull();
    expect((await sms.sendMessage({ to: p, body: "Sale", kind: "marketing", now: MIDDAY })).blocked).toBe("no_marketing_consent");
    expect((await sms.sendMessage({ to: p, body: "Your order", kind: "transactional" })).sent).toBe(true);
  });
  it("the database rejects any other consent category", async () => {
    const p = newPhone();
    await expect(db.insert(schema.smsConsents).values({ phone: p, scope: "everything", action: "opt_in", source: "web" })).rejects.toThrow();
  });
  it("payment confirmations and staff payment links need order/service consent", async () => {
    const p = newPhone();
    const r = await sms.sendMessage({ to: p, body: "Payment received for order #1", kind: "transactional", event: "payment_confirmation" });
    expect(r.blocked).toBe("no_transactional_consent");
    expect(sent).toEqual([]);
    const logged = (await db.select().from(schema.messages).where(eq(schema.messages.id, r.messageId!)))[0];
    expect(logged).toMatchObject({ status: "blocked", errorMessage: "No text consent; call or email." });
  });
  it("without consent: email when there is an address, otherwise staff see 'No text consent; call or email.'", async () => {
    const p = newPhone();
    const a = await sendOrderText({ phone: p, email: "c@example.com", subject: "Pay", body: "Pay here", event: "staff_payment_link" });
    expect(a).toEqual({ texted: false, emailed: true, message: "No text consent: emailed instead." });
    const b = await sendOrderText({ phone: p, email: null, subject: "Pay", body: "Pay here", event: "staff_payment_link" });
    expect(b).toEqual({ texted: false, emailed: false, message: "No text consent; call or email." });
    expect(sent).toEqual([]);
    await optIn(p, "transactional");
    expect((await sendOrderText({ phone: p, email: null, subject: "Pay", body: "Pay here", event: "staff_payment_link" })).texted).toBe(true);
  });
  it("automatic messages must have a listed purpose (no bypass through 'system')", async () => {
    const p = newPhone();
    expect((await sms.sendMessage({ to: p, body: "x", kind: "system", event: "promo_blast" })).blocked).toBe("not_allowed");
    expect((await sms.sendMessage({ to: p, body: "x", kind: "system" })).blocked).toBe("not_allowed");
  });
  it("no code path sends a text except through sendMessage, and every caller uses a checked category", () => {
    const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(path.join(d, f)).isDirectory() ? walk(path.join(d, f)) : [path.join(d, f)]));
    const files = walk("src").filter((f) => /\.(ts|tsx)$/.test(f));
    for (const f of files) {
      const s = readFileSync(f, "utf8");
      if (f !== path.join("src", "lib", "sms.ts")) expect(s, f).not.toMatch(/messages\.create\(/);
      for (const m of s.matchAll(/kind: "system", event: "([a-z_]+)"/g)) expect(Object.keys(sms.SYSTEM_EVENTS), `${f}: ${m[1]}`).toContain(m[1]);
    }
    expect(readFileSync("src/app/admin/(app)/orders/actions.ts", "utf8")).toContain("sendOrderText({");
    expect(readFileSync("src/app/admin/(app)/pos/actions.ts", "utf8")).toContain("sendOrderText({");
    expect(readFileSync("src/app/api/sola/webhook/route.ts", "utf8")).toContain('kind: "transactional", event: "payment_confirmation"');
    expect(readFileSync("src/lib/auth.ts", "utf8")).toContain('kind: "system", event: "login_code", log: false');
  });
});

describe("2B. consent boxes start unchecked; saving customer info never creates consent", () => {
  it("website boxes render unchecked", async () => {
    const { default: SignUpForm } = await import("@/app/text-alerts/SignUpForm");
    const html = renderToStaticMarkup(createElement(SignUpForm, { transactionalText: "T", marketingText: "M", smsNumber: "(845) 415-7585", disclosureRead: undefined, disabledReason: null } as never));
    const boxes = html.match(/<input[^>]*type="checkbox"[^>]*>/g) ?? [];
    expect(boxes).toHaveLength(2);
    for (const b of boxes) expect(b).not.toMatch(/checked/);
  });
  it("staff panel boxes and answers render unselected (also when the customer replied STOP)", async () => {
    const { default: ConsentPanel } = await import("@/app/admin/(app)/orders/[id]/ConsentPanel");
    for (const stopped of [false, true]) {
      const html = renderToStaticMarkup(createElement(ConsentPanel, { orderId: 1, phoneDisplay: "(845) 555-0100", disclosures: copy.STAFF_DISCLOSURE, stopped }));
      for (const i of html.match(/<input[^>]*type="(checkbox|radio)"[^>]*>/g) ?? []) expect(i).not.toMatch(/checked=""|checked /);
    }
  });
  it("form resets can't turn consent on: no default-checked boxes; the staff panel clears after saving", () => {
    expect(readFileSync("src/app/text-alerts/SignUpForm.tsx", "utf8")).not.toMatch(/defaultChecked|checked=\{true\}/);
    const panel = readFileSync("src/app/admin/(app)/orders/[id]/ConsentPanel.tsx", "utf8");
    expect(panel).toContain('useState(false)');
    expect(panel).toMatch(/setRead\(false\);\s*setResponse\(""\);/);
  });
  it("saving or updating customer details creates no consent", async () => {
    const p = newPhone();
    await upsertCustomer(db, { name: "Test Person", phone: p, email: "t@example.com", address: "1 Main St" });
    await upsertCustomer(db, { name: "Test Person 2", phone: p, email: "t2@example.com", address: "2 Main St" });
    await consent.setCustomerTimeZone(p, "America/Chicago", "web_form");
    expect(await consents(p)).toEqual([]);
    expect((await customer(p)).marketingOptIn).toBe(false);
    expect((await sms.sendMessage({ to: p, body: "Order", kind: "transactional" })).blocked).toBe("no_transactional_consent");
  });
});

describe("2C. opt-outs cancel queued promotions immediately", () => {
  it("STOP cancels held and Twilio-scheduled promotions and blocks both programs", async () => {
    const p = newPhone();
    await optIn(p, "transactional");
    await optIn(p, "marketing");
    const held = await holdPromo(p);
    const [scheduled] = await db.insert(schema.messages).values({ direction: "out", toNumber: p, contactPhone: p, body: "x", kind: "marketing", status: "scheduled", twilioSid: "SMsched1" }).returning();
    await inbound(p, "STOP");
    expect(await msgStatus(held)).toBe("canceled");
    expect(await msgStatus(scheduled.id)).toBe("canceled");
    expect(canceledSids).toContain("SMsched1");
    expect((await sms.sendMessage({ to: p, body: "Order", kind: "transactional" })).blocked).toBe("opted_out");
    expect((await sms.sendMessage({ to: p, body: "Sale", kind: "marketing", now: MIDDAY })).blocked).toBe("opted_out");
  });
  it("NOPROMO cancels promotions only; order texts continue", async () => {
    const p = newPhone();
    await optIn(p, "transactional");
    await optIn(p, "marketing");
    const held = await holdPromo(p);
    await inbound(p, "NOPROMO");
    expect(await msgStatus(held)).toBe("canceled");
    expect((await sms.sendMessage({ to: p, body: "Order", kind: "transactional" })).sent).toBe(true);
  });
  it("a staff-recorded promotional 'no' cancels queued promotions", async () => {
    const p = newPhone();
    await optIn(p, "marketing");
    const held = await holdPromo(p);
    await consent.recordStaffConsent({ phone: p, scope: "marketing", response: "said_no", disclosureRead: true, wording: "W", wordingVersion: "staff-v", userId: 3 });
    expect(await msgStatus(held)).toBe("canceled");
  });
  it("an authorized correction to 'no' cancels queued promotions", async () => {
    const p = newPhone();
    await optIn(p, "marketing");
    const held = await holdPromo(p);
    const [orig] = (await consents(p)).filter((c) => c.scope === "marketing");
    await consent.correctConsent({ originalId: orig.id, action: "declined", reason: "Recorded on the wrong customer", userId: 3 });
    expect(await msgStatus(held)).toBe("canceled");
  });
});

describe("2D. promotional hours: held for the next window, rechecked before sending", () => {
  it("never sent outside 8 AM - 9 PM; held with the next window time instead of discarded", async () => {
    const p = newPhone();
    await optIn(p, "marketing");
    const id = await holdPromo(p);
    const m = (await db.select().from(schema.messages).where(eq(schema.messages.id, id)))[0];
    expect(m.status).toBe("held");
    expect(m.sendAfter?.toISOString()).toBe("2026-07-02T12:00:00.000Z"); // 8 AM Eastern next morning
    expect(sent).toEqual([]);
  });
  it("held promotions are sent when due, after rechecking consent", async () => {
    const p = newPhone();
    await optIn(p, "marketing");
    const id = await holdPromo(p);
    const r = await sms.processHeldPromotions(new Date("2026-07-02T13:00:00Z"));
    expect(r.sent).toBeGreaterThanOrEqual(1);
    expect(await msgStatus(id)).toBe("queued");
    expect(sent.find((x) => x.to === p)?.body).toBe("Hup Up Attractions: Reply STOP to opt out. Spring sale");
  });
  it("a held promotion whose customer lost consent is canceled, never sent", async () => {
    const p = newPhone();
    await optIn(p, "marketing");
    const id = await holdPromo(p);
    // consent withdrawn without going through the cancel path (e.g. a phone-menu decline later)
    await db.update(schema.customers).set({ marketingOptIn: false }).where(eq(schema.customers.phone, p));
    await sms.processHeldPromotions(new Date("2026-07-02T13:00:00Z"));
    expect(await msgStatus(id)).toBe("canceled");
    expect(sent.find((x) => x.to === p)).toBeUndefined();
  });
  it("still outside the window when processed: moved to the next window", async () => {
    const p = newPhone();
    await optIn(p, "marketing");
    const id = await holdPromo(p);
    await db.update(schema.messages).set({ sendAfter: new Date("2026-07-02T04:00:00Z") }).where(eq(schema.messages.id, id));
    const r = await sms.processHeldPromotions(new Date("2026-07-02T04:30:00Z"));
    expect(r.rescheduled).toBeGreaterThanOrEqual(1);
    expect(await msgStatus(id)).toBe("held");
  });
});

describe("3. START, then YES", () => {
  const stopNumber = async () => {
    const p = newPhone();
    await optIn(p, "transactional");
    await optIn(p, "marketing");
    await inbound(p, "STOP");
    sent.length = 0;
    return p;
  };
  it("START alone enrolls no one: block stays, no consent, one confirmation text with the approved wording", async () => {
    const p = await stopNumber();
    const before = (await consents(p)).length;
    await inbound(p, "START");
    expect((await customer(p)).smsOptOut).toBe(true);
    expect((await consents(p)).length).toBe(before);
    expect(sent.filter((x) => x.to === p).map((x) => x.body)).toEqual([copy.START_CONFIRMATION_SMS]);
    expect((await sms.sendMessage({ to: p, body: "Order", kind: "transactional" })).blocked).toBe("opted_out");
    const [req] = await pendingRequests(p);
    expect(req).toMatchObject({ status: "pending", scope: "transactional", promptText: copy.START_CONFIRMATION_SMS });
    expect(req.expiresAt.getTime() - req.requestedAt.getTime()).toBe(24 * 3600 * 1000);
  });
  it("START + YES restores order/service texts only, as a new linked record; past opt-outs kept", async () => {
    const p = await stopNumber();
    await inbound(p, "START");
    await inbound(p, "yes");
    const c = await customer(p);
    expect(c.smsOptOut).toBe(false);
    expect(c.marketingOptIn).toBe(false);
    const rows = await consents(p);
    const optOut = rows.find((r) => r.scope === "transactional" && r.action === "opt_out")!;
    const re = rows.filter((r) => r.scope === "transactional" && r.action === "opt_in").at(-1)!;
    expect(re).toMatchObject({ source: "keyword", method: "keyword", wording: copy.START_CONFIRMATION_SMS, wordingVersion: copy.START_CONFIRMATION_VERSION, reenrollsAfterId: optOut.id });
    expect(rows.filter((r) => r.action === "opt_out")).toHaveLength(2); // both STOP records still there
    expect((await pendingRequests(p))[0]).toMatchObject({ status: "confirmed", confirmConsentId: re.id });
    expect((await sms.sendMessage({ to: p, body: "Order", kind: "transactional" })).sent).toBe(true);
    expect((await sms.sendMessage({ to: p, body: "Sale", kind: "marketing", now: MIDDAY })).blocked).toBe("no_marketing_consent");
  });
  it("YES without an active START confirmation does nothing", async () => {
    const p = await stopNumber();
    const before = (await consents(p)).length;
    await inbound(p, "YES");
    expect((await customer(p)).smsOptOut).toBe(true);
    expect((await consents(p)).length).toBe(before);
    const q = newPhone();
    await inbound(q, "YES"); // never opted out, never consented
    expect(await consents(q)).toEqual([]);
  });
  it("the confirmation expires after 24 hours; a late YES does nothing and a new START is needed", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-01T12:00:00Z"));
    const p = await stopNumber();
    await inbound(p, "START");
    vi.setSystemTime(new Date("2026-07-02T12:00:01Z"));
    await inbound(p, "YES");
    expect((await customer(p)).smsOptOut).toBe(true);
    expect((await pendingRequests(p))[0].status).toBe("expired");
    await inbound(p, "START");
    await inbound(p, "YES");
    expect((await customer(p)).smsOptOut).toBe(false);
  });
  it("STOP while pending cancels it; a late YES is ignored; a new START + YES is required", async () => {
    const p = await stopNumber();
    await inbound(p, "START");
    await inbound(p, "STOP");
    expect((await pendingRequests(p))[0].status).toBe("canceled");
    await inbound(p, "YES");
    expect((await customer(p)).smsOptOut).toBe(true);
  });
  it("repeated STARTs create one confirmation and one text", async () => {
    const p = await stopNumber();
    await inbound(p, "START");
    await inbound(p, "START");
    await inbound(p, "unstop");
    expect((await pendingRequests(p)).filter((r) => r.status === "pending")).toHaveLength(1);
    expect(sent.filter((x) => x.to === p)).toHaveLength(1);
  });
  it("the database itself allows only one pending confirmation per number", async () => {
    const p = await stopNumber();
    await inbound(p, "START");
    await expect(db.insert(schema.smsReenrollRequests).values({ phone: p, status: "pending", promptText: "x", expiresAt: new Date(Date.now() + 3600e3) })).rejects.toThrow();
  });
  it("START from a number that never opted out does nothing", async () => {
    const p = newPhone();
    await inbound(p, "START");
    expect(await pendingRequests(p)).toEqual([]);
    expect(sent.filter((x) => x.to === p)).toEqual([]);
  });
  it("promotions need a separate new opt-in after re-enrolling (website, phone or staff)", async () => {
    const p = await stopNumber();
    await inbound(p, "START");
    await inbound(p, "YES");
    expect((await customer(p)).marketingOptIn).toBe(false);
    await optIn(p, "marketing");
    expect((await customer(p)).marketingOptIn).toBe(true);
  });
  it("STOP and YES arriving together never leave consent restored after the STOP", async () => {
    const p = await stopNumber();
    await inbound(p, "START");
    await Promise.all([inbound(p, "STOP"), inbound(p, "YES")]);
    const c = await customer(p);
    const state = await consent.consentState(p);
    // whichever order they were applied in, the number ends opted out unless the YES came first and the STOP after
    expect(c.smsOptOut).toBe(true);
    expect(state.transactional?.action).toBe("opt_out");
  });
});

describe("2E / 5. records are immutable; corrections are separate audited entries", () => {
  it("original consent records can't be edited or deleted", async () => {
    const p = newPhone();
    await optIn(p, "transactional");
    const [row] = await consents(p);
    await expect(db.update(schema.smsConsents).set({ action: "declined" }).where(eq(schema.smsConsents.id, row.id))).rejects.toThrow();
    await expect(db.delete(schema.smsConsents).where(eq(schema.smsConsents.id, row.id))).rejects.toThrow();
  });
  it("messages can't be deleted within 24 months or have their content changed", async () => {
    const p = newPhone();
    await optIn(p, "transactional");
    const r = await sms.sendMessage({ to: p, body: "Order", kind: "transactional" });
    await expect(db.delete(schema.messages).where(eq(schema.messages.id, r.messageId!))).rejects.toThrow();
    await expect(db.update(schema.messages).set({ body: "edited" }).where(eq(schema.messages.id, r.messageId!))).rejects.toThrow();
  });
  it("resolved START confirmations can't be changed or deleted", async () => {
    const p = newPhone();
    await optIn(p, "transactional");
    await inbound(p, "STOP");
    await inbound(p, "START");
    await inbound(p, "YES");
    const [req] = await pendingRequests(p);
    await expect(db.update(schema.smsReenrollRequests).set({ status: "pending" }).where(eq(schema.smsReenrollRequests.id, req.id))).rejects.toThrow();
    await expect(db.delete(schema.smsReenrollRequests).where(eq(schema.smsReenrollRequests.id, req.id))).rejects.toThrow();
  });
  it("a correction is a separate entry with reason, who, time and a reference; originals unchanged", async () => {
    const p = newPhone();
    await optIn(p, "marketing");
    const [orig] = await consents(p);
    await consent.correctConsent({ originalId: orig.id, action: "declined", reason: "Customer said no; entered wrong", userId: 7 });
    const rows = await consents(p);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.id === orig.id)).toMatchObject({ action: "opt_in" });
    expect(rows.find((r) => r.correctsConsentId === orig.id)).toMatchObject({ action: "declined", correctionReason: "Customer said no; entered wrong", userId: 7 });
    expect(rows.find((r) => r.correctsConsentId === orig.id)!.createdAt).toBeInstanceOf(Date);
  });
  it("the database refuses a correction without a reason or a person", async () => {
    const p = newPhone();
    await optIn(p, "marketing");
    const [orig] = await consents(p);
    await expect(db.insert(schema.smsConsents).values({ phone: p, scope: "marketing", action: "declined", source: "staff", correctsConsentId: orig.id, userId: 7 })).rejects.toThrow();
    await expect(db.insert(schema.smsConsents).values({ phone: p, scope: "marketing", action: "declined", source: "staff", correctsConsentId: orig.id, correctionReason: "x" })).rejects.toThrow();
  });
});

describe("3. no manual staff overrides; STOP can't be bypassed", () => {
  const stopped = async () => {
    const p = newPhone();
    await optIn(p, "transactional");
    await inbound(p, "STOP");
    return p;
  };
  it("staff can't record a yes for a customer who replied STOP", async () => {
    const p = await stopped();
    const before = (await consents(p)).length;
    await expect(consent.recordStaffConsent({ phone: p, scope: "transactional", response: "clear_yes", disclosureRead: true, wording: "W", wordingVersion: "staff-v", userId: 3 })).rejects.toBeInstanceOf(consent.ConsentBlockedError);
    expect((await consents(p)).length).toBe(before);
    expect((await customer(p)).smsOptOut).toBe(true);
  });
  it("a correction can never create consent", async () => {
    const p = newPhone();
    await consent.recordConsent({ phone: p, scope: "marketing", action: "declined", source: "phone", method: "keypad", wording: "W", wordingVersion: "v" });
    const [orig] = await consents(p);
    await expect(consent.correctConsent({ originalId: orig.id, action: "opt_in", reason: "override", userId: 3 })).rejects.toBeInstanceOf(consent.ConsentBlockedError);
  });
  it("website or phone opt-ins can't reactivate a number that replied STOP", async () => {
    const p = await stopped();
    await expect(optIn(p, "marketing", "web")).rejects.toBeInstanceOf(consent.ConsentBlockedError);
    await expect(optIn(p, "transactional", "phone")).rejects.toBeInstanceOf(consent.ConsentBlockedError);
  });
  it("a keyword alone can't enroll anyone outside the START + YES confirmation", async () => {
    const p = newPhone();
    await expect(consent.recordConsent({ phone: p, scope: "transactional", action: "opt_in", source: "keyword", method: "keyword", wording: "START", wordingVersion: "k" })).rejects.toThrow(/YES/);
  });
  it("staff attempts that are blocked are written to the audit log", () => {
    expect(readFileSync("src/app/admin/(app)/orders/consent-actions.ts", "utf8")).toContain('"sms_consent.staff_blocked"');
  });
});

describe("1. published SMS Terms and texts match the system", () => {
  it("START confirmation text is the approved wording", () => {
    expect(copy.START_CONFIRMATION_SMS).toBe(
      "Hup Up Attractions: To receive order and service texts again (reservations, orders, payments, deliveries, pickups), reply YES. Msg frequency varies. Msg & data rates may apply. Reply HELP for help. Promotional texts require a separate sign-up.",
    );
    expect(copy.REENROLL_WINDOW_HOURS).toBe(24);
  });
  it("migration 0009 is add-only and holds the new rules", () => {
    const sql = readFileSync("drizzle/0009_start_yes_reenroll.sql", "utf8");
    for (const s of ['CREATE TABLE "sms_reenroll_requests"', 'ADD COLUMN "send_after"', "sms_reenroll_one_pending", "sms_consents_scope_valid", "sms_reenroll_requests_guard"]) expect(sql).toContain(s);
    expect(sql).not.toMatch(/\bDROP\b|DELETE FROM|ALTER COLUMN|RENAME/i);
  });
});

void and;
