/**
 * A database id the tables can hold: a whole number from 1 to 2,147,483,647 (deep check 0600 M56, Nov 27, 2026).
 * A typed or crafted id outside that (letters, 11+ digits) used to reach the database and give an error page.
 */
export const MAX_DB_ID = 2_147_483_647;
export function isDbId(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= MAX_DB_ID;
}
