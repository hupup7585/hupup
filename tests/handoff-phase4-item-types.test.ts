import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

/* Admin handoff Phase 4, Admin part (Nov 27, 2026): explicit item types on Catalog > Item types; anything not set is
   worked out from the name exactly as before. */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/auth", async (orig) => ({ ...(await orig<typeof import("@/lib/auth")>()), requireOwner: async () => ({ userId: null, role: "owner" }) }));

import { db, schema } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { categoryKind, guessCategoryKind, guessLaserRole, itemTypesToSave, laserPoolsMatch, laserRole, parseItemTypes } from "./helpers/item-types-check";
import { laserPoolsFor } from "@/lib/availability";

describe("item types", () => {
  it("unset: worked out from the names as before (the real catalog names)", () => {
    expect(guessCategoryKind("Laser Tag and Inflatable Mazes")).toBe("laser_tag");
    expect(guessCategoryKind("Laser tag add-ons")).toBe("laser_addons");
    expect(guessCategoryKind("Paddle Boats")).toBe("paddle_boat");
    expect(guessCategoryKind("Ocean balls")).toBe("ocean_balls");
    expect(guessCategoryKind("Jumping Balloons")).toBe("jumping_balloon");
    for (const n of ["Inflatable Maze with 6 laser guns", "Maze with four guns", "6 laser guns", "4 laser guns", "Garbage maze", "Laser vests"]) {
      expect(laserPoolsMatch(guessLaserRole(n, "laser_tag"))).toEqual(laserPoolsFor(n, "Laser Tag"));
    }
  });
  it("set by the Owner: the choice wins; garbage in the setting is ignored", () => {
    const t = parseItemTypes(JSON.stringify({ categories: { "3": "paddle_boat", "4": "nonsense" }, products: { "9": "maze_six" } }));
    expect(categoryKind({ id: 3, name: "Water fun" }, t)).toBe("paddle_boat");
    expect(categoryKind({ id: 4, name: "Laser stuff" }, t)).toBe("laser_tag");
    expect(laserRole({ id: 9, name: "The big one" }, "laser_tag", t)).toBe("maze_six");
    expect(parseItemTypes("{not json")).toEqual({ categories: {}, products: {} });
  });
  it("only choices that differ from the name are saved", () => {
    const out = itemTypesToSave([{ id: 1, name: "Laser Tag" }, { id: 2, name: "Water fun" }], [{ id: 5, name: "Maze with 6 guns", categoryId: 1 }, { id: 6, name: "Big set", categoryId: 1 }], { "1": "laser_tag", "2": "paddle_boat" }, { "5": "maze_six", "6": "six_guns" });
    expect(out).toEqual({ categories: { "2": "paddle_boat" }, products: { "6": "six_guns" } });
  });
  it("Owner page saves and audits; New booking reads the setting", async () => {
    const [c] = await db.insert(schema.categories).values({ name: "Water fun", sortOrder: 1, active: true }).returning();
    const { saveItemTypesAction } = await import("@/app/admin/(app)/catalog/types/actions");
    const f = new FormData();
    f.set(`cat:${c.id}`, "paddle_boat");
    const r = await saveItemTypesAction(f);
    expect(r.ok).toBe(true);
    expect(parseItemTypes((await getSettings() as { itemTypes?: unknown }).itemTypes).categories[String(c.id)]).toBe("paddle_boat");
    const audit = (await db.select().from(schema.auditLog)).filter((a) => a.action === "catalog.item_types_saved");
    expect(audit).toHaveLength(1);
    expect(readFileSync("src/app/admin/(app)/pos/page.tsx", "utf8")).toContain("itemTypes=");
    expect(readFileSync("src/app/admin/(app)/pos/PosForm.tsx", "utf8")).not.toMatch(/\/maze\/i\.test/);
  });
});
