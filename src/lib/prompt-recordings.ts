import { and, asc, desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { config } from "@/lib/config";
import { PROMPTS, promptRecordable, type PromptKey } from "@/lib/ivr/prompts";

/**
 * Phone line recordings (Abraham, Phone Recordings):
 *  - Upload recording (MP3 or WAV): replaces the Google voice on that line right away.
 *  - Use Google voice: switches back. Old recordings are kept, never deleted.
 *  - Google voice recording: made with Google Text-to-Speech in the hotline voice (needs GOOGLE_TTS_API_KEY; until
 *    then "Not active yet" and the phone line keeps speaking the same Google voice live).
 * Lines with changing parts (names, emails, dates, cart totals) always stay live Google voice.
 * Stored in the database in pieces (no new paid service; Vercel takes at most 4.5 MB per request).
 */
export const RECORDING_MAX_BYTES = 10 * 1024 * 1024;
export const RECORDING_CHUNK_BYTES = 3 * 1024 * 1024;

export type Recording = typeof schema.promptRecordings.$inferSelect;

function knownRecordable(key: string): key is PromptKey {
  return key in PROMPTS && promptRecordable(key as PromptKey);
}

/** MP3 (ID3 tag or an MPEG frame) or WAV (RIFF....WAVE), from the first bytes. */
export function audioKind(head: Buffer): "audio/mpeg" | "audio/wav" | null {
  if (head.length >= 12 && head.subarray(0, 4).toString("latin1") === "RIFF" && head.subarray(8, 12).toString("latin1") === "WAVE") return "audio/wav";
  if (head.length >= 3 && head.subarray(0, 3).toString("latin1") === "ID3") return "audio/mpeg";
  if (head.length >= 2 && head[0] === 0xff && (head[1] & 0xe0) === 0xe0) return "audio/mpeg";
  return null;
}

export async function startRecordingUpload(key: string, fileName: string, sizeBytes: number, userId: number | null) {
  if (!knownRecordable(key)) throw new Error("This line has changing parts, so it stays live Google voice.");
  if (!/\.(mp3|wav)$/i.test(fileName)) throw new Error("Upload an MP3 or WAV file.");
  if (sizeBytes <= 0 || sizeBytes > RECORDING_MAX_BYTES) throw new Error("Keep the recording under 10 MB.");
  const [r] = await db
    .insert(schema.promptRecordings)
    .values({ promptKey: key, source: "upload", fileName: fileName.slice(0, 200), contentType: /\.wav$/i.test(fileName) ? "audio/wav" : "audio/mpeg", sizeBytes, createdBy: userId })
    .returning();
  return r;
}

/** One piece; the last piece checks the file and makes it the recording that plays on that line right away. */
export async function saveRecordingChunk(id: number, idx: number, data: Buffer, last: boolean, userId: number | null) {
  if (data.length === 0 || data.length > RECORDING_CHUNK_BYTES) throw new Error("That piece of the file didn't arrive.");
  const [r] = await db.select().from(schema.promptRecordings).where(eq(schema.promptRecordings.id, id)).limit(1);
  if (!r || r.complete || r.source !== "upload") throw new Error("That upload isn't open.");
  await db.insert(schema.promptRecordingChunks).values({ recordingId: id, idx, data }).onConflictDoNothing();
  if (!last) return { complete: false };
  const bytes = await recordingBytes(id);
  if (!bytes || bytes.length !== r.sizeBytes) return { complete: false };
  const kind = audioKind(bytes.subarray(0, 16));
  if (!kind) throw new Error("That file isn't an MP3 or WAV recording.");
  await db.update(schema.promptRecordings).set({ complete: true, contentType: kind }).where(eq(schema.promptRecordings.id, id));
  await chooseRecording(r.promptKey, id, userId);
  return { complete: true };
}

export async function recordingBytes(id: number): Promise<Buffer | null> {
  const chunks = await db.select().from(schema.promptRecordingChunks).where(eq(schema.promptRecordingChunks.recordingId, id)).orderBy(asc(schema.promptRecordingChunks.idx));
  return chunks.length ? Buffer.concat(chunks.map((c) => c.data)) : null;
}

export async function getRecording(id: number) {
  const [r] = await db.select().from(schema.promptRecordings).where(eq(schema.promptRecordings.id, id)).limit(1);
  return r ?? null;
}

/** Make an uploaded recording the one that plays on its line. */
export async function chooseRecording(key: string, id: number, userId: number | null) {
  const r = await getRecording(id);
  if (!r || !r.complete || r.promptKey !== key || r.source !== "upload") throw new Error("That recording can't be used on this line.");
  await db
    .insert(schema.voicePrompts)
    .values({ key, recordingId: id, updatedBy: userId })
    .onConflictDoUpdate({ target: schema.voicePrompts.key, set: { recordingId: id, updatedAt: new Date(), updatedBy: userId } });
}

/** Back to the Google voice. The uploads stay saved. */
export async function chooseGoogleVoice(key: string, userId: number | null) {
  await db.update(schema.voicePrompts).set({ recordingId: null, updatedAt: new Date(), updatedBy: userId }).where(eq(schema.voicePrompts.key, key));
}

/** Every recording, newest first, grouped by line. */
export async function recordingsByKey(): Promise<Map<string, Recording[]>> {
  const rows = await db.select().from(schema.promptRecordings).where(eq(schema.promptRecordings.complete, true)).orderBy(desc(schema.promptRecordings.createdAt));
  const out = new Map<string, Recording[]>();
  for (const r of rows) out.set(r.promptKey, [...(out.get(r.promptKey) ?? []), r]);
  return out;
}

/** The newest Google recording made from exactly this wording (older ones are kept for history). */
export async function googleRecordingFor(key: string, wording: string) {
  const [r] = await db
    .select()
    .from(schema.promptRecordings)
    .where(and(eq(schema.promptRecordings.promptKey, key), eq(schema.promptRecordings.source, "google"), eq(schema.promptRecordings.wording, wording), eq(schema.promptRecordings.complete, true)))
    .orderBy(desc(schema.promptRecordings.createdAt))
    .limit(1);
  return r ?? null;
}

export function googleTtsReady(env: Record<string, string | undefined> = process.env) {
  return Boolean(env.GOOGLE_TTS_API_KEY);
}

/** "Google.en-US-Chirp3-HD-Puck" -> "en-US-Chirp3-HD-Puck" */
export function googleVoiceName(voice = config.voice()) {
  return voice.replace(/^Google\./, "");
}

/**
 * Makes (or reuses) the Google voice recording of a line's current wording, in the hotline voice. Free tier of
 * Google Text-to-Speech; needs GOOGLE_TTS_API_KEY (a Google Cloud billing account must be on file). Returns null
 * when it isn't set up yet.
 */
export async function makeGoogleRecording(key: string, wording: string, userId: number | null, fetcher: typeof fetch = fetch) {
  if (!knownRecordable(key)) throw new Error("This line has changing parts, so it stays live Google voice.");
  const have = await googleRecordingFor(key, wording);
  if (have) return have;
  if (!googleTtsReady()) return null;
  const name = googleVoiceName();
  const res = await fetcher(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(process.env.GOOGLE_TTS_API_KEY!)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input: { text: wording }, voice: { languageCode: name.slice(0, 5), name }, audioConfig: { audioEncoding: "MP3" } }),
  });
  if (!res.ok) throw new Error(`Google voice didn't answer (${res.status}).`);
  const { audioContent } = (await res.json()) as { audioContent?: string };
  const data = Buffer.from(audioContent ?? "", "base64");
  if (!data.length) throw new Error("Google voice sent back no audio.");
  const [r] = await db
    .insert(schema.promptRecordings)
    .values({ promptKey: key, source: "google", fileName: `${key}-google.mp3`, contentType: "audio/mpeg", sizeBytes: data.length, wording, createdBy: userId })
    .returning();
  for (let i = 0; i * RECORDING_CHUNK_BYTES < data.length; i++) {
    await db.insert(schema.promptRecordingChunks).values({ recordingId: r.id, idx: i, data: data.subarray(i * RECORDING_CHUNK_BYTES, (i + 1) * RECORDING_CHUNK_BYTES) });
  }
  await db.update(schema.promptRecordings).set({ complete: true }).where(eq(schema.promptRecordings.id, r.id));
  return { ...r, complete: true };
}

/** Owner's OK for a line that was waiting for approval (it starts playing on the phone line). */
export async function approvePrompt(key: string, userId: number | null) {
  const now = new Date();
  await db
    .insert(schema.voicePrompts)
    .values({ key, approvedAt: now, approvedBy: userId, updatedBy: userId })
    .onConflictDoUpdate({ target: schema.voicePrompts.key, set: { approvedAt: now, approvedBy: userId, updatedAt: now, updatedBy: userId } });
}
