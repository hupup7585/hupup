import { beforeEach, describe, expect, it, vi } from "vitest";

/* Extra check H (Nov 27, 2026): deliveries, drivers and invoices. In-memory database with the real migrations. */

const h = vi.hoisted(() => ({ staff: { userId: 0, role: "delivery" as string, name: "Moshe" } }));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/auth", () => ({ requireStaff: async () => h.staff, currentStaff: async () => h.staff }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/notify", () => ({ sendOrderText: async () => ({ texted: true, emailed: false, message: "" }), sendSms: async () => ({ sent: true }), sendEmail: async () => ({ sent: true }) }));

import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { addDays, todayISO } from "@/lib/dates";
import { markDoneAction, stageAction } from "@/app/admin/deliveries/actions";
import { isStopDay } from "@/lib/delivery-stops";
import { createDoc, isUniqueNumberClash } from "@/lib/invoices";

let moshe: number, sara: number;
beforeEach(async () => {
  if (!moshe) {
    const [a, b] = await db.insert(schema.adminUsers).values([{ name: "Moshe", role: "delivery", phone: "+18455550701" }, { name: "Sara", role: "secretary", phone: "+18455550702" }]).returning();
    moshe = a.id;
    sara = b.id;
  }
  h.staff = { userId: moshe, role: "delivery", name: "Moshe" };
});
const order = async (status: string, day = todayISO(), pickup = day) =>
  (await db.insert(schema.orders).values({ status: status as never, channel: "PHONE", eventDate: day, pickupDate: pickup, deliveryDriverId: moshe, pickupDriverId: moshe }).returning())[0];
const events = async (orderId: number, stage: string) => (await db.select().from(schema.deliveryEvents).where(and(eq(schema.deliveryEvents.orderId, orderId), eq(schema.deliveryEvents.stage, stage)))).length;

describe("H1: Delivered / Picked up is one locked step", () => {
  it("a double tap marks it once", async () => {
    const o = await order("CONFIRMED");
    const [a, b] = await Promise.all([markDoneAction(o.id, "delivery"), markDoneAction(o.id, "delivery")]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect(await events(o.id, "delivered")).toBe(1);
    const [after] = await db.select().from(schema.orders).where(eq(schema.orders.id, o.id));
    expect(after.status).toBe("DELIVERED");
  });
  it("a cancelled order is never turned into Delivered", async () => {
    const o = await order("CANCELLED");
    expect((await markDoneAction(o.id, "delivery")).ok).toBe(false);
    const [after] = await db.select().from(schema.orders).where(eq(schema.orders.id, o.id));
    expect(after.status).toBe("CANCELLED");
  });
});

describe("H2: a Delivery login updates only today's stop (or yesterday's late one)", () => {
  it("next week's stop is refused for the driver; the Secretary can", async () => {
    const o = await order("CONFIRMED", addDays(todayISO(), 7));
    expect(await markDoneAction(o.id, "delivery")).toEqual({ ok: false, message: "You can only update one of your own stops today." });
    expect(await stageAction(o.id, "delivery", "out_for_delivery")).toEqual({ ok: false, message: "You can only update one of your own stops today." });
    const [still] = await db.select().from(schema.orders).where(eq(schema.orders.id, o.id));
    expect(still.status).toBe("CONFIRMED");
    h.staff = { userId: sara, role: "secretary", name: "Sara" };
    expect((await markDoneAction(o.id, "delivery")).ok).toBe(true);
  });
  it("yesterday's late stop still works; the pickup is checked on its own day", async () => {
    const y = await order("CONFIRMED", addDays(todayISO(), -1));
    expect((await markDoneAction(y.id, "delivery")).ok).toBe(true);
    expect(isStopDay({ eventDate: todayISO(), pickupDate: addDays(todayISO(), 2) }, "pickup")).toBe(false);
    expect(isStopDay({ eventDate: addDays(todayISO(), -2), pickupDate: todayISO() }, "pickup")).toBe(true);
    expect(isStopDay({ eventDate: null, pickupDate: null }, "delivery")).toBe(false);
  });
});

describe("H3: a stage only fits the order's state", () => {
  it("no Out for delivery or Problem on a cancelled or unpaid order; no Out for pickup before Delivered", async () => {
    const c = await order("CANCELLED");
    expect((await stageAction(c.id, "delivery", "out_for_delivery")).ok).toBe(false);
    expect((await stageAction(c.id, "delivery", "problem", "Gate locked")).ok).toBe(false);
    const p = await order("PENDING_PAYMENT");
    expect((await stageAction(p.id, "delivery", "out_for_delivery")).ok).toBe(false);
    const ok = await order("CONFIRMED");
    expect(await stageAction(ok.id, "pickup", "out_for_pickup")).toEqual({ ok: false, message: "Mark it delivered first." });
    expect((await stageAction(ok.id, "delivery", "out_for_delivery")).ok).toBe(true);
    expect((await stageAction(ok.id, "delivery", "problem", "Customer not home")).ok).toBe(true);
    expect(await events(c.id, "out_for_delivery")).toBe(0);
  });
});

describe("H4: invoice numbers made at the same moment", () => {
  it("three at once each get their own number", async () => {
    const make = (n: string) => createDoc({ kind: "invoice", customerName: n, issueDate: "2026-11-27", lines: [{ description: "Bouncer", qty: 1, unitCents: 10000 }] }, null);
    const docs = await Promise.all([make("A"), make("B"), make("C")]);
    expect(new Set(docs.map((d) => d.number)).size).toBe(3);
  });
  it("knows the database's 'number taken' answer", () => {
    expect(isUniqueNumberClash({ code: "23505" })).toBe(true);
    expect(isUniqueNumberClash({ cause: { constraint: "book_invoices_number_unique" } })).toBe(true);
    expect(isUniqueNumberClash(new Error('duplicate key value violates unique constraint "book_invoices_number_unique"'))).toBe(true);
    expect(isUniqueNumberClash(new Error("connection lost"))).toBe(false);
    expect(isUniqueNumberClash(null)).toBe(false);
  });
});
