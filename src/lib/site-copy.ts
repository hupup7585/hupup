/** Abram's exact website copy. Do not paraphrase. */
export const SLOGAN = "BRINGING SOMETHING SPECIAL TO EVERY OCCASION";
export const INTRO =
  "Make your next event unforgettable with our exciting rentals! Affordable and suitable for any party, gathering, celebration & occasion, or just because.";
export const WHY = [
  "Exciting rental attractions",
  "Options for all types of events",
  "Convenient phone reservations",
  "Friendly customer service",
  "Delivery option available",
  "Simple booking process",
];
export const STEPS = [
  ["STEP 1", "EXPLORE", "Browse our rental categories."],
  ["STEP 2", "CALL", "Call us to discuss rental options, availability, and pricing."],
  ["STEP 3", "CONFIRM", "Complete your reservation over the phone with our team."],
] as const;
/** Delivery always costs extra. Never state an amount (not supplied yet) or suggest it costs nothing. */
export const DELIVERY_FEE_NOTE = "Delivery available. Call for pricing.";
/** Website Hours (Abraham's exact lines). No holidays on the website: holiday rules live in the phone system and admin. */
export const WEBSITE_HOURS = [
  "Sunday: 11:30 AM - 7:00 PM",
  "Monday - Thursday: 10:30 AM - 7:00 PM",
  "Friday: 10:30 AM - Chatzose",
  "Shabbos: Closed",
  "Motzei Shabbos: 2 hours after Shabbos - 11:30 PM (winter), 12:30 AM (summer)",
] as const;
export const WEBSITE_HOURS_NOTE = "Book by phone anytime, 24/7.";

/** How It Works, under the three steps (Abraham's approved wording, exact). */
export const HOW_IT_WORKS_DELIVERY =
  "We deliver and set up your bounce house, laser tag, and paddle boat rentals right to your door in Kiryas Joel and nearby Orange County towns, so just give us a call for friendly help and a quick delivery price.";
/** Kiryas Joel box only (Abram 10:46 PM). */
export const SERVICE_AREA_DELIVERY_NOTE = "Delivery available for an additional fee.";
export const DELIVERY_FEE_SHORT = "Delivery fee applies, call for pricing.";

export const FINAL_CTA_TITLE = "READY TO MAKE YOUR EVENT SPECIAL?";
export const FINAL_CTA_TEXT = "Contact Hup Up Attractions today to explore our rental options and reserve your attraction.";

/** Service area from Abram (exact wording). Main area first; the rest are secondary. */
export const SERVICE_AREA = {
  mainLabel: "Main service area:",
  main: "Kiryas Joel",
  /** Town of Palm Tree is the same place as Kiryas Joel (the town's official name), not a second area. */
  mainSub: "Town of Palm Tree, Orange County, NY",
  officialName: "Town of Palm Tree",
  alsoTitle: "We also deliver to these nearby towns:",
  also: ["Monroe", "Blooming Grove", "Woodbury and Highland Mills", "Chester", "Harriman", "Washingtonville"],
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

/**
 * Exact line breaks Abram chose for specific Why Choose labels (used whenever the label
 * needs two lines; on wide screens it still fits on one). Each part is kept unbreakable.
 */
export const WHY_LINE_BREAKS: Record<string, [string, string]> = {
  "Options for all types of events": ["Options for", "all types of events"], // Abram 10:51 PM
};

/** Labels Abram wants on exactly these two rows at every width (Abram Nov 4, 2:08 PM). */
export const WHY_FORCED_LINES: Record<string, [string, string]> = {
  "Delivery option available": ["Delivery", "option available"],
};

/** The two fixed rows for a label, or null when it wraps naturally. */
export function whyRows(text: string): [string, string] | null {
  const rows = WHY_FORCED_LINES[text];
  return rows ? [rows[0], rows[1].replace(/ /g, "\u00A0")] : null;
}

export function whyLabel(text: string): string {
  const parts = WHY_LINE_BREAKS[text];
  if (!parts) return noLonelyWord(text);
  return parts.map((p) => p.replace(/ /g, " ")).join(" ");
}
