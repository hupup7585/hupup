import { eq } from "drizzle-orm";
import { currentStaff } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { r2Get } from "@/lib/r2";
import { serveHeaders } from "@/lib/message-files";

export const dynamic = "force-dynamic";

/** A file sent or received with a text: Owner and Secretary only (they see the text history). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const staff = await currentStaff();
  if (!staff) return new Response("Unauthorized", { status: 401 });
  if (staff.role !== "owner" && staff.role !== "secretary") return new Response("Forbidden", { status: 403 });
  const [f] = await db.select().from(schema.messageFiles).where(eq(schema.messageFiles.id, Number((await params).id))).limit(1);
  if (!f) return new Response("Not found", { status: 404 });
  const r = await r2Get(f.storageKey);
  if (!r.ok || !r.body) return new Response("File not available", { status: 502 });
  return new Response(r.body, { headers: { ...serveHeaders(f), "Cache-Control": "private, max-age=3600" } });
}
