/**
 * One CSV cell for Admin downloads (deep check A16, Nov 27, 2026): a value that a spreadsheet would run as a formula
 * (starting with = + - @, a tab or a carriage return) gets an apostrophe in front; plain numbers, negative ones too,
 * stay numbers. Quotes are doubled.
 */
export function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : v instanceof Date ? v.toISOString() : String(v);
  const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}
