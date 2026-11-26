import { kinds } from "@/lib/jewish-calendar";
import { addDays } from "@/lib/dates";

/**
 * Chanukah and Chol Hamoed rentals (Abraham, Nov 18, 2026, approved; the same rules for both):
 *  - one price per booking day, picked up the next morning;
 *  - a Friday rental is one full day, picked up 1 hour after Shabbes ends (not held until Sunday), so the same item
 *    can go to a Mutze Shabbes customer;
 *  - no promos, discounts or offers those weeks;
 *  - Mutze Shabbes bookings (delivery about two hours after Shabbes, pickup Sunday 9:00 AM; Friday + Mutze Shabbes
 *    = 1 and a half days) come once Abraham approves their phone lines.
 * Every number and switch is an Admin setting.
 */
export type HolidaySettings = {
  holidayPerDayChanukah?: boolean | string;
  holidayPerDayCholHamoed?: boolean | string;
  holidayNoPromos?: boolean | string;
  holidayPickupAfterShabbesMin?: string | number;
  holidayMutzeDeliveryAfterMin?: string | number;
  holidaySundayPickup?: string;
  holidayFridayMutzeDays?: string | number;
  holidayMutzeAloneDays?: string | number;
};
const on = (v: unknown, d = true) => (v === undefined || v === null || v === "" ? d : v === true || v === "true");

/** "chanukah" / "cholHamoed" when the day is in one of those weeks, else null. */
export function holidayWeek(iso: string): "chanukah" | "cholHamoed" | null {
  const k = kinds(iso).kinds;
  if (k.has("chanukah")) return "chanukah";
  if (k.has("cholHamoed")) return "cholHamoed";
  return null;
}

/** Per-day pricing is on for this day's holiday week. */
export function perDayRules(iso: string, s: HolidaySettings): boolean {
  const w = holidayWeek(iso);
  return w === "chanukah" ? on(s.holidayPerDayChanukah) : w === "cholHamoed" ? on(s.holidayPerDayCholHamoed) : false;
}

/** No promos, discounts or offers for a booking on this day. */
export function noPromosOn(iso: string, s: HolidaySettings): boolean {
  return Boolean(holidayWeek(iso)) && on(s.holidayNoPromos);
}

const weekday = (iso: string) => new Date(`${iso}T12:00:00Z`).getUTCDay();

/**
 * A Friday rental during Chanukah or Chol Hamoed is picked up Saturday night (1 hour after Shabbes ends), when the
 * Saturday is a plain Shabbes (not also Yom Tov). Returns that Saturday, or null (the usual rule applies).
 */
export function holidayFridayPickup(eventDate: string, s: HolidaySettings): string | null {
  if (weekday(eventDate) !== 5 || !perDayRules(eventDate, s)) return null;
  const sat = addDays(eventDate, 1);
  return kinds(sat).kinds.has("yomtov") ? null : sat;
}

/** Minutes after Shabbes for the pickup: 0 to 300, exactly what the Offers page allows (Hark's review H4: 0 used to become 60). */
export const pickupAfterShabbesMin = (s: HolidaySettings) => {
  const n = Math.round(Number(s.holidayPickupAfterShabbesMin ?? 60));
  return Number.isFinite(n) && n >= 0 && n <= 300 ? n : 60;
};

/** Friday plus Mutze Shabbes is offered on this date (box 150): a Friday in a Chanukah or Chol Hamoed week with
 *  per-day pricing on, before a plain Shabbes. */
export function friMutzeOffered(iso: string, s: HolidaySettings): boolean {
  return Boolean(holidayFridayPickup(iso, s));
}

/** Friday plus Mutze Shabbes: picked up Sunday (9:00 AM). */
export const friMutzePickup = (friday: string) => addDays(friday, 2);

/** Days charged for Friday plus Mutze Shabbes (Admin setting, 1 and a half to start). */
export function friMutzeDays(s: HolidaySettings): number {
  const x = Number(s.holidayFridayMutzeDays);
  return x >= 1 && x <= 3 ? x : 1.5;
}

/** A booking that is Friday plus Mutze Shabbes: delivered on a holiday Friday and picked up that Sunday. */
export function isFriMutze(o: { eventDate: string; pickupDate: string }, s: HolidaySettings): boolean {
  return friMutzeOffered(o.eventDate, s) && o.pickupDate === friMutzePickup(o.eventDate);
}

/**
 * A closed day (Abraham, Nov 20, 2026): "You can get it the day before ... and keep it until {the day after}, at
 * 9:00 AM". Offered only when the day before and the day after are both open (and the day before is not past).
 * Price: 1.5 times the rental; Chanukah and Chol Hamoed: 2 full day prices; a Friday with Mutze Shabbes: the Friday
 * plus Mutze Shabbes days (box 149's rule; that booking is priced by it, so days = null here).
 */
export function closedDayOffer(
  closed: string,
  today: string,
  s: HolidaySettings & Record<string, unknown>,
  isClosed: (iso: string) => boolean,
): { before: string; after: string; days: number; spanDays: number | null } | null {
  const before = addDays(closed, -1);
  const after = addDays(closed, 1);
  if (before < today || isClosed(before) || isClosed(after)) return null;
  if (friMutzeOffered(before, s) && after === friMutzePickup(before)) return { before, after, days: friMutzeDays(s), spanDays: null };
  const days = perDayRules(before, s) || perDayRules(after, s) ? 2 : 1.5;
  return { before, after, days, spanDays: days };
}
