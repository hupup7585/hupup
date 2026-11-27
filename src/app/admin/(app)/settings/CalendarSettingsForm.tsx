"use client";

import { useState, useTransition } from "react";
import { saveCalendarSettingsAction } from "./calendar-actions";

const TOGGLES: [string, string][] = [
  ["closePurim", "Purim"],
  ["closeTishaBav", "Tisha B'Av"],
  ["closeMinorFasts", "Minor fasts (Tzom Gedaliah, 10 Teves, Taanis Esther, 17 Tammuz)"],
  ["closeLagBaomer", "Lag Ba'Omer"],
  ["closeCholHamoed", "Chol Hamoed"],
  ["closeChanukah", "Chanukkah"],
];

export default function CalendarSettingsForm({ initial }: { initial: Record<string, string> }) {
  const [v, setV] = useState(initial);
  const [msg, setMsg] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, start] = useTransition();
  const set = (k: string, val: string) => setV({ ...v, [k]: val });
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => setMsg(await saveCalendarSettingsAction(v)));
      }}
    >
      <p className="text-sm text-muted">Always closed: every Shabbes and every Yom Tov day (two-day Yom Tov). Zmanim for Monroe / Kiryas Joel.</p>
      <label className="flex items-center gap-2 font-semibold">
        <input type="checkbox" checked={v.calendarEnabled === "yes"} onChange={(e) => set("calendarEnabled", e.target.checked ? "yes" : "no")} /> Use the Jewish calendar for open and closed days
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="label">Erev Shabbes closes at</span>
          <select className="input" value={v.erevShabbosClose} onChange={(e) => set("erevShabbosClose", e.target.value)}>
            <option value="chatzos">Chatzos (halachic midday)</option>
            <option value="candles">Candle lighting</option>
          </select>
        </label>
        <label className="block">
          <span className="label">Erev Yom Tov closes at</span>
          <select className="input" value={v.erevYomTovClose} onChange={(e) => set("erevYomTovClose", e.target.value)}>
            <option value="chatzos">Chatzos (halachic midday)</option>
            <option value="candles">Candle lighting</option>
          </select>
        </label>
        <label className="block">
          <span className="label">Candle lighting (minutes before shkiah)</span>
          <input className="input" inputMode="numeric" value={v.candleLightingMinutes} onChange={(e) => set("candleLightingMinutes", e.target.value)} />
        </label>
        <label className="block">
          <span className="label">Same-day bookings until (regular days)</span>
          <input className="input" value={v.sameDayCutoff} onChange={(e) => set("sameDayCutoff", e.target.value)} />
          <span className="mt-1 block text-xs text-muted">A time like 15:30 (3:30 PM). After it, today is not offered on the phone.</span>
        </label>
        <label className="block">
          <span className="label">Same-day bookings until (Friday and Erev Yom Tov)</span>
          <input className="input" value={v.sameDayCutoffErev} onChange={(e) => set("sameDayCutoffErev", e.target.value)} />
          <span className="mt-1 block text-xs text-muted">&ldquo;chatzos&rdquo; (halachic midday) or a time like 11:30.</span>
        </label>
        <label className="block">
          <span className="label">Same-day delivery time close by (hours)</span>
          <input className="input" value={v.sameDayHoursClose} onChange={(e) => set("sameDayHoursClose", e.target.value)} />
          <span className="mt-1 block text-xs text-muted">From-to, like 2.5-3.5. Since Nov 27, 2026 both approved same-day notice versions say this time and the surrounding-area time to every caller; a change marks those two recordings for a new recording.</span>
        </label>
        <label className="block">
          <span className="label">Same-day delivery time, surrounding areas (hours)</span>
          <input className="input" value={v.sameDayHoursFar} onChange={(e) => set("sameDayHoursFar", e.target.value)} />
          <span className="mt-1 block text-xs text-muted">From-to, like 3.5-4.5. Since Nov 27, 2026 both approved same-day notice versions say this time and the close-by time to every caller; a change marks those two recordings for a new recording.</span>
        </label>
        <label className="block sm:col-span-2">
          <span className="label">Close-by areas for the same-day notice</span>
          <textarea className="input" rows={2} value={v.sameDayCloseAreas} onChange={(e) => set("sameDayCloseAreas", e.target.value)} />
          <span className="mt-1 block text-xs text-muted">One delivery map area name per line. Empty = only the Kiryas Joel zone is close by. Not used now: since Nov 27, 2026 the same-day notice is one of the two approved versions by customer service hours, the same for every area.</span>
        </label>
        <label className="block">
          <span className="label">Phone stops bookings (minutes before candle lighting)</span>
          <input className="input" inputMode="numeric" value={v.phoneCutoffMinutes} onChange={(e) => set("phoneCutoffMinutes", e.target.value)} />
          <span className="mt-1 block text-xs text-muted">From this time no one can finish a booking or pay on the phone, even in the middle of a call.</span>
        </label>
        <label className="block">
          <span className="label">Saved cart after Shabbes / Yom Tov (minutes)</span>
          <input className="input" inputMode="numeric" value={v.shabbesSaveMinutes} onChange={(e) => set("shabbesSaveMinutes", e.target.value)} />
          <span className="mt-1 block text-xs text-muted">A caller stopped by the cut-off keeps their items until this long after the phone opens again.</span>
        </label>
        <label className="block">
          <span className="label">Reopen after Shabbes / Yom Tov</span>
          <input className="input" value={v.reopenAfter} onChange={(e) => set("reopenAfter", e.target.value)} />
          <span className="mt-1 block text-xs text-muted">&ldquo;tzeis&rdquo; (nightfall, 8.5°) or a number of minutes after shkiah, e.g. 72.</span>
        </label>
      </div>
      <fieldset>
        <legend className="label">Closed on these days?</legend>
        <div className="grid gap-1 sm:grid-cols-2">
          {TOGGLES.map(([k, label]) => (
            <label key={k} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={v[k] === "yes"} onChange={(e) => set(k, e.target.checked ? "yes" : "no")} /> {label}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="label">Office hours (walk-ins and live calls; Eastern time, 24-hour). Phone booking stays open 24/7.</legend>
        {(
          [
            ["hoursMonThu", "Monday to Thursday", "10:30-19:00"],
            ["hoursFridayOpen", "Friday opens (closes at the Erev Shabbes time)", "10:30"],
            ["hoursSunday", "Sunday", "11:30-19:00"],
            ["hoursCholHamoed", "Chol Hamoed", "10:30-22:30"],
            ["hoursChanukah", "Chanukkah (Friday of Chanukkah still closes at chatzos)", "10:30-22:30"],
            ["hoursMotzeiOpen", "Motzei Shabbes opens (\"tzeis+120\" = 2 hours after Shabbes ends)", "tzeis+120"],
            ["hoursMotzeiCloseWinter", "Motzei Shabbes closes (winter)", "23:00"],
            ["hoursMotzeiCloseSummer", "Motzei Shabbes closes (summer, 00:00 = midnight)", "00:00"],
          ] as const
        ).map(([k, label, ph]) => (
          <label key={k} className="block">
            <span className="label">{label}</span>
            <input className="input" placeholder={ph} value={v[k] ?? ""} onChange={(e) => set(k, e.target.value)} />
          </label>
        ))}
        <label className="block">
          <span className="label">Motzei Shabbes summer hours apply</span>
          <select className="input" value={v.hoursMotzeiSeason} onChange={(e) => set("hoursMotzeiSeason", e.target.value)}>
            <option value="dst">While daylight saving time is in effect</option>
            <option value="summer">Always (summer hours)</option>
            <option value="winter">Never (winter hours)</option>
          </select>
        </label>
        <label className="block sm:col-span-2">
          <span className="label">Website note under the hours</span>
          <input className="input" value={v.hoursWebsiteNote ?? ""} onChange={(e) => set("hoursWebsiteNote", e.target.value)} />
        </label>
      </fieldset>
      <label className="block">
        <span className="label">Owner overrides (one per line)</span>
        <textarea className="input font-mono text-sm" rows={4} placeholder={"2027-01-01 closed Family simcha\n2027-04-25 open"} value={v.calendarOverrides} onChange={(e) => set("calendarOverrides", e.target.value)} />
      </label>
      <button className="btn" disabled={pending}>Save calendar settings</button>
      {msg && <p className={`text-sm font-semibold ${msg.ok ? "text-navy" : "text-[#b3261e]"}`}>{msg.message}</p>}
    </form>
  );
}
