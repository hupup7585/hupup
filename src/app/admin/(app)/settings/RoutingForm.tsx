"use client";

import { useActionState, useState } from "react";
import { saveRoutingAction } from "./routing-actions";
import { RING_KEY_DEFAULT_NAMES, staffAnnouncement, type RingKey } from "@/lib/ivr/routing";

/** One main-menu key's ring list: numbers, order or all at once, and the press-1 accept step. */
export default function RoutingForm({
  ringKey,
  initial,
  summary,
}: {
  ringKey: RingKey;
  initial: { targets: string; mode: string; accept: boolean; name?: string; attempts?: string; afterHours?: boolean; announce?: string; afterFrom?: string; afterTo?: string; erevTo?: string; erevBefore?: string };
  summary: string;
}) {
  const [state, action, pending] = useActionState(saveRoutingAction, null);
  const [name, setName] = useState(initial.name ?? "");
  const [announce, setAnnounce] = useState(initial.announce ?? "");
  return (
    <form action={action} className="grid gap-4" data-ring-key={ringKey}>
      <input type="hidden" name="ringKey" value={ringKey} />
      <p className="rounded-lg bg-bg p-3 text-sm font-semibold" data-route-summary>{summary}</p>
      <label className="block">
        <span className="label">Extension name (staff hear it when they answer)</span>
        <input name="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className="input" placeholder={RING_KEY_DEFAULT_NAMES[ringKey]} />
      </label>
      <label className="block">
        <span className="label">What staff hear when they answer (leave empty for the standard announcement)</span>
        <textarea name="announce" value={announce} onChange={(e) => setAnnounce(e.target.value)} rows={2} maxLength={300} className="input" placeholder={staffAnnouncement(ringKey, name.trim() || RING_KEY_DEFAULT_NAMES[ringKey])} />
        <span className="mt-1 block text-sm" data-announcement>
          Staff hear: &ldquo;{staffAnnouncement(ringKey, name.trim() || RING_KEY_DEFAULT_NAMES[ringKey], announce)}&rdquo;
        </span>
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="label">Times to ring the list before voicemail</span>
          <select name="attempts" defaultValue={initial.attempts || "3"} className="input">
            {["1", "2", "3", "4", "5"].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 font-semibold">
          <input type="checkbox" name="afterHours" defaultChecked={Boolean(initial.afterHours)} />
          Ring after the office closes too
        </label>
      </div>
      <fieldset className="grid gap-3 rounded-xl border border-line p-3 sm:grid-cols-4" data-after-hours-window>
        <legend className="px-1 text-sm font-semibold">After-hours ringing times (only when the box above is ticked)</legend>
        <label className="block">
          <span className="label">From</span>
          <input type="time" name="afterFrom" defaultValue={initial.afterFrom ?? ""} className="input" />
        </label>
        <label className="block">
          <span className="label">Until</span>
          <input type="time" name="afterTo" defaultValue={initial.afterTo ?? ""} className="input" />
        </label>
        <label className="block">
          <span className="label">Friday and Erev Yom Tov until</span>
          <input type="time" name="erevTo" defaultValue={initial.erevTo ?? ""} className="input" />
        </label>
        <label className="block">
          <span className="label">Stop this many minutes before candle lighting</span>
          <input type="number" name="erevBefore" min={0} max={240} defaultValue={initial.erevBefore ?? "0"} className="input" />
        </label>
        <p className="text-xs text-muted sm:col-span-4">
          Leave From and Until empty to ring the whole time the office is closed. On Friday and Erev Yom Tov the line rings until the Erev time, or until the minutes before candle lighting when that is later (summer). Example for delivery and pickup: from 8:00 AM until 10:30 PM; Friday until 4:00 PM, or 60 minutes before candle lighting when that is later.
        </p>
      </fieldset>
      <p className="text-xs text-muted">Shabbos and Yom Tov: nothing rings; callers go to this line&rsquo;s voicemail.</p>
      <label className="block">
        <span className="label">Numbers to ring, one per line: Name | phone | seconds to ring (5 to 60)</span>
        <textarea name="targets" rows={3} defaultValue={initial.targets} className="input font-mono text-sm" placeholder={"Sara office phone | (845) 555-0123 | 20\nMoshe mobile | (845) 555-0145 | 15"} />
        <span className="mt-1 block text-xs text-muted" data-ring-example>
          Example: <code>Sara office phone | (845) 555-0123 | 20</code> rings Sara for 20 seconds. Use each person&rsquo;s own phone, never the hotline (845) 415-7585 or the public number (845) 777-7585 (both lead back into the phone menu).
        </span>
        <span className="mt-1 block text-xs text-muted">
          {ringKey === "0"
            ? "If this list is empty, no one is rung: callers go to the general voicemail (the greeting, then the tone). The same happens when the office is closed or no one answers."
            : "Leave empty to ring the operator list (key 0)."}
        </span>
      </label>
      <fieldset className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2 font-semibold"><input type="radio" name="mode" value="sequential" defaultChecked={initial.mode !== "simultaneous"} /> One after another (in this order)</label>
        <label className="flex items-center gap-2 font-semibold"><input type="radio" name="mode" value="simultaneous" defaultChecked={initial.mode === "simultaneous"} /> All at the same time (first to accept)</label>
      </fieldset>
      <label className="flex items-center gap-2 font-semibold">
        <input type="checkbox" name="accept" defaultChecked={initial.accept} /> Person answering must press 1 to accept (so a personal voicemail never takes the call). If they press 2 or don&rsquo;t answer, the next number rings, then this extension&rsquo;s voicemail.
      </label>
      <div className="flex items-center gap-3">
        <button className="btn-dark" disabled={pending}>{pending ? "Saving..." : "Save"}</button>
        {state?.message && <span role="status" className={`text-sm font-semibold ${state.ok ? "text-[#13895C]" : "text-[#C83A2F]"}`}>{state.message}</span>}
      </div>
    </form>
  );
}
