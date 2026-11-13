import { and, desc, eq, isNotNull, isNull, lt, sql } from "drizzle-orm";
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

/** The voicemail box for a main-menu key (2, 4, 5, 6, 8, and 9 for feedback), made on first use with the Main box's alert recipients. Key 0 uses the Main box. */
export async function boxForKey(key: string | null | undefined, name?: string): Promise<VoicemailBox> {
  if (!key || !["2", "4", "5", "6", "8", "9"].includes(key)) return mainBox();
  const { EXTENSION_NUMBER } = await import("@/lib/ivr/routing");
  const label = `Extension ${EXTENSION_NUMBER[key as "4"] ?? key}${name ? `, ${name}` : ""}`;
  const [found] = await db.select().from(schema.voicemailBoxes).where(eq(schema.voicemailBoxes.extensionKey, key)).limit(1);
  if (found) {
    if (name && found.name !== label) {
      const [renamed] = await db.update(schema.voicemailBoxes).set({ name: label }).where(eq(schema.voicemailBoxes.id, found.id)).returning();
      return renamed ?? found;
    }
    return found;
  }
  const main = await mainBox();
  const [created] = await db
    .insert(schema.voicemailBoxes)
    .values({ name: label, extensionKey: key, transcribe: main.transcribe, maxLengthSec: main.maxLengthSec, notifySms: main.notifySms, notifyEmail: main.notifyEmail })
    .onConflictDoNothing({ target: schema.voicemailBoxes.extensionKey })
    .returning();
  if (created) return created;
  const [again] = await db.select().from(schema.voicemailBoxes).where(eq(schema.voicemailBoxes.extensionKey, key)).limit(1);
  return again;
}

/** Note on the alert when the caller pressed # and then hung up without pressing 1 (Abraham, word for word). */
export const HUNG_UP_UNCONFIRMED_NOTE = "The customer hung up without confirming or deleting this message.";

export type RecordingState = "recording" | "reviewing" | "submitted" | "replaced";

/** Send the alert once the message is submitted, the audio file is ready and any transcription is back. */
export async function maybeNotify(id: number) {
  const [v] = await db.select().from(schema.voicemails).where(eq(schema.voicemails.id, id)).limit(1);
  if (!v || v.state !== "submitted" || !v.ready || v.deletedAt || v.notifiedAt || v.transcriptionStatus === "pending") return { sent: 0 };
  return notifyVoicemail(id);
}

/**
 * The caller finished recording (the Record action: # pressed, silence, or hang-up). Saves the message with the
 * caller's state; the audio file may not be ready yet (the status callback marks it ready).
 */
export async function recordingFinished(input: { boxId: number; callSid: string | null; from: string | null; recordingSid: string; recordingUrl: string; durationSec: number; transcribe: boolean; state: RecordingState }) {
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
      state: input.state,
      ready: false,
    })
    .onConflictDoNothing({ target: schema.voicemails.recordingSid })
    .returning();
  if (row) return row;
  // The status callback got here first (the file is ready): only move the state forward.
  const [updated] = await db.update(schema.voicemails).set({ state: input.state }).where(and(eq(schema.voicemails.recordingSid, input.recordingSid), sql`${schema.voicemails.state} in ('recording','reviewing')`)).returning();
  if (updated) await maybeNotify(updated.id);
  return updated ?? null;
}

/** The caller's choice in the review menu: 1 sends it, 3 replaces it with a new recording. */
export async function setRecordingState(recordingSid: string, state: RecordingState, note?: string | null) {
  const [row] = await db
    .update(schema.voicemails)
    .set({ state, ...(note !== undefined ? { note } : {}) })
    .where(and(eq(schema.voicemails.recordingSid, recordingSid), sql`${schema.voicemails.state} in ('recording','reviewing')`))
    .returning();
  if (row) await maybeNotify(row.id);
  return row ?? null;
}

/**
 * The call ended: anything the caller didn't decide is kept as a submitted voicemail, so no message is ever lost.
 * Pressed # and hung up without pressing 1 gets Abraham's note on the alert. Returns how many messages were kept.
 */
export async function finalizeCallRecordings(callSid: string): Promise<number> {
  const rows = await db.select().from(schema.voicemails).where(eq(schema.voicemails.callSid, callSid));
  let kept = 0;
  for (const r of rows) {
    if (r.state === "replaced") continue;
    kept++;
    if (r.state === "recording" || r.state === "reviewing") {
      await db
        .update(schema.voicemails)
        .set({ state: "submitted", note: r.state === "reviewing" ? HUNG_UP_UNCONFIRMED_NOTE : r.note })
        .where(and(eq(schema.voicemails.id, r.id), sql`${schema.voicemails.state} in ('recording','reviewing')`));
      await maybeNotify(r.id);
    }
  }
  return kept;
}

/**
 * Twilio recording status callback (the audio file is ready). Idempotent on RecordingSid (Twilio retries).
 * A message the caller is still deciding on waits; one from a call that already ended is kept as submitted.
 */
export async function saveRecording(input: { boxId: number; callSid: string | null; from: string | null; recordingSid: string; recordingUrl: string; durationSec: number; transcribe: boolean; callEnded?: boolean }) {
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
      state: input.callEnded === false ? "recording" : "submitted",
      ready: true,
    })
    .onConflictDoNothing({ target: schema.voicemails.recordingSid })
    .returning();
  if (row) {
    await maybeNotify(row.id);
    return row;
  }
  const [updated] = await db
    .update(schema.voicemails)
    .set({ ready: true, recordingUrl: input.recordingUrl, durationSec: input.durationSec })
    .where(eq(schema.voicemails.recordingSid, input.recordingSid))
    .returning();
  if (updated) await maybeNotify(updated.id);
  return updated ?? null;
}

/** Twilio transcription callback: store the text, then notify (once). */
export async function saveTranscription(recordingSid: string, status: string, text: string | null) {
  const [row] = await db
    .update(schema.voicemails)
    .set({ transcription: text?.trim() || null, transcriptionStatus: status === "completed" ? "completed" : "failed" })
    .where(eq(schema.voicemails.recordingSid, recordingSid))
    .returning();
  if (row) await maybeNotify(row.id);
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
  v: Pick<Voicemail, "fromNumber" | "durationSec" | "transcription" | "urgent" | "createdAt"> & { note?: string | null },
  info: { callerName?: string | null; box: string; playLink: string; attached: boolean },
): VoicemailAlert {
  const caller = v.fromNumber ? formatPhone(v.fromNumber) : "a withheld number";
  const who = info.callerName ? `${info.callerName} ${caller}` : caller;
  const when = alertWhen(v.createdAt);
  const urgent = v.urgent ? "URGENT: " : "";
  // Abraham: the box first, so it's seen right away.
  const subject = `${urgent}New voicemail - ${info.box} - ${caller}`;
  const email = [
    `New voicemail on ${info.box}.`,
    "",
    `Caller: ${who}`,
    `Date and time: ${when} (Eastern)`,
    `Length: ${mmss(v.durationSec)}`,
    ...(v.note ? ["", v.note] : []),
    "",
    info.attached ? "The recording is attached as an MP3 file." : "Recording attached failed, use the link.",
    `Play it here (private link, expires in 14 days): ${info.playLink}`,
    ...(v.transcription ? ["", "Transcription:", v.transcription] : []),
    "",
    `All voicemails: ${config.baseUrl()}/admin/voicemail`,
  ].join("\n");
  const text = `${urgent}${BUSINESS_NAME}: New voicemail on ${info.box}, from ${caller}, ${when}, ${mmss(v.durationSec)} long.${v.note ? ` ${v.note}` : ""} Play: ${info.playLink}`;
  return { subject, email, text };
}

/** "Nov 10, 2026 at 3:15 PM" in New York time. */
export function alertWhen(d: Date): string {
  const tz = process.env.BUSINESS_TIMEZONE || "America/New_York";
  const date = d.toLocaleDateString("en-US", { timeZone: tz, month: "short", day: "numeric", year: "numeric" });
  const time = d.toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });
  return `${date} at ${time}`;
}

/** The box as shown in alerts: "Extension 4, Customer Service"; the general box is extension 0 (Operator). */
export async function boxLabel(box: Pick<VoicemailBox, "isMain" | "extensionKey" | "name">): Promise<string> {
  const { extensionLabel } = await import("@/lib/ivr/routing");
  const s = await getSettings();
  const k = box.extensionKey ?? (box.isMain ? "0" : null);
  if (k && ["0", "2", "4", "5", "6", "8", "9"].includes(k)) return extensionLabel(s, k as "0");
  return box.name;
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
  void session;
  const alert = voicemailAlert(v, { callerName: cust?.name ?? null, box: await boxLabel(box), playLink, attached: Boolean(mp3?.length) });
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
  // Undecided messages from calls whose hang-up never reached us: keep them (never lose a message).
  const stuck = await db
    .select({ callSid: schema.voicemails.callSid })
    .from(schema.voicemails)
    .where(and(sql`${schema.voicemails.state} in ('recording','reviewing')`, lt(schema.voicemails.createdAt, sql`now() - interval '15 minutes'`)));
  for (const r of stuck) if (r.callSid) await finalizeCallRecordings(r.callSid);
  await db.update(schema.voicemails).set({ ready: true }).where(and(eq(schema.voicemails.ready, false), lt(schema.voicemails.createdAt, sql`now() - interval '15 minutes'`)));
  const rows = await db
    .select({ id: schema.voicemails.id })
    .from(schema.voicemails)
    .where(and(isNull(schema.voicemails.notifiedAt), isNull(schema.voicemails.deletedAt), eq(schema.voicemails.state, "submitted"), lt(schema.voicemails.createdAt, sql`now() - interval '15 minutes'`)));
  let n = 0;
  for (const r of rows) n += (await notifyVoicemail(r.id)).sent ? 1 : 0;
  return n;
}

export async function listVoicemails(boxId?: number) {
  return db
    .select()
    .from(schema.voicemails)
    .where(and(boxId ? eq(schema.voicemails.boxId, boxId) : undefined, isNull(schema.voicemails.deletedAt), eq(schema.voicemails.state, "submitted")))
    .orderBy(desc(schema.voicemails.urgent), desc(schema.voicemails.createdAt))
    .limit(500);
}

export async function unheardCount() {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.voicemails)
    .where(and(isNull(schema.voicemails.heardAt), isNull(schema.voicemails.deletedAt), eq(schema.voicemails.state, "submitted")));
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

/** Delete (Owner and Secretary): hide the message from the list. The recording is kept (Abraham, Nov 13, 2026). */
export async function deleteVoicemail(id: number) {
  const [v] = await db.update(schema.voicemails).set({ deletedAt: new Date() }).where(eq(schema.voicemails.id, id)).returning();
  return Boolean(v);
}

/** Show a hidden message again (Owner). */
export async function restoreVoicemail(id: number) {
  const [v] = await db.update(schema.voicemails).set({ deletedAt: null }).where(and(eq(schema.voicemails.id, id), isNull(schema.voicemails.purgedAt))).returning();
  return Boolean(v);
}

/** Delete for good (Owner only, after a confirm step): remove the recording from Twilio. */
export async function purgeVoicemail(id: number) {
  const [v] = await db.select().from(schema.voicemails).where(eq(schema.voicemails.id, id)).limit(1);
  if (!v || v.purgedAt) return false;
  try {
    await getTwilio()?.recordings(v.recordingSid).remove();
  } catch (e) {
    console.error("[voicemail] Twilio recording delete failed:", e);
    return false;
  }
  await db.update(schema.voicemails).set({ purgedAt: new Date(), deletedAt: v.deletedAt ?? new Date() }).where(eq(schema.voicemails.id, id));
  return true;
}

/** Hidden messages the Owner can show again or delete for good. */
export async function hiddenVoicemails() {
  return db
    .select()
    .from(schema.voicemails)
    .where(and(isNotNull(schema.voicemails.deletedAt), isNull(schema.voicemails.purgedAt), eq(schema.voicemails.state, "submitted")))
    .orderBy(desc(schema.voicemails.deletedAt))
    .limit(500);
}
