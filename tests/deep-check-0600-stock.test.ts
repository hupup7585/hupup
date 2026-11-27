import { describe, expect, it, vi } from "vitest";

/* Deep check Nov 27, 6:00 AM, M7 and M8: renewing an ended phone payment hold, and Admin re-activating a cancelled
   order, check the whole order as one (two items sharing one unit can never both pass when only one is free). */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/notify", () => ({ sendEmail: async () => ({ sent: true }), sendSms: async () => ({ sent: true }), sendOrderText: async () => ({ sent: true }) }));
vi.mock("@/lib/auth", async (orig) => ({ ...(await orig<typeof import("@/lib/auth")>()), requireAdmin: async () => ({ userId: null, role: "owner" }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { renewPaymentHold } from "@/lib/ivr/flow";
import { updateStatusAction } from "@/app/admin/(app)/orders/actions";

const ended = new Date(Date.now() - 3600_000);
async function shared() {
  const g = `maze-${Math.random()}`;
  const [c] = await db.insert(schema.categories).values({ name: `Bounce ${Math.random()}`, sortOrder: 1 }).returning();
  const [a, b] = await db
    .insert(schema.products)
    .values([
      { categoryId: c.id, name: "Castle red", priceCents: 30000, quantity: 1, stockGroup: g },
      { categoryId: c.id, name: "Castle blue", priceCents: 40000, quantity: 1, stockGroup: g },
    ])
    .returning();
  return [a.id, b.id];
}
async function order(status: "PENDING_PAYMENT" | "CANCELLED", pids: number[]) {
  const [o] = await db.insert(schema.orders).values({ status, channel: "PHONE", eventDate: "2027-08-18", pickupDate: "2027-08-19", holdExpiresAt: ended, subtotalCents: 2000, totalCents: 2000 }).returning();
  await db.insert(schema.orderItems).values(pids.map((p) => ({ orderId: o.id, productId: p, qty: 1, unitPriceCents: 1000 })));
  return o.id;
}
const get = async (id: number) => (await db.select().from(schema.orders).where(eq(schema.orders.id, id)))[0];

describe("deep check 06:00 M7: renewing an ended phone payment hold", () => {
  it("two items sharing one unit: not renewed (taken), nothing confirmed later", async () => {
    const id = await order("PENDING_PAYMENT", await shared());
    expect(await renewPaymentHold([id], 10)).toEqual([id]);
  });
  it("an order that fits is renewed", async () => {
    const [a] = await shared();
    const id = await order("PENDING_PAYMENT", [a]);
    expect(await renewPaymentHold([id], 10)).toEqual([]);
    expect((await get(id)).holdExpiresAt!.getTime()).toBeGreaterThan(Date.now());
  });
});

describe("deep check 06:00 M8: Admin re-activating a cancelled order", () => {
  it("two items sharing one unit: refused, the order and its lines unchanged", async () => {
    const id = await order("CANCELLED", await shared());
    const r = await updateStatusAction(id, "CONFIRMED");
    expect(r.ok).toBe(false);
    expect((await get(id)).status).toBe("CANCELLED");
    expect(await db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, id))).toHaveLength(2);
  });
  it("an order that fits is confirmed", async () => {
    const [a] = await shared();
    const id = await order("CANCELLED", [a]);
    expect((await updateStatusAction(id, "CONFIRMED")).ok).toBe(true);
    expect((await get(id)).status).toBe("CONFIRMED");
  });
});
