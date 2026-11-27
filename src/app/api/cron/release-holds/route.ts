import { cronAuthorized } from "@/lib/cron-auth";
import { releaseExpired } from "@/lib/orders";
import { notifyStragglers } from "@/lib/voicemail";
import { sendJoinInvites } from "@/lib/join-invite";
import { runJob } from "@/lib/jobs";
import { backupFileName, buildBackup } from "@/lib/backup";
import { config } from "@/lib/config";
import { sendEmail } from "@/lib/notify";

/** Sundays (New York time): a full backup to the Owner by email; too big to attach means a download link instead. */
async function weeklyBackupEmail(now = new Date()) {
  const day = now.toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "long" });
  if (day !== "Sunday") return { skipped: "not Sunday" };
  const to = config.adminEmail();
  if (!to) return { skipped: "no Owner email" };
  const b = await buildBackup(now);
  const fits = b.gz.length <= 8 * 1024 * 1024;
  const text = `Your weekly backup of Hup Up Attractions: ${b.tables} tables, ${b.rows} rows.\n\n${fits ? "It is attached. Keep it somewhere safe." : "It is too big to attach this week. Download it here:"}\n${config.baseUrl()}/api/admin/backup\n\nKeys, passwords and sign-in codes are never in the backup.`;
  const r = await sendEmail(to, "Hup Up Attractions: weekly backup", text, fits ? [{ filename: backupFileName(now), content: b.gz.toString("base64") }] : [], { record: false }); // deep check 30: the full backup is not copied into the Inbox tables every week
  if (!r?.sent) throw new Error("The backup email could not be sent.");
  return { sent: true, bytes: b.gz.length, tables: b.tables, rows: b.rows };
}

export const dynamic = "force-dynamic";

/**
 * Daily safety net (Vercel Cron, once a day on the Hobby plan): release expired phone holds and unpaid orders,
 * and send any voicemail alert that never went out (transcription never came back).
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  // Code audit L4: no secret set = nobody can run it (like the frequent job)
  if (!cronAuthorized(req.headers.get("authorization"), secret)) {
    return new Response("Unauthorized", { status: 401 });
  }
  // Plan step 3 (Abraham, Nov 15, 2026): every job is logged, retried up to 3 times, and the Owner is emailed if it still fails
  const released = await runJob("Release ended holds", () => releaseExpired());
  const voicemailAlerts = await runJob("Voicemail alerts safety net", () => notifyStragglers());
  // JOIN invitation: switched off until Abraham picks the wording (does nothing while off).
  const joinInvites = await runJob("JOIN invitations", () => sendJoinInvites());
  const backup = await runJob("Weekly backup by email", () => weeklyBackupEmail());
  // Gap review (Nov 26, 2026): texts and emails that failed in the last 24 hours, to the Owner when there are any
  const failedSends = await runJob("Failed texts and emails report", async () => (await import("@/lib/ops-alerts")).failedSendsReport());
  return Response.json({ released, voicemailAlerts, joinInvites, backup: Boolean(backup), failedSends });
}
