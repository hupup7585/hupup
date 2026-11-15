import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { verifyLiveVoiceLink } from "@/lib/signed-link";
import { recordingBytes, storeGoogleRecording, synthesize } from "@/lib/prompt-recordings";

export const dynamic = "force-dynamic";

/**
 * Option B (Abraham, Nov 15, 2026): a changing line in Achird, made by Google Text-to-Speech when Twilio fetches it,
 * then kept so the same words are never made twice. Only works while the Owner's switch is on and
 * GOOGLE_TTS_API_KEY is in Vercel (both off today). Signed links only: no one else can make audio here.
 */
const LIVE_VOICE = "en-US-Chirp3-HD-Achird";

export async function GET(req: Request) {
  const u = new URL(req.url);
  const text = verifyLiveVoiceLink(u.searchParams.get("t"), u.searchParams.get("sig"));
  if (!text) return new Response("Forbidden", { status: 403 });
  if (!(await getSettings()).googleLiveVoice || !process.env.GOOGLE_TTS_API_KEY) return new Response("Not active yet", { status: 404 });
  const key = `live:${createHash("sha256").update(`${LIVE_VOICE}|${text}`).digest("hex").slice(0, 40)}`;
  const [have] = await db
    .select({ id: schema.promptRecordings.id })
    .from(schema.promptRecordings)
    .where(and(eq(schema.promptRecordings.promptKey, key), eq(schema.promptRecordings.complete, true)))
    .orderBy(desc(schema.promptRecordings.id))
    .limit(1);
  let audio = have ? await recordingBytes(have.id) : null;
  if (!audio) {
    try {
      audio = await synthesize(text, LIVE_VOICE);
      await storeGoogleRecording(key, `${key.slice(5, 17)}.mp3`, text, audio, null);
    } catch {
      return new Response("Voice not available", { status: 502 });
    }
  }
  return new Response(new Uint8Array(audio), { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "public, max-age=86400" } });
}
