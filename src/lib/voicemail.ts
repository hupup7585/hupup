import { and, desc, eq, isNull, lt, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { BUSINESS_NAME, config } from "@/lib/config";
import { sendEmail, sendSms } from "@/lib/notify";
import { formatPhone, toE164 } from "@/lib/phone";
import { getTwilio } from "@/lib/twilio-client";

/**
 * Hotline voicemail (plan Round 1, Main box). Audio stays in Twilio; staff play and download it through
 * /api/admin/voicemail/[id]/audio (signed in), so there is no public link and no extra storage service.
 */
export type VoicemailBox = typeof schema.voicemailBoxes.$inferSelect;
export type Voicemail = typeof schema.voicemails.$inferSelect;

/** The Main box, created on first use with the owner as the default recipient. */
export async function mainBox(): Promise<VoicemailBox> {
  const [box] = await db.select().from(schema.voicemailBoxes).where(eq(schema.voicemailBoxes.isMain, true)).limit(1);
  if (box) return box;
  const owner = toE164(config.adminPhone());
  const email = process.env.ADMIN_EMAIL || "";
  const [created] = await db
    .insert(schema.voicemailBoxes)
    .values({ name: "Main", isMain: true, notifySms: owner ? [owner] : [], notifyEmail: email ? [email] : [] })
    .returning();
  return created;
}

export async function boxById(id: number | null | undefined): Promise<VoicemailBox> {
  if (id) {
    const [b] = await db.select().from(schema.voicemailBoxes).where(eq(schema.voicemailBoxes.id, id)).limit(1);
    if (b) return b;
  }
  return mainBox();
}

/** Twilio recording status callback. Idempotent on RecordingSid (Twilio retries). */
export async function saveRecording(input: { boxId: number; callSid: string | null; from: string | null; recordingSid: string; recordingUrl: string; durationSec: number; transcribe: boolean }) {
  const [row] = await db
    .insert(schema.voicemails)
    .values({
      boxId: input.boxId,
      callSid: input.callSid,
      fromNumber: input.from,
      recordingSid: input.recordingSid,
      recordingUrl: input.recordingUrl,
      durationSec: input.durationSec,
      transcriptionStatus: input.transcribe ? "pending" : "off",
    })
    .onConflictDoNothing({ target: schema.voicemails.recordingSid })
    .returning();
  // Without transcription there is nothing to wait for: notify now.
  if (row && !input.transcribe) await notifyVoicemail(row.id);
  return row ?? null;
}

/** Twilio transcription callback: store the text, then notify (once). */
export async function saveTranscription(recordingSid: string, status: string, text: string | null) {
  const [row] = await db
    .update(schema.voicemails)
    .set({ transcription: text?.trim() || null, transcriptionStatus: status === "completed" ? "completed" : "failed" })
    .where(eq(schema.voicemails.recordingSid, recordingSid))
    .returning();
  if (row) await notifyVoicemail(row.id);
  return row ?? null;
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export function voicemailAlertText(v: Pick<Voicemail, "fromNumber" | "durationSec" | "transcription" | "urgent">, box: Pick<VoicemailBox, "name" | "isMain">, link: string) {
  const who = v.fromNumber ? formatPhone(v.fromNumber) : "a withheld number";
  const said = v.transcription ? ` "${v.transcription.length > 240 ? v.transcription.slice(0, 237) + "..." : v.transcription}"` : "";
  return `${v.urgent ? "URGENT: " : ""}${BUSINESS_NAME}: new voicemail${box.isMain ? "" : ` (${box.name})`} from ${who}, ${mmss(v.durationSec)}.${said} Listen: ${link}`;
}

/** Text and email the box's recipients. Runs once per message (claims notified_at atomically). */
export async function notifyVoicemail(id: number): Promise<{ sent: number }> {
  const [v] = await db
    .update(schema.voicemails)
    .set({ notifiedAt: new Date() })
    .where(and(eq(schema.voicemails.id, id), isNull(schema.voicemails.notifiedAt)))
    .returning();
  if (!v) return { sent: 0 };
  const box = await boxById(v.boxId);
  const link = `${config.baseUrl()}/admin/voicemail`;
  const text = voicemailAlertText(v, box, link);
  let sent = 0;
  for (const to of box.notifySms) if ((await sendSms(to, text, { kind: "system", event: "owner_alert" })).sent) sent++;
  for (const to of box.notifyEmail) {
    const body = `${text}\n\nFull message:\n${v.transcription || "(no transcription)"}\n\nCaller: ${v.fromNumber ? formatPhone(v.fromNumber) : "withheld"}\nLength: ${mmss(v.durationSec)}\n${link}`;
    if ((await sendEmail(to, `${v.urgent ? "URGENT: " : ""}New voicemail from ${v.fromNumber ? formatPhone(v.fromNumber) : "a caller"}`, body)).sent) sent++;
  }
  return { sent };
}

/** Daily safety net: alert for messages whose transcription never came back (older than 15 minutes). */
export async function notifyStragglers() {
  const rows = await db
    .select({ id: schema.voicemails.id })
    .from(schema.voicemails)
    .where(and(isNull(schema.voicemails.notifiedAt), isNull(schema.voicemails.deletedAt), lt(schema.voicemails.createdAt, sql`now() - interval '15 minutes'`)));
  let n = 0;
  for (const r of rows) n += (await notifyVoicemail(r.id)).sent ? 1 : 0;
  return n;
}

export async function listVoicemails(boxId: number) {
  return db
    .select()
    .from(schema.voicemails)
    .where(and(eq(schema.voicemails.boxId, boxId), isNull(schema.voicemails.deletedAt)))
    .orderBy(desc(schema.voicemails.urgent), desc(schema.voicemails.createdAt))
    .limit(500);
}

export async function unheardCount() {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.voicemails)
    .where(and(isNull(schema.voicemails.heardAt), isNull(schema.voicemails.deletedAt)));
  return r?.n ?? 0;
}

/** Fetch the recording audio from Twilio (account credentials stay on the server). */
export async function fetchRecordingAudio(v: Pick<Voicemail, "recordingUrl">): Promise<Response | null> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return null;
  const u = new URL(v.recordingUrl);
  if (u.hostname !== "api.twilio.com") return null; // never proxy anything else
  const res = await fetch(`${v.recordingUrl.replace(/\.(mp3|wav)$/, "")}.mp3`, { headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}` } });
  return res.ok ? res : null;
}

/** Delete: hide the row now and remove the recording from Twilio (best effort). */
export async function deleteVoicemail(id: number) {
  const [v] = await db.update(schema.voicemails).set({ deletedAt: new Date() }).where(eq(schema.voicemails.id, id)).returning();
  if (!v) return false;
  try {
    await getTwilio()?.recordings(v.recordingSid).remove();
  } catch (e) {
    console.error("[voicemail] Twilio recording delete failed:", e);
  }
  return true;
}
