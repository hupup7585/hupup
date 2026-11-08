import { requireOwner } from "@/lib/auth";
import Link from "next/link";
import { kpis, leaderboard, listOrders, todaysRuns, weeklyRevenue, channelSplit } from "@/lib/admin-queries";
import { addDays, endOfMonth, shortDate, startOfMonth, startOfWeek, todayISO } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { formatPhone } from "@/lib/phone";
import { StatusBadge } from "@/components/StatusBadge";
import { orderNumber } from "@/lib/orders";
import DualDate, { HebrewDay } from "@/components/DualDate";
import { dualDate } from "@/lib/dual-date";
import { callAnalytics } from "@/lib/call-analytics";
import CallsCard from "./CallsCard";
import JourneyCard from "./JourneyCard";
import { journeyStats } from "@/lib/call-journey";

const RANGES = { week: "This week", month: "This month", year: "This year" } as const;
type Range = keyof typeof RANGES;

function rangeDates(r: Range, today: string): [string, string] {
  if (r === "week") return [startOfWeek(today), addDays(startOfWeek(today), 6)];
  if (r === "year") return [today.slice(0, 4) + "-01-01", today.slice(0, 4) + "-12-31"];
  return [startOfMonth(today), endOfMonth(today)];
}

function delta(cur: number, prev: number) {
  if (!prev) return cur ? "New this period" : "—";
  const pct = Math.round(((cur - prev) / prev) * 100);
  return `${pct >= 0 ? "▲" : "▼"} ${Math.abs(pct)}% vs previous`;
}

function greeting() {
  const h = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: process.env.BUSINESS_TIMEZONE || "America/New_York" }).format(new Date()));
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  await requireOwner(); // Owner only (finances, catalog, hotline prompts)
  const sp = await searchParams;
  const range: Range = (sp.range as Range) in RANGES ? (sp.range as Range) : "month";
  const today = todayISO();
  const [from, to] = rangeDates(range, today);
  const [k, runs, weeks, board, split, upcoming, calls, journey] = await Promise.all([
    kpis(from, to),
    todaysRuns(today),
    weeklyRevenue(today),
    leaderboard(from, to),
    channelSplit(from, to),
    listOrders({ status: "OPEN", from: today, limit: 8 }),
    callAnalytics(range === "week" ? 7 : range === "year" ? 365 : 30),
    journeyStats(range === "week" ? 7 : range === "year" ? 365 : 30),
  ]);
  const thisWeek = startOfWeek(today);
  const maxWeek = Math.max(1, ...weeks.map((w) => Math.max(w.phone, w.pos)));
  const maxBoard = Math.max(1, ...board.map((b) => b.cents));
  const phone = split.find((s) => s.channel === "PHONE");
  const pos = split.find((s) => s.channel === "POS");

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-black sm:text-3xl">{greeting()}, Abram 👋</h1>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(RANGES) as Range[]).map((r) => (
            <Link key={r} href={`/admin?range=${r}`} className={`btn-ghost ${r === range ? "!border-navy" : ""}`}>
              {RANGES[r]}
            </Link>
          ))}
          <a href={`/api/admin/orders.csv?from=${from}&to=${to}`} className="btn-ghost">⬇ Export CSV</a>
        </div>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="card p-5">
          <div className="text-sm font-semibold text-muted">Booked revenue</div>
          <div className="my-1 text-3xl font-black">{formatMoney(k.revenue)}</div>
          <div className="text-sm font-bold text-mint">{delta(k.revenue, k.prevRevenue)}</div>
        </div>
        <div className="card p-5">
          <div className="text-sm font-semibold text-muted">Orders</div>
          <div className="my-1 text-3xl font-black">{k.orders}</div>
          <div className="text-sm text-muted">
            {k.pendingCount ? `+ ${k.pendingCount} awaiting payment (${formatMoney(k.pendingCents)})` : delta(k.orders, k.prevOrders)}
          </div>
        </div>
        <div className="card p-5">
          <div className="text-sm font-semibold text-muted">Fleet utilization</div>
          <div className="my-1 text-3xl font-black">{Math.round(k.utilization * 100)}%</div>
          <div className="text-sm text-muted">of unit-days booked</div>
        </div>
        <Link href={`/admin/calendar?day=${today}`} className="card p-5 hover:border-sky">
          <div className="text-sm font-semibold text-muted">Today</div>
          <div className="my-1 text-3xl font-black">
            {runs.deliveries} / {runs.pickups}
          </div>
          <div className="text-sm text-muted">deliveries / pickups →</div>
        </Link>
      </div>

      <div className="mb-5 grid gap-5 lg:grid-cols-[1.6fr_1fr]">
        <div className="card p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-bold">Revenue by event week <span className="text-xs font-semibold text-muted">(faded = upcoming)</span></h2>
            <div className="flex gap-3 text-xs font-semibold text-muted">
              <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-sky" />Phone {phone ? `· ${phone.n}` : ""}</span>
              <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-coral" />In person (POS) {pos ? `· ${pos.n}` : ""}</span>
            </div>
          </div>
          <div className="flex h-52 items-end gap-2 border-b border-line sm:gap-4">
            {weeks.map((w) => (
              <div key={w.week} className="flex h-full flex-1 items-end gap-1" title={`Week of ${dualDate(w.week, "short")}: phone ${formatMoney(w.phone)}, POS ${formatMoney(w.pos)}`}>
                <div className={`flex-1 rounded-t-md bg-sky ${w.week > thisWeek ? "opacity-50" : ""}`} style={{ height: `${(w.phone / maxWeek) * 100}%`, minHeight: w.phone ? 4 : 0 }} />
                <div className={`flex-1 rounded-t-md bg-coral ${w.week > thisWeek ? "opacity-50" : ""}`} style={{ height: `${(w.pos / maxWeek) * 100}%`, minHeight: w.pos ? 4 : 0 }} />
              </div>
            ))}
          </div>
          <div className="mt-1.5 flex gap-2 text-[11px] text-muted sm:gap-4">
            {weeks.map((w) => (
              <span key={w.week} className={`flex-1 text-center ${w.week === thisWeek ? "font-bold text-navy" : ""}`}>{w.week === thisWeek ? "This wk" : shortDate(w.week).replace(/^\w+, /, "")}<HebrewDay yi iso={w.week} className="block" /></span>
            ))}
          </div>
        </div>

        <div className="card p-5">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-lg font-bold">🏆 Leaderboard</h2>
            <span className="text-xs font-semibold text-muted">by revenue · {RANGES[range].toLowerCase()}</span>
          </div>
          {board.length === 0 && <p className="py-8 text-center text-muted">No booked orders in this period yet.</p>}
          {board.map((b, i) => (
            <div key={b.id} className="flex items-center gap-3 border-b border-line py-2.5 last:border-0">
              <div className={`grid h-7 w-7 place-items-center rounded-lg text-sm font-black ${i === 0 ? "bg-sun" : "bg-bg"}`}>{i + 1}</div>
              <div className="min-w-0 flex-1">
                <div className="truncate font-bold">{b.name}</div>
                <div className="text-xs text-muted">
                  {b.bookings} booking{b.bookings === 1 ? "" : "s"} · {formatMoney(b.cents)}
                </div>
              </div>
              <div className="h-2 w-20 overflow-hidden rounded-full bg-bg">
                <div className="h-full bg-coral" style={{ width: `${(b.cents / maxBoard) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      <CallsCard a={calls} periodLabel={range === "week" ? "Last 7 days" : range === "year" ? "Last 365 days" : "Last 30 days"} />
      <JourneyCard j={journey} periodLabel={range === "week" ? "Last 7 days" : range === "year" ? "Last 365 days" : "Last 30 days"} />

      <div className="card overflow-x-auto p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold">Upcoming orders</h2>
          <Link href="/admin/orders" className="text-sm font-bold text-navy underline-offset-2 hover:underline">All orders →</Link>
        </div>
        {upcoming.length === 0 ? (
          <p className="py-8 text-center text-muted">No upcoming orders.</p>
        ) : (
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr>
                <th className="th">Order</th><th className="th">Customer</th><th className="th">Event date</th>
                <th className="th">Items</th><th className="th">Channel</th><th className="th">Total</th><th className="th">Status</th>
              </tr>
            </thead>
            <tbody>
              {upcoming.map((o) => (
                <tr key={o.id} className="hover:bg-bg">
                  <td className="td font-bold"><Link href={`/admin/orders/${o.id}`}>#{orderNumber(o.id)}</Link></td>
                  <td className="td">{o.customer_name ?? "—"}<div className="text-xs text-muted">{formatPhone(o.customer_phone)}</div></td>
                  <td className="td whitespace-nowrap"><DualDate yi iso={o.event_date} style="short" /> <span className="text-muted">→ pickup <DualDate yi iso={o.pickup_date} style="short" /></span></td>
                  <td className="td">{o.items}</td>
                  <td className="td">{o.channel === "PHONE" ? "📞 Phone" : "🖥 POS"}</td>
                  <td className="td font-bold">{formatMoney(o.subtotal_cents)}</td>
                  <td className="td"><StatusBadge status={o.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
