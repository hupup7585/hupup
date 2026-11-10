import { Compass } from "lucide-react";
import type { JourneyStats } from "@/lib/call-journey";
import { longDate } from "@/lib/dates";

/** Dashboard (Abraham S): what callers ask for and where they hang up without booking. */
export default function JourneyCard({ j, periodLabel }: { j: JourneyStats; periodLabel: string }) {
  return (
    <div className="card mb-5 p-5" data-journey-card>
      <h2 className="mb-4 text-lg font-bold">
        <Compass className="inline-block h-4 w-4 align-[-0.15em]" strokeWidth={2} aria-hidden /> What callers ask for <span className="text-xs font-semibold text-muted">· {periodLabel.toLowerCase()} · {j.finished} booking{j.finished === 1 ? "" : "s"} finished</span>
      </h2>
      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
        <List title="Most-requested items" empty="No items heard yet." rows={j.topItems.map((r) => [r.name, `${r.heard} heard · ${r.added} added`, r.heard])} />
        <List title="Most-requested dates" empty="No dates asked yet." rows={j.topDates.map((r) => [longDate(r.date), `${r.calls} call${r.calls === 1 ? "" : "s"}`, r.calls])} />
        <List title="Asked for but unavailable" empty="Nothing sold out for callers." rows={j.unavailable.map((r) => [r.name, `${r.times}×`, r.times])} />
        <List title="Where callers hang up (no booking)" empty="No drop-offs yet." rows={j.dropOff.map((r) => [r.step, `${r.calls}`, r.calls])} />
      </div>
    </div>
  );
}

function List({ title, rows, empty }: { title: string; rows: [string, string, number][]; empty: string }) {
  const max = Math.max(1, ...rows.map((r) => r[2]));
  return (
    <div className="min-w-0">
      <h3 className="mb-2 text-sm font-bold text-muted">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">{empty}</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map(([name, note, v]) => (
            <li key={name} className="text-sm">
              <div className="flex justify-between gap-2">
                <span className="min-w-0 truncate font-semibold">{name}</span>
                <span className="shrink-0 text-muted">{note}</span>
              </div>
              <div className="mt-0.5 h-1.5 rounded bg-line">
                <div className="h-1.5 rounded bg-sky" style={{ width: `${(v / max) * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
