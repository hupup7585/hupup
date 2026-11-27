import { formatPhone } from "@/lib/phone";

/**
 * Staff promo sign-up (Abraham, Nov 10, 2026): three short lines staff read aloud, then "Send confirmation".
 * Replaces the long read-aloud promo disclosure. The confirmation text itself stays word for word as approved, and
 * only a YES reply from that number within 24 hours signs it up.
 *
 * "owner_preview": the box is marked Preview while Abraham reviews it. The Owner and the Secretary both see it
 *                  (Abraham, Nov 13, 2026: the Secretary handles promos). "live": the Preview mark goes away.
 */
export type StaffPromoMode = "owner_preview" | "live";
export const STAFF_PROMO_MODE: StaffPromoMode = "owner_preview";

export function staffPromoVisible(role: string, mode: StaffPromoMode = STAFF_PROMO_MODE): boolean {
  if (role === "delivery") return false;
  void mode;
  return role === "owner" || role === "secretary";
}

export const STAFF_PROMO_STEP1 = "Would you like to get seasonal offers, discounts, and deals from Hup Up Attractions by text, up to 5 a year? It's never required to book.";
export const STAFF_PROMO_STEP2 = "Should we text {phone}, or a different number?";
export const STAFF_PROMO_STEP3 = "Great, we just sent you a text. Reply YES within 24 hours to finish signing up. Message and data rates may apply.";

export const staffPromoStep2 = (phone: string) => STAFF_PROMO_STEP2.replace("{phone}", formatPhone(phone));
