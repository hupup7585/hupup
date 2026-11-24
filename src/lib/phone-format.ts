/**
 * Phone numbers typed in any phone box get their dashes as they are typed (Abraham, Nov 24, 2026): "845-555-0123",
 * never one long number like an account or a PIN. A leading 1 or +1 is dropped. Anything that is not a US or Canada
 * number (letters, a + with another country, more than 10 digits) is left exactly as typed.
 */
export function formatPhoneTyping(value: string): string {
  if (!/^[\d\s().+-]*$/.test(value)) return value;
  if (/^\s*\+/.test(value) && !/^\s*\+\s*1/.test(value)) return value;
  let d = value.replace(/\D/g, "");
  if (d.startsWith("1")) d = d.slice(1); // US and Canada area codes never start with 1: a leading 1 is the country code
  if (d.length > 10) return value;
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
}

/** Where the cursor goes after formatting: right after the same number of digits as before. */
export function caretAfterDigits(formatted: string, digitsBefore: number): number {
  if (digitsBefore <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < formatted.length; i++) {
    if (/\d/.test(formatted[i]) && ++seen === digitsBefore) return i + 1;
  }
  return formatted.length;
}
