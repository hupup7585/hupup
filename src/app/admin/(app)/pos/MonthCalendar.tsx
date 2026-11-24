"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { calendarFor, type CalendarDay } from "./actions";
import { dualParts } from "@/lib/dual-date";
import { DAY_YI, yiddishDay } from "@/lib/yiddish-day";
import { dayHolidayNames, dayHolidays } from "@/lib/hup-calendar/day-names";

/**
 * New booking: month calendar (Abraham, Nov 17, 2026). Week rows Sunday to Saturday, one box per day with the English
 * date, the Hebrew date, the Yiddish day name and the day's name or "Closes early"; the week's parsha once above each
 * row. Closed days and past days are greyed out and can't be chosen. Arrows move a month at a time.
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

/** "פרשת וישב" for the week (from the Saturday's Yiddish day line), or "". */
export function weekParsha(saturday: string): string {
  const t = yiddishDay(saturday);
  const i = t.indexOf("פרשת");
  return i >= 0 ? t.slice(i) : "";
}

/** The Hebrew months a grid covers: "חשון – כסלו". */
function hebrewMonths(days: CalendarDay[], month: string): string {
  const names: string[] = [];
  for (const d of days) {
    if (d.date.slice(0, 7) !== month) continue;
    const m = dualParts(d.date, "short").he.split(" ").slice(1).join(" ");
    if (m && !names.includes(m)) names.push(m);
  }
  return names.join(" – ");
}

export default function MonthCalendar({ today, value, onPick, initialDays }: { today: string; value: string; onPick: (iso: string) => void; initialDays?: CalendarDay[] }) {
  const startMonth = (value || today).slice(0, 7);
  const [month, setMonth] = useState(startMonth);
  const [days, setDays] = useState<CalendarDay[]>(initialDays ?? []);
  const firstMonth = today.slice(0, 7);
  // Search a date (Abraham, Nov 17, 2026): jumps to its month and marks the day
  const [found, setFound] = useState("");
  function goTo(iso: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return;
    setFound(iso);
    setMonth(iso.slice(0, 7));
  }

  useEffect(() => {
    if (initialDays && month === startMonth && days === initialDays) return;
    let live = true;
    calendarFor(gridStart(month), 42).then((d) => live && setDays(d));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  // Week rows; a last row that belongs entirely to the next month is left out
  const weeks: CalendarDay[][] = [];
  for (let i = 0; i + 7 <= days.length; i += 7) weeks.push(days.slice(i, i + 7));
  if (weeks.length === 6 && weeks[5][0].date.slice(0, 7) !== month) weeks.pop();

  return (
    <div className="mb-3" data-month-calendar>
      <div className="mb-2 flex items-center justify-between gap-2">
        <button type="button" className="btn-ghost !px-2" disabled={month <= firstMonth} onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month" data-prev-month>
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div className="text-center">
          <div className="text-base font-bold text-navy" data-month-title>{monthTitle(month)}</div>
          <bdi dir="rtl" lang="yi" className="block text-sm font-semibold text-muted" data-hebrew-months>
            {hebrewMonths(days, month)}
          </bdi>
        </div>
        <button type="button" className="btn-ghost !px-2" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Next month" data-next-month>
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>
      <label className="mb-2 flex flex-wrap items-center justify-center gap-2 text-sm" data-date-search>
        <span className="font-semibold text-muted">Search a date</span>
        <input type="date" className="input !w-auto !py-1.5" value={found} onChange={(e) => goTo(e.target.value)} aria-label="Search a date" />
        {found && (
          <button type="button" className="btn-ghost !px-2 !py-1 text-xs" onClick={() => { setFound(""); setMonth(startMonth); }}>
            Clear
          </button>
        )}
      </label>
      <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-bold uppercase text-muted">
        {WEEKDAYS.map((w) => (
          <div key={w}>{w}</div>
        ))}
      </div>
      {weeks.map((week) => (
        <div key={week[0].date} data-week>
          <bdi dir="rtl" lang="yi" className="mt-1.5 block text-right text-xs font-semibold text-muted" data-week-parsha>
            {weekParsha(week[6].date)}
          </bdi>
          <div className="mt-0.5 grid grid-cols-7 gap-1">
            {week.map((d) => {
              const other = d.date.slice(0, 7) !== month;
              const past = d.date < today;
              const off = d.closed || past;
              // Closed days get their own color and a "Closed" tag; past days stay grey
              const chosen = d.date === value;
              const label = d.closed ? d.reason : d.closesAtLabel ? "Closes early" : d.names[0] ?? "";
              const he = dualParts(d.date, "short").he;
              // Every Yom Tov / holiday name in English, with the day of Chanukah (Abraham, Nov 17, 2026)
              const holidays = dayHolidayNames(d.date);
              const isFound = d.date === found;
              return (
                <button
                  key={d.date}
                  type="button"
                  disabled={off}
                  onClick={() => onPick(d.date)}
                  title={[d.hebrew, ...holidays, d.closed ? `Closed: ${d.reason}` : d.names.join(", ")].filter(Boolean).join(" · ")}
                  data-day={d.date}
                  data-found={isFound || undefined}
                  data-closed={d.closed || undefined}
                  data-holiday-week={d.holidayWeek || undefined}
                  className={`min-h-[4.25rem] min-w-0 overflow-hidden rounded-lg border p-1 text-left text-[11px] leading-tight sm:p-1.5 sm:text-xs ${
                    chosen
                      ? "border-navy bg-navy text-white"
                      : d.closed && !past
                        ? "cursor-not-allowed border-[#f5c2bd] bg-[#ffe6e4] text-[#b3261e]" // closed: its own light red color (Abraham)
                        : past
                          ? "cursor-not-allowed border-line bg-bg text-muted"
                          : d.holidayWeek
                            ? "border-[#CFE6FB] bg-[#EEF7FF] hover:border-navy" // Chanukah and Chol Hamoed: a very light blue (Abraham, Nov 24, 2026)
                            : "border-line bg-white hover:border-navy"
                  } ${other && !chosen ? "opacity-50" : ""} ${isFound ? "ring-2 ring-[#FFD84D] ring-offset-1" : ""}`}
                >
                  {/* Day number with "Closed" next to it (Abraham, Nov 17, 2026: no crossed-out days) */}
                  <span className="flex flex-wrap items-center justify-between gap-1">
                    <span className="text-sm font-bold">{Number(d.date.slice(8))}</span>
                    {d.closed && !past && (
                      <span className="text-[10px] font-black leading-none sm:text-[11px]" data-closed-tag>
                        Closed
                      </span>
                    )}
                  </span>
                  {/* Hebrew date: the full date on wider screens, the day only on a phone (the months are in the heading) */}
                  <bdi dir="rtl" lang="yi" className="block truncate" data-hebrew-day>
                    <span className="sm:hidden">{he.split(" ")[0]}</span>
                    <span className="hidden sm:inline">{he}</span>
                  </bdi>
                  <bdi dir="rtl" lang="yi" className="hidden truncate opacity-80 sm:block" data-yiddish-day>
                    {DAY_YI[new Date(`${d.date}T12:00:00Z`).getUTCDay()]}
                  </bdi>
                  {!d.closed && d.closesAtLabel ? (
                    <span className="block truncate">
                      <span className="sm:hidden">Early</span>
                      <span className="hidden sm:inline">Closes early</span>
                    </span>
                  ) : (
                    <span className="block break-words text-[10px] sm:truncate sm:text-xs">{label}</span>
                  )}
                  {holidays.length > 0 && (
                    <>
                      {/* Wider screens: the full names. A phone box is too narrow: a short mark, full names listed below the calendar */}
                      <span className={`mt-0.5 hidden text-[11px] font-semibold leading-tight sm:block ${chosen ? "text-white" : "text-[#6B3FA0]"}`} data-holiday-en>
                        {holidays.join(" · ")}
                      </span>
                      <span className={`mt-0.5 block text-[11px] font-bold leading-none sm:hidden ${chosen ? "text-white" : "text-[#6B3FA0]"}`} aria-hidden data-holiday-mark>
                        ●
                      </span>
                    </>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      {/* Phone: this month's Yom Tov and holiday names in full */}
      {(() => {
        const list = days.filter((d) => d.date.slice(0, 7) === month).map((d) => ({ date: d.date, names: dayHolidays(d.date) })).filter((d) => d.names.length);
        if (!list.length) return null;
        return (
          <ul className="mt-2 space-y-0.5 rounded-lg bg-bg p-2 text-xs sm:hidden" data-holiday-list>
            {list.map((d) => (
              <li key={d.date}>
                <b>{new Date(`${d.date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })}:</b>{" "}
                {d.names.map((n, i) => (
                  <span key={n.en} className="font-semibold text-[#6B3FA0]">
                    {i > 0 && " · "}
                    <bdi dir="rtl" lang="he">{n.he}</bdi> ({n.en})
                  </span>
                ))}
              </li>
            ))}
          </ul>
        );
      })()}
      {weeks.some((w) => w.some((d) => d.holidayWeek)) && (
        <p className="mt-2 flex items-center justify-end gap-1.5 text-[11px] text-muted" data-holiday-legend>
          <i className="inline-block h-3 w-3 rounded border border-[#CFE6FB] bg-[#EEF7FF]" aria-hidden /> Chanukah and Chol Hamoed
        </p>
      )}
    </div>
  );
}

