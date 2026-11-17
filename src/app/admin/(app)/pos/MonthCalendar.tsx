"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { calendarFor, type CalendarDay } from "./actions";
import { HebrewDay } from "@/components/DualDate";

/**
 * New booking: month calendar (Abraham, Nov 17, 2026). Week rows Sunday to Saturday, one box per day with the English
 * date, the Hebrew date and the day's name or "Closes early". Closed days and past days are greyed out and can't be
 * chosen. Arrows move a month at a time.
 */
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** The first Sunday on or before the 1st of the month (YYYY-MM-DD). */
export function gridStart(month: string): string {
  const d = new Date(`${month}-01T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.toISOString().slice(0, 10);
}

export function shiftMonth(month: string, by: number): string {
  const d = new Date(`${month}-01T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + by);
  return d.toISOString().slice(0, 7);
}

const monthTitle = (month: string) => new Date(`${month}-01T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

export default function MonthCalendar({ today, value, onPick, initialDays }: { today: string; value: string; onPick: (iso: string) => void; initialDays?: CalendarDay[] }) {
  const [month, setMonth] = useState((value || today).slice(0, 7));
  const [days, setDays] = useState<CalendarDay[]>(initialDays ?? []);
  const firstMonth = today.slice(0, 7);

  useEffect(() => {
    if (initialDays && month === (value || today).slice(0, 7) && days === initialDays) return;
    let live = true;
    calendarFor(gridStart(month), 42).then((d) => live && setDays(d));
    return () => {
      live = false;
    };
  }, [month]);

  // Hide a last row that belongs entirely to the next month
  const rows = days.length === 42 && days[35].date.slice(0, 7) !== month ? days.slice(0, 35) : days;

  return (
    <div className="mb-3" data-month-calendar>
      <div className="mb-2 flex items-center justify-between">
        <button type="button" className="btn-secondary !px-2" disabled={month <= firstMonth} onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month" data-prev-month>
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div className="text-base font-bold text-navy" data-month-title>{monthTitle(month)}</div>
        <button type="button" className="btn-secondary !px-2" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Next month" data-next-month>
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-bold uppercase text-muted">
        {WEEKDAYS.map((w) => (
          <div key={w}>{w}</div>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {rows.map((d) => {
          const other = d.date.slice(0, 7) !== month;
          const past = d.date < today;
          const off = d.closed || past;
          const chosen = d.date === value;
          const label = d.closed ? d.reason : d.closesAtLabel ? "Closes early" : d.names[0] ?? "";
          return (
            <button
              key={d.date}
              type="button"
              disabled={off}
              onClick={() => onPick(d.date)}
              title={d.closed ? `Closed: ${d.reason}` : d.names.join(", ") || d.hebrew}
              data-day={d.date}
              data-closed={d.closed || undefined}
              className={`min-h-[4.25rem] min-w-0 rounded-lg border p-1 text-left text-[11px] leading-tight sm:p-1.5 sm:text-xs ${
                chosen ? "border-navy bg-navy text-white" : off ? "cursor-not-allowed border-line bg-bg text-muted" : "border-line bg-white hover:border-navy"
              } ${other && !chosen ? "opacity-50" : ""}`}
            >
              <span className={`block text-sm font-bold ${d.closed && !chosen ? "line-through" : ""}`}>{Number(d.date.slice(8))}</span>
              <HebrewDay yi iso={d.date} className="block truncate" />
              <span className="block truncate">{label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
