import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { fetchRecordingAudio } from "@/lib/voicemail";
import { verifyVoicemailLink } from "@/lib/signed-link";

export const dynamic = "force-dynamic";

/** Private play link from a voicemail alert (signed, expires). Also the MMS media link Twilio fetches. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = Number((await ctx.params).id);
  const q = new URL(req.url).searchParams;
  if (!verifyVoicemailLink(id, q.get("exp"), q.get("sig"))) return new Response("This link has expired. Open the voicemail in Admin.", { status: 403 });
  const [v] = await db.select().from(schema.voicemails).where(eq(schema.voicemails.id, id)).limit(1);
  if (!v || v.deletedAt) return new Response("Not found", { status: 404 });
  const audio = await fetchRecordingAudio(v);
  if (!audio?.body) return new Response("Recording unavailable", { status: 502 });
  return new Response(audio.body, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "private, no-store", "Content-Disposition": `inline; filename="voicemail-${id}.mp3"` } });
}
