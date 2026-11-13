import { paymentResultLabel } from "@/lib/payment-result";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getOrderWithItems, orderNumber } from "@/lib/orders";
import { formatMoney } from "@/lib/money";
import { formatPhone } from "@/lib/phone";
import { StatusBadge } from "@/components/StatusBadge";
import OrderActions from "./OrderActions";
import ConsentPanel from "./ConsentPanel";
import PromoSignupPanel from "./PromoSignupPanel";
import { requireAdmin } from "@/lib/auth";
import { STAFF_PROMO_MODE, staffPromoStep2, staffPromoVisible } from "@/lib/staff-promo";
import { staffDisclosure } from "@/lib/sms-terms-v2";
import { NO_TEXT_CONSENT, hasTransactionalConsent } from "@/lib/sms";
import DualDate from "@/components/DualDate";
import StripePanel from "./StripePanel";
import { disputesFor } from "@/lib/stripe-ops";
import { LIVE_REFUNDS_APPROVED, refundStatus, refundsFor, refundsSandbox } from "@/lib/refunds";
import RefundPanel from "./RefundPanel";
import { inboxWhen } from "@/lib/inbox-format";
import { db, schema } from "@/lib/db";
import { spokenAnswersFor } from "@/lib/speech-to-text";

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const staff = await requireAdmin();
  const full = await getOrderWithItems(Number(id));
  if (!full) notFound();
  const { order: o, items, customer } = full;
  const due = (o.totalCents ?? o.subtotalCents) - o.paidCents;
  const textStatus = !customer?.phone ? "none" : customer.smsOptOut ? "stopped" : (await hasTransactionalConsent(customer.phone)) ? "ok" : "none";
  return (
    <div className="mx-auto max-w-5xl">
      <Link href="/admin/orders" className="text-sm font-bold text-navy underline-offset-2 hover:underline">← All orders</Link>
      <div className="mb-5 mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-black sm:text-3xl">Order number {orderNumber(o.id)}</h1>
        <StatusBadge status={o.status} />
        <span className="text-sm text-muted">{o.channel === "PHONE" ? "Booked by phone" : "Booked in person"} · <DualDate yi at={o.createdAt} /></span>
      </div>
      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-5">
          <div className="card p-5">
            <div className="mb-4 grid gap-4 sm:grid-cols-2">
              <div><div className="label">Delivery</div><div className="font-bold"><DualDate yi iso={o.eventDate} /></div></div>
              <div><div className="label">Pickup</div><div className="font-bold"><DualDate yi iso={o.pickupDate} /></div></div>
            </div>
            <table className="w-full text-sm">
              <thead><tr><th className="th">Item</th><th className="th">Qty</th><th className="th">Price</th><th className="th text-right">Total</th></tr></thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.id}><td className="td font-semibold">{i.name}</td><td className="td">{i.qty}</td><td className="td">{formatMoney(i.unitPriceCents)}</td><td className="td text-right">{formatMoney(i.qty * i.unitPriceCents)}</td></tr>
                ))}
              </tbody>
            </table>
            <div className="mt-3 space-y-1 text-right">
              {o.totalCents !== null ? (
                <>
                  <div className="text-sm text-muted">Rentals {formatMoney(o.subtotalCents)} · Delivery {formatMoney(o.deliveryFeeCents)} · Sales tax ({o.taxPercent}%) {formatMoney(o.taxCents)}</div>
                  <div>Total <b className="ml-3 text-lg">{formatMoney(o.totalCents)}</b></div>
                </>
              ) : (
                <div>Total <b className="ml-3 text-lg">{formatMoney(o.subtotalCents)}</b></div>
              )}
              <div className="text-sm text-muted">Paid {formatMoney(o.paidCents)}{o.paymentMethod ? ` (${o.paymentMethod})` : ""}{o.solaRefNum ? ` · Sola ref ${o.solaRefNum}` : ""}</div>
              {o.paymentResult && (
                <div data-payment-result className={`text-sm ${o.paymentResult === "declined" ? "font-bold text-coral-dark" : "text-[#13895C] font-semibold"}`}>
                  {paymentResultLabel(o)}
                </div>
              )}
              {refundStatus(o) && <div className="text-sm font-bold text-coral-dark" data-refund-status>{refundStatus(o)}: {formatMoney(o.refundedCents)}</div>}
              {o.stripePaymentId && <div className="text-xs text-muted">Stripe payment {o.stripePaymentId}</div>}
              {due > 0 && <div className="text-sm font-bold text-coral">Balance due {formatMoney(due)}</div>}
            </div>
          </div>
          {staff.role === "owner" && (o.paymentMethod === "stripe" || o.paymentMethod === "sola") && o.paidCents > 0 && (await (async () => {
            // Refund (Owner only; Secretary and Delivery never see it). Stripe phone or Sola website payments.
            const [refunds, disputes] = await Promise.all([refundsFor(o.id), o.paymentMethod === "stripe" ? disputesFor(o.id) : Promise.resolve([])]);
            const users = await db.select({ id: schema.adminUsers.id, name: schema.adminUsers.name }).from(schema.adminUsers);
            const who = (r: { source: string; userId: number | null }) => (r.source === "stripe_dashboard" ? "Stripe dashboard" : r.userId ? (users.find((u) => u.id === r.userId)?.name ?? "Staff") : "Owner");
            const provider = o.paymentMethod === "stripe" ? "stripe" : "sola";
            const ready = LIVE_REFUNDS_APPROVED || refundsSandbox(provider);
            const notReady =
              provider === "stripe"
                ? process.env.STRIPE_REFUNDS_KEY
                  ? "live refunds wait for your OK (sandbox key only for now)."
                  : "Stripe refunds need STRIPE_REFUNDS_KEY in Vercel (sandbox key first)."
                : process.env.SOLA_API_KEY
                  ? "live refunds wait for your OK (Sola sandbox only for now: SOLA_REFUND_MODE=sandbox)."
                  : "Sola refunds need SOLA_API_KEY in Vercel.";
            return (
              <>
                <RefundPanel
                  orderId={o.id}
                  provider={provider === "stripe" ? "Stripe" : "Sola"}
                  leftCents={Math.max(0, o.paidCents - o.refundedCents)}
                  last4={o.cardLast4}
                  status={refundStatus(o)}
                  ready={ready}
                  notReadyReason={ready ? null : notReady}
                  refunds={refunds.map((r) => ({ id: r.id, when: inboxWhen(r.createdAt), amount: formatMoney(r.amountCents), by: who(r), result: r.status === "failed" ? "Failed" : r.status === "pending" ? "Pending" : "Refunded", refundId: r.stripeRefundId, error: r.error }))}
                />
                {disputes.length > 0 && (
                  <StripePanel
                    orderId={o.id}
                    ready={Boolean(process.env.STRIPE_DISPUTES_KEY)}
                    disputes={disputes.map((d) => ({ id: d.id, amount: formatMoney(d.amountCents), reason: (d.reason ?? "").replace(/_/g, " "), status: d.status.replace(/_/g, " "), dueBy: d.evidenceDueBy ? inboxWhen(d.evidenceDueBy) : null, sentAt: d.evidenceSentAt ? inboxWhen(d.evidenceSentAt) : null }))}
                  />
                )}
              </>
            );
          })())}
          {await (async () => {
            const spoken = await spokenAnswersFor(o.callSid);
            if (!spoken.length) return null;
            const fieldName: Record<string, string> = { name: "Name", address: "Address", email: "Email", catalog_local: "Catalog email (before the @)", catalog_domain: "Catalog email (after the @)" };
            return (
              <div className="card p-5" data-spoken-answers>
                <h2 className="mb-1 font-bold">Spoken answers</h2>
                <p className="mb-3 text-xs text-muted">What the caller said, typed up by speech to text (preview test only).</p>
                <ul className="space-y-3">
                  {spoken.map((a) => (
                    <li key={a.id} className="text-sm">
                      <div><b>{fieldName[a.field] ?? a.field}:</b> {a.status === "done" ? a.text || "(nothing understood)" : a.status === "failed" ? "Could not be typed up" : "Still being typed up"}</div>
                      <audio controls preload="none" className="mt-1 w-full" src={`/api/admin/spoken/${a.id}`} />
                    </li>
                  ))}
                </ul>
              </div>
            );
          })()}
          <div className="card p-5">
            <h2 className="mb-3 font-bold">Customer</h2>
            {customer ? (
              <div className="space-y-1">
                <div className="text-lg font-bold">{customer.name}</div>
                {customer.phone && <a className="block text-navy underline-offset-2 hover:underline" href={`tel:${customer.phone}`}>{formatPhone(customer.phone)}</a>}
                {customer.email && <a className="block text-navy underline-offset-2 hover:underline" href={`mailto:${customer.email}`}>{customer.email}</a>}
              </div>
            ) : (
              <p className="text-muted">Not entered yet (caller still on the phone or abandoned cart).</p>
            )}
          </div>
          {customer?.phone && (
            <div data-text-consent className={`card p-4 text-sm font-semibold ${textStatus === "ok" ? "text-[#13895C]" : "text-coral"}`}>
              {textStatus === "ok" ? "Order texts: customer has given text consent." : textStatus === "stopped" ? "Customer replied STOP: no texts of any kind. They must text START and reply YES. Call or email instead." : NO_TEXT_CONSENT}
            </div>
          )}
          {customer?.phone && <ConsentPanel orderId={o.id} phoneDisplay={formatPhone(customer.phone)} disclosures={staffDisclosure()} stopped={textStatus === "stopped"} scopes={["transactional"]} />}
          {staffPromoVisible(staff.role) && (
            <PromoSignupPanel orderId={o.id} phoneDisplay={customer?.phone ? formatPhone(customer.phone) : ""} step2={customer?.phone ? staffPromoStep2(customer.phone) : "Should we text your number, or a different number?"} preview={STAFF_PROMO_MODE !== "live"} stopped={textStatus === "stopped"} />
          )}
        </div>
        <OrderActions
          orderId={o.id}
          status={o.status}
          due={due}
          hasPhone={Boolean(customer?.phone)}
          deliveryAddress={o.deliveryAddress ?? ""}
          deliveryTime={o.deliveryTime ?? ""}
          notes={o.notes ?? ""}
          holdExpiresAt={o.holdExpiresAt?.toISOString() ?? null}
        />
      </div>
    </div>
  );
}
