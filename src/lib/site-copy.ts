/** Abram's exact website copy. Do not paraphrase. */
export const SLOGAN = "BRINGING SOMETHING SPECIAL TO EVERY OCCASION";
export const INTRO =
  "Make your next event unforgettable with exciting attractions and rentals from Hup Up Attractions. We bring something special to parties, schools, celebrations, and special occasions.";
export const WHY = [
  "Exciting rental attractions",
  "Options for all types of events",
  "Convenient phone reservations",
  "Friendly customer service",
  "Delivery available in our service areas",
  "Simple booking process",
];
export const STEPS = [
  ["STEP 1", "EXPLORE", "Browse our rental categories."],
  ["STEP 2", "CALL", "Call us to discuss rental options, availability, and pricing."],
  ["STEP 3", "CONFIRM", "Complete your reservation over the phone with our team."],
] as const;
/** Delivery always costs extra. Never state an amount (not supplied yet) or suggest it costs nothing. */
export const DELIVERY_FEE_NOTE = "Delivery available. Call for pricing.";
/** Kiryas Joel box only (Abram 10:46 PM). */
export const SERVICE_AREA_DELIVERY_NOTE = "Delivery available for an additional fee.";
export const DELIVERY_FEE_SHORT = "Delivery fee applies, call for pricing.";

export const FINAL_CTA_TITLE = "READY TO MAKE YOUR EVENT SPECIAL?";
export const FINAL_CTA_TEXT = "Contact Hup Up Attractions today to explore our rental options and reserve your attraction.";

/** Service area from Abram (exact wording). Main area first; the rest are secondary. */
export const SERVICE_AREA = {
  mainLabel: "Our main service area:",
  main: "Kiryas Joel",
  /** Town of Palm Tree is the same place as Kiryas Joel (the town's official name), not a second area. */
  mainSub: "Town of Palm Tree, Orange County, NY",
  officialName: "Town of Palm Tree",
  alsoTitle: "We also deliver to these nearby towns:",
  also: ["Monroe", "Blooming Grove", "Woodbury and Highland Mills", "Chester", "Harriman", "Middletown", "Washingtonville"],
  region: "Orange County, NY",
} as const;

/** Individual place names for search engines (combined names split, nothing added). */
export function serviceAreaPlaces(): string[] {
  return [SERVICE_AREA.main, ...SERVICE_AREA.also.flatMap((n) => n.split(" and ").map((s) => s.trim()))];
}

/** Keep the business name on one line wherever text wraps ("Why Choose / Hup Up Attractions"). */
export const BUSINESS_NAME_NB = "Hup Up Attractions";
export function keepName(text: string): string {
  return text.replaceAll("Hup Up Attractions", BUSINESS_NAME_NB);
}

/** Keep the last two words of a label together so a wrapped label never ends with one lonely word. */
export function noLonelyWord(text: string): string {
  const i = text.lastIndexOf(" ");
  return i > 0 ? `${text.slice(0, i)} ${text.slice(i + 1)}` : text;
}
