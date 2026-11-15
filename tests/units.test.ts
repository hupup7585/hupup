import { beforeEach, describe, expect, it, vi } from "vitest";

/* Equipment units (Abraham, Nov 15, 2026): one record per physical unit, stock = Available units, one unit per day. */

const h = vi.hoisted(() => ({ emails: [] as { to: string; subject: string; text: string }[] }));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/notify", async (orig) => ({
  ...(await orig<typeof import("@/lib/notify")>()),
  sendEmail: async (to: string, subject: string, text: string) => (h.emails.push({ to, subject, text }), { sent: true }),
  sendSms: async () => ({ sent: true }),
}));

import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import * as u from "@/lib/units";
import { setOrderStatus } from "@/lib/orders";

const owner = { userId: null, role: "owner" };
const secretary = { userId: null, role: "secretary" };
let productId: number;
const qty = async () => (await db.select().from(schema.products).where(eq(schema.products.id, productId)))[0].quantity;
const order = async (day: string, n = 1, pickup = day) => {
  const [o] = await db.insert(schema.orders).values({ status: "PENDING_PAYMENT", channel: "PHONE", eventDate: day, pickupDate: pickup }).returning();
  await db.insert(schema.orderItems).values({ orderId: o.id, productId, qty: n, unitPriceCents: 20000 });
  return o.id;
};

beforeEach(async () => {
  process.env.ADMIN_EMAIL = "owner@example.com";
  h.emails = [];
  if (!productId) {
    const [cat] = await db.insert(schema.categories).values({ name: "Bounce Houses", sortOrder: 1, active: true }).returning();
    const [p] = await db.insert(schema.products).values({ categoryId: cat.id, name: "Castle Bouncer", priceCents: 20000, quantity: 5, active: true, sortOrder: 1 }).returning();
    productId = p.id;
  }
});

describe("equipment units", () => {
  it("only the Owner adds units; stock follows the Available units", async () => {
    await expect(u.addUnit({ productId, code: "CASTLE-01" }, secretary)).rejects.toThrow("Only the Owner");
    await u.addUnit({ productId, code: "castle-01", serial: "SN1", replacementValueCents: 150000 }, owner);
    expect(await qty()).toBe(1);
    await u.addUnit({ productId, code: "CASTLE-02" }, owner);
    expect(await qty()).toBe(2);
    const list = await u.listUnits(productId);
    expect(list.map((r) => r.unit.code)).toEqual(["CASTLE-01", "CASTLE-02"]);
  });

  it("confirming assigns one unit per item per day; cancelling gives them back", async () => {
    const day = "2099-06-10";
    const id = await order(day, 2, "2099-06-11");
    await setOrderStatus(id, "CONFIRMED");
    const rows = await db.select().from(schema.unitBookings).where(eq(schema.unitBookings.orderId, id));
    expect(rows).toHaveLength(4); // 2 units x 2 days
    expect(new Set(rows.filter((r) => r.day === day).map((r) => r.unitId)).size).toBe(2);
    await setOrderStatus(id, "CANCELLED");
    expect(await db.select().from(schema.unitBookings).where(eq(schema.unitBookings.orderId, id))).toHaveLength(0);
  });

  it("the database refuses the same unit twice on the same day", async () => {
    const [unit] = await db.select().from(schema.equipmentUnits).limit(1);
    const a = await order("2099-07-01");
    const b = await order("2099-07-01");
    await db.insert(schema.unitBookings).values({ unitId: unit.id, day: "2099-07-01", orderId: a });
    await expect(db.insert(schema.unitBookings).values({ unitId: unit.id, day: "2099-07-01", orderId: b })).rejects.toThrow();
    await db.execute(sql`DELETE FROM unit_bookings WHERE day = '2099-07-01'`);
  });

  it("no free unit left: the Owner is emailed", async () => {
    const a = await order("2099-08-01", 2);
    await setOrderStatus(a, "CONFIRMED");
    const b = await order("2099-08-01", 1);
    const r = await u.assignUnits(b);
    expect(r.missing).toHaveLength(1);
    expect(h.emails.at(-1)!.subject).toBe("Hup Up Attractions: equipment conflict");
  });

  it("out of service: Owner or Secretary with a reason; history kept; bookings move to another unit or are flagged", async () => {
    const [one, two] = (await u.listUnits(productId)).map((r) => r.unit);
    await expect(u.setUnitStatus(one.id, "damaged", "Torn seam", { userId: null, role: "delivery" })).rejects.toThrow("Only the Owner or the Secretary");
    await expect(u.setUnitStatus(one.id, "damaged", " ", owner)).rejects.toThrow("Please give a reason.");
    const o = await order("2099-09-01");
    await setOrderStatus(o, "CONFIRMED");
    const [booked] = await db.select().from(schema.unitBookings).where(eq(schema.unitBookings.orderId, o));
    const target = booked.unitId === one.id ? one : two;
    const other = target.id === one.id ? two : one;
    const r1 = await u.setUnitStatus(target.id, "maintenance", "Blower check", secretary);
    // the earlier 2-unit booking on Aug 1 has no spare unit, so only that day is flagged
    expect(r1.conflicts.every((c) => c.endsWith("2099-08-01"))).toBe(true);
    expect(r1.conflicts.some((c) => c.endsWith("2099-09-01"))).toBe(false);
    const [moved] = await db.select().from(schema.unitBookings).where(eq(schema.unitBookings.orderId, o));
    expect(moved.unitId).toBe(other.id);
    expect(await qty()).toBe(1);
    const r2 = await u.setUnitStatus(other.id, "missing", "Not back from last job", owner);
    expect(r2.conflicts).toContain(`order #${1000 + o} on 2099-09-01`);
    expect(await qty()).toBe(0);
    const hist = await u.unitHistory(other.id);
    expect(hist.status[0].toStatus).toBe("missing");
    expect(hist.status[0].reason).toBe("Not back from last job");
    // back in service: anyone may do it
    await u.setUnitStatus(target.id, "available", "", secretary);
    await u.setUnitStatus(other.id, "available", "", secretary);
    expect(await qty()).toBe(2);
    // the bookings that lost their unit got one back
    expect(await db.select().from(schema.unitBookings).where(eq(schema.unitBookings.orderId, o))).toHaveLength(1);
  });

  it("unit history counts rentals and revenue", async () => {
    const [b] = await db.select().from(schema.unitBookings).limit(1);
    const hist = await u.unitHistory(b.unitId);
    expect(hist.rentals).toBeGreaterThan(0);
    expect(hist.revenueCents).toBe(hist.rentals * 20000);
  });
});
