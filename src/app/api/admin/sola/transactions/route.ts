import { bridgeKeyOk, parseWhen } from "@/lib/sola-bridge";
import { solaTransactionsBetween } from "@/lib/phonepay-watch";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/sola/transactions?from=2026-11-18&to=2026-11-18 (Abraham, Nov 18, 2026). Header x-admin-api-key.
 * Approved and declined Sola charges in that time (31 days at most). Read only; the Sola key stays on the server.
 */
export async function GET(req: Request) {
  if (!bridgeKeyOk(req.headers.get("x-admin-api-key"))) return new Response("Unauthorized", { status: 401 });
  const u = new URL(req.url);
  const to = parseWhen(u.searchParams.get("to"), true) ?? new Date();
  const from = parseWhen(u.searchParams.get("from")) ?? new Date(to.getTime() - 24 * 3600_000);
  if (from > to || to.getTime() - from.getTime() > 31 * 24 * 3600_000) return Response.json({ error: "Choose a time of 31 days or less (from before to)." }, { status: 400 });
  try {
    const txns = await solaTransactionsBetween(from, to);
    return Response.json({
      from: from.toISOString(),
      to: to.toISOString(),
      transactions: txns.map((t) => ({ ref: t.refNum, amount: (t.amountCents / 100).toFixed(2), at: t.at.toISOString(), status: t.approved ? "approved" : "declined", invoice: t.invoice, last4: t.last4, cardType: t.cardType })),
    });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
