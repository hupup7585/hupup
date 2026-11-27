import { paymentResultLabel } from "@/lib/payment-result";
import { Download } from "lucide-react";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { abandonedCartCount, listOrders } from "@/lib/admin-queries";
import { formatMoney } from "@/lib/money";
import { formatPhone } from "@/lib/phone";
import { orderNumber } from "@/lib/orders";
import { StatusBadge, STATUS_LABEL } from "@/components/StatusBadge";
import { ORDER_STATUSES } from "@/lib/db/schema";
import DualDate from "@/components/DualDate";
import { orderPath } from "@/lib/order-path";
import { payState } from "@/lib/pay-label";

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; from?: string; to?: string }>;
}) {
  await requireAdmin(); // Code audit M9: each page checks the sign-in itself, not only the layout
  const sp = await searchParams;
  const status = sp.status || "ALL";
  const list = await listOrders({ q: sp.q, status, from: sp.from, to: sp.to });
  // Admin bugs 2 and 12 (Nov 24, 2026): the count, and how many abandoned phone carts "All" leaves out
  const hidden = status === "ALL" && !sp.q ? await abandonedCartCount({ from: sp.from, to: sp.to }) : 0;
  const csv = new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][]).toString();
  return (
    <div className="w-full">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-black sm:text-3xl">All orders</h1>
        <div className="flex flex-wrap gap-2">
          <a className="btn-ghost" href={`/api/admin/orders.csv?${csv}`}><Download className="inline-block h-4 w-4 align-[-0.15em]" strokeWidth={2} aria-hidden /> Download CSV</a>
          <Link className="btn" href="/admin/pos">+ New booking</Link>
        </div>
      </div>
      <form className="card mb-5 grid gap-3 p-4 sm:grid-cols-[2fr_1fr_1fr_1fr_auto]">
        <input name="q" defaultValue={sp.q} placeholder="Name, phone, address or order number" className="input" />
        <select name="status" defaultValue={sp.status || "ALL"} className="input">
          <option value="ALL">All (except abandoned carts)</option>
          <option value="OPEN">Open (unpaid, confirmed, out)</option>
          {ORDER_STATUSES.map((s) => (
            <option key={s} value={s}>{STATUS_LABEL[s]}</option>
          ))}
        </select>
        <input type="date" name="from" defaultValue={sp.from} className="input" aria-label="From event date" />
        <input type="date" name="to" defaultValue={sp.to} className="input" aria-label="To event date" />
        <button className="btn-dark">Filter</button>
      </form>
      <p className="mb-2 text-sm text-muted" data-order-count>
        <b className="text-navy">{list.length}</b> {list.length === 1 ? "order" : "orders"}
        {hidden > 0 && <> · {hidden} abandoned phone {hidden === 1 ? "cart" : "carts"} not shown (cancelled before a customer was given; choose Cancelled to see them)</>}
      </p>
      <div className="card overflow-x-auto p-4">
        <table className="w-full min-w-[860px] text-sm">
          <thead>
            <tr>
              <th className="th">Order number</th><th className="th">Customer</th><th className="th">Event → pickup</th>
              <th className="th">Items</th><th className="th">Channel</th><th className="th">Total</th><th className="th">Paid</th><th className="th">Status</th>
            </tr>
          </thead>
          <tbody>
            {list.map((o) => (
              <tr key={o.id} className="hover:bg-bg">
                <td className="td font-bold"><Link className="text-navy underline-offset-2 hover:underline" href={orderPath(o.id)}>{orderNumber(o.id)}</Link></td>
                <td className="td">
                  {o.customer_name ?? <span className="text-muted">Caller in progress</span>}
                  <div className="text-xs text-muted">{formatPhone(o.customer_phone)}</div>
                  {o.unit_not_verified && <div data-unit-not-verified className="mt-1 inline-block rounded bg-sun px-1.5 text-xs font-bold text-navy">Unit not verified</div>}
                </td>
                <td className="td whitespace-nowrap"><DualDate yi iso={o.event_date} style="short" /><div className="text-xs text-muted">→ <DualDate yi iso={o.pickup_date} style="short" /></div></td>
                <td className="td">{o.items}</td>
                <td className="td">{o.channel === "PHONE" ? "Phone" : "In person"}</td>
                <td className="td font-bold">{formatMoney(o.total_cents ?? o.subtotal_cents)}</td>
                <td className={`td ${o.paid_cents >= (o.total_cents ?? o.subtotal_cents) && o.subtotal_cents > 0 ? "text-mint font-bold" : "text-muted"}`}>
                  {payState({ totalCents: o.total_cents, subtotalCents: o.subtotal_cents, paidCents: o.paid_cents, paymentResult: o.payment_result }).state}
                  {o.refunded_cents > 0 && (
                    <div data-refund-status className="text-xs font-bold text-coral-dark">{o.refunded_cents >= o.paid_cents ? "Refunded" : "Partly refunded"} {formatMoney(o.refunded_cents)}</div>
                  )}
                  {o.payment_result && (
                    <div data-payment-result className={`text-xs ${o.payment_result === "declined" ? "font-bold text-coral-dark" : "text-muted"}`}>
                      {paymentResultLabel({ paymentResult: o.payment_result, paymentResultAt: o.payment_result_at, cardLast4: o.card_last4 })}
                    </div>
                  )}
                </td>
                <td className="td">
                  <StatusBadge status={o.status} />
                  {o.hold_expires_at && (o.status === "HOLD" || o.status === "PENDING_PAYMENT") && (
                    <div data-hold-end className="mt-1 text-xs font-semibold text-navy">
                      Hold ends {new Date(o.hold_expires_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })}
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {list.length === 0 && (
              <tr><td colSpan={8} className="py-10 text-center text-muted">No orders match.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
