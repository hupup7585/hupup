import { describe, expect, it, vi } from "vitest";

/* Hark's website list (Nov 26, 2026) A1-A3 on "Check availability again" and the nearest options:
   A1 the order's items are checked together (a shared unit can't go to two items), A2 an order staff cancelled is never
   brought back, A3 a day that has passed (or a closed day for a phone booking) is never held again. */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { chooseLinkOption, holdAgain } from "@/lib/late-payment";

const now = new Date("2026-12-01T15:00:00Z");
const ended = new Date("2026-12-01T14:00:00Z");
const items = async (id: number) => (await db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, id))).map((i) => i.productId);
const order = async (id: number) => (await db.select().from(schema.orders).where(eq(schema.orders.id, id)))[0];

async function products() {
  const [c] = await db.insert(schema.categories).values({ name: `Laser ${Math.random()}`, sortOrder: 1 }).returning();
  // two items that share ONE maze (stock group), and a plain item
  const [a, b, x] = await db
    .insert(schema.products)
    .values([
      { categoryId: c.id, name: "Garbage maze", priceCents: 30000, quantity: 1, stockGroup: "maze" },
      { categoryId: c.id, name: "Maze with 6 laser guns", priceCents: 40000, quantity: 1, stockGroup: "maze" },
      { categoryId: c.id, name: "Paddle boat", priceCents: 9000, quantity: 5 },
    ])
    .returning();
  return { a: a.id, b: b.id, x: x.id };
}
async function expiredOrder(pids: number[], eventDate = "2026-12-20", status: "PENDING_PAYMENT" | "CANCELLED" = "PENDING_PAYMENT") {
  const [o] = await db.insert(schema.orders).values({ status, channel: "PHONE", eventDate, pickupDate: "2026-12-21", holdExpiresAt: ended }).returning();
  await db.insert(schema.orderItems).values(pids.map((p) => ({ orderId: o.id, productId: p, qty: 1, unitPriceCents: 1000 })));
  return o.id;
}

describe("Check availability again", () => {
  it("A1: two items sharing one maze: only one is held again, the other gets its options", async () => {
    const { a, b, x } = await products();
    const id = await expiredOrder([a, b, x]);
    const r = await holdAgain([id], id, now);
    expect(r.removed).toBe(1);
    const left = await items(id);
    expect(left).toHaveLength(2);
    expect(left).toContain(x);
    expect((await order(id)).status).toBe("PENDING_PAYMENT");
    expect((await order(id)).linkRemoved).toHaveLength(1);
  });
  it("A2: an order staff cancelled in Admin stays cancelled, and its options can't revive it", async () => {
    const { x } = await products();
    const id = await expiredOrder([x], "2026-12-20", "CANCELLED");
    await db.insert(schema.orderStatusHistory).values({ orderId: id, fromStatus: "PENDING_PAYMENT", toStatus: "CANCELLED", userId: null, reason: "Cancelled by staff" });
    await db.insert(schema.auditLog).values({ action: "order.status", entityType: "order", entityId: String(id), after: { status: "CANCELLED" } });
    await holdAgain([id], id, now);
    expect((await order(id)).status).toBe("CANCELLED");
    expect(await chooseLinkOption(id, 0, x, "2026-12-21", now)).toBe(false);
    expect((await order(id)).status).toBe("CANCELLED");
  });
  it("A3: a day that has passed is never held again", async () => {
    const { x } = await products();
    const id = await expiredOrder([x], "2026-11-25");
    const r = await holdAgain([id], id, now);
    expect(r.removed).toBe(1);
    expect(await items(id)).toEqual([]);
  });
});
