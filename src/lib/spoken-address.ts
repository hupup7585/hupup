import { numberWords } from "@/lib/spoken-words";

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
