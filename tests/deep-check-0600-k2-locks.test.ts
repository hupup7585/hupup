import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

/* Extra check K2 / deep check 06:00 M48: every booking path locks the same rows in the same (id) order, in one step. */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});

import { db, schema } from "@/lib/db";
import { lockStock } from "@/lib/stock-lock";

describe("K2: one lock step for items, their stock group and the laser pools", () => {
  it("a maze item locks its group and every laser item; a plain item locks only itself, in id order", async () => {
    const [laser] = await db.insert(schema.categories).values({ name: "Laser Tag and Inflatable Mazes", sortOrder: 1 }).returning();
    const [bounce] = await db.insert(schema.categories).values({ name: "Jumping Balloons", sortOrder: 2 }).returning();
    const [guns6, maze6, maze4, castle] = await db
      .insert(schema.products)
      .values([
        { categoryId: laser.id, name: "6 Laser Guns", priceCents: 10000, quantity: 3 },
        { categoryId: laser.id, name: "Maze with 6 guns", priceCents: 30000, quantity: 1, stockGroup: "maze" },
        { categoryId: laser.id, name: "Maze with 4 guns", priceCents: 25000, quantity: 1, stockGroup: "maze" },
        { categoryId: bounce.id, name: "Castle", priceCents: 20000, quantity: 2 },
      ])
      .returning();
    const all = await db.transaction(async (tx) => lockStock(tx as never, [maze4.id]));
    expect(all).toEqual([guns6.id, maze6.id, maze4.id].sort((a, b) => a - b));
    expect(await db.transaction(async (tx) => lockStock(tx as never, [castle.id]))).toEqual([castle.id]);
    expect(await db.transaction(async (tx) => lockStock(tx as never, [castle.id, guns6.id]))).toEqual([guns6.id, maze6.id, maze4.id, castle.id].sort((a, b) => a - b));
  });
  it("every path uses it (no per-item group lock left)", () => {
    for (const f of ["src/lib/orders.ts", "src/lib/late-payment.ts", "src/app/admin/(app)/orders/actions.ts"]) {
      const s = readFileSync(f, "utf8");
      expect(s).toContain("lockStock(tx");
      expect(s).not.toContain("stock_group = (SELECT stock_group FROM products WHERE id =");
    }
  });
});
