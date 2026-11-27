import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { BUSINESS_NAME, config } from "@/lib/config";
import { sendEmail } from "@/lib/notify";
import { getPaymentGroup, orderNumber } from "@/lib/orders";
import { recordAutoMoneyOut } from "@/lib/books";
import { messageDate } from "@/lib/dual-date";
import { StripeError, stripeApi } from "@/lib/stripe";
import { applyRefund } from "@/lib/refunds";
export { refundOrder, refundStatus, refundsFor } from "@/lib/refunds";
import { inboxWhen } from "@/lib/inbox-format";
import { PROMPTS, fill } from "@/lib/ivr/prompts";
import { orderPath } from "@/lib/order-path";

/* Stripe refunds, fees and payouts, disputes (Abraham, Nov 12, 2026). Nothing is ever deleted. */

const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const nyDate = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });

type Ord = typeof schema.orders.$inferSelect;
async function orderById(id: number): Promise<Ord | null> {
  const [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, id)).limit(1);
  return o ?? null;
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
type Charge = { id: string; payment_intent?: string | null; amount_refunded?: number; refunds?: { data: { id: string; amount: number; status: string }[] } };

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
          `A customer disputed a Stripe phone payment.\n\nOrder: ${o ? `#${orderNumber(o.id)} (${config.baseUrl()}${orderPath(o.id)})` : "not matched"}\nAmount: ${money(d.amount)}\nReason: ${d.reason.replace(/_/g, " ")}\n${due ? `Send proof by: ${inboxWhen(due)}\n` : ""}\nOpen the order in Admin and press "Send proof to Stripe".`,
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
    // Deep check 0600 M12: a charge's refund notices are handled one at a time (two arriving together both recorded it)
    await oneAtATime(`stripe-refund:${c.id}`, async () => {
      const list = c.refunds?.data ?? [];
      for (const r of list) await applyRefund(o, { amountCents: r.amount, refundId: r.id, provider: "stripe", source: "stripe_dashboard", userId: null, status: r.status });
      // Deep check 16 (Nov 27, 2026): newer Stripe API versions send no refunds list on the charge. Then the charge's
      // total refunded is compared with what is already recorded, and only the part not recorded yet is added.
      // Deep check 0600 M11: a payment that covered several days has the same payment id on every day, so what is
      // already recorded is counted across all of them (it looked at one day only and recorded refunds twice).
      if (!list.length && (c.amount_refunded ?? 0) > 0) {
        const ids = (await db.select({ id: schema.orders.id }).from(schema.orders).where(inArray(schema.orders.stripePaymentId, [c.id, c.payment_intent].filter((x): x is string => Boolean(x))))).map((x) => x.id);
        const rec = (await db.execute(sql`SELECT COALESCE(SUM(amount_cents), 0)::int AS c FROM order_refunds WHERE order_id IN (${sql.join((ids.length ? ids : [o.id]).map((i) => sql`${i}`), sql`, `)}) AND provider = 'stripe' AND status <> 'failed'`)).rows[0] as { c: number };
        const missing = (c.amount_refunded ?? 0) - Number(rec?.c ?? 0);
        if (missing > 0) await applyRefund(o, { amountCents: missing, refundId: `stripe-charge:${c.id}:${c.amount_refunded}`, provider: "stripe", source: "stripe_dashboard", userId: null, status: "succeeded" });
      }
    });
    return;
  }
  // Deep check Nov 27 (item 16): newer Stripe API versions leave the refunds out of the charge, so the refund's own
  // notice records it (the same refund from either notice is recorded once)
  if (event.type === "refund.created" || event.type === "refund.updated" || event.type === "charge.refund.updated") {
    const r = event.data.object as unknown as { id: string; amount: number; status: string; charge: string | null; payment_intent: string | null; failure_reason?: string | null };
    // Deep check 0600 M12 (second half, Nov 27, 2026): a refund that was pending and then failed (or was canceled)
    // never went back to the customer, so it is taken off the order and corrected in Bookkeeping
    if (r?.id && (r.status === "failed" || r.status === "canceled")) {
      const { reverseFailedRefund } = await import("@/lib/refunds");
      await oneAtATime(`stripe-refund:${r.charge ?? r.payment_intent ?? r.id}`, async () => {
        await reverseFailedRefund(r.id, r.failure_reason || r.status, r.charge ?? r.payment_intent ?? null);
      });
      return;
    }
    if (!r?.id || !(r.status === "succeeded" || r.status === "pending")) return;
    const o = await orderForPayment(r.charge ?? "", r.payment_intent);
    if (!o) return;
    await oneAtATime(`stripe-refund:${r.charge ?? r.payment_intent ?? r.id}`, async () => {
      // a charge.refunded notice with no list already recorded this charge's refunds by its total (fallback): not again
      if ((await db.execute(sql`SELECT 1 FROM order_refunds WHERE stripe_refund_id LIKE ${`stripe-charge:${r.charge ?? ""}:%`} LIMIT 1`)).rows.length) return;
      await applyRefund(o, { amountCents: r.amount, refundId: r.id, provider: "stripe", source: "stripe_dashboard", userId: null, status: r.status });
    });
  }
}

/**
 * Runs fn while holding a short lock row in app_settings (deep check 0600 M12): two Stripe notices for the same charge
 * arriving together are handled one after the other. A lock older than 30 seconds (a run that crashed) is taken over.
 * The lock row is only a marker and is removed when done.
 */
async function oneAtATime(key: string, fn: () => Promise<void>) {
  const k = `lock:${key}`;
  for (let i = 0; i < 100; i++) {
    const got = await db.execute(sql`INSERT INTO app_settings (key, value, updated_at) VALUES (${k}, '"locked"'::jsonb, now())
      ON CONFLICT (key) DO UPDATE SET updated_at = now() WHERE app_settings.updated_at < now() - interval '30 seconds' RETURNING key`);
    if (got.rows.length) {
      try {
        await fn();
      } finally {
        await db.execute(sql`DELETE FROM app_settings WHERE key = ${k}`);
      }
      return;
    }
    await new Promise((res) => setTimeout(res, 100));
  }
  throw new Error(`Busy: ${key}`);
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
    ...group.orders.map((d) => `${messageDate(d.order.eventDate)}: ${[...d.items.map((i) => `${i.qty} x ${i.name}`), ...(d.services ?? []).map((s) => `${s.name} ${money(s.amountCents)}`)].join(", ")}. Delivered to ${d.order.deliveryAddress ?? "the customer's address"}, picked up ${messageDate(d.order.pickupDate)}. Status: ${d.order.status.toLowerCase().replace(/_/g, " ")}.`),
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

/** One button: send Stripe the proof for this dispute (after a confirm step). STRIPE_DISPUTES_KEY. */
export async function sendDisputeEvidence(disputeRowId: number, userId: number | null, fetcher?: typeof fetch) {
  const [d] = await db.select().from(schema.orderDisputes).where(eq(schema.orderDisputes.id, disputeRowId)).limit(1);
  if (!d || !d.orderId) throw new Error("Dispute not found.");
  if (d.evidenceSentAt) throw new Error("The proof was already sent.");
  const evidence = await disputeEvidence(d.orderId);
  await stripeApi("disputes", "POST", `/v1/disputes/${d.stripeDisputeId}`, { evidence, submit: true }, { fetcher });
  await db.update(schema.orderDisputes).set({ evidenceSentAt: new Date(), evidenceSentBy: userId, updatedAt: new Date() }).where(eq(schema.orderDisputes.id, d.id));
  await db.insert(schema.auditLog).values({ userId, action: "stripe.dispute_evidence_sent", entityType: "order", entityId: String(d.orderId), after: { dispute: d.stripeDisputeId } });
}

export { StripeError };


