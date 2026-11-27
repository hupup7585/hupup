import { addDays, todayISO } from "@/lib/dates";

/** Is this order one of the current delivery or pickup stops (today, or yesterday's late stop)? */
export function isCurrentStop(o: { status: string; eventDate: string | null; pickupDate: string | null }, now = new Date()): boolean {
  const days = [todayISO(now), addDays(todayISO(now), -1)];
  return ["CONFIRMED", "DELIVERED", "PICKED_UP"].includes(o.status) && (days.includes(o.eventDate ?? "") || days.includes(o.pickupDate ?? ""));
}

/**
 * Extra check H3 (Nov 27, 2026): is this one stop (the delivery on the event day, the pickup on the pickup day) a current
 * stop, today or yesterday's late one? A Delivery login can only mark done, change the stage or add a photo for these.
 */
export function isCurrentStopFor(o: { eventDate: string | null; pickupDate: string | null }, stop: "delivery" | "pickup", now = new Date()): boolean {
  const day = stop === "delivery" ? o.eventDate : (o.pickupDate ?? o.eventDate);
  return Boolean(day) && [todayISO(now), addDays(todayISO(now), -1)].includes(day!);
}
export const NOT_CURRENT_STOP = "You can only update today's stops (or yesterday's late stop).";

/**
 * Extra check H1 (Nov 27, 2026): drivers see no prices. Order notes also hold system lines about money ("Second payment
 * of $... refund it", "Paid $X of $Y", payment link choices); for a Delivery login every sentence about money or
 * payment is left out, and the delivery directions stay.
 */
export function driverNotes(notes: string | null | undefined): string {
  if (!notes) return "";
  return notes
    .split(/(?<=[.!?])\s+/)
    .filter((s) => s.trim() && !/\$\s?\d|\b(paid|payment|payments|pay link|payment link|refund|refunded|sola|stripe|card|price|priced|total|balance|tip|tax)\b/i.test(s))
    .join(" ")
    .trim();
}
