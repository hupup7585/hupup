import { describe, expect, it, vi } from "vitest";

/* Rental name slots (Hark for Abraham, Nov 27, 2026): "Only 6 laser guns" is said "6 laser guns"; the Owner sets the
   slot text; a name that is the same for one and for two or more has one slot (the phone plays it for both). */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/auth", async (orig) => ({ ...(await orig<typeof import("@/lib/auth")>()), requireOwner: async () => ({ userId: null, role: "owner" }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

import { db, schema } from "@/lib/db";
import { allSlots } from "@/lib/recording-slots";
import { slotsWithStatus } from "@/lib/slot-status";
import { setNameSlotTextAction } from "@/app/admin/(app)/phone/prompts/slots/actions";

describe("rental name slots", () => {
  it("one slot for a name that is the same for one and more; the balloon names hyphenated", () => {
    const s = allSlots([{ id: 23, name: "Only 6 laser guns" }, { id: 1, name: "Soft Hop" }]);
    expect(s.filter((x) => x.key.startsWith("item:23")).map((x) => x.key)).toEqual(["item:23"]);
    expect(s.find((x) => x.key === "item:1")!.text).toBe("Soft-Hop");
    expect(s.find((x) => x.key === "item:1:plural")!.text).toBe("Soft-Hops");
  });
  it("the Owner sets the text; the rental's own name is unchanged", async () => {
    const [c] = await db.insert(schema.categories).values({ name: "Laser", sortOrder: 1, active: true }).returning();
    const [p] = await db.insert(schema.products).values({ categoryId: c.id, name: "Only 6 laser guns", priceCents: 11000, quantity: 2, active: true }).returning();
    expect((await setNameSlotTextAction(`item:${p.id}`, "6 laser guns")).ok).toBe(true);
    const slot = (await slotsWithStatus()).find((x) => x.key === `item:${p.id}`)!;
    expect([slot.text, slot.status]).toEqual(["6 laser guns", "waiting"]);
    expect((await db.select().from(schema.products)).find((x) => x.id === p.id)!.name).toBe("Only 6 laser guns");
    expect((await setNameSlotTextAction("greeting", "hello")).ok).toBe(false);
  });
});
