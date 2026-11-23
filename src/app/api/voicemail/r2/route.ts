import { r2Get } from "@/lib/r2";
import { verifyR2AudioLink } from "@/lib/vm-audio";

/** A voicemail piece, greeting, name or note from R2, for Twilio to play (signed link, Nov 23, 2026). */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const key = u.searchParams.get("k") ?? "";
  if (!verifyR2AudioLink(key, u.searchParams.get("exp"), u.searchParams.get("sig"))) return new Response("Not found", { status: 404 });
  const r = await r2Get(key).catch(() => null);
  if (!r?.ok || !r.body) return new Response("Not found", { status: 404 });
  return new Response(r.body, { headers: { "content-type": "audio/wav", "cache-control": "private, max-age=600" } });
}
