import { addDays, isValidISO } from "@/lib/dates";

const MONTHS: Record<string, number> = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4, may: 5,
  june: 6, jun: 6, july: 7, jul: 7, august: 8, aug: 8, september: 9, sept: 9, sep: 9,
  october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12,
};

const WEEKDAYS: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
};

const ORDINAL_WORDS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9,
  tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15, sixteenth: 16,
  seventeenth: 17, eighteenth: 18, nineteenth: 19, twentieth: 20, thirtieth: 30,
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20, thirty: 30,
};

export const MAX_DAYS_AHEAD = 366;

export type DateParse =
  | { ok: true; date: string }
  | { ok: false; reason: "unparsed" | "past" | "too_far" | "invalid" };

function pad(n: number) {
  return String(n).padStart(2, "0");
}

/** Pick this year's date, or next year's if it has already passed. */
function nextOccurrence(month: number, day: number, todayISO: string): string | null {
  const year = Number(todayISO.slice(0, 4));
  for (const y of [year, year + 1]) {
    const iso = `${y}-${pad(month)}-${pad(day)}`;
    if (isValidISO(iso) && iso >= todayISO) return iso;
  }
  return null;
}

function checkRange(iso: string, todayISO: string): DateParse {
  if (!isValidISO(iso)) return { ok: false, reason: "invalid" };
  if (iso < todayISO) return { ok: false, reason: "past" };
  if (iso > addDays(todayISO, MAX_DAYS_AHEAD)) return { ok: false, reason: "too_far" };
  return { ok: true, date: iso };
}

/** Keypad: MMDD (e.g. 1108) or MMDDYYYY. */
export function parseDigitsDate(digits: string, todayISO: string): DateParse {
  const d = digits.replace(/\D/g, "");
  if (d.length === 4) {
    const m = Number(d.slice(0, 2));
    const day = Number(d.slice(2));
    if (m < 1 || m > 12 || day < 1 || day > 31) return { ok: false, reason: "invalid" };
    const iso = nextOccurrence(m, day, todayISO);
    return iso ? checkRange(iso, todayISO) : { ok: false, reason: "invalid" };
  }
  if (d.length === 8) {
    return checkRange(`${d.slice(4)}-${d.slice(0, 2)}-${d.slice(2, 4)}`, todayISO);
  }
  return { ok: false, reason: "unparsed" };
}

/** Turn "twenty first" / "21st" / "the 8th" into a day number. */
function extractDay(words: string[]): number | null {
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const num = /^(\d{1,2})(st|nd|rd|th)?$/.exec(w);
    if (num) return Number(num[1]);
    if (w === "twenty" || w === "thirty") {
      const base = w === "twenty" ? 20 : 30;
      const next = ORDINAL_WORDS[words[i + 1] ?? ""];
      if (next && next < 10) return base + next;
      return base;
    }
    if (ORDINAL_WORDS[w]) return ORDINAL_WORDS[w];
  }
  return null;
}

/** Speech: "November 8th", "Sunday the 8th of November", "11/8", "tomorrow", "this Sunday", "next Friday". */
export function parseSpokenDate(speech: string, todayISO: string): DateParse {
  const text = speech
    .toLowerCase()
    .replace(/[.,!?]/g, " ")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return { ok: false, reason: "unparsed" };

  if (/\btoday\b/.test(text)) return checkRange(todayISO, todayISO);
  if (/\bday after tomorrow\b/.test(text)) return checkRange(addDays(todayISO, 2), todayISO);
  if (/\btomorrow\b/.test(text)) return checkRange(addDays(todayISO, 1), todayISO);

  // Numeric "11/8" or "11 / 8 / 2026"
  const slash = /\b(\d{1,2})\s*\/\s*(\d{1,2})(?:\s*\/\s*(\d{2,4}))?\b/.exec(text);
  if (slash) {
    const m = Number(slash[1]);
    const d = Number(slash[2]);
    if (slash[3]) {
      const y = slash[3].length === 2 ? 2000 + Number(slash[3]) : Number(slash[3]);
      return checkRange(`${y}-${pad(m)}-${pad(d)}`, todayISO);
    }
    const iso = nextOccurrence(m, d, todayISO);
    return iso ? checkRange(iso, todayISO) : { ok: false, reason: "invalid" };
  }

  const words = text.split(" ");
  const monthIdx = words.findIndex((w) => MONTHS[w] !== undefined);
  if (monthIdx >= 0) {
    const month = MONTHS[words[monthIdx]];
    // Prefer the day right after the month ("november 8th"), else before ("8th of november").
    const after = extractDay(words.slice(monthIdx + 1));
    const before = extractDay(words.slice(0, monthIdx).filter((w) => WEEKDAYS[w] === undefined));
    const day = after ?? before;
    if (!day || day > 31) return { ok: false, reason: "unparsed" };
    const yearMatch = /\b(20\d{2})\b/.exec(text);
    if (yearMatch) return checkRange(`${yearMatch[1]}-${pad(month)}-${pad(day)}`, todayISO);
    const iso = nextOccurrence(month, day, todayISO);
    return iso ? checkRange(iso, todayISO) : { ok: false, reason: "invalid" };
  }

  // Weekday only: "sunday", "this sunday", "next sunday"
  const wd = words.find((w) => WEEKDAYS[w] !== undefined);
  if (wd) {
    const target = WEEKDAYS[wd];
    const [y, m, d] = todayISO.split("-").map(Number);
    const todayDow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    let delta = (target - todayDow + 7) % 7;
    // "next sunday" on a Sunday means a week from today; otherwise the upcoming one.
    if (delta === 0 && /\bnext\b/.test(text)) delta = 7;
    return checkRange(addDays(todayISO, delta), todayISO);
  }

  // Day only: "the 8th" -> this month or next
  const dayOnly = extractDay(words);
  if (dayOnly && dayOnly <= 31) {
    const [y, m] = todayISO.split("-").map(Number);
    for (let k = 0; k < 2; k++) {
      const mm = ((m - 1 + k) % 12) + 1;
      const yy = y + (m - 1 + k >= 12 ? 1 : 0);
      const iso = `${yy}-${pad(mm)}-${pad(dayOnly)}`;
      if (isValidISO(iso) && iso >= todayISO) return checkRange(iso, todayISO);
    }
  }
  return { ok: false, reason: "unparsed" };
}

export function parseDateInput(input: { digits?: string | null; speech?: string | null }, todayISO: string): DateParse {
  if (input.digits && input.digits.replace(/\D/g, "").length) return parseDigitsDate(input.digits, todayISO);
  if (input.speech) return parseSpokenDate(input.speech, todayISO);
  return { ok: false, reason: "unparsed" };
}

/** "yossi at gmail dot com" -> "yossi@gmail.com". Returns null if it doesn't look like an email. */
export function normalizeSpokenEmail(speech: string): string | null {
  let s = speech.toLowerCase().trim().replace(/[,?!]/g, "");
  s = s
    .replace(/\s+at\s+/g, "@")
    .replace(/\s+dot\s+/g, ".")
    .replace(/\s+period\s+/g, ".")
    .replace(/\bunderscore\b/g, "_")
    .replace(/\b(dash|hyphen)\b/g, "-")
    .replace(/\s+/g, "")
    .replace(/\.$/, "");
  return /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(s) ? s : null;
}

/** Tidy a spoken name: "yossi friedman." -> "Yossi Friedman" */
export function normalizeSpokenName(speech: string): string {
  return speech
    .replace(/[.?!]+$/g, "")
    .replace(/^(my name is|this is|it's|it is)\s+/i, "")
    .trim()
    .split(/\s+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(" ");
}

export function normalizeSpokenAddress(speech: string): string {
  return speech.replace(/[.?!]+$/g, "").replace(/\s+/g, " ").trim();
}
