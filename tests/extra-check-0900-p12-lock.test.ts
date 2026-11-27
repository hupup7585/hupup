import { describe, expect, it, vi } from "vitest";

/* 09:00 list P12: once Catalog > Item types are set, the stock lock takes the same laser gun pools availability counts,
   even for a laser item outside a category named "laser". In-memory database. */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});

import { db, schema } from "@/lib/db";
import { saveSetting } from "@/lib/settings";
import { lockStock } from "@/lib/stock-lock";

describe("09:00 P12: stock lock and Item types", () => {
  it("a maze in a category not named laser, typed as laser tag, locks every laser item with it", async () => {
    const [tag] = await db.insert(schema.categories).values({ name: "Tag games", sortOrder: 1, active: true }).returning();
    const [bounce] = await db.insert(schema.categories).values({ name: "Bounce", sortOrder: 2, active: true }).returning();
    const [maze, guns, castle] = await db
      .insert(schema.products)
      .values([
        { categoryId: tag.id, name: "Maze with 6 guns", priceCents: 30000, quantity: 1, active: true },
        { categoryId: tag.id, name: "6 laser guns", priceCents: 11000, quantity: 2, active: true },
        { categoryId: bounce.id, name: "Castle", priceCents: 12000, quantity: 1, active: true },
      ])
      .returning();
    await saveSetting("itemTypes" as never, JSON.stringify({ categories: { [tag.id]: "laser_tag", [bounce.id]: "bounce_house" }, products: { [maze.id]: "maze_six", [guns.id]: "six_guns" } }) as never);
    const locked = await db.transaction((tx) => lockStock(tx as never, [maze.id]));
    expect(locked).toEqual(expect.arrayContaining([maze.id, guns.id]));
    expect(locked).not.toContain(castle.id);
    // a booking of the castle alone locks only the castle
    expect(await db.transaction((tx) => lockStock(tx as never, [castle.id]))).toEqual([castle.id]);
  });
});
