import { beforeAll, describe, expect, it, vi } from "vitest";

/* Extra check K (booking core), Fri Nov 27, 2026, by claude/loving-cerf-ntpz1l. In-memory database; nothing is sent. */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/notify", () => ({ sendSms: async () => ({ sent: true }), sendEmail: async () => ({ sent: true }) }));

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { reserveItem, refreshOrderTotals } from "@/lib/orders";
import { saveSetting } from "@/lib/settings";
import { OFFER_NOTES } from "@/lib/offers";

let balloon = 0;
let customerId = 0;

beforeAll(async () => {
  const [bounce] = await db.insert(schema.categories).values({ name: "Jumping Balloons", ivrDigit: 1, sortOrder: 1, active: true }).returning();
  const [bl] = await db.insert(schema.products).values({ categoryId: bounce.id, name: "Soft Hop", priceCents: 6500, quantity: 5, active: true }).returning();
  balloon = bl.id;
  const [c] = await db.insert(schema.customers).values({ phone: "+18455550777", name: "Every Sunday" }).returning();
  customerId = c.id;
});

/** A confirmed Soft Hop booking for the customer on this Sunday, priced; returns its subtotal and offer note. */
async function sunday(day: string) {
  const r = await reserveItem({ orderId: null, productId: balloon, qty: 1, eventDate: day, channel: "POS", status: "CONFIRMED" });
  if (!r.ok) throw new Error(`no order for ${day}`);
  await db.update(schema.orders).set({ customerId }).where(eq(schema.orders.id, r.orderId));
  await refreshOrderTotals(r.orderId);
  const [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, r.orderId));
  return { subtotal: o.subtotalCents, note: o.offerNote };
}

describe("K1: 4th Sunday free is every 4th Sunday, not every Sunday after the third", () => {
  it("Sundays 1-3 pay, 4 is free, 5-7 pay again, 8 is free", async () => {
    await saveSetting("offerFourthSundayOn", true);
    // 8 Sundays in a row, none in Chanukah (no offers then): Jan 3 to Feb 21, 2027
    const days = ["2027-01-03", "2027-01-10", "2027-01-17", "2027-01-24", "2027-01-31", "2027-02-07", "2027-02-14", "2027-02-21"];
    const got = [];
    for (const d of days) got.push(await sunday(d));
    expect(got.map((g) => g.subtotal)).toEqual([6500, 6500, 6500, 0, 6500, 6500, 6500, 0]);
    expect(got[3].note).toBe(OFFER_NOTES.fourthSunday);
    expect(got[4].note).toBeNull();
    expect(got[7].note).toBe(OFFER_NOTES.fourthSunday);
    await saveSetting("offerFourthSundayOn", false);
  });
});
