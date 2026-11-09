import { config } from "@/lib/config";
/**
 * SMS Terms Version 2 (Abraham Q, Nov 8, 2026). Built on previews only; it goes live only after Abraham approves the
 * exact text. Flip SMS_TERMS_V2_LIVE to true then. The two promotional confirmation texts are Abraham's exact words (U);
 * the rest is proposed wording until that approval.
 *
 * What changes in v2:
 *  - /sms-terms gets nine added sections; /privacy gets the v2 privacy sentence.
 *  - Promotional consent is written only: the separate unchecked website box, or a YES reply to a confirmation text.
 *    A phone keypress (or a staff-recorded yes) only sends that confirmation text; nothing is enrolled until YES.
 *  - A reply of WRONG NUMBER removes the number (same as STOP).
 */
import * as v1 from "@/lib/sms-consent-copy";

/** SMS v3 approved by Abraham (Nov 9, 2026: "Version 3 is the final version, ready to use") */
export const SMS_TERMS_V2_LIVE = true;

/** On for Vercel previews (and when SMS_TERMS_V2=1, used by tests); on the live site only once SMS_TERMS_V2_LIVE. */
export function smsTermsV2Active(env: Record<string, string | undefined> = process.env): boolean {
  return SMS_TERMS_V2_LIVE || env.VERCEL_ENV === "preview" || env.SMS_TERMS_V2 === "1";
}

export const WEB_CONSENT_VERSION_V2 = "web-2026-11-09-v3";

/** SMS v3 website promotional box: it requests the confirmation text; only the YES reply signs the customer up. */
export const WEB_CONSENT_MARKETING_V2 =
  "Text me a confirmation to join Hup Up Attractions promotional texts: seasonal offers, discount codes, and rental deals, up to 5 per calendar year. I am signed up only when I reply YES to that confirmation text within 24 hours. Agreeing is never required to book or buy. Message and data rates may apply. Reply NOPROMO to stop promos, STOP to stop all texts, or HELP for help.";

export const WEB_CONSENT_TRANSACTIONAL_V2 =
  "I agree to receive transactional text messages from Hup Up Attractions, including picture messages such as delivery confirmation photos, regarding my reservations, orders, payments, deliveries, pickups, and customer service, and authorize Hup Up Attractions to share my phone number with service providers only as necessary to deliver these messages. Message frequency varies. Message and data rates may apply. Reply STOP to opt out or HELP for help.";

/** Confirmation text sent after a phone keypress or a staff-recorded yes. Only a YES reply enrolls the number. */
/** SMS v3 confirmation text (Abraham, word for word; only the Terms link is filled in, from the live site address). */
export function promoConfirmRequestSms(base = config.baseUrl()): string {
  return `Hup Up Attractions: You requested to join our seasonal promotional text program. You may receive up to 5 promotional messages per calendar year, including seasonal offers, discount codes, and rental deals. Message and data rates may apply. Reply YES within 24 hours to confirm. Reply STOP to unsubscribe. Reply HELP for assistance. Terms: ${base}/sms-terms`;
}
/** @deprecated kept for older records: the text current at build time. */
export const PROMO_CONFIRM_REQUEST_SMS = promoConfirmRequestSms();
/** SMS v3: sent after the YES (Abraham, exact). */
export const PROMO_ENROLLED_SMS =
  "Hup Up Attractions: You're signed up for seasonal promo texts, up to 5 per year. Msg & data rates may apply. Reply NOPROMO to stop promos, STOP to stop all texts, HELP for help.";
export const PROMO_CONFIRM_VERSION = "promo-confirm-2026-11-09-v3";
/** How long the YES reply counts. */
export const PROMO_CONFIRM_WINDOW_HOURS = 24;

export const STAFF_DISCLOSURE_MARKETING_V2 =
  "Would you like promotional text messages from Hup Up Attractions at {phone}: seasonal offers, discount codes, and rental deals, up to 5 per calendar year? If you say yes, we'll text you a confirmation, and you'll be signed up only after you reply YES to that text within 24 hours. Agreeing is never required to book or buy. Message and data rates may apply. You can reply NOPROMO to stop promos, STOP to stop all texts, or HELP for help, at any time. Do you want the confirmation text? Please answer yes or no.";

/** v2 privacy sentence (Abraham's exact words, section 6). */
export const PRIVACY_V2 =
  "Mobile phone numbers and SMS opt-in consent information will never be sold, rented, or shared with third parties or affiliates for their own marketing or promotional purposes. Service providers, such as Twilio, may process the information only to operate the messaging service.";

/** Section 8: message examples (Abraham's list, exact). */
export const MESSAGE_EXAMPLES = [
  "Your order is confirmed.",
  "Your delivery is on the way.",
  "Here is your delivery confirmation photo.",
  "Your pickup is scheduled.",
  "A seasonal offer is available.",
] as const;

/** Section 1: what order and service texts cover. */
export const SERVICE_TEXT_TYPES = [
  "Reservation confirmations and reminders",
  "Order changes, such as cancellations, rescheduling, and quantity changes",
  "Payment links, receipts, and payment confirmations",
  "Delivery updates, such as estimated arrival times and delays",
  "Delivery completion notices",
  "Pickup reminders and pickup confirmations",
  "Replies to your questions",
  "Verification codes, where applicable",
] as const;

/** The website checkbox wording in force (v2 on previews until approved). */
export function webConsentCopy(env: Record<string, string | undefined> = process.env) {
  return smsTermsV2Active(env)
    ? { marketing: WEB_CONSENT_MARKETING_V2, transactional: WEB_CONSENT_TRANSACTIONAL_V2, version: WEB_CONSENT_VERSION_V2 }
    : { marketing: v1.WEB_CONSENT_MARKETING, transactional: v1.WEB_CONSENT_TRANSACTIONAL, version: v1.WEB_CONSENT_VERSION };
}

/** Staff read-aloud disclosures in force (v2 changes the promotional one only). */
export function staffDisclosure(env: Record<string, string | undefined> = process.env) {
  return smsTermsV2Active(env) ? { ...v1.STAFF_DISCLOSURE, marketing: STAFF_DISCLOSURE_MARKETING_V2 } : v1.STAFF_DISCLOSURE;
}

/** SMS v3: on the live site, sign-up buttons show this until Twilio approves texting (A2P). */
export function smsSignupNotActive(env: Record<string, string | undefined> = process.env): string | null {
  if (!smsTermsV2Active(env) || env.VERCEL_ENV !== "production" || env.TWILIO_MESSAGING_SERVICE_SID) return null;
  return "Not active yet: waiting for Twilio A2P approval";
}
