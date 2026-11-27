import { eq } from "drizzle-orm";
import { currentStaff } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { getOrderWithItems } from "@/lib/orders";
import { hasAnyStop } from "@/lib/drivers";
import { r2Get } from "@/lib/r2";
import { isDbId } from "@/lib/db-id";

export const dynamic = "force-dynamic";

/** A delivery or pickup photo, for signed-in staff only. A Delivery login sees photos of its own stops only. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const staff = await currentStaff();
  if (!staff) return new Response("Unauthorized", { status: 401 });
  const id = Number((await params).id);
  if (!isDbId(id)) return new Response("Not found", { status: 404 }); // deep check 0600 M56
  const [p] = await db.select().from(schema.deliveryPhotos).where(eq(schema.deliveryPhotos.id, id)).limit(1);
  if (!p) return new Response("Not found", { status: 404 });
  if (staff.role === "delivery") {
    const full = await getOrderWithItems(p.orderId);
    if (!full || !hasAnyStop(full.order, staff.userId)) return new Response("Forbidden", { status: 403 });
  }
  const r = await r2Get(p.storageKey);
  if (!r.ok || !r.body) return new Response("Photo not available", { status: 502 });
  return new Response(r.body, { headers: { "Content-Type": p.contentType, "Cache-Control": "private, max-age=3600" } });
}
