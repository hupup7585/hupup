import { ORDER_STATUSES } from "@/lib/db/schema";
import { isValidISO } from "@/lib/dates";

/**
 * Extra check K8 (Nov 27, 2026): Orders and report filters from the address bar. A status that isn't one of ours, or a
 * date that isn't a real date, is ignored (the page used to crash with a database error).
 */
export function cleanFilters<T extends { status?: string; from?: string; to?: string }>(f: T): T {
  const out = { ...f };
  if (out.status && out.status !== "OPEN" && out.status !== "ALL" && !(ORDER_STATUSES as readonly string[]).includes(out.status)) delete out.status;
  if (out.from && !isValidISO(out.from)) delete out.from;
  if (out.to && !isValidISO(out.to)) delete out.to;
  return out;
}

/** Extra check K9: "contains" search text for ILIKE, with %, _ and \ taken as the characters themselves. */
export function likeContains(q: string): string {
  return `%${q.trim().replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
}
