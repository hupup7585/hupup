/**
 * "10:30 AM - 10:30 PM", "10:30am-10:30pm" or "10:30-22:30" -> "10:30-22:30" (24-hour), or null if unclear.
 * The end must be after the start (same day).
 */
export function normalizeHours(input: string): string | null {
  const parts = input.toLowerCase().replace(/\s+/g, "").replace(/–|—|to/g, "-").split("-").filter(Boolean);
  if (parts.length !== 2) return null;
  const toMin = (t: string): number | null => {
    const r = t.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)?$/);
    if (!r) return null;
    let h = Number(r[1]);
    const m = Number(r[2] ?? 0);
    if (m > 59 || h > 23 || (r[3] && (h < 1 || h > 12))) return null;
    if (r[3] === "pm" && h !== 12) h += 12;
    if (r[3] === "am" && h === 12) h = 0;
    return h * 60 + m;
  };
  const a = toMin(parts[0]), b = toMin(parts[1]);
  if (a === null || b === null || b <= a) return null;
  const f = (x: number) => `${String(Math.floor(x / 60)).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}`;
  return `${f(a)}-${f(b)}`;
}

/** "22:30" -> "10:30 PM" */
export function ampm24(range: string): string {
  const f = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
  };
  const [a, b] = range.split("-");
  return a && b ? `${f(a)} - ${f(b)}` : range;
}
