import { r2Get } from "@/lib/r2";

export const dynamic = "force-dynamic";

/**
 * Catalog photos uploaded in Admin (Abraham, Nov 17, 2026): kept in Cloudflare R2 and shown on the website, so this
 * route is public, but only for keys under catalog/ (never delivery photos or text files).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const key = (await params).key.join("/");
  if (!/^catalog\/(products|categories|text)\/[a-z0-9-]+\.(jpg|png|webp)$/.test(key)) return new Response("Not found", { status: 404 });
  const r = await r2Get(key);
  if (!r.ok || !r.body) return new Response("Not found", { status: 404 });
  const type = key.endsWith(".png") ? "image/png" : key.endsWith(".webp") ? "image/webp" : "image/jpeg";
  return new Response(r.body, { headers: { "Content-Type": type, "Cache-Control": "public, max-age=86400", "X-Content-Type-Options": "nosniff" } });
}
