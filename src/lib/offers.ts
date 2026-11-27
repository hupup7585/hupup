import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { addDays } from "@/lib/dates";

/**
 * Offers (Abraham, Nov 17, 2026). Each is an Owner on/off switch, off until he turns it on; they never combine (the
 * one that saves the customer the most applies). They cover jumping balloons, laser tag and paddle boats.
 *
 *  (Laser tag's every third set half price is its own switch, in the item prices: laserAddonPrices in orders.ts.)
 *  - Thursday to Sunday: one booking, delivered Thursday and picked up Monday, priced at 1.5 times the rental.
 *  - 4th Sunday free: 3 Sundays in a row booked, the 4th Sunday's rental is free (the cheapest item when the Sundays
 *    had different items). A Thursday to Sunday booking does not count as one of the Sundays. Delivery still has a
 *    minimum: $20 in Kiryas Joel, $30 in the nearby towns, $40 anywhere else in Orange County.
 */
export type OfferSettings = { offerThuSunOn?: boolean | string; offerFourthSundayOn?: boolean | string; offersStacking?: string };
const on = (v: unknown) => v === true || v === "true";

/** The three switches, read inside the same database transaction as the booking (all off when never set). */
export async function offerSwitches(exec: Exec): Promise<OfferSettings> {
  const r = await exec.execute(sql`SELECT key, value FROM app_settings WHERE key IN ('offerThuSunOn', 'offerFourthSundayOn', 'holidayNoPromos', 'holidayPerDayChanukah', 'holidayPerDayCholHamoed', 'holidayFridayMutzeDays', 'offersStacking')`);
  const out: Record<string, unknown> = {};
  for (const x of r.rows as { key: string; value: unknown }[]) out[x.key] = x.value;
  return out as OfferSettings;
}

/** Delivery on a free 4th Sunday (Abraham, Nov 17, 2026). */
export const OFFER_NOTES = { thuSun: "Thursday to Sunday: 1.5 times the rental", fourthSunday: "4th Sunday free", friMutze: "Friday and Mutze Shabbes: one and a half days" } as const;

/** Is the free 4th Sunday part of this offer note (alone, or added to a customer discount: "... + 4th Sunday free")? */
export const hasFourthSunday = (note: string | null | undefined) => Boolean(note && note.split(" + ").includes(OFFER_NOTES.fourthSunday));

const RENTAL = /balloon|bounce|jump|inflatable|laser|paddle|boat/i;
const ADDONS = /^laser tag add-ons$/i;

type Exec = { execute: typeof db.execute };
type Line = { id: number; productId: number; qty: number; unitPriceCents: number; category: string; name?: string };
async function lines(exec: Exec, orderId: number): Promise<Line[]> {
  const r = await exec.execute(sql`
    SELECT oi.id, oi.product_id, oi.qty, oi.unit_price_cents, COALESCE(c.name, '') AS category, p.name
    FROM order_items oi JOIN products p ON p.id = oi.product_id LEFT JOIN categories c ON c.id = p.category_id
    WHERE oi.order_id = ${orderId} ORDER BY oi.id`);
  return (r.rows as { id: number; product_id: number; qty: number; unit_price_cents: number; category: string; name: string }[]).map((x) => ({ id: Number(x.id), productId: Number(x.product_id), qty: Number(x.qty), unitPriceCents: Number(x.unit_price_cents), category: String(x.category), name: String(x.name ?? "") }));
}

/** Rental items the offers cover (not ocean balls or other extras; the laser tag add-on packs count as laser tag). */
const isRental = (l: Line) => (RENTAL.test(l.category) || ADDONS.test(l.category)) && !/ocean/i.test(l.category);

const weekday = (iso: string) => new Date(`${iso}T12:00:00Z`).getUTCDay(); // 0 Sunday ... 4 Thursday

export const isThuSun = (o: { eventDate: string; pickupDate: string }) => weekday(o.eventDate) === 4 && o.pickupDate === addDays(o.eventDate, 4);

/** Thursday to Sunday: 1.5 times the rental, so the extra is half the rental items (a negative discount). */
export function thuSunAdjustment(ls: Line[]): number {
  const rentals = ls.filter(isRental).reduce((t, l) => t + l.qty * l.unitPriceCents, 0);
  return -Math.round(rentals / 2);
}

/**
 * 4th Sunday free: this booking is on a Sunday, and the same customer has bookings (not cancelled, not Thursday to
 * Sunday) on each of the 3 Sundays right before it. The free amount is the cheapest rental item across the 4 Sundays,
 * never more than this booking's rentals. Returns 0 when it doesn't apply.
 */
export async function fourthSundayDiscount(exec: Exec, o: { id: number; customerId: number | null; eventDate: string }, ls: Line[]): Promise<number> {
  if (!o.customerId || weekday(o.eventDate) !== 0) return 0;
  const prior = [21, 14, 7].map((n) => addDays(o.eventDate, -n));
  const r = await exec.execute(sql`
    SELECT o.id, o.event_date::text AS event_date, o.pickup_date::text AS pickup_date
    FROM orders o
    WHERE o.customer_id = ${o.customerId} AND o.id <> ${o.id} AND o.status NOT IN ('CANCELLED', 'HOLD')
      AND o.event_date IN (${sql.join(prior.map((d) => sql`${d}::date`), sql`, `)})`);
  const rows = r.rows as { id: number; event_date: string; pickup_date: string }[];
  const byDay = new Map<string, number>();
  for (const x of rows) if (!isThuSun({ eventDate: x.event_date, pickupDate: x.pickup_date })) byDay.set(x.event_date, Number(x.id));
  if (!prior.every((d) => byDay.has(d))) return 0;
  let cheapest = Infinity;
  for (const id of byDay.values()) for (const l of (await lines(exec, id)).filter(isRental)) cheapest = Math.min(cheapest, l.unitPriceCents);
  const mine = ls.filter(isRental);
  for (const l of mine) cheapest = Math.min(cheapest, l.unitPriceCents);
  const myRentals = mine.reduce((t, l) => t + l.qty * l.unitPriceCents, 0);
  return Number.isFinite(cheapest) ? Math.min(cheapest, myRentals) : 0;
}

/** The one offer for this booking (the biggest saving), or none. Positive = money off; negative = Thursday to Sunday extra. */
export async function bestOffer(exec: Exec, orderId: number, s: OfferSettings): Promise<{ discountCents: number; note: string | null }> {
  const r = await exec.execute(sql`SELECT id, customer_id, event_date::text AS event_date, pickup_date::text AS pickup_date, span_days FROM orders WHERE id = ${orderId}`);
  const o = r.rows[0] as { id: number; customer_id: number | null; event_date: string; pickup_date: string; span_days: number | null } | undefined;
  if (!o) return { discountCents: 0, note: null };
  const { discountForOrder } = await import("@/lib/customer-discounts");
  const { todayISO } = await import("@/lib/dates");
  return bestOfferFor(
    exec,
    { id: Number(o.id), customerId: o.customer_id ? Number(o.customer_id) : null, eventDate: o.event_date, pickupDate: o.pickup_date, spanDays: Number(o.span_days ?? 0) },
    await lines(exec, orderId),
    s,
    () => discountForOrder(exec as never, Number(o.id), todayISO()),
  );
}

export type OfferLine = Line;
/**
 * The one offer for these lines (Nov 24, 2026: shared by a saved order and the booking screen's live total, so both
 * match to the cent). Positive = money off; negative = an extra (Thursday to Sunday, a longer rental).
 */
export async function bestOfferFor(
  exec: Exec,
  o: { id: number; customerId: number | null; eventDate: string; pickupDate: string; spanDays: number },
  ls: Line[],
  s: OfferSettings,
  customerDiscount: () => Promise<import("@/lib/customer-discounts").DiscountRow | null>,
): Promise<{ discountCents: number; note: string | null }> {
  // Chanukah and Chol Hamoed (Abraham, Nov 18, 2026): no promos, discounts or offers those weeks
  const { noPromosOn, isFriMutze, friMutzeDays } = await import("@/lib/holiday-rentals");
  // Friday plus Mutze Shabbes (box 149, Abraham, Nov 18, 2026): one and a half days, its own price, never an offer
  if (isFriMutze({ eventDate: o.eventDate, pickupDate: o.pickupDate }, s as never)) {
    const rentals = ls.filter(isRental).reduce((t, l) => t + l.qty * l.unitPriceCents, 0);
    return { discountCents: -Math.round(rentals * (friMutzeDays(s as never) - 1)), note: OFFER_NOTES.friMutze };
  }
  // A closed day booked from the day before to the day after (Abraham, Nov 20, 2026): its own price, never an offer
  const span = o.spanDays;
  if (span > 1) {
    const rentals = ls.filter(isRental).reduce((t, l) => t + l.qty * l.unitPriceCents, 0);
    return { discountCents: -Math.round(rentals * (span - 1)), note: `Closed day: ${span === 1.5 ? "one and a half" : span} days` };
  }
  if (noPromosOn(o.eventDate, s as never)) return { discountCents: 0, note: null };
  // Thursday to Sunday is its own price (1.5 times), never combined with the others (a customer discount included)
  if (on(s.offerThuSunOn) && isThuSun({ eventDate: o.eventDate, pickupDate: o.pickupDate })) return { discountCents: thuSunAdjustment(ls), note: OFFER_NOTES.thuSun };
  const options: { discountCents: number; note: string }[] = [];
  // Laser tag's third set at half price never stacks with a customer discount or the 4th Sunday (Abraham, Nov 26,
  // 2026): those are worked out on the full catalog prices, and only a bigger saving than the half price replaces it
  const half = await laserHalfSaving(exec, ls);
  const full = half.cents > 0 ? ls.map((l) => ({ ...l, unitPriceCents: half.full.get(l.id) ?? l.unitPriceCents })) : ls;
  // A customer discount (Abraham, Nov 18, 2026) is one more choice: never combined, the bigger saving applies
  const { discountCents, discountNote } = await import("@/lib/customer-discounts");
  const cd = await customerDiscount();
  if (cd) options.push({ discountCents: discountCents(cd, full.reduce((t, l) => t + l.qty * l.unitPriceCents, 0)), note: discountNote(cd) });
  if (on(s.offerFourthSundayOn)) options.push({ discountCents: await fourthSundayDiscount(exec, { id: o.id, customerId: o.customerId, eventDate: o.eventDate }, full), note: OFFER_NOTES.fourthSunday });
  // How offers combine (Admin handoff, Abraham, Nov 26, 2026): "best" (the default, as always) = only the biggest
  // saving; "add" = the customer discount and the 4th Sunday both apply, on top of the laser half price, never more
  // than the rentals cost
  if (s.offersStacking === "add" && options.length) {
    const rentals = ls.filter(isRental).reduce((t, l) => t + l.qty * l.unitPriceCents, 0);
    const sum = options.reduce((t, x) => t + Math.max(0, x.discountCents), 0);
    const kept = options.filter((x) => x.discountCents > 0);
    return kept.length ? { discountCents: Math.min(sum, rentals), note: kept.map((x) => x.note).join(" + ") } : { discountCents: 0, note: null };
  }
  const best = options.filter((x) => x.discountCents > half.cents).sort((a, b) => b.discountCents - a.discountCents)[0];
  // The lines keep their half price, so the offer takes off only what it saves beyond it (the same total either way)
  return best ? { discountCents: best.discountCents - half.cents, note: best.note } : { discountCents: 0, note: null };
}

/** What the laser third-set half price takes off these lines, and each laser line's price without it. */
async function laserHalfSaving(exec: Exec, ls: Line[]): Promise<{ cents: number; full: Map<number, number> }> {
  const laser = ls.filter((l) => /laser/i.test(l.category));
  if (!laser.length) return { cents: 0, full: new Map() };
  const r = await exec.execute(sql`SELECT id, name, price_cents FROM products WHERE id IN (${sql.join(laser.map((l) => sql`${l.productId}`), sql`, `)})`);
  const cat = new Map((r.rows as { id: number; name: string; price_cents: number }[]).map((x) => [Number(x.id), { name: String(x.name), price: Number(x.price_cents) }]));
  const { laserAddonPrices } = await import("@/lib/orders");
  const full = await laserAddonPrices(exec, laser.map((l) => ({ key: l.id, name: cat.get(l.productId)?.name ?? l.name ?? "", cat: l.category, priceCents: cat.get(l.productId)?.price ?? l.unitPriceCents })), false);
  let cents = 0;
  for (const l of laser) {
    const f = full.get(l.id);
    if (f !== undefined && f > l.unitPriceCents) cents += (f - l.unitPriceCents) * l.qty;
  }
  return { cents, full };
}
