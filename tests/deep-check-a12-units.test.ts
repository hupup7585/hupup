import { describe, expect, it, vi } from "vitest";

/* Deep check A12 (Nov 27, 2026): two Confirm clicks at once never book two sets of units for one order. */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/notify", async (orig) => ({ ...(await orig<typeof import("@/lib/notify")>()), sendEmail: async () => ({ sent: true }), sendSms: async () => ({ sent: true }) }));

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { assignUnits } from "@/lib/units";

describe("units assigned once", () => {
  it("assignUnits twice at the same moment: one unit per item per day", async () => {
    const [c] = await db.insert(schema.categories).values({ name: "Bounce", sortOrder: 1, active: true }).returning();
    const [p] = await db.insert(schema.products).values({ categoryId: c.id, name: "Castle", priceCents: 10000, quantity: 3, active: true }).returning();
    await db.insert(schema.equipmentUnits).values([1, 2, 3].map((n) => ({ productId: p.id, code: `C-${n}`, status: "available" })));
    const [o] = await db.insert(schema.orders).values({ status: "CONFIRMED", channel: "POS", eventDate: "2030-05-07", pickupDate: "2030-05-08", subtotalCents: 10000 }).returning();
    await db.insert(schema.orderItems).values({ orderId: o.id, productId: p.id, qty: 1, unitPriceCents: 10000 });
    await Promise.all([assignUnits(o.id), assignUnits(o.id)]);
    const rows = await db.select().from(schema.unitBookings).where(eq(schema.unitBookings.orderId, o.id));
    expect(rows.map((r) => r.day).sort()).toEqual(["2030-05-07", "2030-05-08"]);
  });
});
