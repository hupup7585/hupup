import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";

/*
 * Shared laser gun stock (Hark for Abraham, Nov 24, 2026), against a real Postgres (row locks): 1 maze, 6 six-packs,
 * 7 four-packs, shared by every laser item. Existing laser items are switched off while this runs, then restored.
 */
const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("shared laser stock (Postgres)", async () => {
  const { db, schema, closeDb } = await import("@/lib/db");
  const { reserveItem } = await import("@/lib/orders");
  const { checkBookable } = await import("@/lib/availability");
  const created: number[] = [];
  const mine: number[] = [];
  let paused: number[] = [];
  let cats: number[] = [];
  const P: Record<string, number> = {};
  const hold = (productId: number, date: string, mins = 10) => reserveItem({ productId, qty: 1, eventDate: date, channel: "PHONE", holdExpiresAt: new Date(Date.now() + mins * 60_000) });

  beforeAll(async () => {
    const live = await db.execute(sql`SELECT p.id FROM products p JOIN categories c ON c.id = p.category_id WHERE c.name ~* 'laser' AND p.active`);
    paused = (live.rows as { id: number }[]).map((r) => Number(r.id));
    if (paused.length) await db.update(schema.products).set({ active: false }).where(inArray(schema.products.id, paused));
    const [tag] = await db.insert(schema.categories).values({ name: "TEST Laser Tag pool", sortOrder: 99, active: true }).returning();
    const [add] = await db.insert(schema.categories).values({ name: "TEST Laser tag add-ons pool", sortOrder: 99, active: true }).returning();
    cats = [tag.id, add.id];
    const items: [string, number, string, number, number][] = [
      ["maze6", tag.id, "Inflatable maze with 6 laser guns", 20000, 1],
      ["maze4", tag.id, "Inflatable maze with 4 laser guns", 17500, 1],
      ["only6", tag.id, "Only 6 laser guns", 11000, 6],
      ["only4", tag.id, "Only 4 laser guns", 7500, 7],
      ["add6", add.id, "Additional 6-pack laser tag", 7500, 6],
      ["add4", add.id, "Additional 4-pack laser tag", 5000, 7],
    ];
    for (const [k, c, name, price, quantity] of items) {
      const [p] = await db.insert(schema.products).values({ categoryId: c, name, priceCents: price, quantity, active: true }).returning();
      P[k] = p.id;
      mine.push(p.id);
    }
  });
  afterAll(async () => {
    if (created.length) await db.delete(schema.orders).where(inArray(schema.orders.id, created));
    if (mine.length) await db.delete(schema.products).where(inArray(schema.products.id, mine));
    if (cats.length) await db.delete(schema.categories).where(inArray(schema.categories.id, cats));
    if (paused.length) await db.update(schema.products).set({ active: true }).where(inArray(schema.products.id, paused));
    await closeDb();
  });

  it("Hark's example: maze with 6 + 2 additional 6-packs + only 6 guns = 4 six-packs used, 2 left; both mazes gone", async () => {
    const d = "2031-03-11";
    for (const k of ["maze6", "add6", "add6", "only6"]) {
      const r = await hold(P[k], d);
      expect(r.ok, k).toBe(true);
      if (r.ok) created.push(r.orderId);
    }
    expect(await checkBookable(P.only6, 6, d)).toBe(2);
    expect(await checkBookable(P.add6, 6, d)).toBe(2);
    expect(await checkBookable(P.maze4, 1, d)).toBe(0); // one maze, already out
    expect(await checkBookable(P.maze6, 1, d)).toBe(0);
    expect(await checkBookable(P.only4, 7, d)).toBe(7); // four-packs untouched
    expect(await checkBookable(P.only6, 6, "2031-03-12")).toBe(6); // the next day is their pickup day: free again (Nov 24, 2026)
  });

  it("Nov 24, 2026: the maze rented Monday is bookable again Tuesday (its pickup day)", async () => {
    const mon = "2031-06-09";
    const r = await hold(P.maze6, mon);
    expect(r.ok).toBe(true);
    if (r.ok) created.push(r.orderId);
    expect(await checkBookable(P.maze4, 1, mon)).toBe(0);
    expect(await checkBookable(P.maze4, 1, "2031-06-10")).toBe(1);
  });

  it("two callers at once cannot both take the last six-pack", async () => {
    const d = "2031-04-08";
    for (let i = 0; i < 5; i++) {
      const r = await hold(P.add6, d);
      if (r.ok) created.push(r.orderId);
    }
    expect(await checkBookable(P.only6, 6, d)).toBe(1);
    const both = await Promise.all([hold(P.only6, d), hold(P.add6, d)]);
    for (const r of both) if (r.ok) created.push(r.orderId);
    expect(both.filter((r) => r.ok)).toHaveLength(1);
    expect(await checkBookable(P.only6, 6, d)).toBe(0);
  });

  it("a held pack comes back when its hold expires", async () => {
    const d = "2031-05-06";
    const r = await reserveItem({ productId: P.maze4, qty: 1, eventDate: d, channel: "PHONE", holdExpiresAt: new Date(Date.now() - 1000) });
    if (r.ok) created.push(r.orderId);
    expect(await checkBookable(P.maze6, 1, d)).toBe(1); // expired: the maze is free again
    expect(await checkBookable(P.only4, 7, d)).toBe(7);
    const live = await hold(P.maze4, d);
    if (live.ok) created.push(live.orderId);
    expect(await checkBookable(P.maze6, 1, d)).toBe(0);
    expect(await checkBookable(P.only4, 7, d)).toBe(6);
    const [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, live.ok ? live.orderId : 0));
    expect(o?.status).toBe("HOLD");
  });
});
