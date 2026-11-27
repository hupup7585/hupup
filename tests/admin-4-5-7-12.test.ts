import { beforeAll, describe, expect, it, vi } from "vitest";

/* Hark's Admin list (Nov 26, 2026): 4 Confirmed on "Needs attention" checks the whole order again, locked; 5 a
   delivered order can't be cancelled; 7 no payment link for a cancelled order; 12 a confirmed attention order gets
   its units. */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/auth", async (orig) => ({ ...(await orig<typeof import("@/lib/auth")>()), requireAdmin: async () => ({ userId: null, role: "owner" }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { sendPayLinkAction, updateStatusAction } from "@/app/admin/(app)/orders/actions";

let maze = 0, guns = 0;
beforeAll(async () => {
  const c = (await db.insert(schema.categories).values({ name: "Laser", sortOrder: 1, active: true }).returning())[0].id;
  const ps = await db
    .insert(schema.products)
    .values([
      { categoryId: c, name: "Garbage maze", priceCents: 30000, quantity: 1, stockGroup: "maze", active: true },
      { categoryId: c, name: "Maze with guns", priceCents: 40000, quantity: 1, stockGroup: "maze", active: true },
    ])
    .returning();
  [maze, guns] = ps.map((p) => p.id);
});
const mk = async (status: "NEEDS_ATTENTION" | "CONFIRMED" | "DELIVERED" | "CANCELLED", pid: number, date = "2027-02-10") => {
  const [o] = await db.insert(schema.orders).values({ status, channel: "POS", eventDate: date, pickupDate: "2027-02-11", subtotalCents: 30000, totalCents: 30000, paidCents: 30000 }).returning();
  await db.insert(schema.orderItems).values({ orderId: o.id, productId: pid, qty: 1, unitPriceCents: 30000 });
  return o.id;
};
const statusOf = async (id: number) => (await db.select().from(schema.orders).where(eq(schema.orders.id, id)))[0].status;

describe("Admin status safety", () => {
  it("4: Confirmed on Needs attention is refused when the shared maze is already booked", async () => {
    await mk("CONFIRMED", maze);
    const late = await mk("NEEDS_ATTENTION", guns);
    const r = await updateStatusAction(late, "CONFIRMED");
    expect(r.ok).toBe(false);
    expect(await statusOf(late)).toBe("NEEDS_ATTENTION");
  });
  it("4 and 12: free again: it confirms", async () => {
    const late = await mk("NEEDS_ATTENTION", guns, "2027-03-10");
    expect((await updateStatusAction(late, "CONFIRMED")).ok).toBe(true);
    expect(await statusOf(late)).toBe("CONFIRMED");
  });
  it("5: a delivered order can't be cancelled", async () => {
    const d = await mk("DELIVERED", maze, "2027-04-10");
    const r = await updateStatusAction(d, "CANCELLED", "customer asked");
    expect(r.ok).toBe(false);
    expect(await statusOf(d)).toBe("DELIVERED");
  });
  it("7: no payment link for a cancelled order", async () => {
    const x = await mk("CANCELLED", maze, "2027-05-10");
    const r = await sendPayLinkAction(x);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/cancelled|priced/);
  });
  it("deep check A2: a picked-up order can't be cancelled", async () => {
    const d = await mk("DELIVERED", maze, "2027-06-10");
    expect((await updateStatusAction(d, "PICKED_UP")).ok).toBe(true);
    expect((await updateStatusAction(d, "CANCELLED", "customer asked")).ok).toBe(false);
    expect(await statusOf(d)).toBe("PICKED_UP");
  });
  it("deep check A2: delivered, moved back to Confirmed, then Cancel: still refused", async () => {
    const d = await mk("CONFIRMED", maze, "2026-11-20"); // a past event day: Delivered is refused before the event day (extra check HD2)
    expect((await updateStatusAction(d, "DELIVERED")).ok).toBe(true);
    expect((await updateStatusAction(d, "CONFIRMED")).ok).toBe(true);
    const r = await updateStatusAction(d, "CANCELLED", "customer asked");
    expect(r.ok).toBe(false);
    expect(await statusOf(d)).toBe("CONFIRMED");
  });
});
