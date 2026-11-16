import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { r2Get } from "@/lib/r2";
import { verifyMessageFileLink } from "@/lib/signed-link";
import { serveHeaders } from "@/lib/message-files";

export const dynamic = "force-dynamic";

/** A file sent with a text, for Twilio to fetch (signed link, 24 hours; no sign-in). Only files staff sent. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const u = new URL(req.url);
  if (!verifyMessageFileLink(id, Number(u.searchParams.get("exp")), u.searchParams.get("sig"))) return new Response("Forbidden", { status: 403 });
  const [f] = await db.select().from(schema.messageFiles).where(eq(schema.messageFiles.id, id)).limit(1);
  if (!f || f.direction !== "out") return new Response("Not found", { status: 404 });
  const r = await r2Get(f.storageKey);
  if (!r.ok || !r.body) return new Response("File not available", { status: 502 });
  return new Response(r.body, { headers: { ...serveHeaders(f), "Cache-Control": "private, max-age=600" } });
}
