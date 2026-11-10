import { currentStaff } from "@/lib/auth";
import { originalOf } from "@/lib/promo-pictures";

export const dynamic = "force-dynamic";

/** Owner: download the full-size original of a promo picture (kept for the website and Rentals page). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await currentStaff();
  if (!s || s.role !== "owner") return new Response("Unauthorized", { status: 401 });
  const o = await originalOf(Number((await params).id));
  if (!o) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(o.data), { headers: { "Content-Type": o.type, "Content-Disposition": `attachment; filename="promo-original-${(await params).id}.${o.type === "image/png" ? "png" : "jpg"}"` } });
}
