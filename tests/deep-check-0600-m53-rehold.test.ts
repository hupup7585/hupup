import { describe, expect, it, vi } from "vitest";

/* Deep check 0600 M53: Box 30 "hold again" checks the cart as one (two items sharing one unit never both pass). */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/notify", () => ({ sendEmail: async () => ({ sent: true }), sendSms: async () => ({ sent: true }), sendOrderText: async () => ({ sent: true }) }));

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { reholdOrders } from "@/lib/ivr/flow";

const ended = new Date(Date.now() - 3600_000);
async function shared() {
  const g = `maze-${Math.random()}`;
  const [c] = await db.insert(schema.categories).values({ name: `Bounce ${Math.random()}`, sortOrder: 1 }).returning();
  const [a, b] = await db
    .insert(schema.products)
    .values([
      { categoryId: c.id, name: "Castle red", priceCents: 30000, quantity: 1, stockGroup: g },
      { categoryId: c.id, name: "Castle blue", priceCents: 40000, quantity: 1, stockGroup: g },
    ])
    .returning();
  return [a.id, b.id];
}
async function cart(status: "HOLD" | "CANCELLED", pids: number[], notes: string | null = null) {
  const [o] = await db.insert(schema.orders).values({ status, channel: "PHONE", eventDate: "2027-08-18", pickupDate: "2027-08-19", holdExpiresAt: ended, notes }).returning();
  await db.insert(schema.orderItems).values(pids.map((p) => ({ orderId: o.id, productId: p, qty: 1, unitPriceCents: 1000 })));
  return o.id;
}
const get = async (id: number) => (await db.select().from(schema.orders).where(eq(schema.orders.id, id)))[0];
const lines = async (id: number) => db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, id));

describe("M53: hold the cart again", () => {
  it("two items sharing one unit: one is kept and held, the other comes out (returned for the item-taken screen)", async () => {
    const [a, b] = await shared();
    const id = await cart("HOLD", [a, b]);
    const taken = await reholdOrders([id]);
    expect(taken).toEqual({ p: b, d: "2027-08-18" });
    expect((await lines(id)).map((l) => l.productId)).toEqual([a]);
    const o = await get(id);
    expect(o.status).toBe("HOLD");
    expect(o.holdExpiresAt!.getTime()).toBeGreaterThan(Date.now());
  });
  it("a day released by the hourly tidy-up is held again when it fits; another call's booking keeps its unit", async () => {
    const [a] = await shared();
    const id = await cart("CANCELLED", [a], "Expired hold released. ");
    expect(await reholdOrders([id])).toBeNull();
    expect((await get(id)).status).toBe("HOLD");
    // someone else now holds the same unit: a second released cart with it is emptied and stays cancelled
    const other = await cart("CANCELLED", [a], "Expired hold released. ");
    expect(await reholdOrders([other])).toEqual({ p: a, d: "2027-08-18" });
    expect((await get(other)).status).toBe("CANCELLED");
    expect(await lines(other)).toEqual([]);
  });
  it("a day staff cancelled is never brought back", async () => {
    const [a] = await shared();
    const id = await cart("CANCELLED", [a], "Cancelled by staff. ");
    expect(await reholdOrders([id])).toBeNull();
    expect((await get(id)).status).toBe("CANCELLED");
  });
});
