import crypto from "node:crypto";
import { config } from "@/lib/config";
import { orderNumber } from "@/lib/orders";

/**
 * Sola Payments (formerly Cardknox).
 *
 * Phone and POS orders are paid through a Sola PaymentSITE hosted page.
 * We text the customer a link that pre-fills amount + invoice:
 *   https://secure.cardknox.com/<SITE>?xAmount=230.00&xInvoice=HU-1074&...
 * The PaymentSITE page must have the matching fields (amount, invoice, name, email, phone) added
 * in the Sola portal, otherwise those query params are ignored.
 *
 * When the payment is approved Sola POSTs a webhook to /api/sola/webhook
 * (configure in the Sola portal: Settings > Webhooks, or ask Sola support to enable xPostUrl).
 * We verify the `ck-signature` header with SOLA_WEBHOOK_PIN.
 */

export function invoiceFor(orderId: number) {
  return `HU-${orderNumber(orderId)}`;
}

export function orderIdFromInvoice(invoice: string | null | undefined): number | null {
  const m = /^HU-(\d+)$/i.exec((invoice || "").trim());
  if (!m) return null;
  const id = Number(m[1]) - 1000;
  return id > 0 ? id : null;
}

export function paymentLink(o: {
  orderId: number;
  amountCents: number;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
}): string {
  const site = process.env.SOLA_PAYMENTSITE_NAME;
  const params = new URLSearchParams({
    xAmount: (o.amountCents / 100).toFixed(2),
    xInvoice: invoiceFor(o.orderId),
  });
  if (o.name) params.set("xName", o.name);
  if (o.email) params.set("xEmail", o.email);
  if (o.phone) params.set("xBillPhone", o.phone);
  params.set("xRedirectURL", `${config.baseUrl()}/paid?invoice=${invoiceFor(o.orderId)}`);
  if (!site) {
    // Dev fallback so the flow can be tested without a Sola account.
    return `${config.baseUrl()}/paid?invoice=${invoiceFor(o.orderId)}&dev=1`;
  }
  return `https://secure.cardknox.com/${encodeURIComponent(site)}?${params.toString()}`;
}

/**
 * Verify Sola's ck-signature: lowercase keys, sort alphabetically, concatenate
 * the (URL-decoded) values, append the PIN, MD5.
 */
export function verifyWebhookSignature(fields: Record<string, string>, signature: string | null, pin: string): boolean {
  if (!signature || !pin) return false;
  const lowered = Object.entries(fields).map(([k, v]) => [k.toLowerCase(), v] as const);
  lowered.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const concat = lowered.map(([, v]) => v).join("") + pin;
  const expected = crypto.createHash("md5").update(concat, "utf8").digest("hex");
  const a = Buffer.from(expected.toLowerCase());
  const b = Buffer.from(signature.trim().toLowerCase());
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Case-insensitive field getter for Sola payloads. */
export function field(fields: Record<string, string>, name: string): string | undefined {
  const k = Object.keys(fields).find((key) => key.toLowerCase() === name.toLowerCase());
  return k ? fields[k] : undefined;
}

export function isApproved(fields: Record<string, string>): boolean {
  const r = (field(fields, "xResult") || field(fields, "xStatus") || "").toUpperCase();
  return r === "A" || r === "APPROVED";
}

/** "approved" (A), "declined" (D or E), or null for anything else (e.g. a void or refund notice). */
export function paymentResultOf(fields: Record<string, string>): "approved" | "declined" | null {
  const r = (field(fields, "xResult") || "").toUpperCase();
  const st = (field(fields, "xStatus") || "").toUpperCase();
  if (r === "A" || st === "APPROVED") return "approved";
  if (r === "D" || r === "E" || st === "DECLINED" || st === "ERROR") return "declined";
  return null;
}

/** The card's last 4 digits only, from Sola's masked number (e.g. "4xxxxxxxxxxx1111" -> "1111"). Nothing else is kept. */
export function last4Of(fields: Record<string, string>): string | null {
  const m = /(\d{4})\s*$/.exec(field(fields, "xMaskedCardNumber") || field(fields, "xMaskedCard") || "");
  return m ? m[1] : null;
}
