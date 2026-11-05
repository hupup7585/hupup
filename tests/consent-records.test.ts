import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

/*
 * Abram's 8 recommended edits (2026-11-05). The database is mocked: every insert/update/delete is captured,
 * so we can prove consent records are only ever added (never edited or deleted).
 */

const h = vi.hoisted(() => ({
  rows: new Map<unknown, unknown[]>(),
  inserts: [] as { table: unknown; v: Record<string, unknown> }[],
  updates: [] as { table: unknown; v: Record<string, unknown> }[],
  deletes: [] as unknown[],
}));

vi.mock("@/lib/db", async () => {
  const schema = await vi.importActual<typeof import("@/lib/db/schema")>("@/lib/db/schema");
  const q = (rows: unknown[]): unknown => {
    const p: Record<string, unknown> = { where: () => p, limit: () => p, orderBy: () => p, then: (res: (v: unknown) => void) => res(rows) };
    return p;
  };
  const db = {
    select: () => ({ from: (t: unknown) => q(h.rows.get(t) ?? []) }),
    insert: (t: unknown) => ({
      values: (v: Record<string, unknown>) => {
        h.inserts.push({ table: t, v });
        const r = [{ id: 100 + h.inserts.length, ...v }];
        return { returning: () => Promise.resolve(r), then: (res: (v: unknown) => void) => res(undefined) };
      },
    }),
    update: (t: unknown) => ({ set: (v: Record<string, unknown>) => ({ where: () => (h.updates.push({ table: t, v }), Promise.resolve()) }) }),
    delete: (t: unknown) => (h.deletes.push(t), { where: () => Promise.resolve() }),
  };
  return { db, schema };
});

const { schema } = await import("@/lib/db");
const consent = await import("@/lib/sms-consent");
const { handleInboundSms, NOPROMO_CONFIRMATION } = await import("@/lib/sms-inbound");
const { sendMessage } = await import("@/lib/sms");
const { STAFF_DISCLOSURE } = await import("@/lib/sms-consent-copy");

const PHONE = "+18455550100";
const cust = (over: Record<string, unknown> = {}) => ({ id: 9, phone: PHONE, name: "Yossi", smsOptOut: false, marketingOptIn: false, marketingOptInAt: null, timeZone: null, ...over });

beforeEach(() => {
  h.rows = new Map();
  h.inserts = [];
  h.updates = [];
  h.deletes = [];
});

const consentInserts = () => h.inserts.filter((i) => i.table === schema.smsConsents).map((i) => i.v);
const noConsentEditsOrDeletes = () => {
  expect(h.updates.filter((u) => u.table === schema.smsConsents)).toEqual([]);
  expect(h.deletes.filter((d) => d === schema.smsConsents)).toEqual([]);
};

describe("1. customer's own time zone first", () => {
  const ninePmNY = new Date("2026-07-02T01:30:00Z"); // 6:30 PM in California
  it("a promo to a customer who told us they're in California goes out at 6:30 PM Pacific", async () => {
    h.rows.set(schema.customers, [cust({ marketingOptIn: true, timeZone: "America/Los_Angeles" })]);
    const r = await sendMessage({ to: PHONE, body: "Spring deals", kind: "marketing", now: ninePmNY });
    expect(r.blocked).toBeUndefined();
  });
  it("without a recorded zone the New York fallback applies and blocks it", async () => {
    h.rows.set(schema.customers, [cust({ marketingOptIn: true })]);
    const r = await sendMessage({ to: PHONE, body: "Spring deals", kind: "marketing", now: ninePmNY });
    expect(r.blocked).toBe("quiet_hours");
  });
  it("only zones from the list can be stored", async () => {
    expect(await consent.setCustomerTimeZone(PHONE, "Mars/Olympus", "web_form")).toBe(false);
    expect(await consent.setCustomerTimeZone(PHONE, "America/Chicago", "phone")).toBe(true);
    expect(h.updates.at(-1)?.v).toMatchObject({ timeZone: "America/Chicago", timeZoneSource: "phone" });
  });
});

describe("3. staff must read the entire disclosure; silence or unclear = no consent", () => {
  const base = { phone: PHONE, wording: STAFF_DISCLOSURE.marketing.replace("{phone}", "(845) 555-0100"), wordingVersion: "staff-2026-11-05", userId: 3 };
  it("a yes cannot be recorded unless the full disclosure was read", async () => {
    await expect(consent.recordStaffConsent({ ...base, scope: "marketing", response: "clear_yes", disclosureRead: false })).rejects.toThrow(/entire disclosure/);
    expect(consentInserts()).toEqual([]);
  });
  it("clear yes after a full reading is an opt-in, with who/when/what stored", async () => {
    h.rows.set(schema.customers, [cust()]);
    await consent.recordStaffConsent({ ...base, scope: "marketing", response: "clear_yes", disclosureRead: true, timeZone: "America/Denver" });
    expect(consentInserts()[0]).toMatchObject({ scope: "marketing", action: "opt_in", source: "staff", method: "staff", disclosureRead: true, userId: 3, wording: base.wording, response: "customer clearly said yes" });
    expect(h.updates.some((u) => u.v.timeZone === "America/Denver")).toBe(true);
  });
  it("silence, uncertainty or an unclear answer is recorded as declined", async () => {
    h.rows.set(schema.customers, [cust()]);
    await consent.recordStaffConsent({ ...base, scope: "transactional", response: "unclear_or_silent", disclosureRead: true });
    await consent.recordStaffConsent({ ...base, scope: "transactional", response: "said_no", disclosureRead: false });
    expect(consentInserts().map((c) => c.action)).toEqual(["declined", "declined"]);
  });
  it("the admin action is limited to Owner/Secretary and audited", () => {
    const a = readFileSync("src/app/admin/(app)/orders/consent-actions.ts", "utf8");
    expect(a).toContain("requireAdmin()");
    expect(a).toContain('user.role === "delivery"');
    expect(a).toContain("schema.auditLog");
  });
});

describe("4. different confirmations; promotional one has no advertising", () => {
  it("transactional and promotional confirmations differ", () => {
    expect(consent.TRANSACTIONAL_CONFIRMATION_SMS).not.toBe(consent.MARKETING_CONFIRMATION_SMS);
    expect(consent.TRANSACTIONAL_CONFIRMATION_SMS).toContain("order and service texts");
    expect(consent.MARKETING_CONFIRMATION_SMS).toContain("promotional text messages");
  });
  it("promotional confirmation contains no offer", () => {
    expect(consent.MARKETING_CONFIRMATION_SMS).not.toMatch(/%|\$|\boff\b|deal|sale|discount|free|special|offer|save|coupon|promo code/i);
  });
});

describe("5. opt-outs apply immediately, including already-queued promotions", () => {
  it("STOP cancels pending promotional texts for that number", async () => {
    h.rows.set(schema.customers, [cust({ marketingOptIn: true })]);
    h.rows.set(schema.messages, [{ id: 55, sid: null }]);
    await handleInboundSms({ From: PHONE, Body: "STOP" });
    expect(h.updates.find((u) => u.table === schema.customers)?.v).toMatchObject({ smsOptOut: true, marketingOptIn: false });
    expect(h.updates.find((u) => u.table === schema.messages)?.v).toMatchObject({ status: "canceled" });
    expect(consentInserts().map((c) => `${c.scope}:${c.action}`)).toEqual(["transactional:opt_out", "marketing:opt_out"]);
    noConsentEditsOrDeletes();
  });
  it("a send also re-checks consent at the moment it goes out", async () => {
    h.rows.set(schema.customers, [cust({ smsOptOut: true, marketingOptIn: false })]);
    const r = await sendMessage({ to: PHONE, body: "Spring deals", kind: "marketing", now: new Date("2026-07-01T16:00:00Z") });
    expect(r.sent).toBe(false);
  });
});

describe("6. NOPROMO: promotions only, never overrides STOP", () => {
  it("not opted out: promotions off, order texts stay, confirmation sent", async () => {
    h.rows.set(schema.customers, [cust({ marketingOptIn: true })]);
    const r = await handleInboundSms({ From: PHONE, Body: "NOPROMO" });
    expect(r.reply).toBe(NOPROMO_CONFIRMATION);
    const upd = h.updates.find((u) => u.table === schema.customers)!.v;
    expect(upd).toEqual({ marketingOptIn: false });
  });
  it("after STOP: stays fully opted out, no reply, smsOptOut untouched", async () => {
    h.rows.set(schema.customers, [cust({ smsOptOut: true })]);
    const r = await handleInboundSms({ From: PHONE, Body: "nopromo" });
    expect(r.reply).toBeNull();
    for (const u of h.updates.filter((x) => x.table === schema.customers)) expect(u.v).not.toHaveProperty("smsOptOut");
  });
});

describe("7. corrections are separate, timestamped entries; originals are never edited or deleted", () => {
  const original = { id: 7, customerId: 9, phone: PHONE, scope: "marketing", action: "opt_in", source: "staff", wording: "W", wordingVersion: "staff-2026-11-05" };
  it("adds a new row pointing at the original, with reason and who", async () => {
    h.rows.set(schema.smsConsents, [original]);
    await consent.correctConsent({ originalId: 7, action: "declined", reason: "Recorded on the wrong customer", userId: 3 });
    expect(consentInserts()).toHaveLength(1);
    expect(consentInserts()[0]).toMatchObject({ correctsConsentId: 7, correctionReason: "Recorded on the wrong customer", userId: 3, action: "declined", scope: "marketing", phone: PHONE });
    noConsentEditsOrDeletes();
  });
  it("needs a reason and a person", async () => {
    h.rows.set(schema.smsConsents, [original]);
    await expect(consent.correctConsent({ originalId: 7, action: "declined", reason: "  ", userId: 3 })).rejects.toThrow(/reason/);
    await expect(consent.correctConsent({ originalId: 7, action: "declined", reason: "x", userId: 0 })).rejects.toThrow(/who/);
  });
  it("migration 0006 adds the correction link, reason/person check and staff-disclosure check (add-only)", () => {
    const sql = readFileSync("drizzle/0006_consent_corrections_timezone.sql", "utf8");
    for (const s of ['ADD COLUMN "time_zone"', 'ADD COLUMN "time_zone_source"', 'ADD COLUMN "time_zone_set_at"', 'ADD COLUMN "disclosure_read"', 'ADD COLUMN "corrects_consent_id"', 'ADD COLUMN "correction_reason"', "sms_consents_corrects_fk", "sms_consents_correction_needs_reason", "sms_consents_staff_optin_disclosure"])
      expect(sql).toContain(s);
    expect(sql).not.toMatch(/\b(DROP|DELETE FROM|UPDATE\s+"|ALTER COLUMN|RENAME)\b/i);
    expect(readFileSync("drizzle/meta/_journal.json", "utf8")).toContain('"tag": "0006_consent_corrections_timezone"');
  });
});

describe("8. security and docs", () => {
  it("policy and SMS Terms cover restricted access, secure storage and immediate reporting", () => {
    const doc = readFileSync("docs/sms-compliance-policy.md", "utf8");
    for (const s of ["Restricted access", "Secure storage", "Immediate reporting", "separate, timestamped correction entry", "NOPROMO", "entire", "Silence, uncertainty, or an unclear response counts as no consent"]) expect(doc).toContain(s);
    const terms = readFileSync("src/app/sms-terms/page.tsx", "utf8");
    for (const s of ["<h2>Security</h2>", "limited to authorized staff", "reported to us immediately", "separate, dated correction entry", "It never undoes a STOP"]) expect(terms).toContain(s);
  });
});

describe("11. withdrawal and re-enrollment", () => {
  it("after STOP nothing goes out except the opt-out confirmation (not even system confirmations)", async () => {
    h.rows.set(schema.customers, [cust({ smsOptOut: true })]);
    expect((await sendMessage({ to: PHONE, body: "x", kind: "system", event: "consent_confirmation" })).blocked).toBe("opted_out");
    expect((await sendMessage({ to: PHONE, body: "x", kind: "transactional" })).blocked).toBe("opted_out");
    expect((await sendMessage({ to: PHONE, body: "Hup Up Attractions: You're unsubscribed.", kind: "system", event: "opt_out_confirmation" })).blocked).toBeUndefined();
  });
  it("re-enrollment is a new row linked to the withdrawal it follows; history untouched", async () => {
    h.rows.set(schema.customers, [cust()]);
    h.rows.set(schema.smsConsents, [{ id: 31, action: "opt_out" }]);
    await consent.recordConsent({ phone: PHONE, scope: "marketing", action: "opt_in", source: "web", method: "checkbox", wording: "W", wordingVersion: "web-2026-11-05" });
    expect(consentInserts()[0]).toMatchObject({ action: "opt_in", reenrollsAfterId: 31 });
    noConsentEditsOrDeletes();
  });
  it("a first enrollment has no re-enrollment link", async () => {
    h.rows.set(schema.customers, [cust()]);
    await consent.recordConsent({ phone: PHONE, scope: "transactional", action: "opt_in", source: "phone", method: "keypad", wording: "W", wordingVersion: "v" });
    expect(consentInserts()[0].reenrollsAfterId).toBeNull();
  });
  it("only approved processes can enroll: no promotional opt-in by keyword, no staff yes without the full reading", async () => {
    await expect(consent.recordConsent({ phone: PHONE, scope: "marketing", action: "opt_in", source: "keyword", method: "keyword", wording: "START", wordingVersion: "keyword" })).rejects.toThrow(/new consent/);
    await expect(consent.recordConsent({ phone: PHONE, scope: "marketing", action: "opt_in", source: "staff", method: "staff", wording: "W", wordingVersion: "v", disclosureRead: false })).rejects.toThrow(/entire disclosure/);
    expect(consentInserts()).toEqual([]);
  });
  it("START re-enrolls order texts only, as a separate linked record; promotions stay off", async () => {
    h.rows.set(schema.customers, [cust({ smsOptOut: true })]);
    h.rows.set(schema.smsConsents, [{ id: 40, action: "opt_out" }]);
    await handleInboundSms({ From: PHONE, Body: "START" });
    expect(h.updates.find((u) => u.table === schema.customers)?.v).toEqual({ smsOptOut: false });
    expect(consentInserts()).toHaveLength(1);
    expect(consentInserts()[0]).toMatchObject({ scope: "transactional", action: "opt_in", source: "keyword", reenrollsAfterId: 40 });
  });
  it("migration 0007 adds the re-enrollment link (add-only) and the policy has sections 11 and 12", () => {
    const sql = readFileSync("drizzle/0007_consent_reenrollment.sql", "utf8");
    expect(sql).toContain('ADD COLUMN "reenrolls_after_id"');
    expect(sql).toContain("sms_consents_reenrolls_fk");
    expect(sql).not.toMatch(/\b(DROP|DELETE FROM|UPDATE\s+"|ALTER COLUMN|RENAME)\b/i);
    const doc = readFileSync("docs/sms-compliance-policy.md", "utf8");
    expect(doc).toContain("## 11. Consent Withdrawal and Re-Enrollment");
    expect(doc).toContain("## 12. System Controls and Compliance Monitoring");
  });
});
