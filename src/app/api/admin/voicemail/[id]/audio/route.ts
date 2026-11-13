import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { currentStaff } from "@/lib/auth";
import { fetchRecordingAudio } from "@/lib/voicemail";

export const dynamic = "force-dynamic";

/** Play or download a voicemail (Owner and Secretary). The audio is fetched from Twilio on the server. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const staff = await currentStaff();
  if (!staff) return new Response("Unauthorized", { status: 401 });
  if (staff.role === "delivery") return new Response("Forbidden", { status: 403 });
  const id = Number((await ctx.params).id);
  const [v] = Number.isInteger(id) ? await db.select().from(schema.voicemails).where(eq(schema.voicemails.id, id)).limit(1) : [];
  // Deleted messages are hidden, not gone: only the Owner can still play them, until deleted for good
  if (!v || v.purgedAt || (v.deletedAt && staff.role !== "owner")) return new Response("Not found", { status: 404 });
  const audio = await fetchRecordingAudio(v);
  if (!audio?.body) return new Response("Recording unavailable", { status: 502 });
  const download = new URL(req.url).searchParams.has("download");
  const stamp = v.createdAt.toISOString().slice(0, 16).replace(/[:T]/g, "-");
  return new Response(audio.body, {
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "private, no-store",
      ...(download ? { "Content-Disposition": `attachment; filename="voicemail-${stamp}-${(v.fromNumber || "unknown").replace(/\D/g, "")}.mp3"` } : {}),
    },
  });
}
