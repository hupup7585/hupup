import Link from "next/link";
import { recentCalls } from "@/lib/admin-queries";
import { formatPhone } from "@/lib/phone";
import { formatMoney } from "@/lib/money";
import { orderNumber } from "@/lib/orders";
import ExportButtons from "@/components/ExportButtons";
import { StatusBadge } from "@/components/StatusBadge";

const OUTCOME: Record<string, [string, string]> = {
  browsing: ["Browsed only", "bg-bg text-muted"],
  carted: ["In cart (live)", "bg-[#E5F3FF] text-[#1170C0]"],
  checked_out: ["Checked out", "bg-[#E3F8EF] text-[#13895C]"],
  dropped: ["Hung up · hold released", "bg-[#FFE6E4] text-[#C83A2F]"],
  forwarded: ["Transferred to you", "bg-[#FFF4D6] text-[#A87800]"],
  voicemail: ["Left a voicemail", "bg-[#F1E8FF] text-[#6B3FB8]"],
};

export default async function CallsPage() {
  const calls = await recentCalls();
  const tz = process.env.BUSINESS_TIMEZONE || "America/New_York";
  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-black sm:text-3xl">Call log</h1>
        <ExportButtons report="calls" />
      </div>
      <p className="mb-5 text-muted">Every call to the hotline. Callers who hung up with items in their cart are listed so you can call them back.</p>
      <div className="card overflow-x-auto p-4">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr><th className="th">When</th><th className="th">Caller</th><th className="th">Name</th><th className="th">Outcome</th><th className="th">Order</th><th className="th">Duration</th></tr>
          </thead>
          <tbody>
            {calls.map((c) => {
              const [label, cls] = OUTCOME[c.outcome] ?? [c.outcome, "bg-bg"];
              const dur = c.ended_at ? Math.round((new Date(c.ended_at).getTime() - new Date(c.started_at).getTime()) / 1000) : null;
              return (
                <tr key={c.call_sid} className="hover:bg-bg">
                  <td className="td whitespace-nowrap">{new Date(c.started_at).toLocaleString("en-US", { timeZone: tz, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</td>
                  <td className="td">{c.from_number ? <a className="text-navy underline-offset-2 hover:underline" href={`tel:${c.from_number}`}>{formatPhone(c.from_number)}</a> : "Unknown"}</td>
                  <td className="td">{c.customer_name ?? "—"}</td>
                  <td className="td"><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${cls}`}>{label}</span></td>
                  <td className="td">
                    {c.order_id ? (
                      <Link href={`/admin/orders/${c.order_id}`} className="flex items-center gap-2">
                        <b className="text-navy underline-offset-2 hover:underline">#{orderNumber(c.order_id)}</b>
                        {c.order_status && <StatusBadge status={c.order_status} />}
                        {c.subtotal_cents ? <span className="text-muted">{formatMoney(c.subtotal_cents)}</span> : null}
                      </Link>
                    ) : "—"}
                  </td>
                  <td className="td text-muted">{dur === null ? (c.status === "in_progress" ? "On the line" : "—") : `${Math.floor(dur / 60)}m ${dur % 60}s`}</td>
                </tr>
              );
            })}
            {calls.length === 0 && <tr><td colSpan={6} className="py-10 text-center text-muted">No calls yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
