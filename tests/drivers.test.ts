import { beforeEach, describe, expect, it, vi } from "vitest";

/* Driver assignment (Abraham, Nov 12, 2026): a driver per delivery and pickup, overlap warnings, own stops only. */

const h = vi.hoisted(() => ({ staff: { userId: 0, role: "delivery" as string, name: "Driver" } }));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/auth", () => ({ requireStaff: async () => h.staff, currentStaff: async () => h.staff }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/notify", () => ({ sendOrderText: async () => ({ texted: true, emailed: false, message: "" }), sendSms: async () => ({ sent: true }), sendEmail: async () => ({ sent: true }) }));

import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { assignDriver, isMyStop, overlapsFor } from "@/lib/drivers";
import { markDoneAction } from "@/app/admin/deliveries/actions";

let moshe: number, dovid: number, secretary: number;
beforeEach(async () => {
  await db.delete(schema.auditLog);
  if (!moshe) {
    const rows = await db
      .insert(schema.adminUsers)
      .values([
        { name: "Moshe", role: "delivery", phone: "+18455550301" },
        { name: "Dovid", role: "delivery", phone: "+18455550302" },
        { name: "Sara", role: "secretary", phone: "+18455550303" },
      ])
      .returning();
    [moshe, dovid, secretary] = rows.map((r) => r.id);
  }
});
const order = async (day: string, extra: Record<string, unknown> = {}) =>
  (await db.insert(schema.orders).values({ status: "CONFIRMED", channel: "PHONE", eventDate: day, pickupDate: day, ...extra }).returning())[0];

describe("assigning drivers", () => {
  it("a driver for the delivery and another for the pickup; audited; only active Delivery logins", async () => {
    const o = await order("2026-12-01");
    await assignDriver(o.id, "delivery", moshe, secretary);
    await assignDriver(o.id, "pickup", dovid, secretary);
    const [row] = await db.select().from(schema.orders).where(eq(schema.orders.id, o.id));
    expect(row.deliveryDriverId).toBe(moshe);
    expect(row.pickupDriverId).toBe(dovid);
    expect((await db.select().from(schema.auditLog)).map((a) => a.action)).toEqual(["order.delivery_driver", "order.pickup_driver"]);
    await expect(assignDriver(o.id, "delivery", secretary, secretary)).rejects.toThrow("Choose an active driver.");
  });
  it("warns on overlapping jobs for the same driver (same day, same kind of stop), never blocks", async () => {
    const a = await order("2026-12-02");
    const b = await order("2026-12-02");
    expect(await assignDriver(a.id, "delivery", moshe, null)).toEqual([]);
    const warn = await assignDriver(b.id, "delivery", moshe, null);
    expect(warn).toHaveLength(1);
    expect(warn[0]).toMatch(/^Delivery for order #/);
    // different set times: no overlap
    const c = await order("2026-12-03", { deliveryTime: "9:00 AM" });
    const d = await order("2026-12-03", { deliveryTime: "1:00 PM" });
    await assignDriver(c.id, "delivery", dovid, null);
    expect(await assignDriver(d.id, "delivery", dovid, null)).toEqual([]);
    const [fresh] = await db.select().from(schema.orders).where(eq(schema.orders.id, d.id));
    expect(await overlapsFor(fresh, "delivery")).toEqual([]);
  });
});

describe("a Delivery login sees and acts on only its own stops (server side)", () => {
  it("own stop only", async () => {
    const o = await order(new Date().toISOString().slice(0, 10));
    await assignDriver(o.id, "delivery", moshe, null);
    expect(isMyStop({ deliveryDriverId: moshe, pickupDriverId: null }, "delivery", moshe)).toBe(true);
    expect(isMyStop({ deliveryDriverId: moshe, pickupDriverId: null }, "pickup", moshe)).toBe(false);
    expect(isMyStop({ deliveryDriverId: moshe, pickupDriverId: null }, "delivery", null)).toBe(false);

    h.staff = { userId: dovid, role: "delivery", name: "Dovid" };
    expect(await markDoneAction(o.id, "delivery")).toEqual({ ok: false, message: "This stop isn't assigned to you." });
    h.staff = { userId: moshe, role: "delivery", name: "Moshe" };
    expect((await markDoneAction(o.id, "delivery")).ok).toBe(true);
  });
  it("the Deliveries page filters stops on the server for Delivery logins", () => {
    const page = readFileSync("src/app/admin/deliveries/page.tsx", "utf8");
    expect(page).toContain('.filter(({ o, stop }) => staff.role !== "delivery" || isMyStop(o, stop, staff.userId))');
  });
});
