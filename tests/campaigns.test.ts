import { beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

/* Promo campaigns and the 6-per-year limit (Abraham, Nov 9, 2026). In-memory database with the real migrations. */
const h = vi.hoisted(() => ({ sent: [] as { to: string; body: string }[] }));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/twilio-client", () => ({
  getTwilio: () => ({ messages: { create: async (p: { to: string; body: string }) => (h.sent.push({ to: p.to, body: p.body }), { sid: `SM${h.sent.length}`, status: "queued" }) } }),
}));

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { approveCampaign, campaignsCanSend, cancelCampaign, createCampaign, eligibleOf, promoSignups, segments, sendCampaign } from "@/lib/campaigns";
import { marketingBodyV2, promosThisYear, sendMessage } from "@/lib/sms";

const NOON = new Date("2026-11-10T17:00:00Z"); // noon in New York: inside promo hours
let ids: number[] = [];

beforeAll(async () => {
  process.env.TWILIO_PHONE_NUMBER = "+18454157585";
  const rows = await db
    .insert(schema.customers)
    .values([
      { name: "Signed up", phone: "+18455550301", marketingOptIn: true, marketingOptInAt: NOON, timeZone: "America/New_York" },
      { name: "Never signed up", phone: "+18455550302", marketingOptIn: false },
      { name: "Replied STOP", phone: "+18455550303", marketingOptIn: true, smsOptOut: true },
      { name: "Busy promo year", phone: "+18455550304", marketingOptIn: true, timeZone: "America/New_York" },
    ])
    .returning();
  ids = rows.map((r) => r.id);
  await db.insert(schema.smsConsents).values({ customerId: ids[0], phone: "+18455550301", scope: "marketing", action: "opt_in", source: "web", method: "checkbox", wording: "x" });
  // Busy customer: already 5 promos this year
  for (let i = 0; i < 5; i++)
    await db.insert(schema.messages).values({ direction: "out", toNumber: "+18455550304", contactPhone: "+18455550304", body: "promo", kind: "marketing", status: "delivered", customerId: ids[3], createdAt: new Date(`2026-0${i + 1}-15T17:00:00Z`) });
});

describe("5 promo texts per customer per year (SMS v3)", () => {
  it("the 6th promo of the year is refused; blocked or failed ones don't count; a new year starts fresh", async () => {
    expect(await promosThisYear("+18455550304", NOON)).toBe(5);
    const r = await sendMessage({ to: "+18455550304", body: "Another deal", kind: "marketing", now: NOON });
    expect(r).toMatchObject({ sent: false, blocked: "yearly_limit" });
    expect(await promosThisYear("+18455550304", NOON)).toBe(5);
    expect(await promosThisYear("+18455550304", new Date("2027-01-02T17:00:00Z"))).toBe(0); // January 1 reset
  });
});

describe("campaigns", () => {
  it("lists who signed up (with how and this year's count) and who can get the next one", async () => {
    const list = await promoSignups(NOON);
    expect(list.map((s) => [s.name, s.status, s.thisYear])).toEqual(
      expect.arrayContaining([
        ["Signed up", "Active", 0],
        ["Replied STOP", "Stopped all texts", 0],
        ["Busy promo year", "At yearly limit", 5],
      ]),
    );
    expect(list.find((s) => s.name === "Signed up")!.source).toBe("web");
    expect(list.some((s) => s.name === "Never signed up")).toBe(false);
    expect(eligibleOf(list).map((s) => s.name)).toEqual(["Signed up"]);
  });

  it("Owner writes, approves, then sends to eligible customers only, once each; it can't be sent twice", async () => {
    const c = await createCampaign({ name: "Winter 2026", body: "Winter special! 10% off laser tag booked by Dec 31." }, 1);
    await expect(sendCampaign(c.id, 1, NOON)).rejects.toThrow(/Only an approved campaign/);
    await approveCampaign(c.id, 1);
    const done = await sendCampaign(c.id, 2, NOON);
    expect(done).toMatchObject({ status: "sent", sentCount: 1, eligibleCount: 1, sentBy: 2 });
    const { campaignRecipients } = await import("@/lib/campaigns");
    expect((await campaignRecipients(c.id)).map((r) => r.name)).toEqual(["Signed up", "Replied STOP", "Busy promo year"]);
    expect(h.sent.map((m) => m.to)).toEqual(["+18455550301"]);
    await expect(sendCampaign(c.id, 2, NOON)).rejects.toThrow(/Only an approved campaign/);
    const sends = await db.select().from(schema.smsCampaignSends).where(eq(schema.smsCampaignSends.campaignId, c.id));
    // History keeps the skipped customers and why
    expect(sends.map((s) => [s.status, s.reason])).toEqual([
      ["sent", null],
      ["skipped", "Replied STOP (no texts)"],
      ["skipped", "Already got 5 promo texts this year"],
    ]);
    expect(done.skippedCount).toBe(2);
    const [msg] = await db.select().from(schema.messages).where(eq(schema.messages.id, sends[0].messageId!));
    expect(msg).toMatchObject({ kind: "marketing", userId: 2, event: `campaign:${c.id}` });
    const d2 = await createCampaign({ name: "Never mind", body: "Spring deals coming soon to Hup Up." }, 1);
    await cancelCampaign(d2.id, 1);
    await expect(approveCampaign(d2.id, 1)).rejects.toThrow();
  });

  it("SMS Terms v2 promo format and length; sending waits for Twilio approval on the live site", () => {
    const t = marketingBodyV2("Summer special! 15% off paddle boat rentals booked by June 30. Call (845) 415-7585.");
    expect(t).toBe("Hup Up Attractions: Summer special! 15% off paddle boat rentals booked by June 30. Call (845) 415-7585. Reply NOPROMO to stop promos, STOP to stop all texts.");
    expect(segments(t)).toEqual({ chars: 157, segments: 1 });
    expect(segments("x".repeat(161)).segments).toBe(2);
    expect(campaignsCanSend({ VERCEL_ENV: "production" })).toBe(false);
    expect(campaignsCanSend({ VERCEL_ENV: "production", TWILIO_ACCOUNT_SID: "AC", TWILIO_AUTH_TOKEN: "t", TWILIO_MESSAGING_SERVICE_SID: "MG" })).toBe(true);
  });

  it("screens: Secretary may send approved campaigns only; Owner writes and approves; 'Not active yet' note", () => {
    const actions = readFileSync("src/app/admin/(app)/campaigns/actions.ts", "utf8");
    expect(actions.match(/await requireOwner\(\)/g)).toHaveLength(3); // create, approve, cancel
    expect(actions).toContain('const s = await requireStaff(["owner", "secretary"]);'); // send
    const page = readFileSync("src/app/admin/(app)/campaigns/page.tsx", "utf8");
    expect(page).toContain('data-not-active="campaigns"');
    expect(page).toContain('requireStaff(["owner", "secretary"])');
    expect(readFileSync("drizzle/0025_sms_campaigns.sql", "utf8")).not.toMatch(/\bDROP\b|\bDELETE\b/i);
  });
});
