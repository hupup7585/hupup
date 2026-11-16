import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { r2Get } from "@/lib/r2";
import { verifyDeliveryPhotoLink } from "@/lib/signed-link";

export const dynamic = "force-dynamic";

/** A delivery photo for a picture text (Twilio fetches it). Signed link, 30 minutes only; no sign-in. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const u = new URL(req.url);
  if (!verifyDeliveryPhotoLink(id, Number(u.searchParams.get("exp")), u.searchParams.get("sig"))) return new Response("Forbidden", { status: 403 });
  const [p] = await db.select().from(schema.deliveryPhotos).where(eq(schema.deliveryPhotos.id, id)).limit(1);
  if (!p) return new Response("Not found", { status: 404 });
  const r = await r2Get(p.storageKey);
  if (!r.ok || !r.body) return new Response("Photo not available", { status: 502 });
  return new Response(r.body, { headers: { "Content-Type": p.contentType, "Cache-Control": "private, max-age=600" } });
}
