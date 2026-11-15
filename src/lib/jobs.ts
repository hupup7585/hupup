import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { config } from "@/lib/config";
import { sendEmail } from "@/lib/notify";

/**
 * Scheduled jobs that never fail silently (plan step 3, Abraham, Nov 15, 2026). Each run is logged; a failure is
 * tried again up to 3 times (2, then 4 seconds apart); if it still fails, the Owner is emailed and it shows in Admin >
 * System status.
 */
export const JOB_TRIES = 3;

export async function runJob<T>(name: string, fn: () => Promise<T>, opts: { tries?: number; waitMs?: number } = {}): Promise<T | null> {
  const tries = opts.tries ?? JOB_TRIES;
  const wait = opts.waitMs ?? 2000;
  const [run] = await db.insert(schema.jobRuns).values({ name }).returning();
  let lastError = "";
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const result = await fn();
      await db.update(schema.jobRuns).set({ ok: true, attempts: attempt, finishedAt: new Date(), result: (result ?? null) as never, error: lastError || null }).where(eq(schema.jobRuns.id, run.id));
      return result;
    } catch (e) {
      lastError = (e as Error)?.message?.slice(0, 500) || String(e);
      console.error(`[job ${name}] try ${attempt} of ${tries} failed:`, e);
      if (attempt < tries) await new Promise((r) => setTimeout(r, wait * attempt));
    }
  }
  await db.update(schema.jobRuns).set({ ok: false, attempts: tries, finishedAt: new Date(), error: lastError }).where(eq(schema.jobRuns.id, run.id));
  const to = config.adminEmail();
  if (to)
    await sendEmail(to, `Hup Up Attractions: the daily job "${name}" failed`, `The job "${name}" failed ${tries} times.\n\nLast error: ${lastError}\n\nIt will try again tomorrow. Details are in Admin > System status.\n${config.baseUrl()}/admin/status`).catch(() => null);
  return null;
}

export async function recentJobRuns(limit = 30) {
  return db.select().from(schema.jobRuns).orderBy(desc(schema.jobRuns.startedAt)).limit(limit);
}
