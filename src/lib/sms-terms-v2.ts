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

export const SMS_TERMS_V2_LIVE = false;

/** On for Vercel previews (and when SMS_TERMS_V2=1, used by tests); on the live site only once SMS_TERMS_V2_LIVE. */
export function smsTermsV2Active(env: Record<string, string | undefined> = process.env): boolean {
  return SMS_TERMS_V2_LIVE || env.VERCEL_ENV === "preview" || env.SMS_TERMS_V2 === "1";
}

export const WEB_CONSENT_VERSION_V2 = "web-2026-11-08-v2";

export const WEB_CONSENT_MARKETING_V2 =
  "I agree to receive promotional text messages from Hup Up Attractions, such as discounts, special offers, and catalog updates, and authorize Hup Up Attractions to share my phone number with service providers only as necessary to deliver these messages. Checking this box is my express written consent. Consent is not a condition of purchase. Message and data rates may apply. Message frequency varies. Reply STOP to opt out or HELP for help.";

export const WEB_CONSENT_TRANSACTIONAL_V2 =
  "I agree to receive transactional text messages from Hup Up Attractions, including picture messages such as delivery confirmation photos, regarding my reservations, orders, payments, deliveries, pickups, and customer service, and authorize Hup Up Attractions to share my phone number with service providers only as necessary to deliver these messages. Message frequency varies. Message and data rates may apply. Reply STOP to opt out or HELP for help.";

/** Confirmation text sent after a phone keypress or a staff-recorded yes. Only a YES reply enrolls the number. */
/**
 * Abraham's approved promotional confirmation text (Nov 9, 2026): up to 6 a year, confirm with JOIN. The Terms link
 * follows the live site address, so it becomes https://hupupattractions.com/sms-terms by itself once that domain is live.
 */
export function promoConfirmRequestSms(base = config.baseUrl()): string {
  return `Hup Up Attractions: You requested to join our seasonal promotional text program. You may receive up to 6 promotional messages per year, including seasonal offers, discount codes, and rental deals. Message and data rates may apply. Reply JOIN to confirm. Reply STOP to unsubscribe. Reply HELP for assistance. Terms: ${base}/sms-terms`;
}
/** @deprecated kept for older records: the text current at build time. */
export const PROMO_CONFIRM_REQUEST_SMS = promoConfirmRequestSms();
/** Sent after that YES (Abraham U, exact). */
export const PROMO_ENROLLED_SMS =
  "Hup Up Attractions: You're signed up for promotional texts. Msg frequency varies. Msg & data rates may apply. Reply HELP for help, STOP to opt out.";
export const PROMO_CONFIRM_VERSION = "promo-confirm-2026-11-09-join-6";
/** How long the YES reply counts. */
export const PROMO_CONFIRM_WINDOW_HOURS = 24;

export const STAFF_DISCLOSURE_MARKETING_V2 =
  "Would you like to receive promotional text messages from Hup Up Attractions at {phone}, such as discounts, special offers, and catalog updates? If you say yes, we'll text you a confirmation, and you'll be signed up only after you reply YES to that text. If you agree, you also authorize Hup Up Attractions to share your phone number with service providers only as necessary to deliver these messages. Consent is not a condition of purchase. Message and data rates may apply. Message frequency varies. You can reply STOP to opt out, or HELP for help, at any time. Do you want the confirmation text? Please answer yes or no.";

/** v2 privacy sentence (Abraham's exact words, section 6). */
export const PRIVACY_V2 =
  "Mobile phone numbers and SMS opt-in consent information will never be sold, rented, or shared with third parties or affiliates for their own marketing or promotional purposes. Service providers, such as Twilio, may process the information only to operate the messaging service.";

/** Section 8: message examples (Abraham's list, exact). */
export const MESSAGE_EXAMPLES = [
  "Your order is confirmed.",
  "Your payment has been received.",
  "Your delivery is on the way.",
  "Your rental has been delivered.",
  "Here is your delivery confirmation photo.",
  "Your pickup is scheduled.",
  "Your reservation has been updated.",
  "A special offer is available.",
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
