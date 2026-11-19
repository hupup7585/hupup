import { releaseExpired } from "@/lib/orders";
import { notifyStragglers } from "@/lib/voicemail";
import { processHeldPromotions } from "@/lib/sms";
import { runJob } from "@/lib/jobs";
import { sendScheduledEmails } from "@/lib/inbox";

export const dynamic = "force-dynamic";

/**
 * Every 5 minutes, called by the free Cloudflare scheduler Worker (cloudflare/scheduler-worker.js). Vercel's free
 * plan runs its own scheduler only once a day, so the short jobs run here as well:
 * - release phone holds and unpaid orders whose time ran out
 * - send voicemail alerts that never went out
 * - send promotional texts held for quiet hours (each one is checked again for consent and opt-out; nothing is
 *   sent while promotional texts are switched off)
 * - send emails scheduled in the Admin Inbox (Schedule send)
 * The daily Vercel job (/api/cron/release-holds) stays as a backup and keeps the weekly backup email.
 * Protected by CRON_SECRET (the same value is saved in the Worker as a secret).
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return new Response("Unauthorized", { status: 401 });
  const released = await runJob("Release ended holds (every 5 minutes)", () => releaseExpired());
  const voicemailAlerts = await runJob("Voicemail alerts safety net (every 5 minutes)", () => notifyStragglers());
  const heldPromotions = await runJob("Held promotional texts (every 5 minutes)", () => processHeldPromotions());
  // Schedule send in the Admin Inbox (Abraham, Nov 19, 2026)
  const scheduledEmails = await runJob("Scheduled emails (every 5 minutes)", () => sendScheduledEmails());
  return Response.json({ released, voicemailAlerts, heldPromotions, scheduledEmails });
}
