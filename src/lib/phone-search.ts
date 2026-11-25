/**
 * Phone search by digits (Abraham, Nov 24, 2026, 11:22 AM): 8457, (845) 7, 845-7, 845.7 and +1 845 7 all find the
 * same numbers. Brackets, spaces, dashes and dots are ignored on both sides, and so is a leading 1 / +1.
 */

/** The digits to look for, or null when the search is not a phone number (it has letters, or too few digits). */
export function phoneQueryDigits(q: string | null | undefined): string | null {
  const t = (q ?? "").trim();
  if (!t || !/^[\d\s().+-]+$/.test(t)) return null;
  let d = t.replace(/\D/g, "");
  // a leading 1 / +1 is the country code when it is written that way, or when the whole 11-digit number is typed
  if (/^\+\s*1/.test(t) || /^1[\s.(-]/.test(t) || (d.length === 11 && d.startsWith("1"))) d = d.slice(1);
  return d.length >= 2 ? d : null;
}

/** A stored number's digits, without the leading country code 1. */
export function storedPhoneDigits(stored: string | null | undefined): string {
  const d = (stored ?? "").replace(/\D/g, "");
  return d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
}

/** Does this cell match the search: as text, or (when the search is a phone number) by its digits. */
export function cellMatches(cell: string | null | undefined, q: string): boolean {
  const c = cell ?? "";
  const t = q.trim().toLowerCase();
  if (!t) return true;
  // A phone number cell is matched only by the phone rule (start, local start, last 4), never in the middle
  if (phoneQueryDigits(q) && storedPhoneDigits(c).length === 10 && /^[\d\s().+-]+$/.test(c.trim())) return phoneMatchRank(c, phoneQueryDigits(q)!) !== null;
  if (c.toLowerCase().includes(t)) return true;
  const d = phoneQueryDigits(q);
  return Boolean(d && phoneMatchRank(c, d) !== null);
}

/*
 * Where the digits may match (Abraham, Nov 25, 2026 bug: short searches hit numbers in the middle): at the START of
 * the 10-digit number (845, 8457...), at the START of the 7-digit local part (777, 7777585), or the LAST 4 digits.
 * Never in the middle. Rank: 0 the exact full number, 1 starts with, 2 the last 4; null = no match.
 */
export function phoneMatchRank(stored: string | null | undefined, digits: string): 0 | 1 | 2 | null {
  const s = storedPhoneDigits(stored);
  if (!s || !digits) return null;
  if (digits.length >= 10) return s === digits.slice(-10) ? 0 : null;
  if (s.startsWith(digits) || (s.length === 10 && s.slice(3).startsWith(digits))) return 1;
  if (digits.length === 4 && s.endsWith(digits)) return 2;
  return null;
}
