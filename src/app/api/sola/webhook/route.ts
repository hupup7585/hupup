import { field, isApproved, last4Of, orderIdFromInvoice, paymentResultOf, verifyWebhookSignature } from "@/lib/sola";
import { recordPaymentResult } from "@/lib/payment-result";
import { getPaymentGroup, markGroupPaid, orderNumber } from "@/lib/orders";
import { linkPaymentToAcceptance } from "@/lib/rental-terms";
import { sendEmail, sendSms } from "@/lib/notify";
import { BUSINESS_NAME, config } from "@/lib/config";
import { businessOrderEmail } from "@/lib/order-email";
import { parseMoneyToCents } from "@/lib/money";
import { messageDate } from "@/lib/dual-date";

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

  if (before.order.solaRefNum !== field(fields, "xRefNum")) {
    const num = orderNumber(orderId);
    const msg =
      days.length > 1
        ? `${BUSINESS_NAME}: payment received for order #${num}. You're all set for ${days.map((d) => messageDate(d.order.eventDate)).join(" and ")}! We'll deliver and pick up on the days you chose.`
        : `${BUSINESS_NAME}: payment received for order #${num}. You're all set for ${messageDate(before.order.eventDate)}! We'll deliver that day and pick up ${messageDate(before.order.pickupDate)}.`;
    // Order/service text only with order-text consent (checked in sendMessage); the email copy goes out as before.
    if (before.customer?.phone) await sendSms(before.customer.phone, msg, { kind: "transactional", event: "payment_confirmation", orderId, customerId: before.customer.id });
    if (before.customer?.email) await sendEmail(before.customer.email, `Order #${num} confirmed`, msg);
    if (process.env.ADMIN_PHONE) {
      await sendSms(process.env.ADMIN_PHONE, `New paid order #${num}: $${(cents / 100).toFixed(2)} for ${messageDate(before.order.eventDate)}${days.length > 1 ? ` and ${days.length - 1} more day${days.length > 2 ? "s" : ""}` : ""}.`, { kind: "system", event: "owner_alert" });
    }
    // The business gets the full order details by email (sent once an email sender is connected; nothing else changes)
    if (config.adminEmail()) {
      for (const d of days) {
        const mail = businessOrderEmail(d, days.length > 1 ? (d.order.totalCents ?? d.order.subtotalCents) : cents);
        await sendEmail(config.adminEmail(), mail.subject, mail.text);
      }
    }
  }
  return new Response("ok");
}
