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

/** The fixed pieces of a line with changing parts: the words between the {blanks}. */
export function pieces(text: string): string[] {
  return text
    .split(/\{[a-z0-9_]+\}/i)
    .map((p) => p.trim())
    .filter((p) => /[a-z]/i.test(p));
}

export function allSlots(items: { id: number; name: string }[] = []): Slot[] {
  const out: Slot[] = [];
  for (const [k, d] of Object.entries(PROMPTS) as [PromptKey, PromptDef][]) {
    if ((d as { textOnly?: boolean }).textOnly) continue;
    if (promptRecordable(k)) out.push({ key: k, kind: "line", group: d.group, label: d.label, text: d.text });
    else pieces(d.text).forEach((p, i) => out.push({ key: `${k}#${i + 1}`, kind: "piece", group: d.group, label: `${d.label}, piece ${i + 1}`, text: p }));
  }
  for (const w of WORDS) out.push({ key: `word:${w.toLowerCase()}`, kind: "word", group: "Numbers, dates and times", label: w, text: w });
  for (const l of LETTERS) out.push({ key: `letter:${l.toLowerCase()}`, kind: "letter", group: "Letters A to Z", label: `Letter ${l}`, text: l });
  for (const it of items) out.push({ key: `item:${it.id}`, kind: "item", group: "Rental names", label: it.name, text: it.name });
  return out;
}

