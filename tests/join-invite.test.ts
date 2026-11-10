import { beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

/* JOIN invitation (Abraham, Nov 10, 2026): built, switched off, once per customer, never inside an order text. */
const h = vi.hoisted(() => ({ sent: [] as { to: string; body: string }[] }));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/twilio-client", () => ({
  getTwilio: () => ({ messages: { create: async (p: { to: string; body: string }) => (h.sent.push({ to: p.to, body: p.body }), { sid: `SM${h.sent.length}`, status: "queued" }) } }),
}));

import { db, schema } from "@/lib/db";
import { JOIN_INVITE_DRAFT, JOIN_INVITE_ON, joinInviteText, sendJoinInvites } from "@/lib/join-invite";
import { PROMOS_PER_YEAR } from "@/lib/sms-consent-copy";
import { promoConfirmRequestSms } from "@/lib/sms-terms-v2";
import { PROMPTS } from "@/lib/ivr/prompts";

const NOON = new Date("2026-11-10T17:00:00Z");
const P = { declined: "+18455550607", nopromo: "+18455550608", ok: "+18455550601", promo: "+18455550602", stop: "+18455550603", test: "+18455550604", noOrder: "+18455550605", noConsent: "+18455550606" };

beforeAll(async () => {
  process.env.TWILIO_PHONE_NUMBER = "+18454157585";
  process.env.TWILIO_ACCOUNT_SID = "ACtest";
  process.env.TWILIO_AUTH_TOKEN = "test";
  const rows = await db
    .insert(schema.customers)
    .values([
      { name: "Ok", phone: P.ok, timeZone: "America/New_York" },
      { name: "On promos", phone: P.promo, marketingOptIn: true, timeZone: "America/New_York" },
      { name: "Stopped", phone: P.stop, smsOptOut: true, timeZone: "America/New_York" },
      { name: "Test entry", phone: P.test, isTest: true, timeZone: "America/New_York" },
      { name: "No order", phone: P.noOrder, timeZone: "America/New_York" },
      { name: "No consent", phone: P.noConsent, timeZone: "America/New_York" },
      { name: "Declined promos", phone: P.declined, timeZone: "America/New_York" },
      { name: "Sent NOPROMO", phone: P.nopromo, timeZone: "America/New_York" },
    ])
    .returning();
  for (const c of rows) {
    if (c.phone !== P.noConsent)
      await db.insert(schema.smsConsents).values({ customerId: c.id, phone: c.phone!, scope: "transactional", action: "opt_in", source: "web", method: "checkbox", wording: "x" });
    if (c.phone === P.declined) await db.insert(schema.smsConsents).values({ customerId: c.id, phone: c.phone, scope: "marketing", action: "declined", source: "phone", method: "keypad", wording: "x" });
    if (c.phone === P.nopromo) await db.insert(schema.smsConsents).values({ customerId: c.id, phone: c.phone, scope: "marketing", action: "opt_out", source: "keyword", method: "keyword", wording: "NOPROMO" });
    if (c.phone !== P.noOrder) await db.insert(schema.orders).values({ customerId: c.id, eventDate: "2026-11-01", pickupDate: "2026-11-02", status: "PICKED_UP", channel: "PHONE" });
  }
});

describe("JOIN invitation", () => {
  it("is switched off, and does nothing while off", async () => {
    expect(JOIN_INVITE_ON).toBe(false);
    expect(await sendJoinInvites(NOON)).toEqual({ on: false, sent: 0, skipped: 0 });
    expect(h.sent).toHaveLength(0);
  });
  it("its yearly number matches the phone line and the confirmation text", () => {
    expect(JOIN_INVITE_DRAFT).toContain("{n}");
    expect(joinInviteText()).toContain(`up to ${PROMOS_PER_YEAR} promo texts a year`);
    expect(promoConfirmRequestSms()).toContain(`up to ${PROMOS_PER_YEAR} promotional messages per calendar year`);
    expect(PROMPTS.promo_ask.text).toContain(`up to ${PROMOS_PER_YEAR} a year`);
  });
  it("when turned on: one text per eligible customer, once ever; skips anyone who joined, declined, sent NOPROMO or STOP, test entries, no order, no consent", async () => {
    const r = await sendJoinInvites(NOON, true);
    expect(r.sent).toBe(1);
    expect(h.sent.map((m) => m.to)).toEqual([P.ok]);
    expect(h.sent[0].body).toBe(joinInviteText());
    const again = await sendJoinInvites(NOON, true);
    expect(again.sent).toBe(0);
    expect(h.sent).toHaveLength(1);
  });
  it("never inside an order text, and never at night", async () => {
    expect(readFileSync("src/lib/sms.ts", "utf8")).not.toContain("joinInvite");
    expect(readFileSync("src/lib/ivr/flow.ts", "utf8")).not.toContain("joinInvite");
    expect((await sendJoinInvites(new Date("2026-11-11T05:00:00Z"), true)).sent).toBe(0); // midnight in New York
  });
});
