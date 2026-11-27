import { beforeAll, describe, expect, it, vi } from "vitest";

/* Hark's Admin list (Nov 26, 2026): 4 Confirmed on "Needs attention" checks the whole order again, locked; 5 a
   delivered order can't be cancelled; 7 no payment link for a cancelled order; 12 a confirmed attention order gets
   its units. */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/auth", async (orig) => ({ ...(await orig<typeof import("@/lib/auth")>()), requireAdmin: async () => ({ userId: null, role: "owner" }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { addDays, todayISO } from "@/lib/dates";
import { recordPaymentAction, sendPayLinkAction, updateDetailsAction, updateStatusAction } from "@/app/admin/(app)/orders/actions";

let maze = 0, guns = 0;
beforeAll(async () => {
  const c = (await db.insert(schema.categories).values({ name: "Laser", sortOrder: 1, active: true }).returning())[0].id;
  const ps = await db
    .insert(schema.products)
    .values([
      { categoryId: c, name: "Garbage maze", priceCents: 30000, quantity: 1, stockGroup: "maze", active: true },
      { categoryId: c, name: "Maze with guns", priceCents: 40000, quantity: 1, stockGroup: "maze", active: true },
    ])
    .returning();
  [maze, guns] = ps.map((p) => p.id);
});
const mk = async (status: "NEEDS_ATTENTION" | "CONFIRMED" | "DELIVERED" | "CANCELLED", pid: number, date = "2027-02-10") => {
  const [o] = await db.insert(schema.orders).values({ status, channel: "POS", eventDate: date, pickupDate: "2027-02-11", subtotalCents: 30000, totalCents: 30000, paidCents: 30000 }).returning();
  await db.insert(schema.orderItems).values({ orderId: o.id, productId: pid, qty: 1, unitPriceCents: 30000 });
  return o.id;
};
const statusOf = async (id: number) => (await db.select().from(schema.orders).where(eq(schema.orders.id, id)))[0].status;

describe("Admin status safety", () => {
  it("4: Confirmed on Needs attention is refused when the shared maze is already booked", async () => {
    await mk("CONFIRMED", maze);
    const late = await mk("NEEDS_ATTENTION", guns);
    const r = await updateStatusAction(late, "CONFIRMED");
    expect(r.ok).toBe(false);
    expect(await statusOf(late)).toBe("NEEDS_ATTENTION");
  });
  it("4 and 12: free again: it confirms", async () => {
    const late = await mk("NEEDS_ATTENTION", guns, "2027-03-10");
    expect((await updateStatusAction(late, "CONFIRMED")).ok).toBe(true);
    expect(await statusOf(late)).toBe("CONFIRMED");
  });
  it("5: a delivered order can't be cancelled", async () => {
    const d = await mk("DELIVERED", maze, "2027-04-10");
    const r = await updateStatusAction(d, "CANCELLED", "customer asked");
    expect(r.ok).toBe(false);
    expect(await statusOf(d)).toBe("DELIVERED");
  });
  it("7: no payment link for a cancelled order", async () => {
    const x = await mk("CANCELLED", maze, "2027-05-10");
    const r = await sendPayLinkAction(x);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/cancelled|priced/);
  });
  it("deep check A2: a picked-up order can't be cancelled", async () => {
    const d = await mk("DELIVERED", maze, "2027-06-10");
    expect((await updateStatusAction(d, "PICKED_UP")).ok).toBe(true);
    expect((await updateStatusAction(d, "CANCELLED", "customer asked")).ok).toBe(false);
    expect(await statusOf(d)).toBe("PICKED_UP");
  });
  it("deep check A2: delivered, moved back to Confirmed, then Cancel: still refused", async () => {
    const d = await mk("CONFIRMED", maze, "2026-11-20"); // a past event day: Delivered is refused before the event (extra check HD2)
    await db.update(schema.orders).set({ pickupDate: "2026-11-21" }).where(eq(schema.orders.id, d)); // a one-day rental (never holding today's stock)
    expect((await updateStatusAction(d, "DELIVERED")).ok).toBe(true);
    expect((await updateStatusAction(d, "CONFIRMED")).ok).toBe(true);
    const r = await updateStatusAction(d, "CANCELLED", "customer asked");
    expect(r.ok).toBe(false);
    expect(await statusOf(d)).toBe("CONFIRMED");
  });
});

describe("deep check 0600 M8 and M57", () => {
  it("M8: re-activating a cancelled order checks the whole order (two lines on the one maze are refused)", async () => {
    const [o] = await db.insert(schema.orders).values({ status: "CANCELLED", channel: "POS", eventDate: "2027-08-10", pickupDate: "2027-08-11", subtotalCents: 70000 }).returning();
    await db.insert(schema.orderItems).values([{ orderId: o.id, productId: maze, qty: 1, unitPriceCents: 30000 }, { orderId: o.id, productId: guns, qty: 1, unitPriceCents: 40000 }]);
    const r = await updateStatusAction(o.id, "CONFIRMED");
    expect(r.ok).toBe(false);
    expect(await statusOf(o.id)).toBe("CANCELLED");
    expect((await db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, o.id)))).toHaveLength(2); // nothing changed
    // one maze line alone fits
    const [ok] = await db.insert(schema.orders).values({ status: "CANCELLED", channel: "POS", eventDate: "2027-08-20", pickupDate: "2027-08-21", subtotalCents: 30000 }).returning();
    await db.insert(schema.orderItems).values({ orderId: ok.id, productId: maze, qty: 1, unitPriceCents: 30000 });
    expect((await updateStatusAction(ok.id, "CONFIRMED")).ok).toBe(true);
  });
  it("M57: brought back straight to Delivered: its units are booked", async () => {
    const day57 = new Date(`${todayISO()}T12:00:00Z`).getUTCDay() === 6 ? addDays(todayISO(), 1) : todayISO(); // never Shabbes
    await db.insert(schema.equipmentUnits).values({ productId: guns, code: "G-1", status: "available" as const });
    const [o] = await db.insert(schema.orders).values({ status: "CANCELLED", channel: "POS", eventDate: day57, pickupDate: addDays(day57, 1), subtotalCents: 40000 }).returning(); // today (or Sunday): Delivered is refused more than a day before the event (extra check HD2)
    await db.insert(schema.orderItems).values({ orderId: o.id, productId: guns, qty: 1, unitPriceCents: 40000 });
    expect((await updateStatusAction(o.id, "DELIVERED")).ok).toBe(true);
    expect((await db.select().from(schema.unitBookings).where(eq(schema.unitBookings.orderId, o.id))).length).toBeGreaterThan(0);
  });
});

describe("deep check 0600 M54 and M23", () => {
  it("M54: a double click on Record payment counts the cash once", async () => {
    const [o] = await db.insert(schema.orders).values({ status: "PENDING_PAYMENT", channel: "POS", eventDate: "2027-10-10", pickupDate: "2027-10-11", subtotalCents: 10000, totalCents: 10000 }).returning();
    const r = await Promise.all([recordPaymentAction(o.id, "40.00", "cash"), recordPaymentAction(o.id, "40.00", "cash")]);
    expect(r.filter((x) => x.ok)).toHaveLength(1);
    expect(r.find((x) => !x.ok)?.message).toMatch(/pressed twice/);
    expect((await db.select().from(schema.orders).where(eq(schema.orders.id, o.id)))[0].paidCents).toBe(4000);
    // a different amount right after is a real second payment
    expect((await recordPaymentAction(o.id, "60.00", "cash")).ok).toBe(true);
  });
  it("M23: Save keeps a note the system added after the page opened", async () => {
    const [o] = await db.insert(schema.orders).values({ status: "CONFIRMED", channel: "POS", eventDate: "2027-11-10", pickupDate: "2027-11-11", subtotalCents: 1, notes: "Gate code 12. " }).returning();
    await db.update(schema.orders).set({ notes: "Gate code 12. Second payment of $5.00 on an order already paid in full: refund it. " }).where(eq(schema.orders.id, o.id));
    const f = (notes: string) => {
      const x = new FormData();
      x.set("deliveryAddress", "");
      x.set("notes", notes);
      x.set("notesBefore", "Gate code 12. ");
      return x;
    };
    await updateDetailsAction(o.id, f("Gate code 12. "));
    expect((await db.select().from(schema.orders).where(eq(schema.orders.id, o.id)))[0].notes).toMatch(/refund it/);
    await updateDetailsAction(o.id, f("Gate code 34."));
    const n = (await db.select().from(schema.orders).where(eq(schema.orders.id, o.id)))[0].notes!;
    expect(n).toMatch(/^Gate code 34\./);
    expect(n).toMatch(/refund it/);
  });
});
