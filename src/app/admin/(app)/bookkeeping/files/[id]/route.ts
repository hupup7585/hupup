import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { currentStaff } from "@/lib/auth";
import { canUseBooks } from "@/lib/books";

export const dynamic = "force-dynamic";

/** Receipts and tax-exempt certificates: Owner only (or a user with the bookkeeping permission). Never public. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await currentStaff();
  if (!s || !(await canUseBooks(s))) return new Response("Not allowed", { status: 403 });
  const [f] = await db.select().from(schema.bookFiles).where(eq(schema.bookFiles.id, Number((await ctx.params).id)));
  if (!f) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(f.data), {
    headers: {
      "Content-Type": f.contentType,
      "Content-Disposition": `inline; filename="${f.name.replace(/[^\w.\- ]/g, "_")}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
