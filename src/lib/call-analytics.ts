import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

/**
 * Hotline call analytics for the dashboard (Abraham's priority 7). Read-only, from call_sessions:
 * how many calls, what happened on them, which main-menu keys callers chose, call length and busiest hour.
 * Days and hours are in New York time. Menu-key counts start from Nov 8, 2026 (when key choices began to be recorded).
 */
export const TZ = "America/New_York";

export type CallAnalytics = {
  days: number;
  total: number;
  today: number;
  /** One entry per day in the window, oldest first: { day: "YYYY-MM-DD", calls } */
  byDay: { day: string; calls: number }[];
  outcomes: { booked: number; toStaff: number; voicemail: number; abandonedCart: number; noChoice: number };
  /** Calls that chose each main-menu key at least once */
  keys: Record<string, number>;
  avgSeconds: number | null;
  /** Busiest hour of the day (0-23, New York time) and its call count, or null with no calls */
  busiestHour: { hour: number; calls: number } | null;
};

const num = (v: unknown) => Number(v ?? 0) || 0;

export async function callAnalytics(days = 30, now: Date = new Date()): Promise<CallAnalytics> {
  const since = new Date(now.getTime() - days * 86_400_000);
  const where = sql`started_at >= ${since.toISOString()}::timestamptz AND started_at <= ${now.toISOString()}::timestamptz`;
  const localDay = sql`to_char(started_at AT TIME ZONE ${TZ}, 'YYYY-MM-DD')`;
  const todayLocal = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);

  const [totals] = (
    await db.execute(sql`
      SELECT count(*)::int AS total,
        count(*) FILTER (WHERE ${localDay} = ${todayLocal})::int AS today,
        count(*) FILTER (WHERE outcome = 'checked_out')::int AS booked,
        count(*) FILTER (WHERE outcome = 'forwarded')::int AS to_staff,
        count(*) FILTER (WHERE outcome = 'voicemail')::int AS voicemail,
        count(*) FILTER (WHERE outcome IN ('dropped', 'carted'))::int AS abandoned,
        count(*) FILTER (WHERE outcome = 'browsing' AND coalesce(jsonb_array_length(data->'menuKeys'), 0) = 0)::int AS no_choice,
        avg(extract(epoch FROM (ended_at - started_at))) FILTER (WHERE ended_at IS NOT NULL) AS avg_seconds
      FROM call_sessions WHERE ${where}`)
  ).rows as Record<string, unknown>[];

  const dayRows = (await db.execute(sql`SELECT ${localDay} AS day, count(*)::int AS calls FROM call_sessions WHERE ${where} GROUP BY 1`)).rows as { day: string; calls: number }[];
  const counts = new Map(dayRows.map((r) => [r.day, num(r.calls)]));
  const byDay: { day: string; calls: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now.getTime() - i * 86_400_000));
    if (!byDay.some((x) => x.day === d)) byDay.push({ day: d, calls: counts.get(d) ?? 0 });
  }

  const keyRows = (
    await db.execute(sql`
      SELECT k AS key, count(DISTINCT call_sid)::int AS calls
      FROM call_sessions, jsonb_array_elements_text(coalesce(data->'menuKeys', '[]'::jsonb)) AS k
      WHERE ${where} GROUP BY k`)
  ).rows as { key: string; calls: number }[];

  const [busy] = (
    await db.execute(sql`
      SELECT extract(hour FROM started_at AT TIME ZONE ${TZ})::int AS hour, count(*)::int AS calls
      FROM call_sessions WHERE ${where} GROUP BY 1 ORDER BY 2 DESC, 1 ASC LIMIT 1`)
  ).rows as { hour: number; calls: number }[];

  const avg = totals?.avg_seconds;
  return {
    days,
    total: num(totals?.total),
    today: num(totals?.today),
    byDay,
    outcomes: {
      booked: num(totals?.booked),
      toStaff: num(totals?.to_staff),
      voicemail: num(totals?.voicemail),
      abandonedCart: num(totals?.abandoned),
      noChoice: num(totals?.no_choice),
    },
    keys: Object.fromEntries(keyRows.map((r) => [r.key, num(r.calls)])),
    avgSeconds: avg === null || avg === undefined ? null : Math.round(Number(avg)),
    busiestHour: busy ? { hour: num(busy.hour), calls: num(busy.calls) } : null,
  };
}
