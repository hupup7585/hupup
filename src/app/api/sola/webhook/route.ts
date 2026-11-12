import { field, isApproved, last4Of, orderIdFromInvoice, paymentResultOf, verifyWebhookSignature } from "@/lib/sola";
import { paymentReceivedNotices, recordPaymentResult } from "@/lib/payment-result";
import { getPaymentGroup, markGroupPaid } from "@/lib/orders";
import { linkPaymentToAcceptance } from "@/lib/rental-terms";
import { parseMoneyToCents } from "@/lib/money";

export const dynamic = "force-dynamic";

/** Sola Payments (Cardknox) transaction webhook. */
export async function POST(req: Request) {
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
  if (!orderId || cents === null) return new Response("ignored (no invoice/amount)");

  // One payment may cover several rental days booked together (a payment group); all of them are confirmed.
  const group = await getPaymentGroup(orderId);
  if (!group) return new Response("unknown order", { status: 404 });
  const before = group.primary;
  const days = group.orders;
  const updated = await markGroupPaid(orderId, cents, "sola", field(fields, "xRefNum") || null);
  await recordPaymentResult(days.map((d) => d.order.id), "approved", last4Of(fields), field(fields, "xRefNum") || null);
  if (!updated.length && before.order.solaRefNum !== field(fields, "xRefNum")) return new Response("unknown order", { status: 404 });
  // Evidence: tie this payment to the rental terms version the customer accepted (or record that none was).
  if (before.order.solaRefNum !== field(fields, "xRefNum")) await linkPaymentToAcceptance(orderId, field(fields, "xRefNum") || null, cents);

  if (before.order.solaRefNum !== field(fields, "xRefNum")) await paymentReceivedNotices(orderId, cents);
  return new Response("ok");
}
