import { kinds } from "@/lib/jewish-calendar";
import { addDays } from "@/lib/dates";

/**
 * Chanukah and Chol Hamoed rentals (Abraham, Nov 18, 2026, approved; the same rules for both):
 *  - one price per booking day, picked up the next morning;
 *  - a Friday rental is one full day, picked up 1 hour after Shabbes ends (not held until Sunday), so the same item
 *    can go to a Mutze Shabbes customer;
 *  - no promos, discounts or offers those weeks;
 *  - Mutze Shabbes bookings (delivery 2 and a half hours after Shabbes, pickup Sunday 9:00 AM; Friday + Mutze Shabbes
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

export const pickupAfterShabbesMin = (s: HolidaySettings) => Math.max(0, Math.round(Number(s.holidayPickupAfterShabbesMin ?? 60)) || 60);
