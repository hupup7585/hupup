import { and, asc, count, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { UnitStatus } from "@/lib/db/schema";
import { config } from "@/lib/config";
import { addDays, todayISO } from "@/lib/dates";
import { sendEmail } from "@/lib/notify";

/*
 * Equipment units (Abraham, Nov 15, 2026).
 *  - Each physical unit has its own record (code, serial, model, purchase, value, condition, location, status).
 *  - An item's stock is the number of its units that are Available: damaged, missing, in maintenance or unavailable
 *    units are never bookable. Items without units keep their typed-in quantity, as before.
 *  - Once a booking is confirmed, a unit is assigned for every rental day. The database refuses a second booking of
 *    the same unit on the same day (unique index), so a double booking can't be saved even by two requests at once.
 *  - Every status change is kept with the staff member and the reason. Owner and Secretary may change a status;
 *    taking a unit out of service needs a reason. Adding units is Owner only.
 */
export const UNIT_STATUS_LABEL: Record<UnitStatus, string> = {
  available: "Available",
  maintenance: "Under maintenance",
  damaged: "Damaged",
  missing: "Missing",
  unavailable: "Unavailable",
};

type Who = { userId: number | null; role: string; name?: string };

/** An item with units: its stock follows the Available units. */
export async function syncQuantity(productId: number) {
  const [all] = await db.select({ n: count() }).from(schema.equipmentUnits).where(eq(schema.equipmentUnits.productId, productId));
  if (!all?.n) return;
  const [ok] = await db.select({ n: count() }).from(schema.equipmentUnits).where(and(eq(schema.equipmentUnits.productId, productId), eq(schema.equipmentUnits.status, "available")));
  await db.update(schema.products).set({ quantity: ok?.n ?? 0 }).where(eq(schema.products.id, productId));
}

export async function listUnits(productId?: number) {
  const rows = await db
    .select({ unit: schema.equipmentUnits, product: schema.products.name })
    .from(schema.equipmentUnits)
    .innerJoin(schema.products, eq(schema.products.id, schema.equipmentUnits.productId))
    .where(productId ? eq(schema.equipmentUnits.productId, productId) : undefined)
    .orderBy(asc(schema.products.name), asc(schema.equipmentUnits.code));
  return rows;
}

export async function addUnit(
  input: { productId: number; code: string; serial?: string; model?: string; purchaseDate?: string; purchasePriceCents?: number | null; replacementValueCents?: number | null; condition?: string; location?: string; notes?: string },
  who: Who,
) {
  if (who.role !== "owner") throw new Error("Only the Owner can add equipment units.");
  const code = input.code.trim().toUpperCase();
  // Abraham keeps his own equipment numbers: letters, digits, spaces, dots, dashes and slashes
  if (!/^[A-Z0-9][A-Z0-9 ./-]{0,39}$/.test(code)) throw new Error("Give the unit an ID of up to 40 letters and numbers.");
  const [u] = await db
    .insert(schema.equipmentUnits)
    .values({
      productId: input.productId,
      code,
      serial: input.serial?.trim() || null,
      model: input.model?.trim() || null,
      purchaseDate: input.purchaseDate || null,
      purchasePriceCents: input.purchasePriceCents ?? null,
      replacementValueCents: input.replacementValueCents ?? null,
      condition: ["good", "fair", "poor"].includes(input.condition ?? "") ? input.condition! : "good",
      location: input.location?.trim() || null,
      notes: input.notes?.trim() || null,
    })
    .returning();
  await db.insert(schema.unitStatusHistory).values({ unitId: u.id, fromStatus: null, toStatus: "available", reason: "Added", userId: who.userId });
  await db.insert(schema.auditLog).values({ userId: who.userId, action: "unit.added", entityType: "unit", entityId: String(u.id), after: { code, productId: input.productId } });
  await syncQuantity(input.productId);
  // Extra check HQ3 (Nov 27, 2026): upcoming confirmed bookings of this item get a unit now (the stock now follows the
  // units); the ones still without a unit are reported on the Units page, so an item with fewer units than bookings is seen
  const open = await db
    .selectDistinct({ id: schema.orders.id })
    .from(schema.orders)
    .innerJoin(schema.orderItems, eq(schema.orderItems.orderId, schema.orders.id))
    .where(and(eq(schema.orderItems.productId, input.productId), eq(schema.orders.status, "CONFIRMED"), sql`coalesce(${schema.orders.pickupDate}, ${schema.orders.eventDate}) >= ${todayISO()}`));
  const missing: string[] = [];
  for (const o of open) missing.push(...(await assignUnits(o.id, { quiet: true })).missing);
  return Object.assign(u, { missingUnits: [...new Set(missing)] });
}

/**
 * Change a unit's status. Taking it out of service (maintenance, damaged, missing, unavailable) is Owner only and
 * needs a reason. Any confirmed bookings that now have no unit are reported to the Owner.
 */
export async function setUnitStatus(unitId: number, status: UnitStatus, reason: string, who: Who) {
  // Abraham, Nov 15, 2026: Owner and Secretary may take a unit out of service and put it back
  if (who.role !== "owner" && who.role !== "secretary") throw new Error("Only the Owner or the Secretary can change a unit.");
  if (status !== "available" && !reason.trim()) throw new Error("Please give a reason.");
  const [u] = await db.select().from(schema.equipmentUnits).where(eq(schema.equipmentUnits.id, unitId)).limit(1);
  if (!u) throw new Error("Unit not found.");
  if (u.status === status) return { conflicts: [] as string[] };
  // Extra check HQ8 (Nov 27, 2026): the change happens only if the unit is still in the status that was read, so a double
  // save moves its booked days once (never two units for one order-day)
  const changed = await db.update(schema.equipmentUnits).set({ status, updatedAt: new Date() }).where(and(eq(schema.equipmentUnits.id, unitId), eq(schema.equipmentUnits.status, u.status))).returning({ id: schema.equipmentUnits.id });
  if (!changed.length) return { conflicts: [] as string[] };
  await db.insert(schema.unitStatusHistory).values({ unitId, fromStatus: u.status, toStatus: status, reason: reason.trim() || null, userId: who.userId });
  await db.insert(schema.auditLog).values({ userId: who.userId, action: "unit.status", entityType: "unit", entityId: String(unitId), before: { status: u.status }, after: { status, reason } });
  await syncQuantity(u.productId);
  let conflicts: string[] = [];
  if (status !== "available") {
    // its future booking days move to another free unit; any day left without one is a conflict
    const days = await db.select().from(schema.unitBookings).where(and(eq(schema.unitBookings.unitId, unitId), gte(schema.unitBookings.day, todayISO())));
    for (const d of days) {
      await db.delete(schema.unitBookings).where(eq(schema.unitBookings.id, d.id));
      const moved = await bookFreeUnit(u.productId, d.day, d.orderId);
      if (!moved) conflicts.push(`order #${1000 + d.orderId} on ${d.day}`);
    }
    conflicts = [...new Set(conflicts)];
    if (conflicts.length) await alertConflict(`Unit ${u.code} was taken out of service (${UNIT_STATUS_LABEL[status]}).`, conflicts);
  } else {
    // back in service: upcoming confirmed bookings of this item that were left without a unit get one again
    const open = await db
      .selectDistinct({ id: schema.orders.id })
      .from(schema.orders)
      .innerJoin(schema.orderItems, eq(schema.orderItems.orderId, schema.orders.id))
      .where(and(eq(schema.orderItems.productId, u.productId), eq(schema.orders.status, "CONFIRMED"), sql`coalesce(${schema.orders.pickupDate}, ${schema.orders.eventDate}) >= ${todayISO()}`));
    for (const o of open) await assignUnits(o.id, { quiet: true });
  }
  return { conflicts };
}

/** Owner email (wording approved by Abraham, Nov 15, 2026). */
async function alertConflict(lead: string, conflicts: string[]) {
  const to = config.adminEmail();
  if (!to) return;
  await sendEmail(
    to,
    "Hup Up Attractions: equipment conflict",
    `${lead} No unit is free for: ${conflicts.join(", ")}.\n\nPlease call these customers about another item or date, or put a unit back in service.\n\n${config.baseUrl()}/admin/units`,
  ).catch(() => null);
}

/** Book one free Available unit of an item for a day. The unique index makes two at once impossible. */
async function bookFreeUnit(productId: number, day: string, orderId: number, exec: Pick<typeof db, "select" | "execute"> = db): Promise<number | null> {
  const units = await exec
    .select({ id: schema.equipmentUnits.id })
    .from(schema.equipmentUnits)
    .where(and(eq(schema.equipmentUnits.productId, productId), eq(schema.equipmentUnits.status, "available")))
    .orderBy(asc(schema.equipmentUnits.code));
  for (const u of units) {
    const res = await exec.execute(sql`INSERT INTO unit_bookings (unit_id, day, order_id) VALUES (${u.id}, ${day}::date, ${orderId}) ON CONFLICT (unit_id, day) DO NOTHING RETURNING id`);
    if (res.rows.length) return u.id;
  }
  return null;
}

/** Days an order needs a unit: delivery day through pickup day. */
function orderDays(o: { eventDate: string; pickupDate: string | null }) {
  const out: string[] = [];
  const last = o.pickupDate && o.pickupDate > o.eventDate ? o.pickupDate : o.eventDate;
  for (let d = o.eventDate; d <= last; d = addDays(d, 1)) out.push(d);
  return out;
}

/** A confirmed booking: assign a unit for every item and day (items without units are skipped). Conflicts email the Owner. */
export async function assignUnits(orderId: number, opts: { quiet?: boolean } = {}) {
  // Deep check A12 (Nov 27, 2026): two Confirm clicks at once could both see no units yet and each book a set. The
  // order is locked while its units are counted and booked, so the second sees the first one's units.
  const r = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM orders WHERE id = ${orderId} FOR UPDATE`);
    const [o] = await tx.select().from(schema.orders).where(eq(schema.orders.id, orderId)).limit(1);
    if (!o) return null;
    const items = await tx.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, orderId));
    const have = await tx.select().from(schema.unitBookings).where(eq(schema.unitBookings.orderId, orderId));
    let assigned = 0;
    const missing: string[] = [];
    for (const i of items) {
      const [hasUnits] = await tx.select({ n: count() }).from(schema.equipmentUnits).where(eq(schema.equipmentUnits.productId, i.productId));
      if (!hasUnits?.n) continue;
      const unitIds = (await tx.select({ id: schema.equipmentUnits.id }).from(schema.equipmentUnits).where(eq(schema.equipmentUnits.productId, i.productId))).map((u) => u.id);
      for (const day of orderDays(o).filter((d) => d >= todayISO())) {
        const already = have.filter((h) => h.day === day && unitIds.includes(h.unitId)).length;
        for (let n = already; n < i.qty; n++) {
          const u = await bookFreeUnit(i.productId, day, orderId, tx);
          if (u) assigned++;
          else missing.push(`order #${1000 + orderId} on ${day}`);
        }
      }
    }
    return { assigned, missing };
  });
  if (!r) return { assigned: 0, missing: [] as string[] };
  const { assigned, missing } = r;
  if (missing.length && !opts.quiet) await alertConflict("A booking was confirmed, but there are not enough units.", [...new Set(missing)]);
  return { assigned, missing: [...new Set(missing)] };
}

/** A cancelled booking gives its units back (past days stay as rental history). */
export async function releaseUnits(orderId: number) {
  await db.delete(schema.unitBookings).where(and(eq(schema.unitBookings.orderId, orderId), gte(schema.unitBookings.day, todayISO())));
}

/** One unit's history: status changes and rentals (count and revenue). */
export async function unitHistory(unitId: number) {
  const status = await db.select().from(schema.unitStatusHistory).where(eq(schema.unitStatusHistory.unitId, unitId)).orderBy(desc(schema.unitStatusHistory.at));
  const days = await db.select().from(schema.unitBookings).where(eq(schema.unitBookings.unitId, unitId)).orderBy(desc(schema.unitBookings.day));
  const orderIds = [...new Set(days.map((d) => d.orderId))];
  const [u] = await db.select().from(schema.equipmentUnits).where(eq(schema.equipmentUnits.id, unitId)).limit(1);
  const lines = orderIds.length && u ? await db.select().from(schema.orderItems).where(and(inArray(schema.orderItems.orderId, orderIds), eq(schema.orderItems.productId, u.productId))) : [];
  const revenueCents = orderIds.reduce((t, id) => t + (lines.find((l) => l.orderId === id)?.unitPriceCents ?? 0), 0);
  return { status, rentals: orderIds.length, daysOut: days.length, revenueCents, orderIds };
}
