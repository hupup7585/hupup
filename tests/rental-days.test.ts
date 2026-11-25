import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

/* Whole rental days (Abraham, Nov 8, 2026): delivery 9-12, pickup by 9 AM next open day; a Friday booking holds through Sunday. */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});

import { db, schema } from "@/lib/db";
import { bookableQty, checkBookable, getUsage, pickupDateFor } from "@/lib/availability";
import { PROMPTS } from "@/lib/ivr/prompts";

const FRI = "2026-11-13";
const SHABBES = "2026-11-14";
const SUN = "2026-11-15";

describe("whole rental days", () => {
  it("Friday delivery is picked up Sunday (no pickup on Shabbes)", () => {
    expect(pickupDateFor(FRI)).toBe(SUN);
    expect(pickupDateFor("2026-11-16")).toBe("2026-11-17"); // Monday -> Tuesday
  });

  it("a Friday booking holds the unit Friday and Shabbes; Sunday (its pickup day) is free again (Abraham, Nov 24, 2026)", async () => {
    const [cat] = await db.insert(schema.categories).values({ name: "Paddle Boats", sortOrder: 1, active: true }).returning();
    const [p] = await db.insert(schema.products).values({ categoryId: cat.id, name: "Paddle Boat", priceCents: 4500, quantity: 1, active: true, sortOrder: 1 }).returning();
    const [o] = await db.insert(schema.orders).values({ status: "CONFIRMED", channel: "PHONE", eventDate: FRI, pickupDate: SUN }).returning();
    await db.insert(schema.orderItems).values({ orderId: o.id, productId: p.id, qty: 1, unitPriceCents: 4500 });
    const usage = await getUsage("2026-11-12", "2026-11-17", [p.id]);
    const days = [...(usage.get(p.id)?.keys() ?? [])].sort();
    expect(days).toEqual([FRI, SHABBES, SUN]);
    expect(days).toEqual([FRI, SHABBES, SUN]); // Sunday is still listed (the pickup, for the drivers)
    expect(await checkBookable(p.id, 1, SUN)).toBe(1); // Sunday: picked up in the morning, out again the same day
    expect(await checkBookable(p.id, 1, "2026-11-12")).toBe(1); // Thursday: its own pickup on Friday morning is fine
    expect(await checkBookable(p.id, 1, FRI)).toBe(0); // Friday itself is booked
    expect(await checkBookable(p.id, 1, "2026-11-16")).toBe(1); // Monday: free
  });

  it("a booking needs the unit free on every day from delivery up to (not including) its pickup day", () => {
    const usage = new Map([[1, new Map([[SHABBES, { event: 0, pickup: 0, between: 1, held: 0 }]])]]);
    expect(bookableQty(1, usage, 1, FRI, SUN)).toBe(0); // only Shabbes is taken, and that still blocks it
  });

  it("Nov 24, 2026: a HOLD cart for Monday frees Tuesday the same way; a two-day rental Monday and Tuesday frees Wednesday", async () => {
    const [cat] = await db.insert(schema.categories).values({ name: "Jumping Balloons", sortOrder: 2, active: true }).returning();
    const [p] = await db.insert(schema.products).values({ categoryId: cat.id, name: "Castle", priceCents: 20000, quantity: 1, active: true, sortOrder: 1 }).returning();
    // a live phone cart (HOLD) for Monday Nov 16, picked up Tuesday
    const [held] = await db.insert(schema.orders).values({ status: "HOLD", channel: "PHONE", eventDate: "2026-11-16", pickupDate: "2026-11-17", holdExpiresAt: new Date(Date.now() + 10 * 60_000) }).returning();
    await db.insert(schema.orderItems).values({ orderId: held.id, productId: p.id, qty: 1, unitPriceCents: 20000 });
    expect(await checkBookable(p.id, 1, "2026-11-16")).toBe(0);
    expect(await checkBookable(p.id, 1, "2026-11-17")).toBe(1);
    // two-day rental Tuesday and Wednesday (Nov 17-18), pickup Thursday
    const [two] = await db.insert(schema.orders).values({ status: "CONFIRMED", channel: "PHONE", eventDate: "2026-11-17", pickupDate: "2026-11-19" }).returning();
    await db.insert(schema.orderItems).values({ orderId: two.id, productId: p.id, qty: 1, unitPriceCents: 20000 });
    expect(await checkBookable(p.id, 1, "2026-11-17")).toBe(0);
    expect(await checkBookable(p.id, 1, "2026-11-18")).toBe(0);
    expect(await checkBookable(p.id, 1, "2026-11-19")).toBe(1);
  });

  it("no delivery times: staff screens show the fixed windows; callers hear the window and the 9 AM pickup", () => {
    expect(readFileSync("src/app/admin/(app)/pos/PosForm.tsx", "utf8")).not.toContain('placeholder="Delivery time');
    expect(readFileSync("src/app/admin/(app)/orders/[id]/OrderActions.tsx", "utf8")).not.toContain('name="deliveryTime"');
    expect(readFileSync("src/app/admin/deliveries/page.tsx", "utf8")).toContain("DELIVERY_WINDOW");
    expect(PROMPTS.date_confirm_day.text).toBe(
      "Got it, {date}! We will deliver that day between 9 AM and noon, and pick up on {pickup}. Please have the rental outside your door by 9 AM that morning. If that is right, press pound to continue. To pick a different date, press 1.",
    );
    expect(readFileSync("src/app/pay/[orderId]/page.tsx", "utf8")).toContain("We deliver between 9:00 AM and 12:00 PM on your delivery day. On your pickup day, please have the rental outside your door by 9:00 AM.");
  });
});
