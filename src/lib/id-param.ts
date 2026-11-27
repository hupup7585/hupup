/**
 * Extra check HD7 (Nov 27, 2026): an id from an address. A positive whole number that fits the database's integer, or
 * null (the route answers "Not found" instead of a database error).
 */
export function idParam(v: string | number | null | undefined): number | null {
  const s = String(v ?? "");
  if (!/^\d{1,10}$/.test(s)) return null;
  const n = Number(s);
  return n > 0 && n < 2 ** 31 ? n : null;
}
