import { r2Get } from "@/lib/r2";

export const dynamic = "force-dynamic";

/**
 * Music pieces the Owner uploaded (Abraham, Nov 17, 2026), fetched by Twilio while a caller waits. Public, but only
 * for keys under music/ (never photos or message files).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const key = (await params).key.join("/");
  if (!/^music\/\d+\/\d+\.wav$/.test(key)) return new Response("Not found", { status: 404 });
  // Extra check HP10 (Nov 27, 2026): storage not set up or not answering is "not found", never a 500 to Twilio
  const r = await r2Get(key).catch(() => null);
  if (!r) return new Response("Not found", { status: 404 });
  if (!r.ok || !r.body) return new Response("Not found", { status: 404 });
  return new Response(r.body, { headers: { "Content-Type": "audio/wav", "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" } });
}
