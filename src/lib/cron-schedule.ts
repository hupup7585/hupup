/**
 * Neon free plan (Abraham, Nov 26, 2026, 12:00 PM ET): the free scheduler calls /api/cron/frequent every 5 minutes;
 * the jobs touch the database only in the first minutes of each hour, so the database can sleep in between when
 * nobody uses the site.
 */
export const RUN_EVERY_MINUTES = 60;
export const RUN_WINDOW_MINUTES = 5;
export function dueNow(now = new Date()): boolean {
  return now.getUTCMinutes() % RUN_EVERY_MINUTES < RUN_WINDOW_MINUTES;
}
