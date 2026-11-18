import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { INBOX_CHUNK_BYTES } from "@/lib/inbox";
import { linkPieceKey, verifyFileLink } from "@/lib/file-links";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The 30-day download link for a file too big to attach (Abraham, Nov 18, 2026). Signed; after 30 days it stops
 * working. The file comes straight from R2, piece by piece, under its own name.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = Number((await ctx.params).id);
  const u = new URL(req.url);
  if (!verifyFileLink(id, u.searchParams.get("e"), u.searchParams.get("s"))) return new Response("This download link is not valid or has expired.", { status: 404 });
  const [f] = await db.select().from(schema.inboxFiles).where(eq(schema.inboxFiles.id, id)).limit(1);
  if (!f || !f.inR2 || !f.complete) return new Response("This file is no longer available.", { status: 404 });
  const { r2Get } = await import("@/lib/r2");
  const pieces = Math.ceil(f.sizeBytes / INBOX_CHUNK_BYTES);
  let i = 0;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (i >= pieces) return controller.close();
      const r = await r2Get(linkPieceKey(id, i++));
      if (!r.ok) return controller.error(new Error("A piece of the file is missing."));
      controller.enqueue(new Uint8Array(await r.arrayBuffer()));
    },
  });
  const name = f.fileName.replace(/["\\\r\n]/g, "_");
  return new Response(stream, {
    headers: {
      "content-type": f.contentType || "application/octet-stream",
      "content-length": String(f.sizeBytes),
      "content-disposition": `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(f.fileName)}`,
      "x-robots-tag": "noindex",
      "cache-control": "private, no-store",
    },
  });
}
