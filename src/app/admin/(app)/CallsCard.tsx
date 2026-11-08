import Link from "next/link";
import type { CallAnalytics } from "@/lib/call-analytics";
import { HebrewDay } from "@/components/DualDate";

/** Staff labels for the main-menu keys (what each key does today). */
export const MENU_KEY_LABELS: [string, string][] = [
  ["1", "1 · Reservations and bookings"],
  ["2", "2 · Equipment instructions"],
  ["3", "3 · Learn about rentals"],
  ["4", "4 · Customer service"],
  ["5", "5 · Help during a rental"],
  ["6", "6 · Delivery and pickup"],
  ["7", "7 · Hours"],
  ["8", "8 · Schools and organizations"],
  ["9", "9 · Voicemail"],
  ["0", "0 · Operator"],
  ["*", "* · Replayed the menu"],
];

const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? "AM" : "PM"}`;
const length = (s: number | null) => (s === null ? "—" : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`);

/** Dashboard: hotline call analytics (Abraham's priority 7). */
export default function CallsCard({ a, periodLabel }: { a: CallAnalytics; periodLabel: string }) {
  const bars = a.byDay.slice(-14);
  const maxDay = Math.max(1, ...bars.map((d) => d.calls));
  const outcomes: [string, number, string][] = [
    ["Booked by phone", a.outcomes.booked, "bg-mint"],
    ["Rang staff", a.outcomes.toStaff, "bg-sky"],
    ["Voicemail", a.outcomes.voicemail, "bg-sun"],
    ["Left with items in cart", a.outcomes.abandonedCart, "bg-coral"],
    ["Hung up in the menu", a.outcomes.noChoice, "bg-line"],
  ];
  const maxKey = Math.max(1, ...Object.values(a.keys));
  return (
    <div className="card mb-5 p-5" data-calls-card>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold">
          📞 Hotline calls <span className="text-xs font-semibold text-muted">· {periodLabel.toLowerCase()}</span>
        </h2>
        <Link href="/admin/calls" className="text-sm font-bold text-navy underline-offset-2 hover:underline">
          Call log →
        </Link>
      </div>
      <div className="mb-5 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Calls" value={a.total} />
        <Stat label="Today" value={a.today} />
        <Stat label="Missed" value={a.missed} note="no one took the call" />
        <Stat label="Voicemails left" value={a.voicemailsLeft} />
        <Stat label="Average call" value={length(a.avgSeconds)} />
        <Stat label="Busiest hour" value={a.busiestHour ? hourLabel(a.busiestHour.hour) : "—"} note={a.busiestHour ? `${a.busiestHour.calls} call${a.busiestHour.calls === 1 ? "" : "s"}` : undefined} />
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <div>
          <h3 className="mb-2 text-sm font-bold text-muted">Last 14 days</h3>
          <div className="flex h-28 items-end gap-1 border-b border-line">
            {bars.map((d) => (
              <div key={d.day} className="flex h-full flex-1 items-end" title={`${d.day}: ${d.calls} call${d.calls === 1 ? "" : "s"}`}>
                <div className="w-full rounded-t bg-sky" style={{ height: `${(d.calls / maxDay) * 100}%`, minHeight: d.calls ? 3 : 0 }} />
              </div>
            ))}
          </div>
          <div className="mt-1 flex justify-between text-[11px] text-muted">
            <span>
              {bars[0]?.day.slice(5)} <HebrewDay iso={bars[0]?.day ?? ""} />
            </span>
            <span>
              {bars.at(-1)?.day.slice(5)} <HebrewDay iso={bars.at(-1)?.day ?? ""} />
            </span>
          </div>
        </div>
        <div>
          <h3 className="mb-2 text-sm font-bold text-muted">What happened</h3>
          <ul className="space-y-1.5 text-sm">
            {outcomes.map(([label, n, color]) => (
              <li key={label} className="flex items-center gap-2">
                <span className={`inline-block h-2.5 w-2.5 rounded-sm ${color}`} aria-hidden />
                <span className="flex-1">{label}</span>
                <span className="font-bold">{n}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="mb-2 text-sm font-bold text-muted">Main menu choices</h3>
          {Object.keys(a.keys).length === 0 ? (
            <p className="text-sm text-muted">No menu choices recorded yet. Counting started Nov 8, 2026.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {MENU_KEY_LABELS.filter(([k]) => a.keys[k]).map(([k, label]) => (
                <li key={k} className="flex items-center gap-2">
                  <span className="w-56 shrink-0 truncate" title={label}>{label}</span>
                  <span className="h-2 flex-1 overflow-hidden rounded-full bg-bg">
                    <span className="block h-full bg-navy" style={{ width: `${(a.keys[k] / maxKey) * 100}%` }} />
                  </span>
                  <span className="w-8 text-right font-bold">{a.keys[k]}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: string | number; note?: string }) {
  return (
    <div>
      <div className="text-sm font-semibold text-muted">{label}</div>
      <div className="text-2xl font-black">{value}</div>
      {note && <div className="text-xs text-muted">{note}</div>}
    </div>
  );
}
