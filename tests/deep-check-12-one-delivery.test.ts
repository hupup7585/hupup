import { describe, expect, it, vi } from "vitest";

/* Deep check Nov 27 #12: choosing an earlier day on the payment link never charges delivery twice. In-memory database. */
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
import { ensurePriced } from "@/lib/order-pricing";

describe("#12 one delivery charge per booking on the payment link", () => {
  it("an option on an earlier day: the new first day carries the one charge, the old first day none", async () => {
    const [c] = await db.insert(schema.categories).values({ name: "Balloons", sortOrder: 1 }).returning();
    const [kept] = await db.insert(schema.products).values({ categoryId: c.id, name: "Castle", priceCents: 10000, quantity: 3 }).returning();
    const [x] = await db.insert(schema.products).values({ categoryId: c.id, name: "Slide", priceCents: 12000, quantity: 1 }).returning();
    const addr = "5 Forest Rd, Kiryas Joel, NY 10950";
    // someone else has the Slide on Monday July 12, 2027
    const [other] = await db.insert(schema.orders).values({ status: "CONFIRMED", channel: "PHONE", eventDate: "2027-07-12", pickupDate: "2027-07-13", subtotalCents: 12000 }).returning();
    await db.insert(schema.orderItems).values({ orderId: other.id, productId: x.id, qty: 1, unitPriceCents: 12000 });
    // the customer's booking: Monday, the Slide taken out by "Check availability again"
    const [a] = await db
      .insert(schema.orders)
      .values({ status: "PENDING_PAYMENT", channel: "PHONE", eventDate: "2027-07-12", pickupDate: "2027-07-13", subtotalCents: 10000, deliveryAddress: addr, holdExpiresAt: new Date(Date.now() + 600_000), linkRemoved: [{ productId: x.id, qty: 1, eventDate: "2027-07-12", name: "Slide" }] })
      .returning();
    await db.update(schema.orders).set({ paymentGroupId: a.id }).where(eq(schema.orders.id, a.id));
    await db.insert(schema.orderItems).values({ orderId: a.id, productId: kept.id, qty: 1, unitPriceCents: 10000 });
    expect(await ensurePriced(a.id)).toBe(true);
    const feeBefore = (await db.select().from(schema.orders).where(eq(schema.orders.id, a.id)))[0].deliveryFeeCents;
    expect(feeBefore).toBeGreaterThan(0);

    const [r] = await removedWithOptions(a.id);
    const before = r.options.find((o) => o.kind === "before" && o.date < "2027-07-12");
    expect(before).toBeTruthy();
    expect(await chooseLinkOption(a.id, r.index, before!.productId, before!.date)).toBe(true);

    const group = await db.select().from(schema.orders).where(eq(schema.orders.paymentGroupId, a.id));
    expect(group).toHaveLength(2);
    const first = group.find((g) => g.eventDate === before!.date)!;
    const old = group.find((g) => g.id === a.id)!;
    expect(old.deliveryFeeCents).toBe(0);
    expect(first.deliveryFeeCents).toBeGreaterThan(0);
    // one charge for the two items of the booking (never the old charge plus a new one)
    expect(first.deliveryFeeCents).toBeGreaterThanOrEqual(feeBefore);
    expect(group.every((g) => g.totalCents !== null)).toBe(true);
  });
});
