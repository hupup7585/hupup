import { zoneFee, type ZonePrices } from "@/lib/delivery-areas";
import { FOURTH_SUNDAY_DELIVERY_CENTS, OFFER_NOTES } from "@/lib/offers";

/**
 * The delivery fee for one booking day: the zone price (with the free delivery promo by delivery date), except a free
 * 4th Sunday, which pays the 4th Sunday delivery: $20 Kiryas Joel, $30 nearby towns, $40 anywhere else (Nov 17, 2026).
 */
export function deliveryFeeFor(kind: "local" | "area" | "outside", s: ZonePrices, eventDate: string, offerNote?: string | null): number {
  if (offerNote === OFFER_NOTES.fourthSunday) return FOURTH_SUNDAY_DELIVERY_CENTS[kind];
  return zoneFee(kind, s, eventDate);
}
