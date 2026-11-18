import { beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

/* Customer discounts (Abraham, Nov 17-18, 2026). In-memory database. */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { refreshOrderTotals } from "@/lib/orders";
import { saveSetting } from "@/lib/settings";
import { discountCents, parseDiscountForm } from "@/lib/customer-discounts";
import { OFFER_NOTES } from "@/lib/offers";

let laserCat = 0;
let maze = 0;
let pack = 0;
let customerId = 0;
const PHONE = "+18455550123";

beforeAll(async () => {
  const [c] = await db.insert(schema.categories).values({ name: "Laser Tag and Inflatable Mazes", ivrDigit: 2, sortOrder: 2, active: true }).returning();
  laserCat = c.id;
  const [m] = await db.insert(schema.products).values({ categoryId: laserCat, name: "Inflatable Maze with 6 Laser Guns", priceCents: 20000, quantity: 1, active: true }).returning();
  const [p] = await db.insert(schema.products).values({ categoryId: laserCat, name: "6 Laser Guns", priceCents: 7500, quantity: 5, active: true }).returning();
  maze = m.id;
  pack = p.id;
  const [cu] = await db.insert(schema.customers).values({ phone: PHONE, name: "Sara" }).returning();
  customerId = cu.id;
});

async function order(items: [number, number, number][], date = "2026-12-14") {
  const [o] = await db.insert(schema.orders).values({ status: "PENDING_PAYMENT", channel: "PHONE", eventDate: date, pickupDate: date, customerId }).returning();
  for (const [productId, qty, price] of items) await db.insert(schema.orderItems).values({ orderId: o.id, productId, qty, unitPriceCents: price });
  await refreshOrderTotals(o.id);
  const [x] = await db.select().from(schema.orders).where(eq(schema.orders.id, o.id));
  return x;
}

describe("customer discounts", () => {
  it("form: dollars or percent, the customer's phone, optional end date", () => {
    expect(parseDiscountForm({ phone: "845-555-0123", kind: "percent", value: "10%", endsOn: "", note: "" })).toMatchObject({ phone: PHONE, kind: "percent", percent: 10 });
    expect(parseDiscountForm({ phone: "(845) 555-0123", kind: "amount", value: "$25", endsOn: "2026-12-31", note: "school" })).toMatchObject({ kind: "amount", amountCents: 2500, endsOn: "2026-12-31" });
    expect(parseDiscountForm({ phone: "12", kind: "amount", value: "25", endsOn: "", note: "" })).toHaveProperty("error");
    expect(parseDiscountForm({ phone: PHONE, kind: "percent", value: "120", endsOn: "", note: "" })).toHaveProperty("error");
    expect(discountCents({ kind: "amount", amount_cents: 50000, percent: null }, 20000)).toBe(20000); // never more than the rentals
    expect(discountCents({ kind: "percent", amount_cents: null, percent: "12.5" }, 27500)).toBe(3438);
  });
  it("comes off the rentals (so tax is on the lower amount), on every booking until turned off", async () => {
    await db.insert(schema.customerDiscounts).values({ phone: PHONE, kind: "percent", percent: "10" });
    const a = await order([[maze, 1, 20000]]);
    expect(a.subtotalCents).toBe(18000);
    expect(a.offerNote).toBe("Customer discount: 10% off");
    const b = await order([[maze, 1, 20000]], "2026-12-21");
    expect(b.subtotalCents).toBe(18000);
  });
  it("never combined with an offer: the bigger saving applies", async () => {
    await saveSetting("offerLaserThirdPackOn", true);
    // maze + 2 packs: the third pack (50% of $75 = $37.50) beats 10% of $350 ($35)
    const a = await order([[maze, 1, 20000], [pack, 2, 7500]]);
    expect(a.offerNote).toBe(OFFER_NOTES.laser);
    expect(a.subtotalCents).toBe(35000 - 3750);
    // a $50 discount beats the third pack
    await db.update(schema.customerDiscounts).set({ active: false });
    await db.insert(schema.customerDiscounts).values({ phone: PHONE, kind: "amount", amountCents: 5000 });
    const b = await order([[maze, 1, 20000], [pack, 2, 7500]]);
    expect(b.offerNote).toBe("Customer discount: $50.00 off");
    expect(b.subtotalCents).toBe(30000);
    await saveSetting("offerLaserThirdPackOn", false);
  });
  it("turned off or past its end date: no discount", async () => {
    await db.update(schema.customerDiscounts).set({ active: false });
    await db.insert(schema.customerDiscounts).values({ phone: PHONE, kind: "amount", amountCents: 5000, endsOn: "2020-01-01" });
    const a = await order([[maze, 1, 20000]]);
    expect(a.subtotalCents).toBe(20000);
    expect(a.offerNote).toBeNull();
  });
  it("Owner only; the phone never speaks the discount", () => {
    expect(readFileSync("src/app/admin/(app)/discounts/page.tsx", "utf8")).toContain("await requireOwner()");
    expect(readFileSync("src/app/admin/(app)/discounts/actions.ts", "utf8").match(/await requireOwner\(\)/g)).toHaveLength(2);
    expect(readFileSync("src/lib/ivr/flow.ts", "utf8")).not.toMatch(/sp\([^)]*offerNote/);
  });
});
