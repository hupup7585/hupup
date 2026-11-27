import { and, desc, eq, gte, ne } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { config } from "@/lib/config";
import { sendEmail } from "@/lib/notify";

/**
 * Scheduled jobs that never fail silently (plan step 3, Abraham, Nov 15, 2026). Each run is logged; a failure is
 * tried again up to 3 times (2, then 4 seconds apart); if it still fails, the Owner is emailed and it shows in Admin >
 * System status.
 */
export const JOB_TRIES = 3;

/** Nothing was done: 0, null, empty, or an object whose values are all nothing. */
export function isNoop(v: unknown): boolean {
  if (v === null || v === undefined || v === 0 || v === false || v === "") return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") return Object.values(v as object).every(isNoop);
  return false;
}

export async function runJob<T>(name: string, fn: () => Promise<T>, opts: { tries?: number; waitMs?: number } = {}): Promise<T | null> {
  const tries = opts.tries ?? JOB_TRIES;
  const wait = opts.waitMs ?? 2000;
  // Neon free plan (Nov 26, 2026): a run that did nothing (first try, no error) writes no row in the job history
  const startedAt = new Date();
  let run: { id: number } | null = null;
  const ensureRow = async () => (run ??= (await db.insert(schema.jobRuns).values({ name, startedAt }).returning())[0]);
  let lastError = "";
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const result = await fn();
      if (attempt === 1 && isNoop(result)) return result;
      const row = await ensureRow();
      await db.update(schema.jobRuns).set({ ok: true, attempts: attempt, finishedAt: new Date(), result: (result ?? null) as never, error: lastError || null }).where(eq(schema.jobRuns.id, row.id));
      return result;
    } catch (e) {
      lastError = (e as Error)?.message?.slice(0, 500) || String(e);
      console.error(`[job ${name}] try ${attempt} of ${tries} failed:`, e);
      if (attempt < tries) await new Promise((r) => setTimeout(r, wait * attempt));
    }
  }
  const failed = await ensureRow();
  await db.update(schema.jobRuns).set({ ok: false, attempts: tries, finishedAt: new Date(), error: lastError }).where(eq(schema.jobRuns.id, failed.id));
  // Extra check G5 (Nov 27, 2026): at most one failure email per job a day (a job checked every 5 minutes that keeps
  // failing used to email every time); every failure is still in Admin > System status
  const earlier = await db
    .select({ id: schema.jobRuns.id })
    .from(schema.jobRuns)
    .where(and(eq(schema.jobRuns.name, name), eq(schema.jobRuns.ok, false), gte(schema.jobRuns.startedAt, new Date(startedAt.getTime() - 24 * 3600_000)), ne(schema.jobRuns.id, failed.id)))
    .limit(1)
    .catch(() => []);
  const to = config.adminEmail();
  if (to && !earlier.length)
    await sendEmail(to, `Hup Up Attractions: the job "${name}" failed`, `The job "${name}" failed ${tries} times.\n\nLast error: ${lastError}\n\nIt will try again on its next run. Further failures today are not emailed again. Details are in Admin > System status.\n${config.baseUrl()}/admin/status`).catch(() => null);
  return null;
}

export async function recentJobRuns(limit = 30) {
  return db.select().from(schema.jobRuns).orderBy(desc(schema.jobRuns.startedAt)).limit(limit);
}
