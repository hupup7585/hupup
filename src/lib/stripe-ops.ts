import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { BUSINESS_NAME, config } from "@/lib/config";
import { sendEmail } from "@/lib/notify";
import { getPaymentGroup, orderNumber } from "@/lib/orders";
import { recordAutoMoneyOut } from "@/lib/books";
import { messageDate } from "@/lib/dual-date";
import { StripeError, stripeApi } from "@/lib/stripe";
import { inboxWhen } from "@/lib/inbox-format";
import { PROMPTS, fill } from "@/lib/ivr/prompts";

/* Stripe refunds, fees and payouts, disputes (Abraham, Nov 12, 2026). Nothing is ever deleted. */

const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const nyDate = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });

type Ord = typeof schema.orders.$inferSelect;
async function orderById(id: number): Promise<Ord | null> {
  const [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, id)).limit(1);
  return o ?? null;
}

/** Refunded / Partly refunded, for Admin, the orders list and the CSV. */
export function refundStatus(o: { paidCents: number; refundedCents: number }): "Refunded" | "Partly refunded" | null {
  if (!o.refundedCents) return null;
  return o.refundedCents >= o.paidCents ? "Refunded" : "Partly refunded";
}

/** The Stripe payment behind an order (the first order of a group holds it for every day). */
async function stripeIdFor(o: Ord): Promise<string | null> {
  if (o.stripePaymentId) return o.stripePaymentId;
  if (o.paymentGroupId) return (await orderById(o.paymentGroupId))?.stripePaymentId ?? null;
  return null;
}

async function applyRefund(o: Ord, amountCents: number, refundId: string, source: "admin" | "stripe_dashboard", userId: number | null, status = "succeeded") {
  const [exists] = await db.select().from(schema.orderRefunds).where(eq(schema.orderRefunds.stripeRefundId, refundId)).limit(1);
  if (exists) return exists;
  const [row] = await db.insert(schema.orderRefunds).values({ orderId: o.id, amountCents, stripeRefundId: refundId, status, source, userId }).returning();
  if (status === "succeeded" || status === "pending") {
    await db.update(schema.orders).set({ refundedCents: sql`${schema.orders.refundedCents} + ${amountCents}`, updatedAt: new Date() }).where(eq(schema.orders.id, o.id));
    await recordAutoMoneyOut({ kind: "refund", amountCents, category: "Refunds", method: "stripe", orderId: o.id, ref: refundId, notes: `Stripe refund, order #${orderNumber(o.id)}` });
  }
  await db.insert(schema.auditLog).values({ userId, action: "payment.refunded", entityType: "order", entityId: String(o.id), after: { amountCents, refundId, source, status } });
  return row;
}

/**
 * Refund full or part of a Stripe phone payment (Owner, after a confirm step). Stripe access: STRIPE_WRITE_KEY.
 * Records who, when and how much; the order shows Refunded or Partly refunded.
 */
export async function refundOrder(orderId: number, amountCents: number | "full", userId: number | null, fetcher?: typeof fetch) {
  const o = await orderById(orderId);
  if (!o) throw new Error("Order not found.");
  const pid = await stripeIdFor(o);
  if (o.paymentMethod !== "stripe" || !pid) throw new Error("This order wasn't paid through Stripe on the phone.");
  const left = o.paidCents - o.refundedCents;
  const amount = amountCents === "full" ? left : amountCents;
  if (!Number.isInteger(amount) || amount <= 0) throw new Error("Enter an amount to refund.");
  if (amount > left) throw new Error(`At most ${money(left)} can be refunded on this order.`);
  try {
    const re = await stripeApi<{ id: string; status: string }>(
      "write",
      "POST",
      "/v1/refunds",
      { ...(pid.startsWith("pi_") ? { payment_intent: pid } : { charge: pid }), amount, reason: "requested_by_customer", metadata: { order_number: orderNumber(o.id) } },
      { idempotencyKey: `refund-${o.id}-${o.refundedCents}-${amount}`, fetcher },
    );
    return applyRefund(o, amount, re.id, "admin", userId, re.status === "failed" ? "failed" : re.status);
  } catch (e) {
    await db.insert(schema.orderRefunds).values({ orderId: o.id, amountCents: amount, status: "failed", error: (e as Error).message.slice(0, 300), userId });
    throw e;
  }
}

export async function refundsFor(orderId: number) {
  return db.select().from(schema.orderRefunds).where(eq(schema.orderRefunds.orderId, orderId)).orderBy(desc(schema.orderRefunds.createdAt));
}

/* ---------------- Stripe fees and payouts (read-only key) ---------------- */

type BalanceTxn = { id: string; type: string; amount: number; fee: number; net: number; description: string | null; source: string | null; created: number; available_on: number };
type Payout = { id: string; amount: number; status: string; arrival_date: number; created: number };

/**
 * Pulls Stripe's balance lines (each payment with its fee, refunds, payouts) and payouts since the last pull. Each fee
 * goes into the books as a "Stripe fees" processor fee, once. STRIPE_READ_KEY (read only).
 */
export async function syncStripeBalance(fetcher?: typeof fetch) {
  const [last] = await db.select({ t: sql<string | null>`max(${schema.stripeBalanceLines.happenedAt})` }).from(schema.stripeBalanceLines);
  const since = last?.t ? Math.floor(new Date(last.t).getTime() / 1000) - 86_400 : Math.floor(Date.now() / 1000) - 90 * 86_400;
  let added = 0;
  let after: string | undefined;
  for (let page = 0; page < 20; page++) {
    const r = await stripeApi<{ data: BalanceTxn[]; has_more: boolean }>("read", "GET", "/v1/balance_transactions", { limit: 100, created: { gte: since }, ...(after ? { starting_after: after } : {}) }, { fetcher });
    for (const t of r.data) {
      const [o] = t.source ? await db.select({ id: schema.orders.id }).from(schema.orders).where(eq(schema.orders.stripePaymentId, t.source)).limit(1) : [];
      const res = await db
        .insert(schema.stripeBalanceLines)
        .values({ id: t.id, type: t.type, amountCents: t.amount, feeCents: t.fee, netCents: t.net, description: t.description, sourceId: t.source, orderId: o?.id ?? null, happenedAt: new Date(t.created * 1000), availableOn: new Date(t.available_on * 1000) })
        .onConflictDoNothing()
        .returning({ id: schema.stripeBalanceLines.id });
      if (res.length) added++;
      if (t.fee > 0) await recordAutoMoneyOut({ kind: "processor_fee", amountCents: t.fee, category: "Stripe fees", method: "stripe", orderId: o?.id ?? null, ref: t.id, date: nyDate(new Date(t.created * 1000)), notes: `Stripe fee (${t.type})` });
    }
    if (!r.has_more || !r.data.length) break;
    after = r.data[r.data.length - 1].id;
  }
  const p = await stripeApi<{ data: Payout[] }>("read", "GET", "/v1/payouts", { limit: 100 }, { fetcher });
  for (const x of p.data) {
    await db
      .insert(schema.stripePayouts)
      .values({ id: x.id, amountCents: x.amount, status: x.status, arrivalDate: new Date(x.arrival_date * 1000), createdAt: new Date(x.created * 1000) })
      .onConflictDoUpdate({ target: schema.stripePayouts.id, set: { status: x.status, arrivalDate: new Date(x.arrival_date * 1000), syncedAt: new Date() } });
  }
  return { added, payouts: p.data.length };
}

export async function stripeBooks(from: string, to: string) {
  const range = and(sql`${schema.stripeBalanceLines.happenedAt} >= ${from}::date`, sql`${schema.stripeBalanceLines.happenedAt} < (${to}::date + 1)`);
  const lines = await db.select().from(schema.stripeBalanceLines).where(range).orderBy(desc(schema.stripeBalanceLines.happenedAt));
  const payouts = await db
    .select()
    .from(schema.stripePayouts)
    .where(and(sql`${schema.stripePayouts.createdAt} >= ${from}::date`, sql`${schema.stripePayouts.createdAt} < (${to}::date + 1)`))
    .orderBy(desc(schema.stripePayouts.createdAt));
  return { lines, payouts };
}

/* ---------------- Disputes (webhook) ---------------- */

type Dispute = { id: string; amount: number; reason: string; status: string; charge: string; payment_intent?: string | null; evidence_details?: { due_by?: number } };
type Charge = { id: string; payment_intent?: string | null; refunds?: { data: { id: string; amount: number; status: string }[] } };

async function orderForPayment(...ids: (string | null | undefined)[]) {
  const list = ids.filter((x): x is string => Boolean(x));
  if (!list.length) return null;
  const [o] = await db.select().from(schema.orders).where(inArray(schema.orders.stripePaymentId, list)).limit(1);
  return o ?? null;
}

/** Stripe's notices: disputes (shown on the order, Abraham emailed) and refunds made in Stripe's own dashboard. */
export async function handleStripeEvent(event: { type: string; data: { object: Record<string, unknown> } }) {
  if (event.type.startsWith("charge.dispute.")) {
    const d = event.data.object as unknown as Dispute;
    const o = await orderForPayment(d.charge, d.payment_intent);
    const due = d.evidence_details?.due_by ? new Date(d.evidence_details.due_by * 1000) : null;
    const [existing] = await db.select().from(schema.orderDisputes).where(eq(schema.orderDisputes.stripeDisputeId, d.id)).limit(1);
    if (existing) {
      await db.update(schema.orderDisputes).set({ status: d.status, amountCents: d.amount, reason: d.reason, evidenceDueBy: due, updatedAt: new Date() }).where(eq(schema.orderDisputes.id, existing.id));
    } else {
      await db.insert(schema.orderDisputes).values({ stripeDisputeId: d.id, orderId: o?.id ?? null, amountCents: d.amount, reason: d.reason, status: d.status, evidenceDueBy: due });
      const owner = process.env.ADMIN_EMAIL;
      if (owner) {
        await sendEmail(
          owner,
          `Dispute on ${o ? `order #${orderNumber(o.id)}` : "a Stripe payment"}: ${money(d.amount)}`,
          `A customer disputed a Stripe phone payment.\n\nOrder: ${o ? `#${orderNumber(o.id)} (${config.baseUrl()}/admin/orders/${o.id})` : "not matched"}\nAmount: ${money(d.amount)}\nReason: ${d.reason.replace(/_/g, " ")}\n${due ? `Send proof by: ${inboxWhen(due)}\n` : ""}\nOpen the order in Admin and press "Send proof to Stripe".`,
        ).catch((e) => console.error("dispute alert failed", e));
      }
    }
    await db.insert(schema.auditLog).values({ action: `stripe.${event.type}`, entityType: "order", entityId: o ? String(o.id) : null, after: { dispute: d.id, status: d.status, amount: d.amount } });
    return;
  }
  if (event.type === "charge.refunded") {
    const c = event.data.object as unknown as Charge;
    const o = await orderForPayment(c.id, c.payment_intent);
    if (!o) return;
    for (const r of c.refunds?.data ?? []) await applyRefund(o, r.amount, r.id, "stripe_dashboard", null, r.status);
  }
}

export async function disputesFor(orderId: number) {
  return db.select().from(schema.orderDisputes).where(eq(schema.orderDisputes.orderId, orderId)).orderBy(desc(schema.orderDisputes.createdAt));
}

/**
 * The proof for a dispute: the order, the phone record (when the customer called, each step, and the total read back
 * to them before they paid by keypad), the payment, and the delivery record. Delivery photos are added once photo
 * storage is set up (Cloudflare R2: Not active yet).
 */
export async function disputeEvidence(orderId: number) {
  const group = await getPaymentGroup(orderId);
  if (!group) throw new Error("Order not found.");
  const p = group.primary;
  const o = p.order;
  const c = p.customer;
  const events = o.callSid ? await db.select().from(schema.callEvents).where(eq(schema.callEvents.callSid, o.callSid)).orderBy(schema.callEvents.id) : [];
  const totals = group.orders.reduce((t, d) => ({ items: t.items + d.order.subtotalCents, delivery: t.delivery + d.order.deliveryFeeCents, tax: t.tax + d.order.taxCents, total: t.total + (d.order.totalCents ?? d.order.subtotalCents) }), { items: 0, delivery: 0, tax: 0, total: 0 });
  const spoken = (c: number) => `${Math.floor(c / 100)} dollars${c % 100 ? ` and ${c % 100} cents` : ""}`;
  const readBack = fill(PROMPTS.checkout_total.text, { total: spoken(totals.total), items: spoken(totals.items), delivery: spoken(totals.delivery), tax: spoken(totals.tax) });
  const terms = await db.select().from(schema.termsAcceptances).where(inArray(schema.termsAcceptances.orderId, group.orders.map((d) => d.order.id)));
  const text = [
    `${BUSINESS_NAME}, order #${orderNumber(o.id)}. Party rental booked by phone through our automated booking line and paid in full by card at booking (keypad, Twilio Pay with Stripe).`,
    "",
    "ORDER",
    ...group.orders.map((d) => `${messageDate(d.order.eventDate)}: ${d.items.map((i) => `${i.qty} x ${i.name}`).join(", ")}. Delivered to ${d.order.deliveryAddress ?? "the customer's address"}, picked up ${messageDate(d.order.pickupDate)}. Status: ${d.order.status.toLowerCase().replace(/_/g, " ")}.`),
    `Rentals ${money(totals.items)}, delivery ${money(totals.delivery)}, sales tax ${money(totals.tax)}, total ${money(totals.total)}.`,
    "",
    "PHONE RECORD",
    `Caller: ${c?.name ?? "on file"}, phone ${c?.phone ?? "on file"}${c?.email ? `, email ${c.email}` : ""}.`,
    ...events.map((e) => `${inboxWhen(e.at)}: ${e.label}`),
    `Before paying, the caller heard the order read back: "${readBack}"`,
    "",
    "PAYMENT",
    `Paid ${o.paymentResultAt ? inboxWhen(o.paymentResultAt) : ""} by card ending ${o.cardLast4 ?? "on file"}, Stripe payment ${o.stripePaymentId ?? ""}, amount ${money(o.paidCents)}.`,
    ...(terms.length ? ["", "TERMS", ...terms.map((t) => `${inboxWhen(t.acceptedAt)}: accepted Terms version ${t.termsVersion} (${t.method}).`)] : []),
    "",
    "DELIVERY PHOTOS: not stored yet (photo storage isn't set up).",
  ].join("\n");
  return {
    customer_name: c?.name ?? undefined,
    customer_email_address: c?.email ?? undefined,
    billing_address: o.deliveryAddress ?? undefined,
    product_description: `Party equipment rental (${group.orders.flatMap((d) => d.items.map((i) => i.name)).join(", ")}), delivered and picked up by ${BUSINESS_NAME}.`,
    service_date: o.eventDate,
    uncategorized_text: text.slice(0, 19000),
  };
}

/** One button: send Stripe the proof for this dispute (after a confirm step). STRIPE_WRITE_KEY. */
export async function sendDisputeEvidence(disputeRowId: number, userId: number | null, fetcher?: typeof fetch) {
  const [d] = await db.select().from(schema.orderDisputes).where(eq(schema.orderDisputes.id, disputeRowId)).limit(1);
  if (!d || !d.orderId) throw new Error("Dispute not found.");
  if (d.evidenceSentAt) throw new Error("The proof was already sent.");
  const evidence = await disputeEvidence(d.orderId);
  await stripeApi("write", "POST", `/v1/disputes/${d.stripeDisputeId}`, { evidence, submit: true }, { fetcher });
  await db.update(schema.orderDisputes).set({ evidenceSentAt: new Date(), evidenceSentBy: userId, updatedAt: new Date() }).where(eq(schema.orderDisputes.id, d.id));
  await db.insert(schema.auditLog).values({ userId, action: "stripe.dispute_evidence_sent", entityType: "order", entityId: String(d.orderId), after: { dispute: d.stripeDisputeId } });
}

export { StripeError };


