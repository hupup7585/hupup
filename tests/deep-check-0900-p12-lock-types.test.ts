import { describe, expect, it, vi } from "vitest";

/* Deep check Nov 27, 9:00 AM, P12 (M48 completed): the stock lock found the shared gun-pack items by a category named
   "laser", but availability uses Catalog > Item types once the Owner sets them. A gun set in a category with another name
   (typed as laser add-ons) was counted in the pools but not locked: two bookings at once could both take the last guns.
   Now the lock takes every item of the pools availability counts. Nothing set: the same rows as before. */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});

import { db, schema } from "@/lib/db";
import { lockStock } from "@/lib/stock-lock";
import { saveSetting } from "@/lib/settings";

describe("deep check 09:00 P12: the lock follows the item types", () => {
  it("a gun set typed as laser add-ons in a 'Party extras' category is locked with the laser items, both ways", async () => {
    const [laser] = await db.insert(schema.categories).values({ name: "Laser Tag", sortOrder: 1, active: true }).returning();
    const [party] = await db.insert(schema.categories).values({ name: "Party extras", sortOrder: 2, active: true }).returning();
    const [bounce] = await db.insert(schema.categories).values({ name: "Jumping Balloons", sortOrder: 3, active: true }).returning();
    const [maze] = await db.insert(schema.products).values({ categoryId: laser.id, name: "Maze with 4 laser guns", priceCents: 1, quantity: 1, active: true }).returning();
    const [big] = await db.insert(schema.products).values({ categoryId: party.id, name: "Big gun set", priceCents: 1, quantity: 3, active: true }).returning();
    const [castle] = await db.insert(schema.products).values({ categoryId: bounce.id, name: "Castle", priceCents: 1, quantity: 2, active: true }).returning();
    const lock = (ids: number[]) => db.transaction(async (tx) => lockStock(tx as never, ids));

    await saveSetting("itemTypes", "");
    expect(await lock([maze.id])).toEqual([maze.id]); // unset: as before (the party item is not a laser item)
    expect(await lock([castle.id])).toEqual([castle.id]);

    await saveSetting("itemTypes", JSON.stringify({ categories: { [party.id]: "laser_addons" }, products: { [big.id]: "four_guns" } }));
    const both = [maze.id, big.id].sort((a, b) => a - b);
    expect(await lock([maze.id])).toEqual(both);
    expect(await lock([big.id])).toEqual(both);
    expect(await lock([castle.id])).toEqual([castle.id]); // a plain item still locks only itself
    expect(await lock([castle.id, big.id])).toEqual([...both, castle.id].sort((a, b) => a - b));
    await saveSetting("itemTypes", "");
  });
});
