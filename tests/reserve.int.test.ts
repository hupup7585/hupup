import "dotenv/config";
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

    // Pickup day (Mar 11) is also taken, and the day before can't be booked either (its pickup is Mar 10).
    expect(await checkBookable(p.id, 1, "2027-03-11")).toBe(0);
    expect(await checkBookable(p.id, 1, "2027-03-09")).toBe(0);
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
});
