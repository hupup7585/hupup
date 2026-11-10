import { formatPhone } from "@/lib/phone";

/**
 * Staff promo sign-up (Abraham, Nov 10, 2026): three short lines staff read aloud, then "Send confirmation".
 * Replaces the long read-aloud promo disclosure. The confirmation text itself stays word for word as approved, and
 * only a YES reply from that number within 24 hours signs it up.
 *
 * "owner_preview": only the Owner sees the new box (marked Preview) so Abraham can review it; Secretaries see no
 *                  promo sign-up at all. "live": Owner and Secretary use it. Abraham switches this after approving.
 */
export type StaffPromoMode = "owner_preview" | "live";
export const STAFF_PROMO_MODE: StaffPromoMode = "owner_preview";

export function staffPromoVisible(role: string, mode: StaffPromoMode = STAFF_PROMO_MODE): boolean {
  if (role === "delivery") return false;
  return mode === "live" ? role === "owner" || role === "secretary" : role === "owner";
}

export const STAFF_PROMO_STEP1 = "Would you like to get seasonal offers, discounts, and deals from Hup Up Attractions by text, up to 6 a year? It's never required to book.";
export const STAFF_PROMO_STEP2 = "Should we text {phone}, or a different number?";
export const STAFF_PROMO_STEP3 = "Great, we just sent you a text. Reply YES within 24 hours to finish signing up. Message and data rates may apply.";

export const staffPromoStep2 = (phone: string) => STAFF_PROMO_STEP2.replace("{phone}", formatPhone(phone));
