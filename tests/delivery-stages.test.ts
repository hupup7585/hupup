import { beforeEach, describe, expect, it, vi } from "vitest";

/* Delivery statuses (Abraham, Nov 15, 2026): Booked, Out for delivery, Delivered, Out for pickup, Picked up,
   Problem reported; each with its time and the staff member; a problem emails the office. */

const h = vi.hoisted(() => ({ staff: { userId: 0, role: "delivery" as string, name: "Moshe" }, emails: [] as { to: string; subject: string; text: string }[] }));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/auth", () => ({ requireStaff: async () => h.staff, currentStaff: async () => h.staff }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/notify", () => ({ sendOrderText: async () => ({ texted: true, emailed: false, message: "" }), sendSms: async () => ({ sent: true }), sendEmail: async (to: string, subject: string, text: string) => (h.emails.push({ to, subject, text }), { sent: true }) }));

import { eq } from "drizzle-orm";
import { todayISO } from "@/lib/dates";
import { db, schema } from "@/lib/db";
import { STAGE_LABEL, stageOf, stagesFor } from "@/lib/delivery-stages";
import { markDoneAction, stageAction } from "@/app/admin/deliveries/actions";

let moshe: number, dovid: number, orderId: number;
beforeEach(async () => {
  process.env.ADMIN_EMAIL = "owner@example.com";
  h.emails = [];
  if (!moshe) {
    const [a, b] = await db.insert(schema.adminUsers).values([{ name: "Moshe", role: "delivery", phone: "+18455550401" }, { name: "Dovid", role: "delivery", phone: "+18455550402" }]).returning();
    moshe = a.id;
    dovid = b.id;
    const today = todayISO();
    const [o] = await db.insert(schema.orders).values({ status: "CONFIRMED", channel: "PHONE", eventDate: today, pickupDate: today, deliveryDriverId: moshe, pickupDriverId: moshe, deliveryAddress: "12 Forest Road, Monroe" }).returning();
    orderId = o.id;
  }
  h.staff = { userId: moshe, role: "delivery", name: "Moshe" };
});

describe("delivery statuses", () => {
  it("the six names", () => {
    expect(Object.values(STAGE_LABEL)).toEqual(["Booked", "Out for delivery", "Delivered", "Out for pickup", "Picked up", "Problem reported"]);
  });
  it("Booked, then Out for delivery, then Delivered, each with its time and driver", async () => {
    expect(await stageOf(orderId, "delivery")).toBe("booked");
    expect((await stageAction(orderId, "delivery", "out_for_delivery")).ok).toBe(true);
    expect(await stageOf(orderId, "delivery")).toBe("out_for_delivery");
    expect((await markDoneAction(orderId, "delivery")).ok).toBe(true);
    const now = (await stagesFor([orderId])).get(`${orderId}-delivery`)!;
    expect(now.stage).toBe("delivered");
    expect(now.history.map((x) => [x.stage, x.userId])).toEqual([["out_for_delivery", moshe], ["delivered", moshe]]);
    const [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId));
    expect(o.status).toBe("DELIVERED");
  });
  it("Problem reported needs a note and emails the office", async () => {
    expect((await stageAction(orderId, "pickup", "problem", "  ")).ok).toBe(false);
    const r = await stageAction(orderId, "pickup", "problem", "No one home, gate locked");
    expect(r).toEqual({ ok: true, message: "Problem reported. The office was told." });
    expect(h.emails[0].to).toBe("owner@example.com");
    expect(h.emails[0].subject).toMatch(/problem on the pickup for order #/);
    expect(h.emails[0].text).toContain("No one home, gate locked");
    expect(await stageOf(orderId, "pickup")).toBe("problem");
  });
  it("a driver can't change another driver's stop", async () => {
    h.staff = { userId: dovid, role: "delivery", name: "Dovid" };
    expect(await stageAction(orderId, "pickup", "out_for_pickup")).toEqual({ ok: false, message: "This stop isn't assigned to you." });
  });
});

describe("deep check 0600 M55: Delivered on the driver screen", () => {
  it("a stop more than a day ahead is refused; a double click records it once", async () => {
    const { addDays, todayISO } = await import("@/lib/dates");
    const far = addDays(todayISO(), 5);
    const [f] = await db.insert(schema.orders).values({ status: "CONFIRMED", channel: "PHONE", eventDate: far, pickupDate: far, deliveryDriverId: moshe }).returning();
    expect((await markDoneAction(f.id, "delivery")).message).toMatch(/It can be marked delivered from the day before/);
    const t = todayISO();
    const [o] = await db.insert(schema.orders).values({ status: "CONFIRMED", channel: "PHONE", eventDate: t, pickupDate: t, deliveryDriverId: moshe }).returning();
    const r = await Promise.all([markDoneAction(o.id, "delivery"), markDoneAction(o.id, "delivery")]);
    expect(r.filter((x) => x.ok)).toHaveLength(1);
    const logs = (await db.select().from(schema.auditLog)).filter((a) => a.action === "delivery.delivered" && a.entityId === String(o.id));
    expect(logs).toHaveLength(1);
  });
});

describe("deep check 0600 M56: crafted bad ids", () => {
  it("letters or 11+ digits are 'not found', never a database error", async () => {
    const { isDbId } = await import("@/lib/db-id");
    const { orderIdFromParam } = await import("@/lib/order-path");
    expect([isDbId(1), isDbId(0), isDbId(NaN), isDbId(99999999999), isDbId(1.5)]).toEqual([true, false, false, false, false]);
    expect(orderIdFromParam("99999999999")).toBe(0);
    expect(orderIdFromParam("1031")).toBe(31);
    expect((await markDoneAction(Number("abc"), "delivery")).message).toBe("Order not found.");
    expect((await stageAction(99999999999, "delivery", "on_the_way" as never)).message).toBe("Order not found.");
  });
});
