"use client";

import { useState, useTransition } from "react";
import { saveCalendarSettingsAction } from "./calendar-actions";

const TOGGLES: [string, string][] = [
  ["closePurim", "Purim"],
  ["closeTishaBav", "Tisha B'Av"],
  ["closeMinorFasts", "Minor fasts (Tzom Gedaliah, 10 Teves, Taanis Esther, 17 Tammuz)"],
  ["closeLagBaomer", "Lag Ba'Omer"],
  ["closeCholHamoed", "Chol Hamoed"],
  ["closeChanukah", "Chanukah"],
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
      <p className="text-sm text-muted">Always closed: every Shabbos and every Yom Tov day (two-day Yom Tov). Zmanim for Monroe / Kiryas Joel.</p>
      <label className="flex items-center gap-2 font-semibold">
        <input type="checkbox" checked={v.calendarEnabled === "yes"} onChange={(e) => set("calendarEnabled", e.target.checked ? "yes" : "no")} /> Use the Jewish calendar for open and closed days
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="label">Erev Shabbos closes at</span>
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
          <span className="label">Reopen after Shabbos / Yom Tov</span>
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
            ["hoursFridayOpen", "Friday opens (closes at the Erev Shabbos time)", "10:30"],
            ["hoursSunday", "Sunday", "11:30-19:00"],
            ["hoursCholHamoed", "Chol Hamoed", "10:30-22:30"],
            ["hoursMotzeiOpen", "Motzei Shabbos opens (\"tzeis+120\" = 2 hours after Shabbos ends)", "tzeis+120"],
            ["hoursMotzeiCloseWinter", "Motzei Shabbos closes (winter)", "23:30"],
            ["hoursMotzeiCloseSummer", "Motzei Shabbos closes (summer)", "00:30"],
          ] as const
        ).map(([k, label, ph]) => (
          <label key={k} className="block">
            <span className="label">{label}</span>
            <input className="input" placeholder={ph} value={v[k] ?? ""} onChange={(e) => set(k, e.target.value)} />
          </label>
        ))}
        <label className="block">
          <span className="label">Motzei Shabbos summer hours apply</span>
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
