import { desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { BUSINESS_NAME, config } from "@/lib/config";
import { sendEmail } from "@/lib/notify";
import { orderNumber } from "@/lib/orders";
import { recordAutoMoneyOut } from "@/lib/books";
import { StripeError, stripeApi, stripeKey } from "@/lib/stripe";
import { orderPath } from "@/lib/order-path";

/**
 * Refunds from Admin (Abraham, Nov 13, 2026). Owner only. Stripe phone payments (STRIPE_REFUNDS_KEY, by the saved
 * Stripe payment ID) and Sola website payments (SOLA_API_KEY, cc:refund by the saved transaction ref). Each refund is
 * its own dated entry; the original payment is never edited or deleted. Sandbox only until Abraham approves live
 * refunds (LIVE_REFUNDS_APPROVED). A failed refund shows the reason in plain words and emails Abraham.
 */
export const LIVE_REFUNDS_APPROVED = false; // the starting value of the Owner setting liveRefundsOn (Bookkeeping > Settings)

/** Admin handoff Phase 2: live refunds are an Owner setting now (off until Abraham turns it on, with the safety check). */
export async function liveRefundsOn(): Promise<boolean> {
  const { getSettings } = await import("@/lib/settings");
  const s = (await getSettings()) as { liveRefundsOn?: unknown };
  return s.liveRefundsOn === true || s.liveRefundsOn === "true";
}

export type Provider = "stripe" | "sola";
type Ord = typeof schema.orders.$inferSelect;
const money = (c: number) => `$${(c / 100).toFixed(2)}`;

export class RefundError extends Error {}

export function refundStatus(o: { paidCents: number; refundedCents: number }): "Refunded" | "Partly refunded" | null {
  if (!o.refundedCents) return null;
  return o.refundedCents >= o.paidCents ? "Refunded" : "Partly refunded";
}

async function orderById(id: number): Promise<Ord | null> {
  const [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, id)).limit(1);
  return o ?? null;
}

/** The payment to refund: Stripe payment ID or Sola transaction ref (the first order of a group holds it). */
export async function paymentRef(o: Ord): Promise<{ provider: Provider; ref: string } | null> {
  const lead = !o.stripePaymentId && !o.solaRefNum && o.paymentGroupId ? await orderById(o.paymentGroupId) : null;
  const src = lead ?? o;
  if (o.paymentMethod === "stripe" && src.stripePaymentId) return { provider: "stripe", ref: src.stripePaymentId };
  if ((o.paymentMethod === "sola" || o.paymentMethod === "sola_phonepay" || o.paymentMethod === "sola_phonepay_custom") && src.solaRefNum) return { provider: "sola", ref: src.solaRefNum };
  return null;
}

export function refundable(o: Ord) {
  return Math.max(0, o.paidCents - o.refundedCents);
}

/** "Refund $25.00 to card ending 1234? This cannot be undone." (Abraham's wording) */
export function refundQuestion(amountCents: number, last4: string | null) {
  return `Refund ${money(amountCents)} to ${last4 ? `card ending ${last4}` : "the card on file"}? This cannot be undone.`;
}

/** Is this the sandbox (test) setup? Live refunds wait for Abraham's OK. */
export function refundsSandbox(provider: Provider, env: Record<string, string | undefined> = process.env) {
  if (provider === "stripe") return /^(rk|sk)_test_/.test(env.STRIPE_REFUNDS_KEY ?? "");
  return env.SOLA_REFUND_MODE === "sandbox";
}

/** Records one refund on the order (and in the books as money out). Shared with refunds made in Stripe's dashboard. */
export async function applyRefund(o: Ord, input: { amountCents: number; refundId: string; provider: Provider; source: "admin" | "stripe_dashboard"; userId: number | null; status?: string; reservedId?: number }) {
  const [exists] = await db.select().from(schema.orderRefunds).where(eq(schema.orderRefunds.stripeRefundId, input.refundId)).limit(1);
  if (exists) return exists;
  const status = input.status ?? "succeeded";
  const values = { orderId: o.id, amountCents: input.amountCents, stripeRefundId: input.refundId, status, source: input.source, provider: input.provider, userId: input.userId };
  // A refund sent from Admin already has its row (reserved before the card company was asked, deep check A7)
  const [row] = input.reservedId
    ? await db.update(schema.orderRefunds).set(values).where(eq(schema.orderRefunds.id, input.reservedId)).returning()
    : await db.insert(schema.orderRefunds).values(values).returning();
  if (status === "succeeded" || status === "pending") {
    await db.update(schema.orders).set({ refundedCents: sql`${schema.orders.refundedCents} + ${input.amountCents}`, updatedAt: new Date() }).where(eq(schema.orders.id, o.id));
    // Deep check A4 (Nov 27, 2026): the refund gives back its share of the sales tax, so tax collected goes down
    await recordAutoMoneyOut({ kind: "refund", amountCents: input.amountCents, taxCents: await refundTaxShare(o.id, input.amountCents), category: "Refunds", method: input.provider, orderId: o.id, ref: input.refundId, notes: `${input.provider === "stripe" ? "Stripe" : "Sola"} refund, order #${orderNumber(o.id)}` });
  }
  await db.insert(schema.auditLog).values({ userId: input.userId, action: "payment.refunded", entityType: "order", entityId: String(o.id), after: { amountCents: input.amountCents, refundId: input.refundId, provider: input.provider, source: input.source, status } });
  return row;
}

/**
 * The sales tax inside a refund (deep check A4): the order's tax (rentals and services) in the same share as the
 * refund is of the order total, never more than the tax not yet given back on earlier refunds of this order.
 */
export async function refundTaxShare(orderId: number, amountCents: number): Promise<number> {
  const [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId)).limit(1);
  if (!o) return 0;
  // Deep check 06:00 (Nov 27): taxCents already includes the services' tax (servicesTaxCents is the part of it the
  // services added), so adding it again gave back too much tax on orders with services
  const tax = o.taxCents ?? 0;
  const total = o.totalCents ?? o.subtotalCents;
  if (tax <= 0 || total <= 0) return 0;
  const r = (await db.execute(sql`SELECT COALESCE(SUM(tax_cents) FILTER (WHERE kind = 'refund'), 0)::int AS t, COALESCE(SUM(CASE WHEN kind = 'refund' THEN -amount_cents ELSE amount_cents END), 0)::int AS net FROM book_entries WHERE order_id = ${orderId} AND ((kind = 'income' AND source = 'auto') OR kind = 'refund')`)).rows[0] as { t: number; net: number };
  // Money paid above the total (an overpayment) is given back first, with no tax in it
  const excess = Math.max(0, Number(r?.net ?? 0) - total);
  const portion = Math.max(0, amountCents - excess);
  return Math.max(0, Math.min(Math.round((portion * tax) / total), tax - Number(r?.t ?? 0)));
}

/** Plain words for the reasons cards companies give. */
export function plainReason(raw: string): string {
  const r = raw.toLowerCase();
  if (/already.*refund|charge_already_refunded/.test(r)) return "This payment was already refunded.";
  if (/greater than|exceeds|amount/.test(r) && /refund/.test(r)) return "The refund is more than what's left on this payment.";
  if (/insufficient|balance/.test(r)) return "There isn't enough in the payment account to cover this refund right now.";
  if (/not active yet/.test(r)) return raw;
  if (/invalid.*key|api key|unauthor|permission/.test(r)) return "The refund key isn't set up correctly. Nothing was refunded.";
  if (/not found|no such|invalid.*ref/.test(r)) return "The payment couldn't be found at the card company.";
  return `The card company didn't accept the refund (${raw}).`;
}

async function stripeRefund(ref: string, amount: number, o: Ord, fetcher?: typeof fetch) {
  const re = await stripeApi<{ id: string; status: string; failure_reason?: string }>(
    "refunds",
    "POST",
    "/v1/refunds",
    { ...(ref.startsWith("pi_") ? { payment_intent: ref } : { charge: ref }), amount, reason: "requested_by_customer", metadata: { order_number: orderNumber(o.id) } },
    { idempotencyKey: `refund-${o.id}-${o.refundedCents}-${amount}`, fetcher },
  );
  if (re.status === "failed" || re.status === "canceled") throw new RefundError(plainReason(re.failure_reason ?? re.status));
  return { id: re.id, status: re.status };
}

/** Sola (Cardknox) gateway: cc:refund by the saved transaction ref. */
async function solaRefund(ref: string, amount: number, fetcher: typeof fetch = fetch) {
  const key = process.env.SOLA_API_KEY;
  if (!key) throw new RefundError("Not active yet: SOLA_API_KEY isn't in Vercel.");
  const res = await fetcher("https://x1.cardknox.com/gatewayjson", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ xKey: key, xVersion: "5.0.0", xSoftwareName: BUSINESS_NAME, xSoftwareVersion: "1.0", xCommand: "cc:refund", xRefNum: ref, xAmount: (amount / 100).toFixed(2) }),
  });
  const j = (await res.json().catch(() => ({}))) as { xResult?: string; xStatus?: string; xError?: string; xRefNum?: string };
  if (j.xResult !== "A" || !j.xRefNum) throw new RefundError(plainReason(j.xError || j.xStatus || `Sola answered ${res.status}`));
  return { id: `sola:${j.xRefNum}`, status: "succeeded" };
}

async function alertOwner(o: Ord, amount: number, reason: string) {
  const owner = process.env.ADMIN_EMAIL;
  if (!owner) return;
  await sendEmail(owner, `Refund failed on order #${orderNumber(o.id)}`, `A refund of ${money(amount)} on order #${orderNumber(o.id)} didn't go through.\n\nReason: ${reason}\n\nNothing was refunded. Open the order: ${config.baseUrl()}${orderPath(o.id)}`).catch(() => null);
}

/**
 * Refund full or part of a paid order. Throws RefundError with the reason in plain words (and emails Abraham) when it
 * fails; a failed refund is still kept on the order.
 */
export async function refundOrder(orderId: number, amountCents: number | "full", userId: number | null, fetcher?: typeof fetch) {
  const o = await orderById(orderId);
  if (!o) throw new RefundError("Order not found.");
  const pay = await paymentRef(o);
  if (!pay) throw new RefundError("This order has no card payment to refund (only Stripe phone payments and Sola website payments can be refunded here).");
  if (!(await liveRefundsOn()) && !refundsSandbox(pay.provider))
    throw new RefundError(pay.provider === "stripe" && !stripeKey("refunds") ? "Not active yet: STRIPE_REFUNDS_KEY isn't in Vercel." : "Live refunds are off until Abraham approves them. Use the sandbox (test) keys for now.");
  // Deep check A7 (Nov 27, 2026): two Refund clicks at once could both pass the "at most" check and refund twice. The
  // order is locked, refunds still being sent (the last 10 minutes) count as taken, and this refund's row is saved as
  // "sending" before the card company is asked; the row then gets the result.
  const reserved = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM orders WHERE id = ${o.id} FOR UPDATE`);
    const [cur] = await tx.select().from(schema.orders).where(eq(schema.orders.id, o.id));
    // also refunds that went through at the card company but could not be fully saved here (deep check 15a)
    const sending = (await tx.execute(sql`SELECT COALESCE(SUM(amount_cents), 0)::int AS c FROM order_refunds WHERE order_id = ${o.id} AND ((status = 'sending' AND created_at > now() - interval '10 minutes') OR (status <> 'failed' AND error LIKE 'Refunded at the card company, but not fully saved%'))`)).rows[0] as { c: number };
    const left = Math.max(0, refundable(cur) - Number(sending?.c ?? 0));
    const amount = amountCents === "full" ? left : amountCents;
    if (!Number.isInteger(amount) || amount <= 0) return { error: left <= 0 && amountCents === "full" ? `At most ${money(0)} can be refunded on this order.` : "Enter an amount to refund." };
    if (amount > left) return { error: `At most ${money(left)} can be refunded on this order.` };
    const [row] = await tx.insert(schema.orderRefunds).values({ orderId: o.id, amountCents: amount, status: "sending", provider: pay.provider, userId }).returning();
    return { id: row.id, amount };
  });
  if ("error" in reserved) throw new RefundError(reserved.error!);
  const amount = reserved.amount;
  let r: { id: string; status: string };
  try {
    r = pay.provider === "stripe" ? await stripeRefund(pay.ref, amount, o, fetcher) : await solaRefund(pay.ref, amount, fetcher);
  } catch (e) {
    const reason = e instanceof RefundError ? e.message : plainReason(e instanceof StripeError || e instanceof Error ? e.message : String(e));
    await db.update(schema.orderRefunds).set({ status: "failed", error: reason.slice(0, 300) }).where(eq(schema.orderRefunds.id, reserved.id));
    await db.insert(schema.auditLog).values({ userId, action: "payment.refund_failed", entityType: "order", entityId: String(o.id), after: { amountCents: amount, provider: pay.provider, reason } });
    await alertOwner(o, amount, reason);
    throw new RefundError(reason);
  }
  // Deep check 15a (Nov 27, 2026): the card company refunded it. If saving it here fails, it is never shown as
  // "nothing was refunded": the row keeps the refund (with its id) and the Owner is emailed to check the books.
  try {
    return await applyRefund(o, { amountCents: amount, refundId: r.id, provider: pay.provider, source: "admin", userId, status: r.status, reservedId: reserved.id });
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    await db.update(schema.orderRefunds).set({ status: r.status === "pending" ? "pending" : "succeeded", stripeRefundId: r.id, error: `Refunded at the card company, but not fully saved here: ${err}`.slice(0, 300) }).where(eq(schema.orderRefunds.id, reserved.id)).catch(() => undefined);
    await db.insert(schema.auditLog).values({ userId, action: "payment.refund_save_failed", entityType: "order", entityId: String(o.id), after: { amountCents: amount, provider: pay.provider, refundId: r.id, error: err } }).catch(() => undefined);
    const owner = process.env.ADMIN_EMAIL;
    if (owner) await sendEmail(owner, `Refund on order #${orderNumber(o.id)} went through but was not fully saved`, `A refund of ${money(amount)} on order #${orderNumber(o.id)} WENT THROUGH at ${pay.provider === "stripe" ? "Stripe" : "Sola"} (${r.id}), but saving it in Admin failed (${err}).\n\nDo not refund it again. Check the order's refunded amount and Bookkeeping.\n\n${config.baseUrl()}${orderPath(o.id)}`).catch(() => null);
    throw new RefundError(`The refund went through (${r.id}), but it could not be fully saved here. Do not refund again; the Owner was emailed to check the books.`);
  }
}

export async function refundsFor(orderId: number) {
  return db.select().from(schema.orderRefunds).where(eq(schema.orderRefunds.orderId, orderId)).orderBy(desc(schema.orderRefunds.createdAt));
}
