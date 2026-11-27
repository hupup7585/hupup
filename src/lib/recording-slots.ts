import { PIECE_ALIAS, PROMPTS, SHARED_PIECES, promptRecordable, type PromptDef, type PromptKey } from "@/lib/ivr/prompts";
import { LETTERS, TOWN_PHRASES, WORDS, numberWords, pluralName, townSlotKey } from "@/lib/spoken-words";
import { STREETS, UNIT_CODES, ZIP_CODES, streetSlotKey, unitSlotKey } from "@/lib/streets";
import { TYPE_CLIPS, typeSlotKey, type RentalKind } from "@/lib/box56";
import { balloonEntry } from "@/lib/ivr/balloon-menu";
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
/** Keypad symbols and "basement" (Nov 22, 2026): one recording each. */
export const KEYPAD_WORDS: readonly [string, string][] = [["dot", "Keypad - dot"], ["dash", "Keypad - dash"], ["underscore", "Keypad - underscore"], ["basement", "Word - basement"]];

export const NOT_RECORDED: readonly string[] = ["product_intro", "product_options", "product_default_desc", "phonepay_choice", "phonepay_not_found", "catalog_offer", "box153", "book_note", "book_corporate", "booked_closest", "booked_bigger", "booked_smaller", "booked_keep", "bounce_water_note", "item_added", "keep_shopping", "another_day"];

/**
 * Hark's 33 number clips (Nov 19, 2026): live numbers, item digits and prices, each its own row, in his order.
 * zero to twenty, thirty to ninety, Hundred, Thousand, Dollars, And, Cents.
 */
export const NUMBER_CLIPS: readonly string[] = [
  ...["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty"],
  ...["thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"],
  "Hundred", "Thousand", "Dollars", "And", "Cents",
  // Abraham, Nov 22, 2026: exactly one says "1 dollar" and "1 cent"
  "Dollar", "Cent",
];

/** The fixed pieces of a line with changing parts: the words between the {blanks}. */
export function pieces(text: string): string[] {
  return text
    .split(/\{[a-z0-9_]+\}/i)
    .map((p) => p.trim().replace(/^[,;:]\s*/, "")) // a comma after a blank is a pause, not a word to record (Batch 2, Nov 25, 2026)
    .filter((p) => /[a-z]/i.test(p));
}

/** texts: the Admin text of each line where it was edited (the list always shows the text that plays). */
export function allSlots(items: { id: number; name: string }[] = [], texts: Record<string, string | null | undefined> = {}, custom: Slot[] = []): Slot[] {
  const out: Slot[] = [];
  for (const [k, d] of Object.entries(PROMPTS) as [PromptKey, PromptDef][]) {
    if ((d as { textOnly?: boolean }).textOnly || (d as PromptDef).parts || NOT_RECORDED.includes(k)) continue;
    const text = texts[k]?.trim() || d.text;
    if (promptRecordable(k)) out.push({ key: k, kind: "line", group: d.group, label: d.label, text });
    else pieces(text).forEach((p, i) => {
      if (!PIECE_ALIAS[`${k}#${i + 1}`]) out.push({ key: `${k}#${i + 1}`, kind: "piece", group: d.group, label: `${d.label}, piece ${i + 1}`, text: p });
    });
  }
  // Shared pieces (Nov 22, 2026): one recording each, used inside several lines
  for (const x of SHARED_PIECES) out.push({ key: x.key, kind: "piece", group: x.group, label: x.label, text: x.text });
  const clips = new Set(NUMBER_CLIPS.map((w) => w.toLowerCase()));
  for (const w of NUMBER_CLIPS) out.push({ key: `word:${w.toLowerCase()}`, kind: "word", group: "Number clips (live numbers, item digits, prices)", label: w, text: w });
  for (const w of WORDS) if (!clips.has(w.toLowerCase())) out.push({ key: `word:${w.toLowerCase()}`, kind: "word", group: "Dates and times", label: w, text: w });
  for (const l of LETTERS) out.push({ key: `letter:${l.toLowerCase()}`, kind: "letter", group: "Letters A to Z", label: `Letter ${l}`, text: l });
  // Read-back pieces (Abraham, Nov 22, 2026, 11:12 PM): 21 to 99 as one recording each, "unit", the 10950 zip, streets
  for (let n = 21; n <= 99; n++) if (n % 10) out.push({ key: `word:${numberWords(n).join(" ")}`, kind: "word", group: "Number words 21 to 99", label: numberWords(n).join(" "), text: numberWords(n).join(" ") });
  out.push({ key: "word:unit", kind: "word", group: "Address words", label: "Word - unit", text: "unit" });
  for (const z of ZIP_CODES) {
    const spoken = z.split("").map((d) => numberWords(Number(d))[0]).join(" ");
    out.push({ key: `zip:${z}`, kind: "word", group: "Address words", label: `Zip - ${spoken}`, text: spoken });
  }
  // Box 56 rental types (Abraham, Nov 24, 2026): eight clips, each with "for the"
  for (const [kind, t] of Object.entries(TYPE_CLIPS)) {
    out.push({ key: typeSlotKey(kind as RentalKind, false), kind: "word", group: "Box 56 rental types", label: `Box 56 type (one): ${t.one}`, text: t.one });
    out.push({ key: typeSlotKey(kind as RentalKind, true), kind: "word", group: "Box 56 rental types", label: `Box 56 type (two or more): ${t.more}`, text: t.more });
  }
  for (const st of STREETS) out.push({ key: streetSlotKey(st.spoken), kind: "word", group: "Streets", label: `Street - ${st.spoken}`, text: st.spoken });
  for (const u of UNIT_CODES) {
    const spoken = u.split("").map((c) => (/\d/.test(c) ? numberWords(Number(c))[0] : c)).join(" ");
    out.push({ key: unitSlotKey(u), kind: "word", group: "Unit numbers", label: `Unit - ${spoken}`, text: spoken });
  }
  // Town phrases (Abraham, Nov 22, 2026): one recording each
  for (const t of TOWN_PHRASES) out.push({ key: townSlotKey(t), kind: "word", group: "Town", label: `Town - ${t}`, text: t });
  // Keypad echo and the unit read-back (Abraham, Nov 22, 2026)
  for (const [w, label] of KEYPAD_WORDS) out.push({ key: `word:${w}`, kind: "word", group: "Letters A to Z", label, text: `${w}.` });
  // Each rental name twice (Abraham, Nov 19, 2026): for 1, and for 2 or more
  // The jumping balloon names are recorded with hyphens (Abraham's rule, Nov 27, 2026: "Soft-Hop"); only the slot text
  // here changes so it matches the recording; the rental's name on the website and in Admin stays as it is
  const said = (name: string) => (balloonEntry(name) ? name.trim().replace(/\s+/g, "-") : name);
  for (const it of items) {
    out.push({ key: `item:${it.id}`, kind: "item", group: "Rental names", label: `${it.name} (one)`, text: said(it.name) });
    out.push({ key: `item:${it.id}:plural`, kind: "item", group: "Rental names", label: `${it.name} (two or more)`, text: said(pluralName(it.name)) });
  }
  // Added in Admin (Nov 23, 2026)
  for (const c of custom) if (!out.some((o) => o.key === c.key)) out.push(c);
  return out;
}

