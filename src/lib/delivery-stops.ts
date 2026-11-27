import { addDays, todayISO } from "@/lib/dates";

/** Is this order one of the current delivery or pickup stops (today, or yesterday's late stop)? */
export function isCurrentStop(o: { status: string; eventDate: string | null; pickupDate: string | null }, now = new Date()): boolean {
  const days = [todayISO(now), addDays(todayISO(now), -1)];
  return ["CONFIRMED", "DELIVERED", "PICKED_UP"].includes(o.status) && (days.includes(o.eventDate ?? "") || days.includes(o.pickupDate ?? ""));
}

/** Is this stop's own day today, or yesterday (a late stop)? Delivery: the event day; pickup: the pickup day. */
export function isStopDay(o: { eventDate: string | null; pickupDate: string | null }, stop: "delivery" | "pickup", now = new Date()): boolean {
  const day = stop === "delivery" ? o.eventDate : o.pickupDate;
  return Boolean(day) && [todayISO(now), addDays(todayISO(now), -1)].includes(day as string);
}
