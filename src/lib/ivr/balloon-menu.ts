/**
 * Box 153, the jumping balloons menu (Abraham, Nov 19, 2026, approved word for word). Each key is one balloon, found in
 * Admin by its name; the item number is read digit by digit ("seven two zero one"). No second page, no "more" key.
 * Keys 10, 11 and 12: after 1 the line waits 2 seconds for a second digit (pound skips the wait; never announced).
 */
export const BALLOON_MENU = [
  { key: "1", name: "Soft Hop", number: "7201" },
  { key: "2", name: "Sunlight Spot", number: "7202" },
  { key: "3", name: "Blue Bounce", number: "7203" },
  { key: "4", name: "Ball Buster", number: "7204" },
  { key: "5", name: "Rising Joy", number: "7205" },
  { key: "6", name: "Family Fun", number: "7206" },
  { key: "7", name: "Adventure Zone", number: "7207" },
  { key: "8", name: "Wide Slide", number: "7208" },
  { key: "9", name: "Amusing Obstacle", number: "7209" },
  { key: "10", name: "Mega Mountain", number: "7210" },
  { key: "11", name: "Wheel Thrill", number: "7211" }, // Abraham, Nov 22, 2026: Wheel Thrill is item 11
  { key: "12", name: "Bounce Blast", number: "7212" },
] as const;

/** Seconds the line waits for a second digit after 1. */
export const BALLOON_SECOND_DIGIT_SECONDS = 2;

const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
/** "7201" -> "seven two zero one" */
export const digitWords = (n: string) => n.replace(/\D/g, "").split("").map((d) => WORDS[Number(d)]).join(" ");

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** The menu entry for a balloon (by its Admin name), if it is on box 153. */
export const balloonEntry = (name: string) => BALLOON_MENU.find((b) => norm(b.name) === norm(name)) ?? null;

/** The product for a key, among the category's products (matched by name). */
export function balloonForKey<T extends { name: string }>(key: string, products: T[]): T | null {
  const entry = BALLOON_MENU.find((b) => b.key === key);
  return entry ? (products.find((p) => norm(p.name) === norm(entry.name)) ?? null) : null;
}

/**
 * Box 155 sizes from the item's Admin "Dimensions" field: the first three numbers are length, width and height in feet
 * ("15 by 20 by 12 feet", "15' x 20' x 12'"). Null when the field does not have all three.
 */
export function balloonSizes(dimensions: string): { length: string; width: string; height: string } | null {
  const n = (dimensions ?? "").match(/\d+(?:\.\d+)?/g);
  return n && n.length >= 3 ? { length: n[0], width: n[1], height: n[2] } : null;
}

/**
 * How the key is said after "press," (live). Keys 10 to 12 for now as "one zero", "one one", "one two", the way box 153
 * read them; Abraham will say how they are spoken (Nov 19, 2026).
 */
export const balloonKeyWords = (key: string) => (key.length > 1 ? digitWords(key) : key);
