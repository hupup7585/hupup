/** Abram's exact website copy. Do not paraphrase. */
export const SLOGAN = "BRINGING SOMETHING SPECIAL TO EVERY OCCASION";
export const INTRO =
  "Make your next event unforgettable with exciting attractions and rentals from Hup Up Attractions. We bring something special to parties, schools, celebrations, and special occasions.";
export const WHY = [
  "Exciting rental attractions",
  "Options for all types of events",
  "Convenient phone reservations",
  "Friendly customer service",
  "Delivery arrangements for an additional fee",
  "Simple booking process",
];
export const STEPS = [
  ["STEP 1", "EXPLORE", "Browse our rental categories."],
  ["STEP 2", "CALL", "Call us to discuss rental options, availability, and pricing."],
  ["STEP 3", "CONFIRM", "Complete your reservation over the phone with our team."],
] as const;
/** Delivery always costs extra. Never state an amount (not supplied yet) or suggest it costs nothing. */
export const DELIVERY_FEE_NOTE = "Delivery available for an additional fee. Call for pricing.";
export const DELIVERY_FEE_SHORT = "Delivery fee applies, call for pricing.";

export const FINAL_CTA_TITLE = "READY TO MAKE YOUR EVENT SPECIAL?";
export const FINAL_CTA_TEXT = "Contact Hup Up Attractions today to explore our rental options and reserve your attraction.";

/** Service area from Abram (exact wording). Main area first; the rest are secondary. */
export const SERVICE_AREA = {
  mainLabel: "Our main service area:",
  main: "Kiryas Joel / Town of Palm Tree",
  alsoTitle: "We also deliver to these nearby towns:",
  also: ["Monroe", "Blooming Grove", "Woodbury / Highland Mills", "Chester", "Harriman", "Middletown", "Washingtonville"],
  region: "Orange County, NY",
} as const;

/** Individual place names for search engines (combined names split, nothing added). */
export function serviceAreaPlaces(): string[] {
  return [SERVICE_AREA.main, ...SERVICE_AREA.also].flatMap((n) => n.split("/").map((s) => s.trim()));
}
