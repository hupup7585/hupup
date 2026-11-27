import { describe, expect, it, vi } from "vitest";

/* Extra check P (Nov 27, 2026): multi-day payments. In-memory database; notices are stand-ins. */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/notify", () => ({ sendSms: async () => ({ sent: true }), sendEmail: async () => ({ sent: true }) }));

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { markGroupPaid } from "@/lib/orders";

const get = async (id: number) => (await db.select().from(schema.orders).where(eq(schema.orders.id, id)))[0];
const later = () => new Date(Date.now() + 10 * 60_000);

async function twoDays(a: Partial<typeof schema.orders.$inferInsert>, b: Partial<typeof schema.orders.$inferInsert>, dates: [string, string]) {
  const [d1] = await db.insert(schema.orders).values({ status: "PENDING_PAYMENT", channel: "PHONE", eventDate: dates[0], pickupDate: dates[0], subtotalCents: 10000, totalCents: 10000, holdExpiresAt: later(), ...a }).returning();
  const [d2] = await db.insert(schema.orders).values({ status: "PENDING_PAYMENT", channel: "PHONE", eventDate: dates[1], pickupDate: dates[1], subtotalCents: 20000, totalCents: 20000, holdExpiresAt: later(), paymentGroupId: d1.id, ...b }).returning();
  await db.update(schema.orders).set({ paymentGroupId: d1.id }).where(eq(schema.orders.id, d1.id));
  return [d1, d2];
}

describe("extra check P: one payment for several days", () => {
  it("Pay2: the retry of a payment that stopped after the first day finished pays the second day its share (once)", async () => {
    // the first try: day 1 got its $100 and was confirmed, then it stopped before day 2
    const [d1, d2] = await twoDays({ status: "CONFIRMED", paidCents: 10000, solaRefNum: "RR2" }, {}, ["2027-03-01", "2027-03-02"]);
    await markGroupPaid(d1.id, 30000, "sola", "RR2");
    expect([(await get(d2.id)).paidCents, (await get(d2.id)).status]).toEqual([20000, "CONFIRMED"]);
    expect((await get(d1.id)).paidCents).toBe(10000);
    // a third copy changes nothing
    await markGroupPaid(d1.id, 30000, "sola", "RR2");
    expect([(await get(d1.id)).paidCents, (await get(d2.id)).paidCents]).toEqual([10000, 20000]);
  });

  it("Pay3: a link payment for the waiting day goes to that day, not to a confirmed day with a balance", async () => {
    // day 1 confirmed and paid $100 of $150 (staff added an item later); day 2 waiting for $200; the link charged $200
    const [d1, d2] = await twoDays({ status: "CONFIRMED", paidCents: 10000, totalCents: 15000, subtotalCents: 15000, solaRefNum: "OLD" }, {}, ["2027-03-08", "2027-03-09"]);
    await markGroupPaid(d1.id, 20000, "sola", "NEW3");
    expect([(await get(d2.id)).paidCents, (await get(d2.id)).status]).toEqual([20000, "CONFIRMED"]);
    expect((await get(d1.id)).paidCents).toBe(10000);
  });
  it("Pay4: paid but a day needs staff: the phone never says 'booking confirmed' (goodbye) and no confirmation text is made", async () => {
    process.env.PUBLIC_BASE_URL = "https://hupup.example";
    const [o] = await db.insert(schema.orders).values({ status: "NEEDS_ATTENTION", channel: "PHONE", eventDate: "2027-03-15", pickupDate: "2027-03-16", subtotalCents: 10000, totalCents: 10000, paidCents: 10000 }).returning();
    const { handleVoice } = await import("@/lib/ivr/flow");
    const xml = await handleVoice({ action: "pay-approved", query: new URLSearchParams(`o=${o.id}`), body: { CallSid: "CApay4" }, callSid: "CApay4", from: "+18455550444" });
    expect(xml).toContain("/api/voice/goodbye");
    expect(xml).not.toContain("approved");
    const { confirmationText } = await import("@/lib/payment-result");
    expect(await confirmationText(o.id)).toBeNull();
    // the same order once staff confirm it: approved and the confirmation as before
    await db.update(schema.orders).set({ status: "CONFIRMED" }).where(eq(schema.orders.id, o.id));
    expect(await handleVoice({ action: "pay-approved", query: new URLSearchParams(`o=${o.id}`), body: { CallSid: "CApay4" }, callSid: "CApay4", from: "+18455550444" })).toContain("pay-approved-choice");
    expect(await confirmationText(o.id)).not.toBeNull();
  });
});

