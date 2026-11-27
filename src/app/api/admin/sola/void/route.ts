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
  const orders = r.ok ? await recordVoidOnOrders(ref) : [];
  return Response.json({ ref, voided: r.ok, error: r.error, orders }, { status: r.ok ? 200 : 502 });
}

/**
 * Hark's Admin list 10 / backend 8 (Nov 26, 2026): a voided charge is taken off its order(s) like a refund: the order
 * shows it refunded, Bookkeeping gets the money out, and it is in the audit log. No order found: the Owner is emailed.
 */
async function recordVoidOnOrders(ref: string): Promise<number[]> {
  const { and, eq, or } = await import("drizzle-orm");
  const paidOn = await db
    .select({ orderId: schema.bookEntries.orderId, cents: schema.bookEntries.amountCents })
    .from(schema.bookEntries)
    .where(and(eq(schema.bookEntries.ref, ref), eq(schema.bookEntries.kind, "income")));
  const byRef = await db.select().from(schema.orders).where(or(eq(schema.orders.solaRefNum, ref)));
  const ids = [...new Set([...paidOn.map((p) => p.orderId).filter((x): x is number => x !== null), ...byRef.map((o) => o.id)])];
  if (!ids.length) {
    const to = process.env.ADMIN_EMAIL;
    if (to) {
      const { sendEmail } = await import("@/lib/notify");
      await sendEmail(to, `Hup Up Attractions: Sola charge ${ref} was voided, no order found`, `The Sola charge with reference ${ref} was voided, but no order in Admin has that payment. Please check it in Sola and in Bookkeeping.`).catch(() => null);
    }
    return [];
  }
  const { applyRefund } = await import("@/lib/refunds");
  for (const id of ids) {
    const [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, id));
    if (!o) continue;
    const cents = paidOn.filter((p) => p.orderId === id).reduce((n, p) => n + p.cents, 0) || Math.max(0, o.paidCents - o.refundedCents);
    if (cents > 0) await applyRefund(o, { amountCents: cents, refundId: `sola-void:${ref}:${id}`, provider: "sola", source: "admin", userId: null });
  }
  return ids;
}
