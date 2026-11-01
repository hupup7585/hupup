/** All business dates are plain "YYYY-MM-DD" strings in the business time zone. */

export const TZ = process.env.BUSINESS_TIMEZONE || "America/New_York";

export function todayISO(now: Date = new Date(), tz: string = TZ): string {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

export function isValidISO(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function asUTC(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** "Sunday, November 8" */
export function longDate(iso: string): string {
  return asUTC(iso).toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

/** "Sun Nov 8" */
export function shortDate(iso: string): string {
  return asUTC(iso).toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function weekdayShort(iso: string): string {
  return asUTC(iso).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short" });
}

export function dayOfMonth(iso: string): number {
  return Number(iso.slice(8, 10));
}

export function daysBetween(fromISO: string, toISO: string): string[] {
  const out: string[] = [];
  for (let d = fromISO; d <= toISO; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Monday of the week containing iso */
export function startOfWeek(iso: string): string {
  const dow = asUTC(iso).getUTCDay(); // 0 Sun
  return addDays(iso, dow === 0 ? -6 : 1 - dow);
}

export function startOfMonth(iso: string): string {
  return iso.slice(0, 8) + "01";
}

export function endOfMonth(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}
