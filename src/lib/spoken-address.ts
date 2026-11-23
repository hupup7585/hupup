import { numberWords, townSlotKey } from "@/lib/spoken-words";
import { UNIT_CODES, ZIP_CODES, findStreet, streetSlotKey, unitSlotKey } from "@/lib/streets";

/**
 * Address read-back rules (Abraham, Nov 22, 2026, approved):
 * - the house number is read like an amount: 53 = "fifty three", 279 = "two hundred seventy nine";
 * - the unit digit by digit, letters as the letter, "Bsmt" = "basement": 302A = "three zero two A";
 * - a directory house number "21-312" is house 21, unit 312: "twenty one Rovna Court, unit three one two";
 * - town and state are one phrase, no comma: "Monroe New York"; rows printed as Blooming Grove (filed as Monroe, NY
 *   10950) say "Blooming Grove" right before it; the written address stays "Monroe, NY 10950";
 * - the zip code digit by digit; a name is last name, then first name, with a comma.
 */
const DIGIT = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

/** "21-312" -> house 21, unit 312; "29-001" -> house 29, unit 001; "53" -> house 53. */
export function splitHouse(house: string): { house: string; unit: string | null } {
  const m = /^\s*(\d+)\s*-\s*([0-9A-Za-z]+)\s*$/.exec(house);
  return m ? { house: m[1], unit: m[2] } : { house: house.trim(), unit: null };
}

export function houseWords(house: string): string {
  const n = Number(house.replace(/\D/g, ""));
  const w = /^\d+$/.test(house.trim()) && n > 0 ? numberWords(n) : [];
  return w.length ? w.join(" ") : unitWords(house);
}

export function unitWords(unit: string): string {
  const u = unit.trim();
  if (/^(bsmt|basement)$/i.test(u)) return "basement";
  return u
    .replace(/[^0-9A-Za-z]/g, "")
    .split("")
    .map((c) => (/\d/.test(c) ? DIGIT[Number(c)] : c.toUpperCase()))
    .join(" ");
}

export const zipWords = (zip: string) => zip.replace(/\D/g, "").split("").map((d) => DIGIT[Number(d)]).join(" ");

/** "Monroe New York", or "Blooming Grove, Monroe New York" for rows printed as Blooming Grove. */
export function townPhrase(town: string, areaPrinted?: string | null): string {
  const t = town.trim();
  const bg = areaPrinted && /blooming\s*grove/i.test(areaPrinted) && !/blooming\s*grove/i.test(t);
  return `${bg ? "Blooming Grove, " : ""}${t} New York`;
}

export function spokenAddress(a: { house: string; street: string; unit?: string | null; town: string; zip: string; areaPrinted?: string | null }): string {
  const h = splitHouse(a.house);
  const unit = a.unit?.trim() || h.unit;
  return [`${houseWords(h.house)} ${a.street.trim()}`, unit ? `unit ${unitWords(unit)}` : null, townPhrase(a.town, a.areaPrinted), zipWords(a.zip)].filter(Boolean).join(", ");
}

export const spokenName = (last: string, first: string) => [last.trim(), first.trim()].filter(Boolean).join(", ");

/**
 * The read-back joined from Hark's recordings (Abraham, Nov 22, 2026, 11:12 PM): the house number as an amount (21 to 99
 * one recording each), the street, "unit" and its digits one by one (skipped when none), the town phrase(s), and the
 * zip: 10950 is one recording, other zips digit by digit. Null when a street has no slot.
 */
export function addressSlotKeys(a: { house: string; street: string; unit?: string | null; town: string; zip: string; areaPrinted?: string | null }): string[] | null {
  const h = splitHouse(a.house);
  const unit = a.unit?.trim() || h.unit;
  const n = Number(h.house);
  if (!/^\d+$/.test(h.house) || !n) return null;
  const street = findStreet(a.street);
  if (!street) return null;
  const keys = [...amountSlots(n), streetSlotKey(street.spoken)];
  if (unit) {
    keys.push("word:unit");
    if (/^(bsmt|basement)$/i.test(unit)) keys.push("word:basement");
    else if (UNIT_CODES.includes(unit.toUpperCase())) keys.push(unitSlotKey(unit)); // one recording for the whole unit
    else for (const c of unit.replace(/[^0-9A-Za-z]/g, "")) keys.push(/\d/.test(c) ? `word:${DIGIT[Number(c)]}` : `letter:${c.toLowerCase()}`);
  }
  if (a.areaPrinted && /blooming\s*grove/i.test(a.areaPrinted) && !/blooming\s*grove/i.test(a.town)) keys.push(townSlotKey("Blooming Grove"));
  keys.push(townSlotKey(`${a.town.trim()} New York`));
  const zip = a.zip.replace(/\D/g, "");
  if (ZIP_CODES.includes(zip)) keys.push(`zip:${zip}`); // one recording each (Hark, Nov 23, 2026)
  else for (const d of zip) keys.push(`word:${DIGIT[Number(d)]}`);
  return keys;
}

/** 279 -> two, hundred, seventy nine: the number clips, with 21 to 99 as one recording each. */
export function amountSlots(n: number): string[] {
  const out: string[] = [];
  const two = (x: number) => {
    if (!x) return;
    if (x > 20 && x % 10) out.push(`word:${numberWords(x).join(" ")}`);
    else out.push(...numberWords(x).map((w) => `word:${w}`));
  };
  if (n >= 1000) {
    out.push(...amountSlots(Math.floor(n / 1000)), "word:thousand");
    n %= 1000;
  }
  if (n >= 100) {
    out.push(`word:${numberWords(Math.floor(n / 100))[0]}`, "word:hundred");
    n %= 100;
  }
  two(n);
  return out;
}
