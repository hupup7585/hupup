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

/** What the customer sees when online payment is off (Nov 24, 2026). */
export const PAYMENT_UNAVAILABLE = "Online payment is not available right now. Please call us.";

/**
 * The test fallback (/paid?dev=1, no card step) only on a developer's own computer, never on Vercel (preview or
 * production): there it once let customers skip the card step (Nov 24, 2026).
 */
export const devPaymentFallbackAllowed = (env: Record<string, string | undefined> = process.env) => !env.VERCEL && env.NODE_ENV !== "production";

/** Online card payment can be offered: the Sola page name is set (or a developer's own computer). */
export const onlinePaymentReady = (env: Record<string, string | undefined> = process.env) => Boolean(env.SOLA_PAYMENTSITE_NAME) || devPaymentFallbackAllowed(env);

/** The Sola settings that are missing, for the red warning in Admin. */
export function solaMissing(env: Record<string, string | undefined> = process.env): string[] {
  return [!env.SOLA_PAYMENTSITE_NAME && "SOLA_PAYMENTSITE_NAME", !env.SOLA_WEBHOOK_PIN && "SOLA_WEBHOOK_PIN"].filter(Boolean) as string[];
}

/** The secure Sola card page for this amount and invoice; null when online payment is not set up (never a fake link). */
export function paymentLink(o: {
  orderId: number;
  amountCents: number;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
}): string | null {
  const site = process.env.SOLA_PAYMENTSITE_NAME;
  const params = new URLSearchParams({
    xAmount: (o.amountCents / 100).toFixed(2),
    xInvoice: invoiceFor(o.orderId),
  });
  if (o.name) params.set("xName", o.name);
  if (o.email) params.set("xEmail", o.email);
  if (o.phone) params.set("xBillPhone", o.phone);
  params.set("xRedirectURL", `${config.siteUrl()}/paid?invoice=${invoiceFor(o.orderId)}`); // the real site, never vercel.app (item 7)
  if (!site) {
    if (!devPaymentFallbackAllowed()) {
      console.error(`[sola] SOLA_PAYMENTSITE_NAME is not set: no payment link for ${invoiceFor(o.orderId)}`);
      return null;
    }
    // Dev fallback on a developer's computer only, so the flow can be tested without a Sola account.
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

/**
 * A sale (money in): "cc:sale", "check:sale" and the like. Refunds, voids, credits, auth-only, capture, save and
 * adjust are not payments (Audit C1, Nov 24, 2026).
 */
export function isSaleCommand(command: string): boolean {
  const c = command.trim().toLowerCase();
  return /^(cc|check|ach|ebt|gift)?:?sale$/.test(c);
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
