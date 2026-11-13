/**
 * SMS consent and SMS-terms wording from Abram's "SMS Terms - Additional Requirements" (2026-11-05).
 * One place for the website checkboxes, the required promotional opening, and the provider-sharing clause.
 * The spoken (phone) versions live in the prompts catalog (src/lib/ivr/prompts.ts) and say the same things.
 */

/** Version id of the website checkbox wording. Bump when the text changes. */
export const WEB_CONSENT_VERSION = "web-2026-11-05";

/** Every promotional text begins with exactly this, before the offer (Requirement 2). */
export const PROMO_OPENING = "Hup Up Attractions: Reply STOP to opt out.";

/** Abraham (SMS v3, Nov 9, 2026): strict maximum of promotional texts per customer per calendar year, all campaigns combined. */
export const PROMOS_PER_YEAR = 6; // Abraham, Nov 13, 2026: "Promo list is 6." Six promo texts per calendar year, everywhere

/**
 * SMS Terms v2 promo format (Abraham, Nov 9, 2026): starts with the business name, ends with the NO PROMO and STOP
 * line. Used on preview until the SMS Terms v2 lines are approved; the live site keeps PROMO_OPENING until then.
 */
export const PROMO_PREFIX_V2 = "Hup Up Attractions:";
export const PROMO_ENDING_V2 = "Reply NOPROMO to stop promos, STOP to stop all texts.";

/** Website checkbox: promotional (Abram's suggested consent wording, Requirement 3, verbatim). Unchecked by default. */
export const WEB_CONSENT_MARKETING =
  "I agree to receive promotional text messages from Hup Up Attractions and authorize Hup Up Attractions to share my phone number with service providers only as necessary to deliver these messages. Consent is not a condition of purchase. Message and data rates may apply. Message frequency varies. Reply STOP to opt out or HELP for help.";

/**
 * What the promotional list offers (Abraham's list, shown above the promotional checkbox on /text-alerts).
 * "And much more" is limited by the note: it adds content, never extra texts beyond the stated frequency.
 */
export const PROMO_BENEFITS = ["New item notices", "Promos and special offers", "Our catalog before each season"] as const;
/** Top of the promotional box (Abraham approved): title, then the heading directly under it. */
export const PROMO_TITLE = "And much more";
export const PROMO_HEADING = "STAY INFORMED";
export const PROMO_BENEFITS_NOTE = "All in our occasional promotional texts. Message frequency varies.";

/** Website checkbox: transactional (Abram's earlier wording plus the same provider-sharing clause). Unchecked by default. */
export const WEB_CONSENT_TRANSACTIONAL =
  "I agree to receive transactional text messages from Hup Up Attractions regarding my reservations, orders, payments, deliveries, pickups, and customer service, and authorize Hup Up Attractions to share my phone number with service providers only as necessary to deliver these messages. Message frequency varies. Message and data rates may apply. Reply STOP to opt out or HELP for help.";

/** Service provider disclosure (Requirement 3), used on the SMS Terms and Privacy pages. */
export const PROVIDER_DISCLOSURE =
  "Customer phone numbers and messaging consent information may be processed by service providers, such as messaging and technology providers, solely as necessary to deliver and operate the requested messaging program. Customer information will not be shared with third parties for their own marketing purposes.";

/** Opt-out keywords recognized everywhere (Requirement 5). */
export const OPT_OUT_KEYWORDS = ["STOP", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "OPT OUT", "REVOKE"] as const;

/** Minimum retention for consent, opt-out and message records (Requirement 4). */
export const RECORD_RETENTION_MONTHS = 24;

/** Version id of the staff read-aloud disclosures. Bump when the text changes. */
export const STAFF_CONSENT_VERSION = "staff-2026-11-05";

/**
 * Read aloud by staff, in full, before recording consent (phone or in person). {phone} is the customer's number.
 * The exact text read (with the number filled in) is stored on the consent record.
 */
export const STAFF_DISCLOSURE = {
  transactional:
    "May Hup Up Attractions text you at {phone} about your reservations, orders, payments, deliveries, pickups, and customer service? If you agree, you also authorize Hup Up Attractions to share your phone number with service providers only as necessary to deliver these messages. Message frequency varies. Message and data rates may apply. You can reply STOP to opt out, or HELP for help, at any time. Do you agree? Please answer yes or no.",
  marketing:
    "Would you like to receive promotional text messages from Hup Up Attractions at {phone}? If you agree, you also authorize Hup Up Attractions to share your phone number with service providers only as necessary to deliver these messages. Consent is not a condition of purchase. Message and data rates may apply. Message frequency varies. You can reply STOP to opt out, or HELP for help, at any time. Do you agree? Please answer yes or no.",
} as const;

/** Sent when an opted-out customer replies START (approved wording). */
export const START_CONFIRMATION_SMS =
  "Hup Up Attractions: To receive order and service texts again (reservations, orders, payments, deliveries, pickups), reply YES. Msg frequency varies. Msg & data rates may apply. Reply HELP for help. Promotional texts require a separate sign-up.";

/** Version id of the START confirmation wording stored with a YES re-enrollment. */
export const START_CONFIRMATION_VERSION = "start-confirm-2026-11-05";

/** A START confirmation is valid for this long; after that a new START is needed. */
export const REENROLL_WINDOW_HOURS = 24;
