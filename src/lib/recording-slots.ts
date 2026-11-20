import { PROMPTS, promptRecordable, type PromptDef, type PromptKey } from "@/lib/ivr/prompts";
import { LETTERS, WORDS } from "@/lib/spoken-words";
export { LETTERS, WORDS, numberWords, ordinalWords, wordSlotsFor } from "@/lib/spoken-words";

/**
 * Every recording slot on the hotline (Abraham, Nov 15, 2026). Hark records each one in Achird only after Abraham
 * confirms its exact text; Claude never records or uploads audio.
 *  - line:   a whole fixed line (plays as soon as its recording is uploaded and approved)
 *  - piece:  the fixed words of a line that has changing parts ("Your total is" ... "for delivery,")
 *  - word:   numbers, money words, ordinals, days, months, time words
 *  - letter: A to Z
 *  - item:   a rental's spoken name (from the catalog)
 * Lines with changing parts are put together from pieces and words only when the Owner turns on "Achird for the
 * whole line"; until then they stay in the live voice (Puck).
 */
export type SlotKind = "line" | "piece" | "word" | "letter" | "item";
export type Slot = { key: string; kind: SlotKind; group: string; label: string; text: string };

/** Lines no step leads to any more (Abraham, Nov 16, 2026): dropped from the recording list. */
export const NOT_RECORDED: readonly string[] = ["product_intro", "product_options", "product_default_desc", "phonepay_choice", "phonepay_not_found", "catalog_offer", "box153", "book_note", "book_corporate", "booked_closest", "booked_bigger", "booked_smaller", "booked_keep", "bounce_water_note", "item_added", "keep_shopping", "another_day"];

/**
 * Hark's 33 number clips (Nov 19, 2026): live numbers, item digits and prices, each its own row, in his order.
 * zero to twenty, thirty to ninety, Hundred, Thousand, Dollars, And, Cents.
 */
export const NUMBER_CLIPS: readonly string[] = [
  ...["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty"],
  ...["thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"],
  "Hundred", "Thousand", "Dollars", "And", "Cents",
];

/** The fixed pieces of a line with changing parts: the words between the {blanks}. */
export function pieces(text: string): string[] {
  return text
    .split(/\{[a-z0-9_]+\}/i)
    .map((p) => p.trim())
    .filter((p) => /[a-z]/i.test(p));
}

/** texts: the Admin text of each line where it was edited (the list always shows the text that plays). */
export function allSlots(items: { id: number; name: string }[] = [], texts: Record<string, string | null | undefined> = {}): Slot[] {
  const out: Slot[] = [];
  for (const [k, d] of Object.entries(PROMPTS) as [PromptKey, PromptDef][]) {
    if ((d as { textOnly?: boolean }).textOnly || NOT_RECORDED.includes(k)) continue;
    const text = texts[k]?.trim() || d.text;
    if (promptRecordable(k)) out.push({ key: k, kind: "line", group: d.group, label: d.label, text });
    else pieces(text).forEach((p, i) => out.push({ key: `${k}#${i + 1}`, kind: "piece", group: d.group, label: `${d.label}, piece ${i + 1}`, text: p }));
  }
  const clips = new Set(NUMBER_CLIPS.map((w) => w.toLowerCase()));
  for (const w of NUMBER_CLIPS) out.push({ key: `word:${w.toLowerCase()}`, kind: "word", group: "Number clips (live numbers, item digits, prices)", label: w, text: w });
  for (const w of WORDS) if (!clips.has(w.toLowerCase())) out.push({ key: `word:${w.toLowerCase()}`, kind: "word", group: "Dates and times", label: w, text: w });
  for (const l of LETTERS) out.push({ key: `letter:${l.toLowerCase()}`, kind: "letter", group: "Letters A to Z", label: `Letter ${l}`, text: l });
  for (const it of items) out.push({ key: `item:${it.id}`, kind: "item", group: "Rental names", label: it.name, text: it.name });
  return out;
}

