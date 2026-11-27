import { dayInfo, kinds, type CalendarSettings } from "@/lib/jewish-calendar";
import { zmanim } from "@/lib/hup-calendar/zmanim";
import { addDays } from "@/lib/dates";

/**
 * Mutze Shabbes bookings by staff, every week (Abraham, Nov 26, 2026, 8:34 PM): New booking in Admin may book a
 * Saturday night (Motzei Shabbos) every week of the year, not only during Chanukah and Chol Hamoed. The phone system
 * and the website do not use this: callers get Mutze Shabbes only as before.
 *  - Delivery: the Admin minutes (150 = two and a half hours) after Shabbes ends in Monroe (nightfall, tzeis 8.5 degrees).
 *  - Pickup: Sunday at the Sunday pickup time (9:00 AM).
 *  - Price: one day (the Mutze Shabbes alone days setting, 1 to start).
 *  - Stock: the booking is Saturday (delivery) to Sunday (pickup). A Chanukah or Chol Hamoed Friday rental picked up
 *    Saturday night leaves the unit free for it; a usual Friday rental (kept to Sunday) does not.
 * Never during Shabbes or Yom Tov itself: only after Shabbes ends, and only when Sunday is an open day for the pickup.
 */
export type StaffMutzeSettings = CalendarSettings & { staffMutzeEveryWeek?: boolean | string; staffMutzeDeliveryAfterMin?: string | number; holidaySundayPickup?: string; holidayMutzeAloneDays?: string | number };

const on = (v: unknown) => v === true || v === "true";
/** When Shabbes ends on this Saturday in Monroe: nightfall (tzeis, 8.5 degrees), from the Admin location. */
export function shabbesEndsAt(saturday: string, s: CalendarSettings): Date {
  const place = { latitude: Number(s.calendarLatitude) || 41.3407, longitude: Number(s.calendarLongitude) || -74.1679 };
  return zmanim(saturday, place).tzeis(8.5);
}
const fmt = (d: Date) => d.toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
const hhmm = (t: string | undefined) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(t ?? "09:00").trim());
  const h = m ? Number(m[1]) : 9;
  const min = m ? m[2] : "00";
  return `${h % 12 || 12}:${min} ${h < 12 ? "AM" : "PM"}`;
};

export type StaffMutze = { ok: true; saturday: string; pickupDate: string; deliveryAt: Date; deliveryLabel: string; pickupLabel: string; days: number } | { ok: false; reason: string };

/** Can staff book this Saturday as Mutze Shabbes? With the delivery and pickup times. */
export function staffMutze(iso: string, s: StaffMutzeSettings): StaffMutze {
  if (!on(s.staffMutzeEveryWeek)) return { ok: false, reason: "Mutze Shabbes bookings by staff are turned off on All settings." };
  if (new Date(`${iso}T12:00:00Z`).getUTCDay() !== 6 || !kinds(iso).kinds.has("shabbos")) return { ok: false, reason: "Mutze Shabbes is a Saturday night." };
  const sunday = addDays(iso, 1);
  if (dayInfo(sunday, s).closed) return { ok: false, reason: "Sunday is closed, so there is no pickup that day." };
  const mins = Math.round(Number(s.staffMutzeDeliveryAfterMin ?? 150));
  const after = Number.isFinite(mins) && mins >= 0 && mins <= 360 ? mins : 150;
  const deliveryAt = new Date(shabbesEndsAt(iso, s).getTime() + after * 60_000);
  const days = Number(s.holidayMutzeAloneDays);
  return {
    ok: true,
    saturday: iso,
    pickupDate: sunday,
    deliveryAt,
    deliveryLabel: `Mutze Shabbes, delivery from ${fmt(deliveryAt)}`,
    pickupLabel: `Sunday ${hhmm(s.holidaySundayPickup)}`,
    days: Number.isFinite(days) && days > 0 ? days : 1,
  };
}
