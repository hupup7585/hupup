import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { addDays } from "@/lib/dates";
import { getSettings } from "@/lib/settings";
import { calendarDefaults, nextOpenDay, type CalendarSettings } from "@/lib/jewish-calendar";

/**
 * Inventory rule (Abraham, Nov 8, 2026): bookings are whole rental days. A rented unit is OUT from its delivery day
 * (delivered 9:00 AM to 12:00 PM) through its pickup day (out the door by 9:00 AM), and on every day in between.
 * There is no pickup on Shabbos or Yom Tov, so a Friday booking is picked up Sunday and holds the unit Friday,
 * Shabbos and Sunday. A booking for day D needs a free unit on every day from D through its pickup day.
 *
 * Orders that occupy inventory:
 *  - CONFIRMED, DELIVERED, NEEDS_ATTENTION      always (a late payment keeps its claim while staff sort it out)
 *  - HOLD, PENDING_PAYMENT                      while hold_expires_at is in the future (or null)
 * PICKED_UP and CANCELLED free the unit.
 */
export const ACTIVE_ORDER_SQL = sql`(
  o.status IN ('CONFIRMED','DELIVERED','NEEDS_ATTENTION')
  OR (o.status IN ('HOLD','PENDING_PAYMENT') AND (o.hold_expires_at IS NULL OR o.hold_expires_at > now()))
)`;

export type Usage = {
  /** units out because the event (delivery) is that day */
  event: number;
  /** units still out from the previous day's event (pickup day) */
  pickup: number;
  /** units in a HOLD (live phone cart) — subset of event+pickup */
  held: number;
};

export type UsageMap = Map<number, Map<string, Usage>>; // productId -> day -> usage

type Executor = { execute: typeof db.execute };

export async function getUsage(
  fromISO: string,
  toISO: string,
  productIds?: number[],
  exec: Executor = db,
): Promise<UsageMap> {
  const productFilter =
    productIds && productIds.length
      ? sql`AND oi.product_id IN (${sql.join(productIds.map((id) => sql`${id}`), sql`, `)})`
      : sql``;
  const res = await exec.execute(sql`
    SELECT oi.product_id AS product_id,
           d.day::text AS day,
           d.kind AS kind,
           SUM(oi.qty)::int AS qty,
           SUM(CASE WHEN o.status = 'HOLD' THEN oi.qty ELSE 0 END)::int AS held
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    -- every day from delivery through pickup (a Friday booking holds Friday, Shabbos and Sunday)
    CROSS JOIN LATERAL (
      SELECT g::date AS day, CASE WHEN g::date = o.event_date THEN 'event' ELSE 'pickup' END AS kind
      FROM generate_series(o.event_date::timestamp, greatest(o.pickup_date, o.event_date)::timestamp, interval '1 day') AS g
    ) AS d
    WHERE ${ACTIVE_ORDER_SQL}
      AND d.day BETWEEN ${fromISO}::date AND ${toISO}::date
      ${productFilter}
    GROUP BY 1, 2, 3
  `);
  const map: UsageMap = new Map();
  for (const r of res.rows as { product_id: number; day: string; kind: string; qty: number; held: number }[]) {
    const byDay = map.get(r.product_id) ?? new Map<string, Usage>();
    const u = byDay.get(r.day) ?? { event: 0, pickup: 0, held: 0 };
    if (r.kind === "event") u.event += r.qty;
    else u.pickup += r.qty;
    u.held += r.held;
    byDay.set(r.day, u);
    map.set(r.product_id, byDay);
  }
  return map;
}

export function usedOn(usage: UsageMap, productId: number, day: string): number {
  const u = usage.get(productId)?.get(day);
  return u ? u.event + u.pickup : 0;
}

/** Units free on a single calendar day. */
export function freeOnDay(quantity: number, usage: UsageMap, productId: number, day: string): number {
  return Math.max(0, quantity - usedOn(usage, productId, day));
}

/**
 * Pickup day for an event: the next day, or, when that day is Shabbos / Yom Tov / another closed day, the next open
 * day (Jewish calendar settings). The unit stays out until then, so it can't be double-booked in between.
 */
export function pickupDateFor(eventDate: string, cal: CalendarSettings = calendarDefaults()): string {
  return nextOpenDay(addDays(eventDate, 1), cal);
}

/** Units that can be booked for an event on `eventDate`: free on every day from delivery through pickup. */
export function bookableQty(quantity: number, usage: UsageMap, productId: number, eventDate: string, pickupDate: string = addDays(eventDate, 1)): number {
  let free = quantity;
  for (let d = eventDate; d <= pickupDate; d = addDays(d, 1)) free = Math.min(free, freeOnDay(quantity, usage, productId, d));
  return free;
}

/** Bookable units for one product on one event date (fresh DB read). Pass `pickupDate` when inside a transaction. */
export async function checkBookable(productId: number, quantity: number, eventDate: string, exec: Executor = db, pickupDate?: string) {
  const pickup = pickupDate ?? pickupDateFor(eventDate, await getSettings());
  const usage = await getUsage(eventDate, pickup, [productId], exec);
  return bookableQty(quantity, usage, productId, eventDate, pickup);
}
