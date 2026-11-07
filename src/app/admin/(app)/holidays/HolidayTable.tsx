"use client";

import { useState, useTransition } from "react";
import type { HolidayRow } from "./data";
import { dayRowAction, saveHolidayRowsAction } from "./actions";
import { ampm24 } from "./hours";
import DualDate from "@/components/DualDate";

/** Holidays & hours: the calendar's default for each day, and the Owner's Open/Closed, Hours and Notes. */
export default function HolidayTable({ initial }: { initial: HolidayRow[] }) {
  const [rows, setRows] = useState(initial.map((r) => ({ ...r, hours: r.hours ? ampm24(r.hours) : "" })));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [add, setAdd] = useState("");
  const [pending, start] = useTransition();
  const set = (i: number, patch: Partial<HolidayRow>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const when = (iso: string) => <DualDate iso={iso} />;

  return (
    <div className="space-y-4">
      <div className="card overflow-x-auto p-4">
        <table className="w-full min-w-[960px] text-sm" data-holiday-table>
          <thead>
            <tr className="text-left text-muted">
              <th className="py-2">Date</th>
              <th>Holiday</th>
              <th>Calendar default</th>
              <th className="w-44">Open or Closed</th>
              <th className="w-48">Hours</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.date} data-row={r.date} className={`border-t border-line align-top ${r.choice !== "default" ? "bg-sun/15" : ""}`}>
                <td className="py-2.5 pr-2">
                  <div className="font-semibold">{when(r.date)}</div>
                  <div className="text-xs text-muted">{r.hebrew}</div>
                </td>
                <td className="pr-2 pt-2.5">{r.holiday}</td>
                <td className="pr-2 pt-2.5 text-muted">{r.defaultHours}</td>
                <td className="py-2 pr-2">
                  <select aria-label={`Open or closed on ${r.date}`} className="input" value={r.choice} onChange={(e) => set(i, { choice: e.target.value as HolidayRow["choice"] })}>
                    <option value="default">Default ({r.defaultOpen ? "Open" : "Closed"})</option>
                    <option value="open">Open</option>
                    <option value="closed">Closed</option>
                  </select>
                </td>
                <td className="py-2 pr-2">
                  <input aria-label={`Hours on ${r.date}`} className="input" placeholder={r.choice === "open" ? "10:30 AM - 10:30 PM" : ""} disabled={r.choice !== "open"} value={r.choice === "open" ? r.hours : ""} onChange={(e) => set(i, { hours: e.target.value })} />
                </td>
                <td className="py-2">
                  <input aria-label={`Notes for ${r.date}`} className="input" maxLength={120} value={r.note} onChange={(e) => set(i, { note: e.target.value })} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          className="btn-dark"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await saveHolidayRowsAction(rows.map(({ date, choice, hours, note }) => ({ date, choice, hours, note })));
              setMsg({ ok: r.ok, text: r.message });
            })
          }
        >
          {pending ? "Saving..." : "Save changes"}
        </button>
        {msg && <span role="status" className={`text-sm font-semibold ${msg.ok ? "text-[#13895C]" : "text-[#C83A2F]"}`}>{msg.text}</span>}
      </div>
      <div className="card flex flex-wrap items-end gap-3 p-4">
        <label className="block">
          <span className="label">Add any other day</span>
          <input type="date" className="input" value={add} onChange={(e) => setAdd(e.target.value)} />
        </label>
        <button
          className="btn-ghost"
          disabled={!add || pending}
          onClick={() =>
            start(async () => {
              if (rows.some((r) => r.date === add)) return setMsg({ ok: false, text: "That day is already in the list." });
              const row = await dayRowAction(add);
              if (row) setRows((rs) => [...rs, { ...row, hours: row.hours ? ampm24(row.hours) : "" }].sort((a, b) => a.date.localeCompare(b.date)));
              setAdd("");
            })
          }
        >
          Add day
        </button>
      </div>
    </div>
  );
}
