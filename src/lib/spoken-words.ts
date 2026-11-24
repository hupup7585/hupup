import { ZIP_CODES } from "@/lib/streets";
/** The words the hotline can say from recordings (Abraham, Nov 15, 2026). No other imports, so prompts.ts can use it. */
const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const ORD_ONES = ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth", "eleventh", "twelfth", "thirteenth", "fourteenth", "fifteenth", "sixteenth", "seventeenth", "eighteenth", "nineteenth"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Shabbes"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** Compound ordinals, each its own recording (Abraham, Nov 22, 2026): "twenty-first", not "twenty" + "first". */
const COMPOUND_ORDINALS = ["twenty-first", "twenty-second", "twenty-third", "twenty-fourth", "twenty-fifth", "twenty-sixth", "twenty-seventh", "twenty-eighth", "twenty-ninth", "thirty-first"];
const OTHER_WORDS = ["hundred", "thousand", "dollar", "dollars", "cent", "cents", "and", "AM", "PM", "oh", "at", "on", "twentieth", "thirtieth"];

export const WORDS: string[] = [...ONES, ...TENS.filter(Boolean), ...ORD_ONES.filter(Boolean), ...COMPOUND_ORDINALS, ...DAYS, "Saturday", ...MONTHS, ...OTHER_WORDS];
export const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

/* ---- Turning a changing part into word slots ---- */

export function numberWords(n: number): string[] {
  if (!Number.isInteger(n) || n < 0) return [];
  if (n < 20) return [ONES[n]];
  if (n < 100) return [TENS[Math.floor(n / 10)], ...(n % 10 ? [ONES[n % 10]] : [])];
  if (n < 1000) return [ONES[Math.floor(n / 100)], "hundred", ...(n % 100 ? numberWords(n % 100) : [])];
  if (n < 1_000_000) return [...numberWords(Math.floor(n / 1000)), "thousand", ...(n % 1000 ? numberWords(n % 1000) : [])];
  return [];
}
export function ordinalWords(n: number): string[] {
  if (n < 20) return [ORD_ONES[n]];
  if (n % 10 === 0) return [n === 20 ? "twentieth" : n === 30 ? "thirtieth" : ""].filter(Boolean);
  return [`${TENS[Math.floor(n / 10)]}-${ORD_ONES[n % 10]}`]; // one recording each (Nov 22, 2026)
}

/**
 * The word slots for a changing part as it is spoken today ("245 dollars and 50 cents", "Tuesday, March 5th",
 * "1 4 3 8", "3:40 PM"). Null = some word has no slot (the line then stays in the live voice).
 */
/** 279 -> word:two, word:hundred, word:seventy nine (21 to 99 not a multiple of ten: one recording). */
export function numberSlotKeys(n: number): string[] {
  const out: string[] = [];
  const two = (x: number) => {
    if (!x) return;
    if (x > 20 && x < 100 && x % 10) out.push(`word:${numberWords(x).join(" ")}`);
    else out.push(...numberWords(x).map((w) => `word:${w.toLowerCase()}`));
  };
  if (n === 0) return ["word:zero"];
  if (n >= 1000) {
    out.push(...numberSlotKeys(Math.floor(n / 1000)), "word:thousand");
    n %= 1000;
  }
  if (n >= 100) {
    out.push(`word:${numberWords(Math.floor(n / 100))[0]}`, "word:hundred");
    n %= 100;
  }
  two(n);
  return out;
}

export function wordSlotsFor(value: string, items: { id: number; name: string }[] = []): string[] | null {
  const town = townSlot(value);
  if (town) return [town];
  // Keypad echo (Nov 22, 2026): dot, dash, underscore and basement have their own recordings
  if (/^(dot|dash|underscore|basement)$/i.test(value.trim())) return [`word:${value.trim().toLowerCase()}`];
  const item = items.find((i) => i.name.trim().toLowerCase() === value.trim().toLowerCase());
  if (item) return [`item:${item.id}`];
  // "2 paddle boats": the number, then the plural name recording (Nov 19, 2026)
  const plural = items.find((i) => pluralName(i.name).toLowerCase() === value.trim().toLowerCase() && pluralName(i.name) !== i.name);
  if (plural) return [`item:${plural.id}:plural`];
  const keys: string[] = [];
  // a colon that ends a word ("Sunday to Thursday: 10:00 AM") is not part of it; a time keeps its colon
  for (const raw of value.replace(/[,.!?]/g, " ").replace(/:(?=\s|$)/g, " ").split(/\s+/).filter(Boolean)) {
    const time = /^(\d{1,2}):(\d{2})$/.exec(raw);
    const ord = /^(\d{1,2})(st|nd|rd|th)$/i.exec(raw);
    let words: string[] | null = null;
    if (time) {
      // 3:45 PM: three, forty five (one recording), PM; 3:05: three, oh, five (Abraham, Nov 24, 2026)
      keys.push(...numberSlotKeys(Number(time[1])));
      const m = Number(time[2]);
      if (m && m < 10) keys.push("word:oh", ...numberSlotKeys(m));
      else if (m) keys.push(...numberSlotKeys(m));
      continue;
    } else if (ord) words = ordinalWords(Number(ord[1]));
    else if (/^\d{5}$/.test(raw)) {
      // A zip code (Nov 23, 2026): the six zips are one recording each, any other zip digit by digit
      if (ZIP_CODES.includes(raw)) keys.push(`zip:${raw}`);
      else for (const d of raw) keys.push(`word:${numberWords(Number(d))[0]}`);
      continue;
    } else if (/^\d+$/.test(raw)) {
      // A whole number (Nov 23, 2026): 21 to 99 one recording each ("eighty eight"), the rest from the number clips
      keys.push(...numberSlotKeys(Number(raw)));
      continue;
    }
    else if (/^[A-Za-z]$/.test(raw)) {
      // A spelled letter in any case ("y o s s i" in an email read-back): its letter recording (Nov 24, 2026)
      keys.push(`letter:${raw.toLowerCase()}`);
      continue;
    } else if (/^(dot|dash|underscore|basement)$/i.test(raw)) {
      keys.push(`word:${raw.toLowerCase()}`);
      continue;
    } else words = [raw];
    for (const w of words) {
      // A word with no recording slot is said live on its own; the words around it still play (Nov 24, 2026)
      keys.push(WORDS.some((x) => x.toLowerCase() === w.toLowerCase()) ? `word:${w.toLowerCase()}` : `say:${w}`);
    }
  }
  return keys;
}

/** A rental's name for 2 or more ("2 paddle boats", "2 Castle Combos"); a name already plural stays. */
export function pluralName(name: string): string {
  const n = name.trim();
  if (/s$/i.test(n)) return n;
  if (/[^aeiou]y$/i.test(n)) return `${n.slice(0, -1)}ies`;
  if (/(x|ch|sh|z)$/i.test(n)) return `${n}es`;
  return `${n}s`;
}

/** Town phrases, one recording each (Abraham, Nov 22, 2026): read-back and step 7. Neighborhoods use their postal town. */
export const TOWN_PHRASES = ["Monroe New York", "Highland Mills New York", "Chester New York", "Washingtonville New York", "Central Valley New York", "Harriman New York", "Blooming Grove"] as const;
export const townSlotKey = (phrase: string) => `town:${phrase.toLowerCase().replace(/[^a-z]+/g, "_")}`;
export function townSlot(value: string): string | null {
  const v = value.trim().toLowerCase();
  const t = TOWN_PHRASES.find((x) => x.toLowerCase() === v);
  return t ? townSlotKey(t) : null;
}
