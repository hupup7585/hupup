import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { catalogPdfBytes } from "@/lib/catalog-pdf";

/**
 * The catalog PDF on hupupattractions.com (Abraham, Nov 23, 2026): the "View the catalog" button in every catalog
 * email opens it in the browser, no sign-in. /catalog/12.pdf = uploaded catalog 12, so an older email still opens the
 * catalog it was sent with.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ file: string }> }) {
  const m = /^(\d{1,9})\.pdf$/i.exec((await params).file);
  if (!m) return new Response("Not found", { status: 404 });
  const [f] = await db
    .select()
    .from(schema.catalogFiles)
    .where(and(eq(schema.catalogFiles.id, Number(m[1])), eq(schema.catalogFiles.complete, true)))
    .limit(1);
  const data = f ? await catalogPdfBytes(f.id) : null;
  if (!f || !data) return new Response("Not found", { status: 404 });
  const name = f.fileName.replace(/[^\w .()-]/g, "_");
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${name}"`,
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
      "X-Robots-Tag": "noindex",
    },
  });
}
