import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { currentStaff } from "@/lib/auth";
import { fetchRecordingAudio } from "@/lib/voicemail";

export const dynamic = "force-dynamic";

/** Play a caller's spoken answer (speech to text) from the order page. Owner and Secretary; audio fetched from Twilio. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const staff = await currentStaff();
  if (!staff) return new Response("Unauthorized", { status: 401 });
  if (staff.role === "delivery") return new Response("Forbidden", { status: 403 });
  const id = Number((await ctx.params).id);
  const [a] = Number.isInteger(id) ? await db.select().from(schema.spokenAnswers).where(eq(schema.spokenAnswers.id, id)).limit(1) : [];
  if (!a?.recordingUrl) return new Response("Not found", { status: 404 });
  const audio = await fetchRecordingAudio({ recordingUrl: a.recordingUrl });
  if (!audio?.body) return new Response("Recording unavailable", { status: 502 });
  return new Response(audio.body, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "private, no-store" } });
}
