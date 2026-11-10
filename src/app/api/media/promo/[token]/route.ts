import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";

export const dynamic = "force-dynamic";

/** The phone-ready promo picture, by its unguessable token (Twilio fetches this for the MMS). */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const token = (await params).token.replace(/\.jpg$/i, "");
  if (!/^[A-Za-z0-9_-]{20,40}$/.test(token)) return new Response("Not found", { status: 404 });
  const [p] = await db.select({ jpg: schema.promoPictures.jpg }).from(schema.promoPictures).where(eq(schema.promoPictures.token, token)).limit(1);
  if (!p) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(p.jpg), { headers: { "Content-Type": "image/jpeg", "Content-Length": String(p.jpg.length), "Cache-Control": "public, max-age=31536000, immutable" } });
}
