import { sql } from "drizzle-orm";

/* The phone search rule (phone-search.ts phoneMatchRank) in SQL (Abraham, Nov 25, 2026). Server only. */

/** The same rule in SQL, for a column holding a phone number in any format. */
export function phoneMatchSql(column: unknown, digits: string) {
  
  const d10 = sql`right(regexp_replace(coalesce(${column}, ''), '[^0-9]', '', 'g'), 10)`;
  if (digits.length >= 10) return sql`(${d10} = ${digits.slice(-10)})`;
  return sql`(${d10} LIKE ${`${digits}%`} OR (length(${d10}) = 10 AND substr(${d10}, 4) LIKE ${`${digits}%`})${digits.length === 4 ? sql` OR right(${d10}, 4) = ${digits}` : sql``})`;
}

/** Order by best match in SQL: the exact number, then starts with, then the last 4 (then the caller's own order). */
export function phoneRankSql(column: unknown, digits: string) {
  
  const d10 = sql`right(regexp_replace(coalesce(${column}, ''), '[^0-9]', '', 'g'), 10)`;
  return sql`(CASE WHEN ${d10} = ${digits.slice(-10)} THEN 0 WHEN ${d10} LIKE ${`${digits}%`} OR substr(${d10}, 4) LIKE ${`${digits}%`} THEN 1 WHEN right(${d10}, 4) = ${digits} THEN 2 ELSE 3 END)`;
}
