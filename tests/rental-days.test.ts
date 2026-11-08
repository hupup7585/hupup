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
const SHABBOS = "2026-11-14";
const SUN = "2026-11-15";

describe("whole rental days", () => {
  it("Friday delivery is picked up Sunday (no pickup on Shabbos)", () => {
    expect(pickupDateFor(FRI)).toBe(SUN);
    expect(pickupDateFor("2026-11-16")).toBe("2026-11-17"); // Monday -> Tuesday
  });

  it("a Friday booking holds the unit Friday, Shabbos and Sunday, on the phone, website and staff booking alike", async () => {
    const [cat] = await db.insert(schema.categories).values({ name: "Paddle Boats", sortOrder: 1, active: true }).returning();
    const [p] = await db.insert(schema.products).values({ categoryId: cat.id, name: "Paddle Boat", priceCents: 4500, quantity: 1, active: true, sortOrder: 1 }).returning();
    const [o] = await db.insert(schema.orders).values({ status: "CONFIRMED", channel: "PHONE", eventDate: FRI, pickupDate: SUN }).returning();
    await db.insert(schema.orderItems).values({ orderId: o.id, productId: p.id, qty: 1, unitPriceCents: 4500 });
    const usage = await getUsage("2026-11-12", "2026-11-17", [p.id]);
    const days = [...(usage.get(p.id)?.keys() ?? [])].sort();
    expect(days).toEqual([FRI, SHABBOS, SUN]);
    expect(await checkBookable(p.id, 1, SUN)).toBe(0); // Sunday: still out until the pickup
    expect(await checkBookable(p.id, 1, "2026-11-12")).toBe(0); // Thursday: its pickup day (Friday) overlaps
    expect(await checkBookable(p.id, 1, "2026-11-16")).toBe(1); // Monday: free again
  });

  it("a booking needs the unit free on every day from delivery through pickup", () => {
    const usage = new Map([[1, new Map([[SHABBOS, { event: 0, pickup: 1, held: 0 }]])]]);
    expect(bookableQty(1, usage, 1, FRI, SUN)).toBe(0); // only Shabbos is taken, and that still blocks it
  });

  it("no delivery times: staff screens show the fixed windows; callers hear the window and the 9 AM pickup", () => {
    expect(readFileSync("src/app/admin/(app)/pos/PosForm.tsx", "utf8")).not.toContain('placeholder="Delivery time');
    expect(readFileSync("src/app/admin/(app)/orders/[id]/OrderActions.tsx", "utf8")).not.toContain('name="deliveryTime"');
    expect(readFileSync("src/app/admin/deliveries/page.tsx", "utf8")).toContain("DELIVERY_WINDOW");
    expect(PROMPTS.date_confirm_day.text).toBe(
      "Got it, {date}! We'll deliver that day between 9 AM and noon, and pick up on {pickup}. Please have the rental outside your door by 9 AM that morning. Press 1 if that's right, or 2 to pick a different date.",
    );
    expect(readFileSync("src/app/pay/[orderId]/page.tsx", "utf8")).toContain("We deliver between 9:00 AM and 12:00 PM on your delivery day. On your pickup day, please have the rental outside your door by 9:00 AM.");
  });
});
