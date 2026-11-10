import Link from "next/link";
import { recentCalls } from "@/lib/admin-queries";
import { formatPhone } from "@/lib/phone";
import { formatMoney } from "@/lib/money";
import { orderNumber } from "@/lib/orders";
import { requireStaff } from "@/lib/auth";
import { blockCallerAction } from "../settings/blocking-actions";
import { StatusBadge } from "@/components/StatusBadge";
import DualDate from "@/components/DualDate";
import SectionNotActive from "@/components/SectionNotActive";
import { safeSection } from "@/lib/safe-section";
import CallYiddishDay from "@/components/CallYiddishDay";
import { callJourneys, type JourneyEvent } from "@/lib/call-journey";

const KIND_STYLE: Record<string, string> = {
  step: "bg-bg text-muted",
  category_heard: "bg-[#E5F3FF] text-[#1170C0]",
  item_heard: "bg-[#E5F3FF] text-[#1170C0]",
  item_details: "bg-[#E5F3FF] text-[#1170C0]",
  item_added: "bg-[#E3F8EF] text-[#13895C]",
  date_asked: "bg-[#FFF4D6] text-[#A87800]",
  date_closed: "bg-[#FFE6E4] text-[#C83A2F]",
  date_unclear: "bg-[#FFE6E4] text-[#C83A2F]",
  unavailable: "bg-[#FFE6E4] text-[#C83A2F]",
  typed: "bg-[#F1E8FF] text-[#6B3FB8]",
  said: "bg-[#F1E8FF] text-[#6B3FB8]",
  booking_finished: "bg-[#E3F8EF] text-[#13895C]",
  hung_up: "bg-[#123D73] text-white",
};
const KIND_TAG: Record<string, string> = {
  step: "Menu", category_heard: "Category", item_heard: "Item", item_details: "Details", item_added: "Added", date_asked: "Date",
  date_closed: "Closed day", date_unclear: "Date unclear", unavailable: "Unavailable", typed: "Typed", said: "Said", booking_finished: "Booked", hung_up: "Ended",
};

function Timeline({ events, start }: { events: JourneyEvent[]; start: Date }) {
  if (!events.length) return <p className="text-xs text-muted">No step-by-step record for this call (calls before Nov 8, 2026 only have the outcome).</p>;
  return (
    <ol className="space-y-1.5" data-timeline>
      {events.map((e) => {
        const secs = Math.max(0, Math.round((new Date(e.at).getTime() - start.getTime()) / 1000));
        const d = e.detail as Record<string, unknown>;
        const extra = e.kind === "step" ? [d.key ? `pressed ${d.key}` : null, d.said ? `said "${d.said}"` : null].filter(Boolean).join(", ") : "";
        return (
          <li key={e.id} className="flex min-w-0 items-start gap-2 text-xs">
            <span className="w-12 shrink-0 pt-0.5 text-right font-mono text-muted">{Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")}</span>
            <span className={`shrink-0 rounded px-1.5 py-0.5 font-bold ${KIND_STYLE[e.kind] ?? "bg-bg"}`}>{KIND_TAG[e.kind] ?? e.kind}</span>
            <span className="min-w-0 break-words">
              {e.label}
              {extra && <span className="text-muted"> · {extra}</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

const OUTCOME: Record<string, [string, string]> = {
  browsing: ["Browsed only", "bg-bg text-muted"],
  carted: ["In cart (live)", "bg-[#E5F3FF] text-[#1170C0]"],
  checked_out: ["Checked out", "bg-[#E3F8EF] text-[#13895C]"],
  dropped: ["Hung up · hold released", "bg-[#FFE6E4] text-[#C83A2F]"],
  forwarded: ["Transferred to you", "bg-[#FFF4D6] text-[#A87800]"],
  voicemail: ["Left a voicemail", "bg-[#F1E8FF] text-[#6B3FB8]"],
};

export default async function CallsPage() {
  const staff = await requireStaff(["owner", "secretary"]);
  const calls = await recentCalls();
  const journeySection = await safeSection("call journeys", callJourneys(calls.map((c) => c.call_sid)));
  const journeys = journeySection.ok ? journeySection.value : new Map<string, JourneyEvent[]>();
  const tz = process.env.BUSINESS_TIMEZONE || "America/New_York";
  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="mb-1 text-2xl font-black sm:text-3xl">Call log</h1>
      {!journeySection.ok && <SectionNotActive title="Call journeys" reason={journeySection.reason} />}
      <p className="mb-5 text-muted">Every call to the hotline. Callers who hung up with items in their cart are listed so you can call them back. Open &ldquo;Journey&rdquo; on a call to see every menu, key, item, date and answer, and where the caller hung up.</p>
      <div className="card overflow-x-auto p-4">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr><th className="th">When</th><th className="th">Caller</th><th className="th">Name</th><th className="th">Outcome</th><th className="th">Order</th><th className="th">Duration</th></tr>
          </thead>
          <tbody>
            {calls.map((c) => {
              const [label, cls] = OUTCOME[c.outcome] ?? [c.outcome, "bg-bg"];
              const dur = c.ended_at ? Math.round((new Date(c.ended_at).getTime() - new Date(c.started_at).getTime()) / 1000) : null;
              const ev = journeys.get(c.call_sid) ?? [];
              return [
                <tr key={c.call_sid} className="hover:bg-bg">
                  <td className="td whitespace-nowrap"><DualDate at={c.started_at} /><br /><CallYiddishDay at={c.started_at} /></td>
                  <td className="td">
                    {c.from_number ? <a className="text-navy underline-offset-2 hover:underline" href={`tel:${c.from_number}`}>{formatPhone(c.from_number)}</a> : "Unknown"}
                    {staff.role === "owner" && c.from_number && (
                      <form action={blockCallerAction.bind(null, c.from_number)} className="inline">
                        <button className="ml-2 text-xs font-semibold text-muted hover:text-[#C83A2F]" title="Blocked callers hear a busy signal (Settings → Caller blocking)">Block</button>
                      </form>
                    )}
                  </td>
                  <td className="td">{c.customer_name ?? "—"}</td>
                  <td className="td"><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${cls}`}>{label}</span></td>
                  <td className="td">
                    {c.order_id ? (
                      <Link href={`/admin/orders/${c.order_id}`} className="flex items-center gap-2">
                        <b className="text-navy underline-offset-2 hover:underline">Order number {orderNumber(c.order_id)}</b>
                        {c.order_status && <StatusBadge status={c.order_status} />}
                        {c.subtotal_cents ? <span className="text-muted">{formatMoney(c.subtotal_cents)}</span> : null}
                      </Link>
                    ) : "—"}
                  </td>
                  <td className="td text-muted">{dur === null ? (c.status === "in_progress" ? "On the line" : "—") : `${Math.floor(dur / 60)}m ${dur % 60}s`}</td>
                </tr>,
                <tr key={`${c.call_sid}-j`} className="border-b border-line">
                  <td colSpan={6} className="px-3 pb-3">
                    <details>
                      <summary className="cursor-pointer text-xs font-bold text-navy">Journey ({ev.filter((e) => e.kind !== "step").length} events, {ev.filter((e) => e.kind === "step").length} steps)</summary>
                      <div className="mt-2">
                        <Timeline events={ev} start={new Date(c.started_at)} />
                      </div>
                    </details>
                  </td>
                </tr>,
              ];
            })}
            {calls.length === 0 && <tr><td colSpan={6} className="py-10 text-center text-muted">No calls yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
