import { describe, expect, it, vi } from "vitest";

/* Live bug (Abraham, Nov 25, 2026, 1:16 and 1:54 PM): an item name with no name recording was said as its database
 * id ("For the 23, press 3") in lines that mix recordings with live words (laser tag and paddle boat lists, box 154,
 * cart and added lines). It must say the item's name. */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});

import { db, schema } from "@/lib/db";
import { composeMixed, loadPromptOverrides } from "@/lib/ivr/prompts";

describe("item names in mixed lines", () => {
  it("an item with no name recording is said by name, never by its id; its plural too", async () => {
    process.env.AUTH_SECRET = "t";
    const [c] = await db.insert(schema.categories).values({ name: "Laser Tag", active: true, sortOrder: 1 }).returning();
    const [p] = await db.insert(schema.products).values({ categoryId: c.id, name: "6 Laser Guns", priceCents: 11000, quantity: 1, active: true }).returning();
    const [boat] = await db.insert(schema.products).values({ categoryId: c.id, name: "Paddle Boat", priceCents: 9000, quantity: 2, active: true }).returning();
    // a number clip in use, so the line is put together from pieces (the live situation)
    const [three] = await db.insert(schema.promptRecordings).values({ promptKey: "word:three", source: "upload", fileName: "three.mp3", contentType: "audio/mpeg", sizeBytes: 1, complete: true }).returning();
    await db.insert(schema.voicePrompts).values({ key: "word:three", recordingId: three.id });
    const o = await loadPromptOverrides();
    const said = (pieces: ReturnType<typeof composeMixed>) => (pieces ?? []).map((x) => ("say" in x ? x.say : "rec")).join(" | ");
    // the laser tag and paddle boat lists: "For the {item}, press {key}." (live: "For the | 23 | press | rec")
    const list = said(composeMixed(o, "category_item", { item: p.name, key: 3 }));
    expect(list).toBe("For the | 6 Laser Guns | press | rec");
    const line = said(composeMixed(o, "box25_added", { item: p.name, qty: 3, date: "Tuesday" }));
    expect(line).toContain("6 Laser Guns");
    expect(line).not.toMatch(new RegExp(`(^|\\| )${p.id}( \\||$)`));
    const plural = said(composeMixed(o, "box25_added", { qty: 3, item: "Paddle Boats", date: "Tuesday" }));
    expect(plural).toContain("Paddle Boats");
    expect(plural).not.toMatch(new RegExp(`(^|\\| )${boat.id}( \\||$)`));
  });
});
