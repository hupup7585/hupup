import { describe, expect, it, vi } from "vitest";

/* Deep check 0600 M52: "Choose this option" on the pay link keeps one line per laser set, so every third set is half
   price, the same as a phone or New booking order. In-memory database. */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/notify", () => ({ sendEmail: async () => ({ sent: true }), sendSms: async () => ({ sent: true }) }));
vi.mock("@/lib/address-checks", async (orig) => ({ ...(await orig<typeof import("@/lib/address-checks")>()), noteAddressCheck: async () => undefined }));
vi.mock("@/lib/delivery-areas", async (orig) => ({
  ...(await orig<typeof import("@/lib/delivery-areas")>()),
  deliveryQuote: async (address: string | null) => (!address ? { ok: false, reason: "no_address" } : { ok: true, zone: "KJ", feeCents: 1000, kind: "local" }),
}));

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { chooseLinkOption, removedWithOptions } from "@/lib/late-payment";

describe("M52: a laser option chosen on the pay link", () => {
  it("3 sets become 3 lines; the third is half price", async () => {
    const [c] = await db.insert(schema.categories).values({ name: "Laser Tag", sortOrder: 1 }).returning();
    const [guns] = await db.insert(schema.products).values({ categoryId: c.id, name: "6 Laser Guns", priceCents: 10000, quantity: 5 }).returning();
    const addr = "5 Forest Rd, Kiryas Joel, NY 10950";
    // someone else has 4 of the 5 sets on Monday July 12, 2027, so 3 don't fit that day
    const [other] = await db.insert(schema.orders).values({ status: "CONFIRMED", channel: "PHONE", eventDate: "2027-07-12", pickupDate: "2027-07-13", subtotalCents: 40000 }).returning();
    await db.insert(schema.orderItems).values({ orderId: other.id, productId: guns.id, qty: 4, unitPriceCents: 10000 });
    const [a] = await db
      .insert(schema.orders)
      .values({ status: "PENDING_PAYMENT", channel: "PHONE", eventDate: "2027-07-12", pickupDate: "2027-07-13", subtotalCents: 0, deliveryAddress: addr, holdExpiresAt: new Date(Date.now() + 600_000), linkRemoved: [{ productId: guns.id, qty: 3, eventDate: "2027-07-12", name: "6 Laser Guns" }] })
      .returning();
    const [r] = await removedWithOptions(a.id);
    const opt = r.options.find((o) => o.productId === guns.id && o.date !== "2027-07-12");
    expect(opt).toBeTruthy();
    expect(await chooseLinkOption(a.id, r.index, opt!.productId, opt!.date)).toBe(true);
    const day = (await db.select().from(schema.orders).where(eq(schema.orders.paymentGroupId, a.paymentGroupId ?? a.id))).find((o) => o.eventDate === opt!.date) ?? (await db.select().from(schema.orders).where(eq(schema.orders.id, a.id)))[0];
    const lines = await db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, day.id));
    expect(lines.map((l) => l.qty)).toEqual([1, 1, 1]);
    expect(lines.map((l) => l.unitPriceCents).sort((x, y) => x - y)).toEqual([5000, 10000, 10000]);
    expect(day.subtotalCents).toBe(25000);
  });
});
