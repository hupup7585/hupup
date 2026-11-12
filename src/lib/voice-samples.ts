import { and, desc, eq, like } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { googleTtsReady, storeGoogleRecording, synthesize } from "@/lib/prompt-recordings";

/**
 * Voice samples for Abraham to pick the hotline voice (Nov 12, 2026). Listening only: nothing here changes IVR_VOICE
 * or any live phone line. Made with the same Google Text-to-Speech setup as the pre-recorded lines. Seven samples of
 * about 160 characters each (about 1,100 characters in all), inside Google's free monthly allowance.
 */
export const VOICE_SAMPLE_TEXT =
  "Hi! Thank you for calling Hup Up Attractions! Bringing something special to every occasion! If you know your desired extension, you may press it at any time.";

export const VOICE_SAMPLE_VOICES = [
  "en-US-Chirp3-HD-Sadachbia",
  "en-US-Chirp3-HD-Zubenelgenubi",
  "en-US-Chirp3-HD-Umbriel",
  "en-US-Chirp3-HD-Algieba",
  "en-US-Chirp3-HD-Puck",
  "en-US-Chirp3-HD-Fenrir",
  "en-US-Chirp3-HD-Achird",
] as const;

const KEY_PREFIX = "voice-sample:";
export const sampleKey = (voice: string) => `${KEY_PREFIX}${voice}`;
/** voice-sample-sadachbia.mp3 */
export const sampleFileName = (voice: string) => `voice-sample-${voice.split("-").pop()!.toLowerCase()}.mp3`;

/** The newest sample for each voice (only ones made from the exact sample text). */
export async function voiceSamples() {
  const rows = await db
    .select()
    .from(schema.promptRecordings)
    .where(and(like(schema.promptRecordings.promptKey, `${KEY_PREFIX}%`), eq(schema.promptRecordings.complete, true)))
    .orderBy(desc(schema.promptRecordings.createdAt));
  return VOICE_SAMPLE_VOICES.map((voice) => ({ voice, fileName: sampleFileName(voice), recording: rows.find((r) => r.promptKey === sampleKey(voice) && r.wording === VOICE_SAMPLE_TEXT) ?? null }));
}

/** Makes the samples that don't exist yet. Returns null when Google Text-to-Speech isn't set up (Not active yet). */
export async function makeVoiceSamples(userId: number | null, fetcher: typeof fetch = fetch) {
  if (!googleTtsReady()) return null;
  let made = 0;
  for (const s of await voiceSamples()) {
    if (s.recording) continue;
    const data = await synthesize(VOICE_SAMPLE_TEXT, s.voice, fetcher);
    await storeGoogleRecording(sampleKey(s.voice), s.fileName, VOICE_SAMPLE_TEXT, data, userId);
    made++;
  }
  return made;
}
