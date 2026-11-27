import { describe, expect, it, vi } from "vitest";

/* Code audit H5 (Nov 24, 2026): "Check availability again" on an order whose every item was taken never leaves an
   empty order waiting for payment with only delivery and tax on it. */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { holdAgain } from "@/lib/late-payment";

const get = async (id: number) => (await db.select().from(schema.orders).where(eq(schema.orders.id, id)))[0];

describe("check availability again, everything taken", () => {
  it("the emptied order is cancelled with nothing to pay; another order keeps the item", async () => {
    const [c] = await db.insert(schema.categories).values({ name: "Bounce", sortOrder: 1 }).returning();
    const [p] = await db.insert(schema.products).values({ categoryId: c.id, name: "Castle", priceCents: 20000, quantity: 1 }).returning();
    const now = new Date();
    const day = new Date(now.getTime() + 20 * 86400_000).toISOString().slice(0, 10);
    const next = new Date(now.getTime() + 21 * 86400_000).toISOString().slice(0, 10);
    // our order: link expired (hold ended a minute ago)
    const [mine] = await db.insert(schema.orders).values({ status: "PENDING_PAYMENT", channel: "POS", eventDate: day, pickupDate: next, deliveryAddress: "1 Main St, Kiryas Joel, NY", holdExpiresAt: new Date(now.getTime() - 60_000), linkHoldKind: "admin" }).returning();
    await db.insert(schema.orderItems).values({ orderId: mine.id, productId: p.id, qty: 1, unitPriceCents: 20000 });
    // someone else booked the only castle
    const [other] = await db.insert(schema.orders).values({ status: "CONFIRMED", channel: "POS", eventDate: day, pickupDate: next }).returning();
    await db.insert(schema.orderItems).values({ orderId: other.id, productId: p.id, qty: 1, unitPriceCents: 20000 });

    const r = await holdAgain([mine.id], mine.id, now);
    expect(r.removed).toBe(1);
    const o = await get(mine.id);
    expect(o.status).toBe("CANCELLED");
    expect([o.subtotalCents, o.deliveryFeeCents, o.taxCents, o.totalCents]).toEqual([0, 0, 0, 0]);
    expect(o.notes).toContain("nothing left to pay");
    expect(o.linkRemoved?.length).toBe(1); // the nearest options are still offered from this list
    expect((await get(other.id)).status).toBe("CONFIRMED");
  });
});

describe("the link page after an emptied day", () => {
  it("an emptied, cancelled day no longer counts as an expired link (no endless Check availability again)", async () => {
    const { linkExpired } = await import("@/lib/late-payment");
    const d = { order: { id: 999, status: "CANCELLED" as const, paidCents: 0, holdExpiresAt: null }, items: [] };
    expect(await linkExpired([d as never])).toBe(false);
  });
});
