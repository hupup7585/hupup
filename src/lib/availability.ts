import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { addDays } from "@/lib/dates";
import { getSettings } from "@/lib/settings";
import { calendarDefaults, nextOpenDay, type CalendarSettings } from "@/lib/jewish-calendar";
import { holidayFridayPickup, type HolidaySettings } from "@/lib/holiday-rentals";

/**
 * Inventory rule (Abraham, Nov 8, 2026): bookings are whole rental days. A rented unit is OUT from its delivery day
 * (delivered 9:00 AM to 12:00 PM) through its pickup day (out the door by 9:00 AM), and on every day in between.
 * There is no pickup on Shabbes or Yom Tov, so a Friday booking is picked up Sunday and holds the unit Friday,
 * Shabbes and Sunday. A booking for day D needs a free unit on every day from D through its pickup day.
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
    -- every day from delivery through pickup (a Friday booking holds Friday, Shabbes and Sunday)
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
 * Pickup day for an event: the next day, or, when that day is Shabbes / Yom Tov / another closed day, the next open
 * day (Jewish calendar settings). The unit stays out until then, so it can't be double-booked in between.
 */
export function pickupDateFor(eventDate: string, cal: CalendarSettings = calendarDefaults()): string {
  // Chanukah and Chol Hamoed (Abraham, Nov 18, 2026): a Friday rental is picked up Saturday night, 1 hour after Shabbes
  const holidayFriday = holidayFridayPickup(eventDate, cal as unknown as HolidaySettings);
  if (holidayFriday) return holidayFriday;
  return nextOpenDay(addDays(eventDate, 1), cal);
}

/** Units that can be booked for an event on `eventDate`: free on every day from delivery through pickup. */
export function bookableQty(quantity: number, usage: UsageMap, productId: number, eventDate: string, pickupDate: string = addDays(eventDate, 1)): number {
  let free = quantity;
  for (let d = eventDate; d <= pickupDate; d = addDays(d, 1)) free = Math.min(free, freeOnDay(quantity, usage, productId, d));
  return free;
}

/** The items that share this item's unit (its stock group), itself included; just itself when it has no group. */
export async function stockGroupIds(productId: number, exec: Executor = db): Promise<number[]> {
  const r = await exec.execute(sql`
    SELECT p2.id FROM products p1 JOIN products p2 ON p2.stock_group = p1.stock_group
    WHERE p1.id = ${productId} AND p1.stock_group IS NOT NULL`);
  const ids = (r.rows as { id: number }[]).map((x) => Number(x.id));
  return ids.length ? ids : [productId];
}

/*
 * Shared laser tag stock (Hark for Abraham, Nov 24, 2026). The real stock is pools: 1 inflatable maze, a number of
 * six-packs and a number of four-packs of laser guns. Every laser item takes from its pools:
 *   maze with 6 guns = maze + six-pack; maze with 4 guns = maze + four-pack; only 6 guns / additional 6-pack = six-pack;
 *   only 4 guns / additional 4-pack = four-pack.
 * An item's pools come from its name in a laser category ("maze", "6", "4"); nothing is hard-coded. A pool's size is the
 * Admin Catalog quantity of the items that use only that pool (six-pack items 6, four-pack items 7); the maze pool is the
 * maze items' quantity (1). An item is free on a day when every one of its pools has one left.
 */
export type LaserPool = "maze" | "six" | "four";
export function laserPoolsFor(name: string, category: string): LaserPool[] {
  if (!/laser/i.test(category)) return [];
  const pools: LaserPool[] = [];
  if (/maze/i.test(name)) pools.push("maze");
  if (/(^|\D)6(\D|$)|\bsix\b/i.test(name)) pools.push("six");
  else if (/(^|\D)4(\D|$)|\bfour\b/i.test(name)) pools.push("four");
  return pools;
}
export type LaserPoolInfo = { items: Map<number, { quantity: number; pools: LaserPool[]; active?: boolean }>; sizes: Record<LaserPool, number> };

export async function laserPoolInfo(exec: Executor = db): Promise<LaserPoolInfo> {
  const r = await exec.execute(sql`
    SELECT p.id, p.name, p.quantity, p.active, coalesce(c.name, '') AS cat FROM products p LEFT JOIN categories c ON c.id = p.category_id
    WHERE c.name ~* 'laser'`);
  const items = new Map<number, { quantity: number; pools: LaserPool[]; active: boolean }>();
  for (const x of r.rows as { id: number; name: string; quantity: number; active: boolean; cat: string }[]) {
    const pools = laserPoolsFor(x.name, x.cat);
    if (pools.length) items.set(Number(x.id), { quantity: Number(x.quantity), pools, active: Boolean(x.active) });
  }
  // a pool's size comes from the active items (an item switched off in Admin does not set it; its bookings still count)
  const sizeOf = (pool: LaserPool) => {
    const live = [...items.values()].filter((i) => i.active);
    const only = live.filter((i) => i.pools.length === 1 && i.pools[0] === pool);
    const any = live.filter((i) => i.pools.includes(pool));
    return Math.max(0, ...(only.length ? only : any).map((i) => i.quantity));
  };
  return { items, sizes: { maze: sizeOf("maze"), six: sizeOf("six"), four: sizeOf("four") } };
}

/** Turn each laser item's own use into its pools' use: what is left for it is what its emptiest pool has left. */
export function applyLaserPools(usage: UsageMap, info: LaserPoolInfo): void {
  if (!info.items.size) return;
  const days = new Set<string>();
  for (const id of info.items.keys()) for (const d of usage.get(id)?.keys() ?? []) days.add(d);
  const original = new Map([...info.items.keys()].map((id) => [id, usage.get(id)]));
  const usedIn = (pool: LaserPool, day: string) => {
    let n = 0;
    for (const [id, it] of info.items) if (it.pools.includes(pool)) {
      const u = original.get(id)?.get(day);
      if (u) n += u.event + u.pickup;
    }
    return n;
  };
  for (const [id, it] of info.items) {
    const byDay = new Map<string, Usage>();
    for (const day of days) {
      const left = Math.min(...it.pools.map((pool) => info.sizes[pool] - usedIn(pool, day)));
      const used = Math.max(0, it.quantity - Math.max(0, left));
      byDay.set(day, { event: used, pickup: 0, held: original.get(id)?.get(day)?.held ?? 0 });
    }
    usage.set(id, byDay);
  }
}

/**
 * Bookable units for one product on one event date (fresh DB read). Pass `pickupDate` when inside a transaction.
 * Items in a stock group share their units (Abraham, Nov 17, 2026: one maze for both maze items), so a booking of
 * any of them counts against all of them.
 */
export async function checkBookable(productId: number, quantity: number, eventDate: string, exec: Executor = db, pickupDate?: string) {
  const pickup = pickupDate ?? pickupDateFor(eventDate, await getSettings());
  // A laser item: what is left of its shared pools (maze, six-packs, four-packs) on every day it is out
  const laser = await laserPoolInfo(exec);
  if (laser.items.has(productId)) {
    const usage = await getUsage(eventDate, pickup, [...laser.items.keys()], exec);
    applyLaserPools(usage, laser);
    return bookableQty(quantity, usage, productId, eventDate, pickup);
  }
  const ids = await stockGroupIds(productId, exec);
  const usage = await getUsage(eventDate, pickup, ids, exec);
  if (ids.length > 1) {
    // Add the whole group's use onto this item, day by day
    const merged = new Map<string, Usage>();
    for (const id of ids)
      for (const [day, u] of usage.get(id) ?? []) {
        const m = merged.get(day) ?? { event: 0, pickup: 0, held: 0 };
        merged.set(day, { event: m.event + u.event, pickup: m.pickup + u.pickup, held: m.held + u.held });
      }
    usage.set(productId, merged);
  }
  return bookableQty(quantity, usage, productId, eventDate, pickup);
}
