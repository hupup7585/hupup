import { releaseExpired } from "@/lib/orders";
import { notifyStragglers } from "@/lib/voicemail";
import { processHeldPromotions } from "@/lib/sms";
import { runJob } from "@/lib/jobs";
import { sendScheduledEmails } from "@/lib/inbox";
import { dueNow } from "@/lib/cron-schedule";

export const dynamic = "force-dynamic";

/**
 * Called every 5 minutes by the free Cloudflare scheduler Worker; does its work every 3 hours (src/lib/cron-schedule.ts) (cloudflare/scheduler-worker.js). Vercel's free
 * plan runs its own scheduler only once a day, so the short jobs run here as well:
 * - release phone holds and unpaid orders whose time ran out
 * - send voicemail alerts that never went out
 * - send promotional texts held for quiet hours (each one is checked again for consent and opt-out; nothing is
 *   sent while promotional texts are switched off)
 * - send emails scheduled in the Admin Inbox (Schedule send)
 * The daily Vercel job (/api/cron/release-holds) stays as a backup and keeps the weekly backup email.
 * Protected by CRON_SECRET (the same value is saved in the Worker as a secret).
 */
/**
 * Neon free plan (Abraham, Nov 26, 2026, 12:00 PM ET): the scheduler calls every 5 minutes, which kept the database
 * awake day and night. Now the jobs touch the database only in the first minutes of each hour (one wake an hour when
 * nobody uses the site); the other calls answer at once without the database. Nothing caller-facing depends on the
 * 5 minutes: a phone hold that ran out already stops counting for stock the moment it ends (availability.ts); these
 * jobs only tidy up after it. ?all=1 runs them now (manual check, with the secret). Schedule: src/lib/cron-schedule.ts.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return new Response("Unauthorized", { status: 401 });
  if (!dueNow() && new URL(req.url).searchParams.get("all") !== "1") return Response.json({ skipped: "not due: the jobs run every 3 hours, without waking the database in between" });
  const released = await runJob("Release ended holds (every 3 hours)", () => releaseExpired());
  const voicemailAlerts = await runJob("Voicemail alerts safety net (every 3 hours)", () => notifyStragglers());
  // Deleted voicemails are kept 30 days, then erased forever with their pieces (Nov 23, 2026)
  await runJob("Erase deleted voicemails after 30 days", async () => (await import("@/lib/vm-boxes")).purgeOldDeleted());
  const heldPromotions = await runJob("Held promotional texts (every 3 hours)", () => processHeldPromotions());
  // Schedule send in the Admin Inbox (Abraham, Nov 19, 2026)
  const scheduledEmails = await runJob("Scheduled emails (every 3 hours)", () => sendScheduledEmails());
  return Response.json({ released, voicemailAlerts, heldPromotions, scheduledEmails });
}
