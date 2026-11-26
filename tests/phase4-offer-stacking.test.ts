import { beforeAll, describe, expect, it, vi } from "vitest";

/* Admin handoff Phase 4 (Nov 26, 2026): how offers combine is an Owner setting. "best" (the default) keeps today's
 * rule: only the biggest saving. "add": the customer discount and the 4th Sunday both apply, never more than the
 * rentals cost. Orders already placed keep their price. */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { bestOfferFor, OFFER_NOTES } from "@/lib/offers";
import { reserveItem } from "@/lib/orders";
import { SETTING_DEFAULTS } from "@/lib/settings";
import { configDef, validateConfig } from "@/lib/config-registry";

let fourth = 0;
let customerId = 0;
let productId = 0;
beforeAll(async () => {
  const [cat] = await db.insert(schema.categories).values({ name: "Jumping balloons", ivrDigit: 1, sortOrder: 1, active: true }).returning();
  const [p] = await db.insert(schema.products).values({ categoryId: cat.id, name: "Castle", priceCents: 30000, quantity: 5, active: true }).returning();
  productId = p.id;
  const [c] = await db.insert(schema.customers).values({ phone: "+18455550777", name: "Sunday, Sara" }).returning();
  customerId = c.id;
  for (const d of ["2027-01-03", "2027-01-10", "2027-01-17", "2027-01-24"]) {
    const r = await reserveItem({ orderId: null, productId: p.id, qty: 1, eventDate: d, channel: "POS", status: "CONFIRMED" });
    if (!r.ok) throw new Error("no order");
    await db.update(schema.orders).set({ customerId: c.id }).where(eq(schema.orders.id, r.orderId));
    fourth = r.orderId;
  }
});

const offerFor = async (stacking: string | undefined) => {
  const [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, fourth));
  const ls = [
    { id: 1, productId, qty: 1, unitPriceCents: 30000, category: "Jumping balloons", name: "Castle" },
    { id: 2, productId, qty: 1, unitPriceCents: 30000, category: "Jumping balloons", name: "Castle" },
  ]; // $600 of rentals
  const tenPercent = async () => ({ kind: "percent", amount_cents: null, percent: 10, note: "", ends_on: null });
  return bestOfferFor(db as never, { id: o.id, customerId, eventDate: o.eventDate, pickupDate: o.pickupDate, spanDays: 1 }, ls, { offerFourthSundayOn: true, ...(stacking ? { offersStacking: stacking } : {}) }, tenPercent);
};

describe("how offers combine", () => {
  it("default 'best' (as always): only the biggest saving, the 4th Sunday", async () => {
    expect(SETTING_DEFAULTS.offersStacking).toBe("best");
    const r = await offerFor(undefined);
    expect(r.note).toBe(OFFER_NOTES.fourthSunday);
    expect(r.discountCents).toBe(30000); // the free Sunday item ($300) beats 10% ($60)
  });
  it("'add': both savings add up", async () => {
    const r = await offerFor("add");
    expect(r.note).toContain(OFFER_NOTES.fourthSunday);
    expect(r.note).toContain("Customer discount: 10% off");
    expect(r.discountCents).toBe(36000); // $300 free Sunday item + $60 (10% of $600)
  });
  it("an Owner setting in All settings (draft first), checked, and explained", () => {
    const d = configDef("offersStacking")!;
    expect(d.mode).toBe("edit");
    expect(validateConfig(d, "add")).toEqual({ ok: true, value: "add" });
    expect(validateConfig(d, "everything").ok).toBe(false);
    expect(d.explain?.example).toMatch(/\$105\.00/);
  });
});
