import { eq } from "drizzle-orm";
import { currentStaff } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { catalogPdfBytes } from "@/lib/catalog-pdf";

export const dynamic = "force-dynamic";

/** Download the catalog PDF (Owner, signed in). */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await currentStaff();
  if (!s || s.role !== "owner") return new Response("Unauthorized", { status: 401 });
  const id = Number((await ctx.params).id);
  const [f] = await db.select().from(schema.catalogFiles).where(eq(schema.catalogFiles.id, id)).limit(1);
  const data = f?.complete ? await catalogPdfBytes(id) : null;
  if (!f || !data) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(data), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${f.fileName.replace(/[^\w.\- ]/g, "")}"`, "Cache-Control": "private, no-store" },
  });
}
