import { eq } from "drizzle-orm";
import { after } from "next/server";
import { db, schema } from "@/lib/db";

/**
 * Spoken answers: record what the caller says, type it up with Google Speech-to-Text, read it back (Abraham, Nov 13,
 * 2026). PREVIEW ONLY: on the live line callers keep today's spoken answers until Abraham approves the price per call
 * (STT_LIVE_APPROVED). Uses the V1 API (Abraham, Nov 13: V1 with data logging on, $0.016 a minute, first 60 minutes a
 * month free; data logging is switched on in the Google Cloud console). Needs a Google key with the Cloud Speech-to-Text API allowed: GOOGLE_STT_API_KEY, or the same
 * GOOGLE_TTS_API_KEY if both APIs are ticked on it.
 */
export const STT_LIVE_APPROVED = false;

export function sttKey(env: Record<string, string | undefined> = process.env) {
  return env.GOOGLE_STT_API_KEY || env.GOOGLE_TTS_API_KEY || null;
}

export function sttActive(env: Record<string, string | undefined> = process.env) {
  if (!sttKey(env)) return false;
  return STT_LIVE_APPROVED || env.VERCEL_ENV !== "production";
}

/** Google Speech-to-Text (phone call model): the words, or "" when nothing was understood. */
export async function recognize(audio: Buffer, hints: string[], fetcher: typeof fetch = fetch): Promise<string> {
  const key = sttKey();
  if (!key) throw new Error("Speech to text isn't set up.");
  const res = await fetcher(`https://speech.googleapis.com/v1/speech:recognize?key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      config: { languageCode: "en-US", model: "phone_call", useEnhanced: true, speechContexts: hints.length ? [{ phrases: hints.slice(0, 500) }] : undefined },
      audio: { content: audio.toString("base64") },
    }),
  });
  if (!res.ok) throw new Error(`Speech to text answered ${res.status}`);
  const j = (await res.json()) as { results?: { alternatives?: { transcript?: string }[] }[] };
  return (j.results ?? []).map((r) => r.alternatives?.[0]?.transcript ?? "").join(" ").replace(/\s+/g, " ").trim();
}

/** The recording from Twilio (WAV), with the account's credentials. Only api.twilio.com is ever fetched. */
export async function fetchRecordingWav(recordingUrl: string, fetcher: typeof fetch = fetch): Promise<Buffer | null> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return null;
  if (new URL(recordingUrl).hostname !== "api.twilio.com") return null;
  const res = await fetcher(`${recordingUrl.replace(/\.(mp3|wav)$/, "")}.wav`, { headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}` } });
  return res.ok ? Buffer.from(await res.arrayBuffer()) : null;
}

/** Type up one spoken answer (runs while the caller hears the hold clip). */
export async function transcribeAnswer(id: number, hints: string[], fetcher?: typeof fetch) {
  const [row] = await db.select().from(schema.spokenAnswers).where(eq(schema.spokenAnswers.id, id)).limit(1);
  if (!row || row.status !== "pending" || !row.recordingUrl) return;
  try {
    // Twilio may need a moment before the file is ready
    let wav: Buffer | null = null;
    for (let i = 0; i < 4 && !wav; i++) {
      wav = await fetchRecordingWav(row.recordingUrl, fetcher);
      if (!wav) await new Promise((r) => setTimeout(r, 400));
    }
    if (!wav) throw new Error("recording not available");
    const text = await recognize(wav, hints, fetcher);
    await db.update(schema.spokenAnswers).set({ text, status: "done" }).where(eq(schema.spokenAnswers.id, id));
  } catch (e) {
    await db.update(schema.spokenAnswers).set({ status: "failed", error: (e as Error).message.slice(0, 200) }).where(eq(schema.spokenAnswers.id, id));
  }
}

/** The spoken answers recorded on one call (the order page shows them with a play button). */
export async function spokenAnswersFor(callSid: string | null) {
  if (!callSid) return [];
  return db.select().from(schema.spokenAnswers).where(eq(schema.spokenAnswers.callSid, callSid)).orderBy(schema.spokenAnswers.id);
}

/** Run work after the reply is sent (Next.js after()); outside a request (tests) it just starts. */
export function runLater(fn: () => Promise<unknown>) {
  try {
    after(fn);
  } catch {
    void fn().catch(() => {});
  }
}

/** The soft hold clip played while the answer is typed up (made for us, no music rights involved). */
export const STT_HOLD_FILE = "/audio/stt-hold.wav";
/** How many hold clips (about 4 seconds each) before we give up and ask again. */
export const STT_MAX_WAITS = 4;
