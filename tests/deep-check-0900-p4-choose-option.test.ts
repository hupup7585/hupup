import { describe, expect, it, vi } from "vitest";

/* Deep check Nov 27, 9:00 AM, P4: on the payment link, "Choose this option" for a taken item put it on another day of the
   same booking whose hold had already ended, and held that whole day again without checking its other items (someone
   else may have booked them meanwhile): two bookings on one unit. Now a day whose hold ended is never held again by an
   option; "Check availability again" checks the whole day first. A day still held takes the option as before. */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/notify", () => ({ sendEmail: async () => ({ sent: true }), sendSms: async () => ({ sent: true }) }));

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { chooseLinkOption, removedWithOptions } from "@/lib/late-payment";

const get = async (id: number) => (await db.select().from(schema.orders).where(eq(schema.orders.id, id)))[0];
const D1 = "2027-08-16"; // Monday
const D2 = "2027-08-17"; // Tuesday

async function booking(tag: string, secondDayHold: Date) {
  const [c] = await db.insert(schema.categories).values({ name: `Bounce ${tag}`, sortOrder: 1 }).returning();
  const [x] = await db.insert(schema.products).values({ categoryId: c.id, name: `Castle ${tag}`, priceCents: 20000, quantity: 1 }).returning();
  const [y] = await db.insert(schema.products).values({ categoryId: c.id, name: `Slide ${tag}`, priceCents: 10000, quantity: 1 }).returning();
  // someone else has the castle on day 1 (it was taken off this booking's link)
  const [o1] = await db.insert(schema.orders).values({ status: "CONFIRMED", channel: "PHONE", eventDate: D1, pickupDate: D2 }).returning();
  await db.insert(schema.orderItems).values({ orderId: o1.id, productId: x.id, qty: 1, unitPriceCents: 20000 });
  const [a] = await db
    .insert(schema.orders)
    .values({ status: "PENDING_PAYMENT", channel: "PHONE", eventDate: D1, pickupDate: D2, subtotalCents: 0, deliveryAddress: "5 Forest Rd, Kiryas Joel, NY 10950", holdExpiresAt: new Date(Date.now() + 600_000), linkRemoved: [{ productId: x.id, qty: 1, eventDate: D1, name: `Castle ${tag}` }] })
    .returning();
  await db.update(schema.orders).set({ paymentGroupId: a.id }).where(eq(schema.orders.id, a.id));
  // the booking's second day: the slide
  const [b] = await db.insert(schema.orders).values({ status: "PENDING_PAYMENT", channel: "PHONE", eventDate: D2, pickupDate: "2027-08-18", subtotalCents: 10000, deliveryAddress: "5 Forest Rd, Kiryas Joel, NY 10950", paymentGroupId: a.id, holdExpiresAt: secondDayHold }).returning();
  await db.insert(schema.orderItems).values({ orderId: b.id, productId: y.id, qty: 1, unitPriceCents: 10000 });
  return { a, b, x, y };
}

describe("deep check 09:00 P4: Choose this option on a day whose hold ended", () => {
  it("the second day's hold ended and its slide was booked by someone else: the option is refused, nothing held again", async () => {
    const { a, b, x, y } = await booking("p4a", new Date(Date.now() - 60_000));
    const [o2] = await db.insert(schema.orders).values({ status: "CONFIRMED", channel: "PHONE", eventDate: D2, pickupDate: "2027-08-18" }).returning();
    await db.insert(schema.orderItems).values({ orderId: o2.id, productId: y.id, qty: 1, unitPriceCents: 10000 });
    const [r] = await removedWithOptions(a.id);
    const opt = r.options.find((o) => o.productId === x.id && o.date === D2);
    expect(opt).toBeTruthy();
    expect(await chooseLinkOption(a.id, r.index, x.id, D2)).toBe(false);
    const after = await get(b.id);
    expect(after.holdExpiresAt!.getTime()).toBeLessThan(Date.now()); // not held again
    const castleLines = (await db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, b.id))).filter((l) => l.productId === x.id);
    expect(castleLines).toEqual([]);
  });

  it("the second day is still held: the option is added to it as before", async () => {
    const { a, b, x } = await booking("p4b", new Date(Date.now() + 600_000));
    const [r] = await removedWithOptions(a.id);
    expect(r.options.some((o) => o.productId === x.id && o.date === D2)).toBe(true);
    expect(await chooseLinkOption(a.id, r.index, x.id, D2)).toBe(true);
    const castleLines = (await db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, b.id))).filter((l) => l.productId === x.id);
    expect(castleLines.length).toBe(1);
  });
});
