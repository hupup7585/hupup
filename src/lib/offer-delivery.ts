import { zoneFee, type ZonePrices } from "@/lib/delivery-areas";
import { hasFourthSunday } from "@/lib/offers";

/**
 * The 4th Sunday's delivery (Abraham, Nov 27, 2026, 1:36 AM): exactly twice the zone's regular delivery price from
 * Admin Delivery settings (Kiryas Joel $10 -> $20, nearby towns $15 -> $30, the rest of Orange County $20 -> $40), so
 * it follows any price change. The regular price, not the free-delivery promo price.
 */
export function fourthSundayDeliveryCents(kind: "local" | "area" | "outside", s: ZonePrices): number {
  return 2 * zoneFee(kind, { ...s, deliveryPromoOn: false } as ZonePrices);
}

/**
 * The delivery fee for one booking day: the zone price (with the free delivery promo by delivery date), except a free
 * 4th Sunday, which pays twice the zone's regular price.
 */
export function deliveryFeeFor(kind: "local" | "area" | "outside", s: ZonePrices, eventDate: string, offerNote?: string | null): number {
  if (hasFourthSunday(offerNote)) return fourthSundayDeliveryCents(kind, s);
  return zoneFee(kind, s, eventDate);
}
