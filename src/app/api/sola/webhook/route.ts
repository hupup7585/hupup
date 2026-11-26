import { field, isApproved, isSaleCommand, last4Of, orderIdFromInvoice, paymentResultOf, verifyWebhookSignature } from "@/lib/sola";
import { paymentReceivedNotices, recordPaymentResult } from "@/lib/payment-result";
import { getPaymentGroup, markGroupPaid } from "@/lib/orders";
import { linkPaymentToAcceptance } from "@/lib/rental-terms";
import { parseMoneyToCents } from "@/lib/money";
import { alertOwner, withCallbackAlert } from "@/lib/ops-alerts";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

/**
 * A payment Sola already told us about (gap review, Nov 26, 2026): any earlier approved notice with the same Sola
 * reference, not only the latest one on the order, so a repeat of an older payment is never counted twice.
 */
async function alreadyApproved(ref: string | null): Promise<boolean> {
  if (!ref) return false;
  const r = await db.execute(sql`SELECT 1 FROM audit_log WHERE action = 'payment.approved' AND after->>'solaRef' = ${ref} LIMIT 1`);
  return r.rows.length > 0;
}

export const dynamic = "force-dynamic";

/** Sola Payments (Cardknox) transaction webhook. A failure emails the Owner and returns 500 so Sola sends it again. */
export async function POST(req: Request) {
  return withCallbackAlert("Sola", () => handle(req));
}

async function handle(req: Request): Promise<Response> {
  const raw = await req.text();
  const fields: Record<string, string> = {};
  new URLSearchParams(raw).forEach((v, k) => {
    fields[k] = v;
  });

  const pin = process.env.SOLA_WEBHOOK_PIN;
  if (!pin) {
    console.error("SOLA_WEBHOOK_PIN not set - rejecting webhook");
    return new Response("Webhook PIN not configured", { status: 503 });
  }
  if (!verifyWebhookSignature(fields, req.headers.get("ck-signature"), pin)) {
    return new Response("Bad signature", { status: 401 });
  }
  // Audit C1 (Nov 24, 2026): only a sale is a payment. A refund, void, auth-only, save or adjust notice for the same
  // invoice is logged and ignored, never counted as new money.
  const command = (field(fields, "xCommand") || "").trim().toLowerCase();
  if (command && !isSaleCommand(command)) {
    console.log(`[sola webhook] ignored ${command} for ${field(fields, "xInvoice") ?? "(no invoice)"} ref ${field(fields, "xRefNum") ?? ""}`);
    return new Response(`ignored (${command})`);
  }
  const result = paymentResultOf(fields);
  const orderId = orderIdFromInvoice(field(fields, "xInvoice"));
  if (result === "declined") {
    // Declined (Abraham, Nov 12, 2026): marked on the order with the date and time and the card's last 4 only. The
    // order stays waiting for payment, so the customer can try again with the same link while the hold lasts.
    if (!orderId) return new Response("ignored (no invoice)");
    const group = await getPaymentGroup(orderId);
    if (!group) return new Response("unknown order", { status: 404 });
    await recordPaymentResult(group.orders.map((d) => d.order.id), "declined", last4Of(fields), field(fields, "xRefNum") || null);
    return new Response("ok (declined)");
  }
  if (!isApproved(fields)) return new Response("ignored (not approved)");

  const cents = parseMoneyToCents(field(fields, "xAuthAmount") || field(fields, "xAmount") || "");
  if (!orderId || cents === null) {
    await alertOwner("a Sola payment could not be matched to an order", `Sola sent an approved payment (reference ${field(fields, "xRefNum") ?? "none"}) without an order number or amount. Please check it in Sola and in Admin.`, { type: "payment_callback", id: field(fields, "xRefNum") ?? "sola" });
    return new Response("ignored (no invoice/amount)");
  }
  if (cents <= 0) return new Response("ignored (zero amount)");
  // The same payment sent again (Sola retries): counted once, whatever came in between
  if (await alreadyApproved(field(fields, "xRefNum") || null)) return new Response("ok (already recorded)");

  // One payment may cover several rental days booked together (a payment group); all of them are confirmed.
  const group = await getPaymentGroup(orderId);
  if (!group) {
    await alertOwner("a Sola payment could not be matched to an order", `Sola sent an approved payment of $${(cents / 100).toFixed(2)} (reference ${field(fields, "xRefNum") ?? "none"}) for invoice ${field(fields, "xInvoice") ?? "(none)"}, but no such order was found. Please check it in Sola and in Admin.`, { type: "payment_callback", id: field(fields, "xRefNum") ?? "sola" });
    return new Response("unknown order", { status: 404 });
  }
  const before = group.primary;
  const days = group.orders;
  const updated = await markGroupPaid(orderId, cents, "sola", field(fields, "xRefNum") || null);
  await recordPaymentResult(days.map((d) => d.order.id), "approved", last4Of(fields), field(fields, "xRefNum") || null);
  if (!updated.length && before.order.solaRefNum !== field(fields, "xRefNum")) return new Response("unknown order", { status: 404 });
  // Evidence: tie this payment to the rental terms version the customer accepted (or record that none was).
  if (before.order.solaRefNum !== field(fields, "xRefNum")) await linkPaymentToAcceptance(orderId, field(fields, "xRefNum") || null, cents);

  // The "paid" notice only when the booking is now confirmed (Audit C1: never for less than the total)
  if (before.order.solaRefNum !== field(fields, "xRefNum") && updated.some((u) => u.status === "CONFIRMED")) await paymentReceivedNotices(orderId, cents);
  return new Response("ok");
}
