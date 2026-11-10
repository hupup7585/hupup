import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

/*
 * SMS v3 (Abraham's final requirements, Nov 9, 2026), message 2 section 11: every listed test, end to end through
 * the real inbound-text handler and the real sending code, on an in-memory Postgres with every migration.
 * Twilio is replaced by a recorder; nothing is sent.
 */
const h = vi.hoisted(() => ({ sent: [] as { to: string; body: string; mediaUrl?: string[] }[], canceled: [] as string[] }));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/twilio-client", () => {
  const messages = Object.assign((sid: string) => ({ update: async () => (h.canceled.push(sid), {}) }), {
    create: async (p: { to: string; body: string; mediaUrl?: string[] }) => (h.sent.push(p), { sid: `SM${h.sent.length}`, status: "queued" }),
  });
  return { getTwilio: () => ({ messages }) };
});

import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { handleInboundSms, handleSmsStatus, HELP_REPLY } from "@/lib/sms-inbound";
import { inMarketingHours, marketingBodyV2, promosThisYear, sendMessage } from "@/lib/sms";
import { approveCampaign, createCampaign, segments, sendCampaign } from "@/lib/campaigns";
import { PROMO_ENROLLED_SMS, promoConfirmRequestSms } from "@/lib/sms-terms-v2";
import { requestPromoByCustomer } from "@/lib/sms-reenroll";

let sid = 0;
const text = (from: string, Body: string) => handleInboundSms({ From: from, To: "+18454157585", Body, MessageSid: `SMin${++sid}` });
const customer = async (phone: string) => (await db.select().from(schema.customers).where(eq(schema.customers.phone, phone)))[0];
const consents = async (phone: string, scope?: string) =>
  (await db.select().from(schema.smsConsents).where(eq(schema.smsConsents.phone, phone))).filter((r) => !scope || r.scope === scope);
const sentTo = (phone: string) => h.sent.filter((m) => m.to === phone).map((m) => m.body);
const optInOrders = async (phone: string) => {
  const c = (await customer(phone)) ?? (await db.insert(schema.customers).values({ phone }).returning())[0];
  await db.insert(schema.smsConsents).values({ customerId: c.id, phone, scope: "transactional", action: "opt_in", source: "web", method: "checkbox", wording: "order texts" });
  return c;
};

beforeAll(() => {
  process.env.SMS_TERMS_V2 = "1"; // SMS v3 switched on
  process.env.TWILIO_PHONE_NUMBER = "+18454157585";
  process.env.PUBLIC_BASE_URL = "https://hupup.vercel.app";
});
afterAll(() => {
  delete process.env.SMS_TERMS_V2;
});

describe("JOIN and YES", () => {
  const P = "+18455550601";
  it("JOIN sends the exact confirmation text; JOIN again neither confirms nor repeats it", async () => {
    await text(P, "Hi, do you have bounce houses Sunday?");
    expect(sentTo(P)).toEqual([]); // a normal question never signs up or invites
    await text(P, "JOIN");
    expect(sentTo(P)).toEqual([promoConfirmRequestSms()]);
    expect(promoConfirmRequestSms()).toBe(
      "Hup Up Attractions: You requested to join our seasonal promotional text program. You may receive up to 6 promotional messages per calendar year, including seasonal offers, discount codes, and rental deals. Message and data rates may apply. Reply YES within 24 hours to confirm. Reply STOP to unsubscribe. Reply HELP for assistance. Terms: https://hupup.vercel.app/sms-terms",
    );
    await text(P, "join");
    expect(sentTo(P)).toHaveLength(1);
    expect(await consents(P, "marketing")).toHaveLength(0);
  });
  it("YES within 24 hours activates promo consent, linked to the request, and sends the exact sign-up text", async () => {
    await text(P, "Yes");
    const rows = await consents(P, "marketing");
    expect(rows.map((r) => r.action)).toEqual(["opt_in"]);
    expect(rows[0].response).toMatch(/texted "Yes" to the promotional confirmation sent .* \(requested by texted "JOIN"\)/);
    const [req] = await db.select().from(schema.smsReenrollRequests).where(eq(schema.smsReenrollRequests.phone, P));
    expect(req).toMatchObject({ status: "confirmed", confirmConsentId: rows[0].id }); // confirmation linked to the original request
    expect(sentTo(P).at(-1)).toBe(PROMO_ENROLLED_SMS);
    expect(PROMO_ENROLLED_SMS).toBe("Hup Up Attractions: You're signed up for seasonal promo texts, up to 6 per year. Msg & data rates may apply. Reply NOPROMO to stop promos, STOP to stop all texts, HELP for help.");
    expect((await customer(P)).marketingOptIn).toBe(true);
  });
  it("a second YES does nothing (no duplicate enrollment)", async () => {
    await text(P, "YES");
    expect(await consents(P, "marketing")).toHaveLength(1);
  });
  it("YES after 24 hours (expired confirmation) never activates", async () => {
    const Q = "+18455550602";
    const [c] = await db.insert(schema.customers).values({ phone: Q }).returning();
    // A confirmation sent two days ago (expired after 24 hours)
    await db.insert(schema.smsReenrollRequests).values({ phone: Q, customerId: c.id, scope: "marketing", status: "pending", promptText: promoConfirmRequestSms(), startMessage: 'texted "JOIN"', requestedAt: new Date(Date.now() - 48 * 3600_000), expiresAt: new Date(Date.now() - 24 * 3600_000) });
    await text(Q, "YES");
    expect(await consents(Q, "marketing")).toHaveLength(0);
    expect((await customer(Q)).marketingOptIn).toBe(false);
  });
});

describe("STOP and every opt-out word", () => {
  it.each(["STOP", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "OPT OUT", "REVOKE", "stop"])("%s stops all texts and is recorded", async (word) => {
    const P = `+1845555${String(700 + ["STOP", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "OPT OUT", "REVOKE", "stop"].indexOf(word)).padStart(4, "0")}`;
    await optInOrders(P);
    await text(P, word);
    expect((await customer(P)).smsOptOut).toBe(true);
    const outs = (await consents(P)).filter((r) => r.action === "opt_out");
    expect(outs.map((r) => r.scope).sort()).toEqual(["marketing", "transactional"]);
    expect(outs[0]).toMatchObject({ source: "keyword", keyword: word.toUpperCase() });
    // blocked from then on
    expect((await sendMessage({ to: P, body: "Your order is confirmed.", kind: "transactional" })).blocked).toBe("opted_out");
  });
  it("STOP cancels every queued and scheduled message (order texts and promos)", async () => {
    const P = "+18455550801";
    const c = await optInOrders(P);
    await db.insert(schema.messages).values([
      { direction: "out", toNumber: P, contactPhone: P, body: "promo held", kind: "marketing", status: "held", customerId: c.id },
      { direction: "out", toNumber: P, contactPhone: P, body: "order scheduled", kind: "transactional", status: "scheduled", twilioSid: "SMsched1", customerId: c.id },
    ]);
    await text(P, "STOP");
    const left = await db.select().from(schema.messages).where(and(eq(schema.messages.contactPhone, P), eq(schema.messages.direction, "out")));
    expect(left.filter((m) => m.body !== "promo held" && m.body !== "order scheduled").every((m) => m.status !== "held")).toBe(true);
    expect(left.find((m) => m.body === "promo held")!.status).toBe("canceled");
    expect(left.find((m) => m.body === "order scheduled")!.status).toBe("canceled");
    expect(h.canceled).toContain("SMsched1");
  });
  it("WRONG NUMBER removes the number like STOP", async () => {
    const P = "+18455550802";
    await optInOrders(P);
    await text(P, "wrong number");
    expect((await customer(P)).smsOptOut).toBe(true);
  });
});

describe("NOPROMO and NO PROMO", () => {
  it.each(["NOPROMO", "No Promo", "nopromo"])("%s stops promos only, cancels queued promos, keeps order texts", async (word) => {
    const P = `+1845555${String(900 + ["NOPROMO", "No Promo", "nopromo"].indexOf(word)).padStart(4, "0")}`;
    const c = await optInOrders(P);
    await db.update(schema.customers).set({ marketingOptIn: true }).where(eq(schema.customers.id, c.id));
    await db.insert(schema.messages).values([
      { direction: "out", toNumber: P, contactPhone: P, body: "promo held", kind: "marketing", status: "held", customerId: c.id },
      { direction: "out", toNumber: P, contactPhone: P, body: "order held", kind: "transactional", status: "held", customerId: c.id },
    ]);
    await text(P, word);
    const after = await customer(P);
    expect(after.marketingOptIn).toBe(false);
    expect(after.smsOptOut).toBe(false);
    const msgs = await db.select().from(schema.messages).where(eq(schema.messages.contactPhone, P));
    expect(msgs.find((m) => m.body === "promo held")!.status).toBe("canceled");
    expect(msgs.find((m) => m.body === "order held")!.status).toBe("held"); // order texts continue
  });
  it("NOPROMO never overrides a STOP", async () => {
    const P = "+18455550910";
    await optInOrders(P);
    await text(P, "STOP");
    await text(P, "NOPROMO");
    expect((await customer(P)).smsOptOut).toBe(true);
  });
});

describe("START then YES, and HELP", () => {
  it("START restores nothing alone; YES within 24 hours restores order texts only, never promos", async () => {
    const P = "+18455551001";
    const c = await optInOrders(P);
    await db.update(schema.customers).set({ marketingOptIn: true }).where(eq(schema.customers.id, c.id));
    await text(P, "STOP");
    await text(P, "START");
    expect((await customer(P)).smsOptOut).toBe(true);
    await text(P, "YES");
    const after = await customer(P);
    expect(after.smsOptOut).toBe(false);
    expect(after.marketingOptIn).toBe(false);
  });
  it("HELP replies with the business name, (845) 777-7585 and hupupattractions@gmail.com", async () => {
    const r = await text("+18455551002", "HELP");
    expect(r.reply).toBe(HELP_REPLY);
    for (const part of ["Hup Up Attractions", "(845) 777-7585", "hupupattractions@gmail.com"]) expect(HELP_REPLY).toContain(part);
  });
});

describe("failed and undelivered texts, permanent records", () => {
  it("delivery status and Twilio error codes are saved", async () => {
    const P = "+18455551101";
    await optInOrders(P);
    const r = await sendMessage({ to: P, body: "Your delivery is on the way.", kind: "transactional" });
    const [m] = await db.select().from(schema.messages).where(eq(schema.messages.id, r.messageId!));
    await handleSmsStatus({ MessageSid: m.twilioSid!, MessageStatus: "undelivered", ErrorCode: "30003", ErrorMessage: "Unreachable destination handset" });
    const [after] = await db.select().from(schema.messages).where(eq(schema.messages.id, m.id));
    expect(after).toMatchObject({ status: "undelivered", errorCode: "30003" });
  });
  it("consent records can never be edited or deleted", async () => {
    const [row] = await db.select().from(schema.smsConsents).limit(1);
    await expect(db.update(schema.smsConsents).set({ wording: "changed" }).where(eq(schema.smsConsents.id, row.id))).rejects.toThrow();
    await expect(db.delete(schema.smsConsents).where(eq(schema.smsConsents.id, row.id))).rejects.toThrow();
  });
});

describe("the 6 limit, January 1 reset, promo hours, segment length", () => {
  it("two campaigns at the same time never push a customer past 6", async () => {
    const P = "+18455551201";
    const [c] = await db.insert(schema.customers).values({ phone: P, marketingOptIn: true, marketingOptInAt: new Date(), timeZone: "America/New_York" }).returning();
    for (let i = 0; i < 5; i++)
      await db.insert(schema.messages).values({ direction: "out", toNumber: P, contactPhone: P, body: "old promo", kind: "marketing", status: "delivered", customerId: c.id, createdAt: new Date(`2026-0${i + 1}-10T17:00:00Z`) });
    const NOON = new Date("2026-11-10T17:00:00Z");
    const a = await createCampaign({ name: "A", body: "Deal A for our customers this week." }, 1);
    const b = await createCampaign({ name: "B", body: "Deal B for our customers this week." }, 1);
    await approveCampaign(a.id, 1);
    await approveCampaign(b.id, 1);
    await Promise.all([sendCampaign(a.id, 1, NOON), sendCampaign(b.id, 1, NOON)]);
    expect(await promosThisYear(P, NOON)).toBe(6);
    expect(await promosThisYear(P, new Date("2027-01-01T12:00:00Z"))).toBe(0); // January 1 reset (New York time)
  });
  it("promos only 8 AM - 9 PM local time; unknown zone: both the area-code zone and Eastern Time", () => {
    const at = (iso: string) => new Date(iso);
    expect(inMarketingHours("+13105550100", at("2026-11-10T16:30:00Z"), "America/Los_Angeles")).toBe(true); // 8:30 AM LA
    expect(inMarketingHours("+13105550100", at("2026-11-10T15:30:00Z"), "America/Los_Angeles")).toBe(false); // 7:30 AM LA
    expect(inMarketingHours("+13105550100", at("2026-11-11T01:30:00Z"), null)).toBe(true); // 5:30 PM LA and 8:30 PM New York: both allow
    expect(inMarketingHours("+13105550100", at("2026-11-11T02:30:00Z"), null)).toBe(false); // 6:30 PM LA, but 9:30 PM in New York
    expect(inMarketingHours("+13105550100", at("2026-11-10T13:30:00Z"), null)).toBe(false); // 8:30 AM New York, but 5:30 AM LA
  });
  it("promo format; segments counted for the SMS cost (texts up to 1,600 characters are allowed, Abraham section 7)", () => {
    const t = marketingBodyV2("Spring sale: 10% off jumping balloons booked this week.");
    expect(t.startsWith("Hup Up Attractions:")).toBe(true);
    expect(t.endsWith("Reply NOPROMO to stop promos, STOP to stop all texts.")).toBe(true);
    expect(segments(t).segments).toBe(1);
    expect(segments(marketingBodyV2("x ".repeat(60))).segments).toBe(2);
    expect(readFileSync("src/app/admin/(app)/campaigns/page.tsx", "utf8")).toContain("segment${seg.segments === 1");
  });
});

describe("website request, staff restrictions, A2P off", () => {
  it("the website promo box only requests the confirmation text (no consent until YES)", async () => {
    const P = "+18455551301";
    const r = await requestPromoByCustomer(P, "website box");
    expect(r.sent).toBe(true);
    expect(sentTo(P)).toEqual([promoConfirmRequestSms()]);
    expect(await consents(P, "marketing")).toHaveLength(0);
    expect((await requestPromoByCustomer(P, "website box")).sent).toBe(false); // no duplicate confirmation
  });
  it("staff: Owner writes/approves, Secretary sends approved campaigns; Delivery has no campaign access", () => {
    const actions = readFileSync("src/app/admin/(app)/campaigns/actions.ts", "utf8");
    expect(actions.match(/await requireOwner\(\)/g)).toHaveLength(3);
    expect(actions).toContain('requireStaff(["owner", "secretary"])');
    expect(readFileSync("src/app/admin/(app)/campaigns/page.tsx", "utf8")).toContain('requireStaff(["owner", "secretary"])');
    expect(readFileSync("src/app/admin/(app)/staff/page.tsx", "utf8")).toContain("data-staff-permissions");
  });
  it("until A2P is approved, no customer text goes out on the live site; owner alerts still do", async () => {
    const P = "+18455551401";
    await optInOrders(P);
    process.env.VERCEL_ENV = "production";
    const r = await sendMessage({ to: P, body: "Your order is confirmed.", kind: "transactional" });
    expect(r).toMatchObject({ sent: false, blocked: "not_active", error: "Not active yet: waiting for Twilio A2P approval" });
    const owner = await sendMessage({ to: "+18457777585", body: "New voicemail", kind: "system", event: "owner_alert" });
    expect(owner.blocked).toBeUndefined();
    process.env.TWILIO_MESSAGING_SERVICE_SID = "MG1";
    expect((await sendMessage({ to: P, body: "Your order is confirmed.", kind: "transactional" })).sent).toBe(true);
    delete process.env.TWILIO_MESSAGING_SERVICE_SID;
    delete process.env.VERCEL_ENV;
  });
});
