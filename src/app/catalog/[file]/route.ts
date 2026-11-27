import { catalogPdfBytes, currentCatalog } from "@/lib/catalog-pdf";

export const dynamic = "force-dynamic";

/**
 * The catalog PDF on hupupattractions.com (Abraham, Nov 23, 2026): the "View our catalog" button in every catalog
 * email opens it in the browser, no sign-in.
 *
 * Abraham, Nov 27, 2026: every catalog link (/catalog/<n>.pdf, old or new, and any other /catalog/<anything> link in
 * past emails and texts) opens the CURRENT catalog, right away after a new one is uploaded in Admin. Old files stay
 * stored for the Owner (Admin, Catalog email & text, history) and are never served here. Not cached, so a replaced
 * catalog shows at once.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ file: string }> }) {
  await params; // any old link (any number or name) opens the current catalog
  const f = await currentCatalog();
  const data = f?.complete ? await catalogPdfBytes(f.id) : null;
  if (!f || !data) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
  const name = f.fileName.replace(/[^\w .()-]/g, "_");
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${name}"`,
      "Cache-Control": "no-store, max-age=0",
      "X-Robots-Tag": "noindex",
    },
  });
}
