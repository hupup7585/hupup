/**
 * SMS consent and SMS-terms wording from Abram's "SMS Terms - Additional Requirements" (2026-11-05).
 * One place for the website checkboxes, the required promotional opening, and the provider-sharing clause.
 * The spoken (phone) versions live in the prompts catalog (src/lib/ivr/prompts.ts) and say the same things.
 */

/** Version id of the website checkbox wording. Bump when the text changes. */
export const WEB_CONSENT_VERSION = "web-2026-11-05";

/** Every promotional text begins with exactly this, before the offer (Requirement 2). */
export const PROMO_OPENING = "Hup Up Attractions: Reply STOP to opt out.";

/** Website checkbox: promotional (Abram's suggested consent wording, Requirement 3, verbatim). Unchecked by default. */
export const WEB_CONSENT_MARKETING =
  "I agree to receive promotional text messages from Hup Up Attractions and authorize Hup Up Attractions to share my phone number with service providers only as necessary to deliver these messages. Consent is not a condition of purchase. Message and data rates may apply. Message frequency varies. Reply STOP to opt out or HELP for help.";

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
