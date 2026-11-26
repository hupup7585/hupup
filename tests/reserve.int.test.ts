import { afterAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";

/**
 * Integration test against a real Postgres (DATABASE_URL). Skipped when no database is configured.
 * Run: DATABASE_URL=postgres://... npm test
 */
const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("reservations (Postgres)", async () => {
  const { db, schema, closeDb } = await import("@/lib/db");
  const { reserveItem, releaseExpired } = await import("@/lib/orders");
  const { checkBookable } = await import("@/lib/availability");
  const created: number[] = [];
  let productId = 0;

  afterAll(async () => {
    if (created.length) await db.delete(schema.orders).where(inArray(schema.orders.id, created));
    if (productId) await db.delete(schema.products).where(eq(schema.products.id, productId));
    await closeDb();
  });

  it("only one of several simultaneous callers gets the last unit", async () => {
    const [cat] = await db.select().from(schema.categories).limit(1);
    const [p] = await db
      .insert(schema.products)
      .values({ categoryId: cat.id, name: "TEST single unit", priceCents: 1000, quantity: 1, active: true })
      .returning();
    productId = p.id;
    const date = "2027-03-10";
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        reserveItem({ productId: p.id, qty: 1, eventDate: date, channel: "PHONE", holdExpiresAt: new Date(Date.now() + 60_000) }),
      ),
    );
    for (const r of results) if (r.ok) created.push(r.orderId);
    expect(results.filter((r) => r.ok)).toHaveLength(1);

    // Nov 24, 2026: only Mar 10 is taken; its pickup day (Mar 11) is free again, and a Mar 9 booking (picked up the
    // morning of Mar 10) fits too
    expect(await checkBookable(p.id, 1, "2027-03-10")).toBe(0);
    expect(await checkBookable(p.id, 1, "2027-03-11")).toBe(1);
    expect(await checkBookable(p.id, 1, "2027-03-09")).toBe(1);
    expect(await checkBookable(p.id, 1, "2027-03-12")).toBe(1);
  });

  it("expired holds stop counting and are released by the sweep", async () => {
    const r = await reserveItem({ productId, qty: 1, eventDate: "2027-04-01", channel: "PHONE", holdExpiresAt: new Date(Date.now() - 1000) });
    expect(r.ok).toBe(true);
    if (r.ok) created.push(r.orderId);
    expect(await checkBookable(productId, 1, "2027-04-01")).toBe(1); // expired hold ignored immediately
    expect(await releaseExpired()).toBeGreaterThanOrEqual(1);
    if (r.ok) {
      const [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, r.orderId));
      expect(o.status).toBe("CANCELLED");
    }
  });

  it("Audit C2: an expired cart hold whose unit someone else booked is caught at checkout, never booked twice", async () => {
    const { createOrderWithItems, recheckHolds, keepCartHeld } = await import("@/lib/orders");
    const date = "2027-04-14";
    // The first caller's cart: its hold ran out a minute ago
    const a = await reserveItem({ productId, qty: 1, eventDate: date, channel: "PHONE", status: "HOLD", holdExpiresAt: new Date(Date.now() - 60_000) });
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    created.push(a.orderId);
    // keepCartHeld never brings an expired hold back
    await keepCartHeld([a.orderId]);
    const [stillExpired] = await db.select().from(schema.orders).where(eq(schema.orders.id, a.orderId));
    expect(stillExpired.holdExpiresAt!.getTime()).toBeLessThan(Date.now());
    // Someone else books the same unit (allowed: the hold had run out)
    const b = await createOrderWithItems({ items: [{ productId, qty: 1 }], eventDate: date, channel: "POS", status: "CONFIRMED" });
    expect(b.ok).toBe(true);
    if (b.ok) created.push(b.orderId);
    // The first caller reaches checkout: the line is caught and taken out of the cart
    const taken = await recheckHolds([a.orderId]);
    expect(taken).toEqual([{ orderId: a.orderId, productId, eventDate: date, qty: 1 }]);
    const lines = await db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, a.orderId));
    expect(lines).toHaveLength(0); // nothing left to charge
    expect(await checkBookable(productId, 1, date)).toBe(0); // only the second booking holds the unit
  });

  it("Audit C2: a hold still free passes the check and is renewed", async () => {
    const { recheckHolds } = await import("@/lib/orders");
    const date = "2027-05-12";
    const a = await reserveItem({ productId, qty: 1, eventDate: date, channel: "PHONE", status: "HOLD", holdExpiresAt: new Date(Date.now() - 60_000) });
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    created.push(a.orderId);
    expect(await recheckHolds([a.orderId])).toEqual([]);
    const [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, a.orderId));
    expect(o.holdExpiresAt!.getTime()).toBeGreaterThan(Date.now());
  });
});

