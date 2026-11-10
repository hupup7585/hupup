import { Download } from "lucide-react";
import Link from "next/link";
import { listOrders } from "@/lib/admin-queries";
import { formatMoney } from "@/lib/money";
import { formatPhone } from "@/lib/phone";
import { orderNumber } from "@/lib/orders";
import { StatusBadge, STATUS_LABEL } from "@/components/StatusBadge";
import { ORDER_STATUSES } from "@/lib/db/schema";
import DualDate from "@/components/DualDate";

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const list = await listOrders({ q: sp.q, status: sp.status || "ALL", from: sp.from, to: sp.to });
  const csv = new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][]).toString();
  return (
    <div className="mx-auto max-w-7xl">
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
                <td className="td font-bold"><Link className="text-navy underline-offset-2 hover:underline" href={`/admin/orders/${o.id}`}>{orderNumber(o.id)}</Link></td>
                <td className="td">{o.customer_name ?? <span className="text-muted">Caller in progress</span>}<div className="text-xs text-muted">{formatPhone(o.customer_phone)}</div></td>
                <td className="td whitespace-nowrap"><DualDate yi iso={o.event_date} style="short" /><div className="text-xs text-muted">→ <DualDate yi iso={o.pickup_date} style="short" /></div></td>
                <td className="td">{o.items}</td>
                <td className="td">{o.channel === "PHONE" ? "Phone" : "In person"}</td>
                <td className="td font-bold">{formatMoney(o.subtotal_cents)}</td>
                <td className={`td ${o.paid_cents >= o.subtotal_cents && o.subtotal_cents > 0 ? "text-mint font-bold" : "text-muted"}`}>{formatMoney(o.paid_cents)}</td>
                <td className="td"><StatusBadge status={o.status} /></td>
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
