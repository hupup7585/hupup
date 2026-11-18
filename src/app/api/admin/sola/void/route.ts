import { db, schema } from "@/lib/db";
import { bridgeKeyOk } from "@/lib/sola-bridge";
import { solaVoid } from "@/lib/sola-phonepay";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/sola/void with JSON {"ref": "123456789"} (Abraham, Nov 18, 2026). Header x-admin-api-key.
 * Voids one Sola charge (cc:void). No new charges, ever. Every call is in the audit log.
 */
export async function POST(req: Request) {
  if (!bridgeKeyOk(req.headers.get("x-admin-api-key"))) return new Response("Unauthorized", { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { ref?: unknown };
  const ref = String(body.ref ?? "").trim();
  if (!/^\d{3,20}$/.test(ref)) return Response.json({ error: "Send the Sola reference number as ref." }, { status: 400 });
  const r = await solaVoid(ref);
  await db.insert(schema.auditLog).values({ userId: null, action: r.ok ? "sola.bridge_void" : "sola.bridge_void_failed", entityType: "sola_charge", entityId: ref, after: { error: r.error } });
  return Response.json({ ref, voided: r.ok, error: r.error }, { status: r.ok ? 200 : 502 });
}
