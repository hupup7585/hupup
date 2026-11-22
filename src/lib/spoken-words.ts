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
export function wordSlotsFor(value: string, items: { id: number; name: string }[] = []): string[] | null {
  const item = items.find((i) => i.name.trim().toLowerCase() === value.trim().toLowerCase());
  if (item) return [`item:${item.id}`];
  // "2 paddle boats": the number, then the plural name recording (Nov 19, 2026)
  const plural = items.find((i) => pluralName(i.name).toLowerCase() === value.trim().toLowerCase() && pluralName(i.name) !== i.name);
  if (plural) return [`item:${plural.id}:plural`];
  const keys: string[] = [];
  for (const raw of value.replace(/[,.!?]/g, " ").split(/\s+/).filter(Boolean)) {
    const time = /^(\d{1,2}):(\d{2})$/.exec(raw);
    const ord = /^(\d{1,2})(st|nd|rd|th)$/i.exec(raw);
    let words: string[] | null = null;
    if (time) words = [...numberWords(Number(time[1])), ...(time[2] === "00" ? [] : Number(time[2]) < 10 ? ["oh", ...numberWords(Number(time[2]))] : numberWords(Number(time[2])))];
    else if (ord) words = ordinalWords(Number(ord[1]));
    else if (/^\d+$/.test(raw)) words = numberWords(Number(raw));
    else if (/^[A-Z]$/.test(raw)) {
      keys.push(`letter:${raw.toLowerCase()}`);
      continue;
    } else words = [raw];
    for (const w of words) {
      const k = `word:${w.toLowerCase()}`;
      if (!WORDS.some((x) => x.toLowerCase() === w.toLowerCase())) return null;
      keys.push(k);
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
