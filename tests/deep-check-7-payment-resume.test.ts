import { describe, expect, it, vi } from "vitest";

/* Deep check Nov 27 #7: a payment saved halfway (amount saved, status not) is finished by the repeat notice, never
   treated as a duplicate and never counted twice. In-memory database. */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/notify", () => ({ sendEmail: async () => ({ sent: true }), sendSms: async () => ({ sent: true }) }));

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { markGroupPaid, markPaid } from "@/lib/orders";

const get = async (id: number) => (await db.select().from(schema.orders).where(eq(schema.orders.id, id)))[0];
const books = async (id: number) => db.select().from(schema.bookEntries).where(eq(schema.bookEntries.orderId, id));
async function halfwayOrder(gid?: number) {
  // the state a failure leaves: the amount and reference saved, still waiting for payment, nothing in Books
  const [o] = await db
    .insert(schema.orders)
    .values({ status: "PENDING_PAYMENT", channel: "PHONE", eventDate: "2027-09-15", pickupDate: "2027-09-16", subtotalCents: 15000, totalCents: 15000, paidCents: 15000, solaRefNum: "HALF1", paymentGroupId: gid ?? null, updatedAt: new Date(Date.now() - 5 * 60_000), holdExpiresAt: new Date(Date.now() + 600_000) })
    .returning();
  return o.id;
}

describe("payment that stopped halfway", () => {
  it("the repeat notice confirms it and records it in Books once; the amount is not added again", async () => {
    const id = await halfwayOrder();
    await markPaid(id, 15000, "sola", "HALF1");
    let o = await get(id);
    expect([o.status, o.paidCents]).toEqual(["CONFIRMED", 15000]);
    expect((await books(id)).filter((b) => b.ref === "HALF1")).toHaveLength(1);
    // a third copy of the notice changes nothing
    await markPaid(id, 15000, "sola", "HALF1");
    o = await get(id);
    expect([o.status, o.paidCents]).toEqual(["CONFIRMED", 15000]);
    expect((await books(id)).filter((b) => b.ref === "HALF1")).toHaveLength(1);
  });
  it("a copy arriving at the same moment as the first (saved seconds ago, not finished yet) is a duplicate", async () => {
    const [o] = await db
      .insert(schema.orders)
      .values({ status: "PENDING_PAYMENT", channel: "PHONE", eventDate: "2027-09-15", pickupDate: "2027-09-16", subtotalCents: 7000, totalCents: 7000, paidCents: 7000, solaRefNum: "NOW1", updatedAt: new Date(), holdExpiresAt: new Date(Date.now() + 600_000) })
      .returning();
    const r = await markPaid(o.id, 7000, "sola", "NOW1");
    expect((r as { duplicate?: boolean }).duplicate).toBe(true);
    expect((await books(o.id))).toHaveLength(0);
  });
  it("a finished payment repeated is still a duplicate", async () => {
    const [o] = await db.insert(schema.orders).values({ status: "PENDING_PAYMENT", channel: "PHONE", eventDate: "2027-09-15", pickupDate: "2027-09-16", subtotalCents: 9000, totalCents: 9000, holdExpiresAt: new Date(Date.now() + 600_000) }).returning();
    await markPaid(o.id, 9000, "sola", "FULL1");
    await markPaid(o.id, 9000, "sola", "FULL1");
    expect((await get(o.id)).paidCents).toBe(9000);
  });
  it("a booking of several days: the retry finishes the halfway day, moves no money", async () => {
    const a = await halfwayOrder();
    await db.update(schema.orders).set({ paymentGroupId: a }).where(eq(schema.orders.id, a));
    const [b] = await db.insert(schema.orders).values({ status: "CONFIRMED", channel: "PHONE", eventDate: "2027-09-16", pickupDate: "2027-09-17", subtotalCents: 5000, totalCents: 5000, paidCents: 5000, solaRefNum: "HALF1", paymentGroupId: a }).returning();
    await markGroupPaid(a, 20000, "sola", "HALF1");
    expect([(await get(a)).status, (await get(a)).paidCents, (await get(b.id)).paidCents]).toEqual(["CONFIRMED", 15000, 5000]);
  });
});
