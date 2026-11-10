import { releaseExpired } from "@/lib/orders";
import { notifyStragglers } from "@/lib/voicemail";
import { sendJoinInvites } from "@/lib/join-invite";

export const dynamic = "force-dynamic";

/**
 * Daily safety net (Vercel Cron, once a day on the Hobby plan): release expired phone holds and unpaid orders,
 * and send any voicemail alert that never went out (transcription never came back).
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const released = await releaseExpired();
  // Voicemail tables arrive with migration 0012; until then this step is skipped, not fatal.
  const voicemailAlerts = await notifyStragglers().catch((e) => (console.error("[cron] voicemail safety net skipped:", e), null));
  // JOIN invitation: switched off until Abraham picks the wording (does nothing while off).
  const joinInvites = await sendJoinInvites().catch((e) => (console.error("[cron] JOIN invitations skipped:", e), null));
  return Response.json({ released, voicemailAlerts, joinInvites });
}
