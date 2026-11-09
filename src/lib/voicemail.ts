import { and, desc, eq, isNull, lt, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { BUSINESS_NAME, config } from "@/lib/config";
import { sendEmail, sendSms } from "@/lib/notify";
import { formatPhone, toE164 } from "@/lib/phone";
import { getTwilio } from "@/lib/twilio-client";
import { voicemailPlayLink } from "@/lib/signed-link";
import { getSettings } from "@/lib/settings";

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


/** Texting is live once Twilio approves our texting registration (A2P) and the messaging service is set. */
export const textingActive = (env: Record<string, string | undefined> = process.env) => Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_MESSAGING_SERVICE_SID);
export const TEXT_ALERTS_NOT_ACTIVE = "Not active yet: waiting for Twilio A2P";

/** Carriers often reject audio MMS above about 600 KB; bigger recordings go by text with the play link only. */
export const MMS_AUDIO_MAX_BYTES = 600_000;

/** "Mon, Nov 9, 2026, 3:15 PM" (New York time). */
export function alertDateTime(d: Date): string {
  const tz = process.env.BUSINESS_TIMEZONE || "America/New_York";
  const date = d.toLocaleDateString("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric", year: "numeric" });
  const time = d.toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });
  return `${date}, ${time}`;
}

/** Which key or box the message came from, e.g. "Key 0 (no one answered)", "Key 9 (voicemail)", "Main voicemail". */
export function voicemailSource(box: Pick<VoicemailBox, "name" | "isMain">, data: { menuKeys?: string[]; missed?: string } | null | undefined): string {
  const key = data?.menuKeys?.at(-1);
  if (!box.isMain) return box.name;
  if (key && data?.missed) return `Key ${key} (${data.missed === "closed" ? "office closed" : "no one answered"})`;
  if (key === "9") return "Key 9 (voicemail)";
  return "Main voicemail";
}

export type VoicemailAlert = { subject: string; email: string; text: string };

/** The words of one voicemail alert (email and text). */
export function voicemailAlert(
  v: Pick<Voicemail, "fromNumber" | "durationSec" | "transcription" | "urgent" | "createdAt">,
  info: { callerName?: string | null; source: string; playLink: string; attached: boolean },
): VoicemailAlert {
  const caller = v.fromNumber ? formatPhone(v.fromNumber) : "a withheld number";
  const who = info.callerName ? `${info.callerName} ${caller}` : caller;
  const when = alertDateTime(v.createdAt);
  const urgent = v.urgent ? "URGENT: " : "";
  const subject = `${urgent}New voicemail from ${who}, ${when}`;
  const email = [
    `New voicemail for ${BUSINESS_NAME}.`,
    "",
    `Caller: ${who}`,
    `Key or box: ${info.source}`,
    `Date and time: ${when}`,
    `Length: ${mmss(v.durationSec)}`,
    "",
    info.attached ? "The recording is attached as an MP3 file." : "Recording attached failed, use the link.",
    `Play it here (private link, expires in 14 days): ${info.playLink}`,
    ...(v.transcription ? ["", "Transcription:", v.transcription] : []),
    "",
    `All voicemails: ${config.baseUrl()}/admin/voicemail`,
  ].join("\n");
  const text = `${urgent}${BUSINESS_NAME}: new voicemail from ${who}, ${info.source}, ${when}, ${mmss(v.durationSec)}. Play: ${info.playLink}`;
  return { subject, email, text };
}

/** Email (with the MP3 attached) and text the box's recipients. Runs once per message (claims notified_at atomically). */
export async function notifyVoicemail(id: number): Promise<{ sent: number }> {
  const [v] = await db
    .update(schema.voicemails)
    .set({ notifiedAt: new Date() })
    .where(and(eq(schema.voicemails.id, id), isNull(schema.voicemails.notifiedAt)))
    .returning();
  if (!v) return { sent: 0 };
  const box = await boxById(v.boxId);
  const [session] = v.callSid ? await db.select({ data: schema.callSessions.data }).from(schema.callSessions).where(eq(schema.callSessions.callSid, v.callSid)).limit(1) : [];
  const phone = toE164(v.fromNumber || "");
  const [cust] = phone ? await db.select({ name: schema.customers.name }).from(schema.customers).where(eq(schema.customers.phone, phone)).limit(1) : [];
  const playLink = voicemailPlayLink(v.id);
  // The recording itself, fetched once from Twilio; if that fails the alert still goes out with the play link.
  let mp3: Buffer | null = null;
  try {
    const res = await fetchRecordingAudio(v);
    if (res) mp3 = Buffer.from(await res.arrayBuffer());
  } catch (e) {
    console.error("voicemail alert: recording download failed", e);
  }
  const alert = voicemailAlert(v, { callerName: cust?.name ?? null, source: voicemailSource(box, session?.data), playLink, attached: Boolean(mp3?.length) });
  const stamp = alertDateTime(v.createdAt).replace(/[^0-9A-Za-z]+/g, "-").replace(/-+$/, "");
  const attachments = mp3?.length ? [{ filename: `voicemail-${stamp}-${(v.fromNumber || "unknown").replace(/\D/g, "")}.mp3`, content: mp3.toString("base64") }] : [];
  let sent = 0;
  for (const to of box.notifyEmail) if ((await sendEmail(to, alert.subject, alert.email, attachments)).sent) sent++;
  // Text alerts start by themselves once Twilio approves texting. The MP3 rides along as an MMS only when the Owner
  // has turned that on (it costs more per message) and the file is small enough for carriers; the link is always there.
  if (textingActive()) {
    const mms = Boolean((await getSettings()).voicemailMms) && Boolean(mp3?.length) && mp3!.length <= MMS_AUDIO_MAX_BYTES;
    for (const to of box.notifySms) if ((await sendSms(to, alert.text, { kind: "system", event: "owner_alert", ...(mms ? { mediaUrls: [playLink] } : {}) })).sent) sent++;
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
