import { ADAR, ADAR2, isLeapYear, type HDay } from "./hebrew-date";

/**
 * Month names. `en` is what staff see today ("15th of Kislev, 5787"); `he` is the pointed Hebrew used in the
 * Hebrew-letter date. Yiddish holiday names are in holidays.ts (proposed, waiting for Abraham's approval).
 */
const MONTHS: Record<number, { en: string; he: string }> = {
  1: { en: "Nisan", he: "נִיסָן" },
  2: { en: "Iyyar", he: "אִיָּיר" },
  3: { en: "Sivan", he: "סִיוָן" },
  4: { en: "Tamuz", he: "תַּמּוּז" },
  5: { en: "Av", he: "אָב" },
  6: { en: "Elul", he: "אֱלוּל" },
  7: { en: "Tishrei", he: "תִּשְׁרֵי" },
  8: { en: "Cheshvan", he: "חֶשְׁוָן" },
  9: { en: "Kislev", he: "כִּסְלֵו" },
  10: { en: "Teves", he: "טֵבֵת" },
  11: { en: "Sh’vat", he: "שְׁבָט" },
  12: { en: "Adar", he: "אֲדָר" },
  13: { en: "Adar II", he: "אֲדָר ב׳" },
};

export function monthName(month: number, year: number, lang: "en" | "he"): string {
  if (month === ADAR && isLeapYear(year)) return lang === "en" ? "Adar I" : "אֲדָר א׳";
  if (month === ADAR2) return MONTHS[ADAR2][lang];
  return MONTHS[month][lang];
}

const ordinal = (n: number) => {
  const t = n % 100;
  if (t >= 11 && t <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
};

/** "15th of Kislev, 5787" */
export function renderEnglish(h: HDay): string {
  return `${ordinal(h.day)} of ${monthName(h.month, h.year, "en")}, ${h.year}`;
}

/* ---- Hebrew numerals (gematriya) ---- */

const ONES = ["", "א", "ב", "ג", "ד", "ה", "ו", "ז", "ח", "ט"];
const TENS = ["", "י", "כ", "ל", "מ", "נ", "ס", "ע", "פ", "צ"];
const HUNDREDS = ["", "ק", "ר", "ש", "ת"];

/** Letters for 1-999 (15 = ט״ו, 16 = ט״ז; hundreds above 400 repeat ת). */
function letters(n: number): string {
  let out = "";
  let h = Math.floor(n / 100);
  while (h > 4) {
    out += "ת";
    h -= 4;
  }
  out += HUNDREDS[h];
  const rest = n % 100;
  if (rest === 15) return out + "טו";
  if (rest === 16) return out + "טז";
  return out + TENS[Math.floor(rest / 10)] + ONES[rest % 10];
}

/** Adds geresh (one letter) or gershayim (before the last letter). */
export function gematriya(n: number): string {
  const s = letters(n);
  if (s.length === 1) return `${s}׳`;
  return `${s.slice(0, -1)}״${s.slice(-1)}`;
}

/**
 * Hebrew-letter year. Before 6000 the thousands are left off, as is customary (5787 = תשפ״ז). A round thousand
 * shows as its letter (6000 = ו׳, 7000 = ז׳). In the seventh millennium the thousands letter is written first so
 * 6001 can't be mistaken for 5001 (6001 = ו׳א׳, 6787 = ו׳תשפ״ז).
 */
export function hebrewYear(year: number): string {
  const thousands = Math.floor(year / 1000), rest = year % 1000;
  if (rest === 0) return gematriya(thousands);
  if (year < 6000) return gematriya(rest);
  return `${gematriya(thousands)}${gematriya(rest)}`;
}

/** "ט״ו כִּסְלֵו תשפ״ז" */
export function renderHebrew(h: HDay): string {
  return `${gematriya(h.day)} ${monthName(h.month, h.year, "he")} ${hebrewYear(h.year)}`;
}
