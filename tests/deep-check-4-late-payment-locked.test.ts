import { describe, expect, it, vi } from "vitest";

/* Deep check Nov 27 #4: a late payment checks the whole order as one (shared maze unit counted), locked. */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/notify", () => ({ sendEmail: async () => ({ sent: true }), sendSms: async () => ({ sent: true }) }));

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { markPaid } from "@/lib/orders";
import { claimIfStillFree } from "@/lib/late-payment";

const ended = new Date(Date.now() - 3600_000);
async function products() {
  const g = `maze-${Math.random()}`;
  const [c] = await db.insert(schema.categories).values({ name: `Laser ${Math.random()}`, sortOrder: 1 }).returning();
  const [a, b, x] = await db
    .insert(schema.products)
    .values([
      { categoryId: c.id, name: "Castle red", priceCents: 30000, quantity: 1, stockGroup: g },
      { categoryId: c.id, name: "Castle blue", priceCents: 40000, quantity: 1, stockGroup: g },
      { categoryId: c.id, name: "Water slide", priceCents: 9000, quantity: 5 },
    ])
    .returning();
  return { a: a.id, b: b.id, x: x.id };
}
async function releasedOrder(pids: number[], total: number) {
  const [o] = await db.insert(schema.orders).values({ status: "CANCELLED", channel: "PHONE", eventDate: "2027-08-18", pickupDate: "2027-08-19", holdExpiresAt: ended, subtotalCents: total, totalCents: total }).returning();
  await db.insert(schema.orderItems).values(pids.map((p) => ({ orderId: o.id, productId: p, qty: 1, unitPriceCents: 1000 })));
  await db.insert(schema.orderStatusHistory).values({ orderId: o.id, fromStatus: "PENDING_PAYMENT", toStatus: "CANCELLED", userId: null, reason: "Hold ended" });
  return o.id;
}
const get = async (id: number) => (await db.select().from(schema.orders).where(eq(schema.orders.id, id)))[0];

describe("late payment stock check", () => {
  it("two items sharing one unit (stock group): not free as a whole, so Needs attention (never confirmed, overbooked)", async () => {
    const { a, b } = await products();
    const id = await releasedOrder([a, b], 2000);
    expect(await claimIfStillFree(id)).toBe(false);
    expect((await get(id)).status).toBe("CANCELLED"); // nothing changed by the check
    await markPaid(id, 2000, "sola", "L4A");
    expect((await get(id)).status).toBe("NEEDS_ATTENTION");
  });
  it("items that fit: confirmed by the late payment", async () => {
    const { a, x } = await products();
    const id = await releasedOrder([a, x], 2000);
    const { checkBookable } = await import("@/lib/availability");
    expect([await checkBookable(a, 1, "2027-08-18", db, "2027-08-19"), await checkBookable(x, 5, "2027-08-18", db, "2027-08-19")]).toEqual([1, 5]);
    await markPaid(id, 2000, "sola", "L4B");
    expect((await get(id)).status).toBe("CONFIRMED");
  });
});
