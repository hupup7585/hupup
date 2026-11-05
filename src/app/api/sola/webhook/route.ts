import { field, isApproved, orderIdFromInvoice, verifyWebhookSignature } from "@/lib/sola";
import { getOrderWithItems, markPaid, orderNumber } from "@/lib/orders";
import { linkPaymentToAcceptance } from "@/lib/rental-terms";
import { sendEmail, sendSms } from "@/lib/notify";
import { BUSINESS_NAME } from "@/lib/config";
import { longDate } from "@/lib/dates";
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
  if (!isApproved(fields)) return new Response("ignored (not approved)");

  const orderId = orderIdFromInvoice(field(fields, "xInvoice"));
  const cents = parseMoneyToCents(field(fields, "xAuthAmount") || field(fields, "xAmount") || "");
  if (!orderId || cents === null) return new Response("ignored (no invoice/amount)");

  const before = await getOrderWithItems(orderId);
  if (!before) return new Response("unknown order", { status: 404 });
  const updated = await markPaid(orderId, cents, "sola", field(fields, "xRefNum") || null);
  if (!updated) return new Response("unknown order", { status: 404 });
  // Evidence: tie this payment to the rental terms version the customer accepted (or record that none was).
  if (before.order.solaRefNum !== field(fields, "xRefNum")) await linkPaymentToAcceptance(orderId, field(fields, "xRefNum") || null, cents);

  if (before.order.solaRefNum !== field(fields, "xRefNum")) {
    const num = orderNumber(orderId);
    const msg = `${BUSINESS_NAME}: payment received for order #${num}. You're all set for ${longDate(before.order.eventDate)}! We'll deliver that day and pick up ${longDate(before.order.pickupDate)}.`;
    // Order/service text only with order-text consent (checked in sendMessage); the email copy goes out as before.
    if (before.customer?.phone) await sendSms(before.customer.phone, msg, { kind: "transactional", event: "payment_confirmation", orderId, customerId: before.customer.id });
    if (before.customer?.email) await sendEmail(before.customer.email, `Order #${num} confirmed`, msg);
    if (process.env.ADMIN_PHONE) {
      await sendSms(process.env.ADMIN_PHONE, `New paid order #${num}: $${(cents / 100).toFixed(2)} for ${longDate(before.order.eventDate)}.`, { kind: "system", event: "owner_alert" });
    }
  }
  return new Response("ok");
}
