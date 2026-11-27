import { beforeAll, describe, expect, it, vi } from "vitest";

/* Extra check K (booking core), Fri Nov 27, 2026, by claude/loving-cerf-ntpz1l. In-memory database; nothing is sent. */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/notify", () => ({ sendSms: async () => ({ sent: true }), sendEmail: async () => ({ sent: true }) }));

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { reserveItem, refreshOrderTotals } from "@/lib/orders";
import { saveSetting } from "@/lib/settings";
import { OFFER_NOTES } from "@/lib/offers";

let balloon = 0;
let customerId = 0;

beforeAll(async () => {
  const [bounce] = await db.insert(schema.categories).values({ name: "Jumping Balloons", ivrDigit: 1, sortOrder: 1, active: true }).returning();
  const [bl] = await db.insert(schema.products).values({ categoryId: bounce.id, name: "Soft Hop", priceCents: 6500, quantity: 5, active: true }).returning();
  balloon = bl.id;
  const [c] = await db.insert(schema.customers).values({ phone: "+18455550777", name: "Every Sunday" }).returning();
  customerId = c.id;
});

/** A confirmed Soft Hop booking for the customer on this Sunday, priced; returns its subtotal and offer note. */
async function sunday(day: string) {
  const r = await reserveItem({ orderId: null, productId: balloon, qty: 1, eventDate: day, channel: "POS", status: "CONFIRMED" });
  if (!r.ok) throw new Error(`no order for ${day}`);
  await db.update(schema.orders).set({ customerId }).where(eq(schema.orders.id, r.orderId));
  await refreshOrderTotals(r.orderId);
  const [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, r.orderId));
  return { subtotal: o.subtotalCents, note: o.offerNote };
}

describe("K1: 4th Sunday free is every 4th Sunday, not every Sunday after the third", () => {
  it("Sundays 1-3 pay, 4 is free, 5-7 pay again, 8 is free", async () => {
    await saveSetting("offerFourthSundayOn", true);
    // 8 Sundays in a row, none in Chanukah (no offers then): Jan 3 to Feb 21, 2027
    const days = ["2027-01-03", "2027-01-10", "2027-01-17", "2027-01-24", "2027-01-31", "2027-02-07", "2027-02-14", "2027-02-21"];
    const got = [];
    for (const d of days) got.push(await sunday(d));
    expect(got.map((g) => g.subtotal)).toEqual([6500, 6500, 6500, 0, 6500, 6500, 6500, 0]);
    expect(got[3].note).toBe(OFFER_NOTES.fourthSunday);
    expect(got[4].note).toBeNull();
    expect(got[7].note).toBe(OFFER_NOTES.fourthSunday);
    await saveSetting("offerFourthSundayOn", false);
  });
});

describe("K2: one shared stock lock, in id order, laser gun packs included", () => {
  it("locks the item, its maze group and every laser item (sorted); a plain item locks only itself", async () => {
    const { lockUnits } = await import("@/lib/availability");
    const [laser] = await db.insert(schema.categories).values({ name: "Laser Tag and Inflatable Mazes", ivrDigit: 2, sortOrder: 2, active: true }).returning();
    // ids made out of order on purpose: the maze items come after the plain guns
    const [guns] = await db.insert(schema.products).values({ categoryId: laser.id, name: "6 Laser Guns", priceCents: 11000, quantity: 3, active: true }).returning();
    const [m6, m4] = await db
      .insert(schema.products)
      .values([
        { categoryId: laser.id, name: "Inflatable Maze with 6 Laser Guns", priceCents: 20000, quantity: 1, active: true, stockGroup: "maze" },
        { categoryId: laser.id, name: "Inflatable Maze with 4 Laser Guns", priceCents: 17500, quantity: 1, active: true, stockGroup: "maze" },
      ])
      .returning();
    const [addons] = await db.select().from(schema.categories).where(eq(schema.categories.name, "Laser tag add-ons"));
    const [pack] = await db.insert(schema.products).values({ categoryId: addons.id, name: "Additional 6-Pack Laser Guns", priceCents: 7500, quantity: 10, active: true }).returning();
    const allLaser = [guns.id, m6.id, m4.id, pack.id].sort((a, b) => a - b);

    await db.transaction(async (tx) => {
      // the maze item and the plain guns lock exactly the same rows in the same order: no deadlock between them
      expect(await lockUnits(tx as never, [m6.id])).toEqual(allLaser);
      expect(await lockUnits(tx as never, [guns.id])).toEqual(allLaser);
      expect(await lockUnits(tx as never, [pack.id])).toEqual(allLaser);
      expect(await lockUnits(tx as never, [balloon])).toEqual([balloon]);
      expect(await lockUnits(tx as never, [balloon, m4.id, balloon])).toEqual([...allLaser, balloon].sort((a, b) => a - b));
      expect(await lockUnits(tx as never, [])).toEqual([]);
    });
  });

  it("every booking path uses the shared lock (no path locks only its own item or its maze group)", async () => {
    const { readFileSync } = await import("node:fs");
    for (const f of ["src/lib/orders.ts", "src/lib/late-payment.ts", "src/app/admin/(app)/orders/actions.ts"]) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toContain("stock_group = (SELECT stock_group FROM products WHERE id =");
      expect(src, f).toContain("lockUnits(");
    }
  });
});
