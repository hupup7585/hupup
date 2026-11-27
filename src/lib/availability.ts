import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { addDays } from "@/lib/dates";
import { getSettings } from "@/lib/settings";
import { calendarDefaults, nextOpenDay, type CalendarSettings } from "@/lib/jewish-calendar";
import { holidayFridayPickup, type HolidaySettings } from "@/lib/holiday-rentals";

/**
 * Inventory rule (Abraham, Nov 8, 2026; changed Nov 24, 2026, 11:11 PM): bookings are whole rental days. A rented unit
 * is OUT on its delivery day (delivered 9:00 AM to 12:00 PM) and on every day strictly between delivery and pickup.
 * The pickup day itself is FREE for a new booking (Abraham, Nov 24, 2026: pickups are out the door by 9:00 AM and
 * deliveries start at 9:00 AM, so the unit picked up that morning can go out again the same day).
 * There is no pickup on Shabbes or Yom Tov, so a Friday booking is picked up Sunday and holds Friday and Shabbes; the
 * unit is free for Sunday. A Chanukah or Chol Hamoed Friday rental picked up Saturday night holds Shabbes; free Sunday.
 * A booking for day D needs a free unit on D and on every day strictly between D and its pickup day.
 * The pickup day is still counted (kind "pickup") so the drivers see it, but it never lowers the bookable count.
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
  /** units picked up that morning (shown for the drivers; NOT counted against stock, Nov 24, 2026) */
  pickup: number;
  /** units still out on a day strictly between their event day and their pickup day (counted) */
  between?: number;
  /** units in a HOLD (live phone cart) */
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
    -- every day from delivery through pickup; the pickup day is listed (for the drivers) but does not hold the unit
    CROSS JOIN LATERAL (
      SELECT g::date AS day,
             CASE WHEN g::date = o.event_date THEN 'event' WHEN g::date = o.pickup_date THEN 'pickup' ELSE 'between' END AS kind
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
    const u = byDay.get(r.day) ?? { event: 0, pickup: 0, between: 0, held: 0 };
    if (r.kind === "event") u.event += r.qty;
    else if (r.kind === "pickup") u.pickup += r.qty;
    else u.between = (u.between ?? 0) + r.qty;
    // a HOLD counts as held only on the days it holds the unit (not its pickup day)
    if (r.kind !== "pickup") u.held += r.held;
    byDay.set(r.day, u);
    map.set(r.product_id, byDay);
  }
  return map;
}

/** Units that hold this day: delivered that day, or out on a day between delivery and pickup. Pickup-day units do not count. */
export function usedOn(usage: UsageMap, productId: number, day: string): number {
  const u = usage.get(productId)?.get(day);
  return u ? u.event + (u.between ?? 0) : 0;
}

/** The last day a booking holds its unit: the day before pickup (the event day itself when pickup is the next day or unset). */
export function lastHeldDay(eventDate: string, pickupDate: string | null | undefined): string {
  return pickupDate && pickupDate > eventDate ? addDays(pickupDate, -1) : eventDate;
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

/**
 * Units that can be booked for an event on `eventDate`: free on the event day and on every day strictly between it
 * and the pickup day (Nov 24, 2026: the pickup day itself is not checked; a one-day rental checks only its event day).
 */
export function bookableQty(quantity: number, usage: UsageMap, productId: number, eventDate: string, pickupDate: string = addDays(eventDate, 1)): number {
  let free = quantity;
  const last = lastHeldDay(eventDate, pickupDate);
  for (let d = eventDate; d <= last; d = addDays(d, 1)) free = Math.min(free, freeOnDay(quantity, usage, productId, d));
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
  // Admin handoff Phase 4 (Nov 27, 2026): Catalog > Item types when the Owner set them; otherwise the names, as before.
  // Read through the same connection (exec), so a locked booking step sees the same types.
  const { parseItemTypes, categoryKind, laserRole, LASER_ROLE_POOLS } = await import("@/lib/item-types");
  const raw = ((await exec.execute(sql`SELECT value FROM app_settings WHERE key = 'itemTypes' LIMIT 1`)).rows[0] as { value?: unknown } | undefined)?.value;
  const types = parseItemTypes(raw);
  const anySet = Object.keys(types.categories).length + Object.keys(types.products).length > 0;
  const r = await exec.execute(sql`
    SELECT p.id, p.name, p.quantity, p.active, coalesce(c.name, '') AS cat, c.id AS cat_id FROM products p LEFT JOIN categories c ON c.id = p.category_id
    ${anySet ? sql`` : sql`WHERE c.name ~* 'laser'`}`);
  const items = new Map<number, { quantity: number; pools: LaserPool[]; active: boolean }>();
  for (const x of r.rows as { id: number; name: string; quantity: number; active: boolean; cat: string; cat_id: number | null }[]) {
    let pools: LaserPool[];
    if (!anySet) pools = laserPoolsFor(x.name, x.cat);
    else {
      const kind = x.cat_id === null ? "other" : categoryKind({ id: Number(x.cat_id), name: x.cat }, types);
      pools = kind === "laser_tag" || kind === "laser_addons" ? [...LASER_ROLE_POOLS[laserRole({ id: Number(x.id), name: x.name }, kind, types)]] : [];
    }
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
      if (u) n += u.event + (u.between ?? 0); // the pickup day frees the pool too (Nov 24, 2026)
    }
    return n;
  };
  for (const [id, it] of info.items) {
    const byDay = new Map<string, Usage>();
    for (const day of days) {
      const left = Math.min(...it.pools.map((pool) => info.sizes[pool] - usedIn(pool, day)));
      const used = Math.max(0, it.quantity - Math.max(0, left));
      byDay.set(day, { event: used, pickup: original.get(id)?.get(day)?.pickup ?? 0, between: 0, held: original.get(id)?.get(day)?.held ?? 0 });
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
        const m = merged.get(day) ?? { event: 0, pickup: 0, between: 0, held: 0 };
        merged.set(day, { event: m.event + u.event, pickup: m.pickup + u.pickup, between: (m.between ?? 0) + (u.between ?? 0), held: m.held + u.held });
      }
    usage.set(productId, merged);
  }
  return bookableQty(quantity, usage, productId, eventDate, pickup);
}
