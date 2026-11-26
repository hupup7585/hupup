/**
 * Timed jobs and the Neon free plan (Abraham, Nov 26, 2026, 12:00 PM and 1:28 PM ET). The free scheduler calls
 * /api/cron/frequent every 5 minutes; the jobs touch the database only at the start of every third hour (00:00, 03:00,
 * 06:00 ... UTC), so the database can sleep in between when nobody uses the system. Keeping any one job hourly would
 * keep the database waking every hour, which cancels the saving; so the two jobs where lateness could matter (the
 * voicemail alert safety net and scheduled emails) ALSO run whenever the database is already awake from real use (a
 * call, an Admin page, the payment page), at most once every 10 minutes per server, which adds no wake-ups.
 */
export const RUN_EVERY_HOURS = 3;
export const RUN_WINDOW_MINUTES = 5;
/** Kept for the tests and the hourly wording elsewhere: the cron runs every RUN_EVERY_HOURS hours. */
export const RUN_EVERY_MINUTES = RUN_EVERY_HOURS * 60;

export function dueNow(now = new Date()): boolean {
  return now.getUTCHours() % RUN_EVERY_HOURS === 0 && now.getUTCMinutes() < RUN_WINDOW_MINUTES;
}

/** The jobs, in plain words, with their timing (shown on the status page and in the reply to Abraham). */
export const TIMED_JOBS = [
  { name: "Release ended holds", every: "Every 3 hours", why: "Tidy-up only: a phone or payment-link hold stops blocking stock the moment it ends." },
  { name: "Voicemail alerts safety net", every: "Every 3 hours, and whenever the system is already in use", why: "Only retries an alert that failed; the normal alert goes out the moment the message is left." },
  { name: "Erase deleted voicemails after 30 days", every: "Every 3 hours", why: "Nothing waits on it." },
  { name: "Held promotional texts", every: "Every 3 hours", why: "Promotional texts held for quiet hours go out up to 3 hours after quiet hours end; consent and quiet hours are checked again before each one." },
  { name: "Scheduled emails", every: "Every 3 hours, and whenever the system is already in use", why: "An email scheduled for a set time goes out within minutes while anyone uses the system, and within 3 hours otherwise." },
] as const;

/* ---- run the two time-sensitive jobs while the database is awake anyway ---- */
const AWAKE_EVERY_MS = 10 * 60_000;
let lastAwakeRun = 0;

/** Call from a request that already uses the database. Runs at most once every 10 minutes per server, after the reply. */
export async function runWhileAwake(): Promise<void> {
  if (process.env.VITEST && !process.env.RUN_WHILE_AWAKE_TEST) return;
  const now = Date.now();
  if (now - lastAwakeRun < AWAKE_EVERY_MS) return;
  lastAwakeRun = now;
  const { runJob } = await import("@/lib/jobs");
  const { notifyStragglers } = await import("@/lib/voicemail");
  const { sendScheduledEmails } = await import("@/lib/inbox");
  await runJob("Voicemail alerts safety net (while in use)", () => notifyStragglers());
  await runJob("Scheduled emails (while in use)", () => sendScheduledEmails());
}
/** For tests: forget the last run. */
export function resetWhileAwake() {
  lastAwakeRun = 0;
}
