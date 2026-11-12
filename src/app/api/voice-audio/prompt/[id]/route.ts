import { verifyPromptRecordingLink } from "@/lib/signed-link";
import { getRecording, recordingBytes } from "@/lib/prompt-recordings";

export const dynamic = "force-dynamic";

/** A phone line recording for Twilio <Play> (signed link; recordings never change, so it caches well). */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = Number((await ctx.params).id);
  if (!verifyPromptRecordingLink(id, new URL(req.url).searchParams.get("sig"))) return new Response("Not found", { status: 404 });
  const r = await getRecording(id);
  const data = r?.complete ? await recordingBytes(id) : null;
  if (!r || !data) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(data), {
    headers: { "Content-Type": r.contentType, "Content-Length": String(data.length), "Cache-Control": "public, max-age=31536000, immutable" },
  });
}
