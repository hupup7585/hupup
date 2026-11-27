import { idParam } from "@/lib/id-param";
import { eq } from "drizzle-orm";
import { currentStaff } from "@/lib/auth";
import { db, schema } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Owner: a catalog item's photo served from our own site, so the Campaigns screen can turn it into a promo picture
 * (browsers can't read pictures from other sites). Only http(s) photo links from the catalog are fetched.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await currentStaff();
  if (!s || s.role !== "owner") return new Response("Unauthorized", { status: 401 });
  const [p] = await db.select({ imageUrl: schema.products.imageUrl }).from(schema.products).where(eq(schema.products.id, idParam((await params).id) ?? 0)).limit(1);
  if (!p?.imageUrl) return new Response("Not found", { status: 404 });
  // Photos stored as a path on our own site resolve against this same site.
  const url = new URL(p.imageUrl, new URL(req.url).origin);
  if (url.protocol !== "https:" && url.protocol !== "http:") return new Response("Not found", { status: 404 });
  // Extra check K7: a photo site that does not answer gives the "couldn't be loaded" answer, not a crash
  const r = await fetch(url, { redirect: "follow" }).catch(() => null);
  if (!r) return new Response("That catalog photo couldn't be loaded.", { status: 502 });
  const type = r.headers.get("content-type") ?? "";
  if (!r.ok || !/^image\/(jpeg|jpg|png|webp)/i.test(type)) return new Response("That catalog photo couldn't be loaded.", { status: 502 });
  return new Response(await r.arrayBuffer(), { headers: { "Content-Type": type, "Cache-Control": "no-store" } });
}
