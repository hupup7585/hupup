import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { verifyNameVoiceLink } from "@/lib/signed-link";
import { recordingBytes, storeGoogleRecording, synthesize } from "@/lib/prompt-recordings";

export const dynamic = "force-dynamic";

/**
 * A household name in the hotline voice (Puck) at the Owner's name speed (Abraham, Nov 25, 2026, 12:36). Made by Google
 * the first time Twilio asks, then kept, so the same name at the same speed is never made twice. Signed links only.
 */
const VOICE = "en-US-Chirp3-HD-Puck";

export async function GET(req: Request) {
  const u = new URL(req.url);
  const v = verifyNameVoiceLink(u.searchParams.get("t"), u.searchParams.get("r"), u.searchParams.get("sig"));
  if (!v) return new Response("Forbidden", { status: 403 });
  if (!process.env.GOOGLE_TTS_API_KEY) return new Response("Not active yet", { status: 404 });
  const key = `name:${createHash("sha256").update(`${VOICE}|${v.rate.toFixed(2)}|${v.text}`).digest("hex").slice(0, 40)}`;
  const [have] = await db
    .select({ id: schema.promptRecordings.id })
    .from(schema.promptRecordings)
    .where(and(eq(schema.promptRecordings.promptKey, key), eq(schema.promptRecordings.complete, true)))
    .orderBy(desc(schema.promptRecordings.id))
    .limit(1);
  let audio = have ? await recordingBytes(have.id) : null;
  if (!audio) {
    try {
      audio = await synthesize(v.text, VOICE, fetch, v.rate);
      await storeGoogleRecording(key, `${key.slice(5, 17)}.mp3`, v.text, audio, null);
    } catch {
      return new Response("Voice not available", { status: 502 });
    }
  }
  return new Response(new Uint8Array(audio), { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "public, max-age=86400" } });
}
