import { describe, expect, it, vi } from "vitest";

/* Deep check 0600 M24 (Nov 27, 2026): the order page Drivers Save never drops a deactivated driver silently, and a
   refused choice comes back as a plain signed message instead of an error page. */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Error(`REDIRECT ${u}`); } }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/auth", async (orig) => ({ ...(await orig<typeof import("@/lib/auth")>()), requireStaff: async () => ({ userId: null, role: "owner" }) }));

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { assignDriversAction } from "@/app/admin/(app)/orders/[id]/driver-actions";

const save = async (orderId: number, delivery: string, pickup: string) => {
  const f = new FormData();
  f.set("delivery", delivery);
  f.set("pickup", pickup);
  try {
    await assignDriversAction(orderId, f);
    return "";
  } catch (e) {
    return decodeURIComponent(String((e as Error).message));
  }
};

describe("Drivers on the order page", () => {
  it("a deactivated driver stays when the form is saved unchanged; a refused choice is a message", async () => {
    const [a] = await db.insert(schema.adminUsers).values({ name: "Yossi", phone: "+18455550401", role: "delivery", active: false }).returning();
    const [b] = await db.insert(schema.adminUsers).values({ name: "Moshe", phone: "+18455550402", role: "delivery", active: true }).returning();
    const [o] = await db.insert(schema.orders).values({ status: "CONFIRMED", channel: "POS", eventDate: "2027-05-10", pickupDate: "2027-05-11", subtotalCents: 1, deliveryDriverId: a.id }).returning();
    expect(await save(o.id, String(a.id), String(b.id))).toMatch(/drivers=Drivers saved\./);
    const [after] = await db.select().from(schema.orders).where(eq(schema.orders.id, o.id));
    expect([after.deliveryDriverId, after.pickupDriverId]).toEqual([a.id, b.id]);
    // choosing the inactive driver for the pickup is refused with a message, not an error page
    expect(await save(o.id, String(a.id), String(a.id))).toMatch(/Pickup driver not saved: Choose an active driver\./);
  });
});
