import { beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

/* Extra check H (Nov 27, 2026): delivery role, orders, Admin download routes. In-memory database. */
const h = vi.hoisted(() => ({ staff: { userId: null as number | null, role: "owner", name: "Owner" } }));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/auth", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth")>()),
  requireAdmin: async () => h.staff,
  requireStaff: async () => h.staff,
  requireOwner: async () => h.staff,
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { addDays, todayISO } from "@/lib/dates";
import { driverNotes, isCurrentStopFor } from "@/lib/delivery-stops";
import { cleanFilters, likeContains } from "@/lib/filter-params";
import { idParam } from "@/lib/id-param";
import { orderIdFromParam } from "@/lib/order-path";

let maze = 0;
beforeAll(async () => {
  const [cat] = await db.insert(schema.categories).values({ name: "Mazes", ivrDigit: 7 } as never).returning();
  const [p] = await db.insert(schema.products).values({ name: "Maze", categoryId: cat.id, quantity: 5, priceCents: 10000 } as never).returning();
  maze = p.id;
});
const mk = async (status: string, eventDate: string) => {
  const [o] = await db.insert(schema.orders).values({ status, channel: "POS", eventDate, pickupDate: addDays(eventDate, 1), subtotalCents: 10000, totalCents: 10000, paidCents: 10000 } as never).returning();
  await db.insert(schema.orderItems).values({ orderId: o.id, productId: maze, qty: 1, unitPriceCents: 10000 } as never);
  return o.id;
};
const statusOf = async (id: number) => (await db.select().from(schema.orders).where(eq(schema.orders.id, id)))[0].status;

describe("H1: drivers see no money lines", () => {
  it("money sentences are left out; directions stay", () => {
    const n = "Back door, ring twice. Second payment of $221.65 (sola, 123) on an order already paid in full: refund it. Paid $50.00 of $120.00. Gate code 4411.";
    expect(driverNotes(n)).toBe("Back door, ring twice. Gate code 4411.");
    expect(driverNotes(null)).toBe("");
    expect(readFileSync("src/app/admin/deliveries/page.tsx", "utf8")).toContain('staff.role === "delivery" ? driverNotes(o.notes) : o.notes');
  });
});

describe("H2: Admin status buttons keep the delivery order", () => {
  it("Picked up only after Delivered; Delivered only when confirmed and on or after the event day", async () => {
    const { updateStatusAction } = await import("@/app/admin/(app)/orders/actions");
    const future = await mk("CONFIRMED", addDays(todayISO(), 7));
    expect((await updateStatusAction(future, "PICKED_UP")).ok).toBe(false);
    expect((await updateStatusAction(future, "DELIVERED")).ok).toBe(false);
    expect(await statusOf(future)).toBe("CONFIRMED");
    const hold = await mk("PENDING_PAYMENT", todayISO());
    expect((await updateStatusAction(hold, "DELIVERED")).message).toBe("Only a confirmed order can be marked delivered. Confirm it first.");
    const cancelled = await mk("CANCELLED", todayISO());
    expect((await updateStatusAction(cancelled, "PICKED_UP")).ok).toBe(false);
    const today = await mk("CONFIRMED", todayISO());
    expect((await updateStatusAction(today, "DELIVERED")).ok).toBe(true);
    expect((await updateStatusAction(today, "PICKED_UP")).ok).toBe(true);
    expect(await statusOf(today)).toBe("PICKED_UP");
  });
});

describe("H3: a driver acts only on today's stops", () => {
  it("the stop's own day, today or yesterday", () => {
    const t = todayISO();
    expect(isCurrentStopFor({ eventDate: t, pickupDate: addDays(t, 1) }, "delivery")).toBe(true);
    expect(isCurrentStopFor({ eventDate: t, pickupDate: addDays(t, 1) }, "pickup")).toBe(false);
    expect(isCurrentStopFor({ eventDate: addDays(t, 7), pickupDate: addDays(t, 8) }, "delivery")).toBe(false);
    expect(isCurrentStopFor({ eventDate: addDays(t, -1), pickupDate: null }, "pickup")).toBe(true);
    const src = readFileSync("src/app/admin/deliveries/actions.ts", "utf8");
    expect(src.match(/isCurrentStopFor\(full\.order, stop\)/g)).toHaveLength(3);
  });
  it("a Delivery login can't mark next week's stop delivered", async () => {
    const [d] = await db.insert(schema.adminUsers).values({ name: "Driver", phone: "+18455551301", role: "delivery" }).returning();
    const id = await mk("CONFIRMED", addDays(todayISO(), 7));
    await db.update(schema.orders).set({ deliveryDriverId: d.id }).where(eq(schema.orders.id, id));
    h.staff = { userId: d.id, role: "delivery", name: "Driver" };
    const { markDoneAction } = await import("@/app/admin/deliveries/actions");
    const r = await markDoneAction(id, "delivery");
    expect(r.ok).toBe(false);
    expect(await statusOf(id)).toBe("CONFIRMED");
    h.staff = { userId: null, role: "owner", name: "Owner" };
  });
});

describe("H5 + H6: Save drivers", () => {
  it("a deactivated driver stays on a stop that wasn't changed; a just-deactivated choice is skipped without a crash", async () => {
    const [gone] = await db.insert(schema.adminUsers).values({ name: "Gone", phone: "+18455551302", role: "delivery", active: false }).returning();
    const [ok] = await db.insert(schema.adminUsers).values({ name: "Ok", phone: "+18455551303", role: "delivery" }).returning();
    const id = await mk("CONFIRMED", todayISO());
    await db.update(schema.orders).set({ deliveryDriverId: gone.id }).where(eq(schema.orders.id, id));
    const { assignDriversAction } = await import("@/app/admin/(app)/orders/[id]/driver-actions");
    const f = new FormData();
    f.set("delivery", String(gone.id));
    f.set("pickup", String(ok.id));
    await assignDriversAction(id, f);
    let [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, id));
    expect(o.deliveryDriverId).toBe(gone.id);
    expect(o.pickupDriverId).toBe(ok.id);
    const g = new FormData();
    g.set("delivery", String(gone.id));
    g.set("pickup", String(gone.id)); // chosen while still active, deactivated before Save
    await assignDriversAction(id, g);
    [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, id));
    expect(o.pickupDriverId).toBe(ok.id);
  });
});

describe("H7, H8, H9: bad addresses and filters", () => {
  it("ids, order numbers, filters and search text", async () => {
    expect(idParam("abc")).toBeNull();
    expect(idParam("99999999999")).toBeNull();
    expect(idParam("12")).toBe(12);
    expect(orderIdFromParam("99999999999")).toBe(0);
    expect(orderIdFromParam("1031")).toBe(31);
    expect(cleanFilters({ status: "foo", from: "2026-13-40", to: "2026-12-01" })).toEqual({ to: "2026-12-01" });
    expect(cleanFilters({ status: "OPEN" })).toEqual({ status: "OPEN" });
    expect(likeContains(" 50%_off\\ ")).toBe("%50\\%\\_off\\\\%");
    const { reportFor } = await import("@/lib/reports");
    expect(reportFor("constructor", "owner")).toEqual({ error: "Unknown report", status: 404 });
    const { listOrders } = await import("@/lib/admin-queries");
    await expect(listOrders({ status: "foo", from: "2026-13-40" })).resolves.toBeDefined();
    await db.insert(schema.customers).values([{ name: "100% Fun", phone: "+18455551401" }, { name: "Plain", phone: "+18455551402" }]);
    const found = await listOrders({ q: "%" });
    expect(found.every((r) => (r.customer_name ?? "").includes("%") || (r.delivery_address ?? "").includes("%"))).toBe(true);
  });
});
