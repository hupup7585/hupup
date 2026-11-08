import { addDays, todayISO } from "@/lib/dates";

/** Is this order one of the current delivery or pickup stops (today, or yesterday's late stop)? */
export function isCurrentStop(o: { status: string; eventDate: string | null; pickupDate: string | null }, now = new Date()): boolean {
  const days = [todayISO(now), addDays(todayISO(now), -1)];
  return ["CONFIRMED", "DELIVERED", "PICKED_UP"].includes(o.status) && (days.includes(o.eventDate ?? "") || days.includes(o.pickupDate ?? ""));
}
