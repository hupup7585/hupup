"use client";

import { useActionState } from "react";
import { saveRoutingAction } from "./routing-actions";
import type { RingKey } from "@/lib/ivr/routing";

/** One main-menu key's ring list: numbers, order or all at once, and the press-1 accept step. */
export default function RoutingForm({
  ringKey,
  initial,
  summary,
}: {
  ringKey: RingKey;
  initial: { targets: string; mode: string; accept: boolean; acceptText?: string };
  summary: string;
}) {
  const [state, action, pending] = useActionState(saveRoutingAction, null);
  return (
    <form action={action} className="grid gap-4" data-ring-key={ringKey}>
      <input type="hidden" name="ringKey" value={ringKey} />
      <p className="rounded-lg bg-bg p-3 text-sm font-semibold" data-route-summary>{summary}</p>
      <label className="block">
        <span className="label">Numbers to ring, one per line: Name | phone | seconds to ring (5 to 60)</span>
        <textarea name="targets" rows={3} defaultValue={initial.targets} className="input font-mono text-sm" placeholder={"Sara office phone | (845) 555-0123 | 20\nMoshe mobile | (845) 555-0145 | 15"} />
        <span className="mt-1 block text-xs text-muted" data-ring-example>
          Example: <code>Sara office phone | (845) 555-0123 | 20</code> rings Sara for 20 seconds. Use each person&rsquo;s own phone, never the hotline (845) 415-7585 or the public number (845) 777-7585 (both lead back into the phone menu).
        </span>
        <span className="mt-1 block text-xs text-muted">
          {ringKey === "0"
            ? "If this list is empty, no one is rung: callers hear the missed-call line and go to the general voicemail. The same happens when the office is closed or no one answers."
            : "Leave empty to ring the operator list (key 0)."}
        </span>
      </label>
      <fieldset className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2 font-semibold"><input type="radio" name="mode" value="sequential" defaultChecked={initial.mode !== "simultaneous"} /> One after another (in this order)</label>
        <label className="flex items-center gap-2 font-semibold"><input type="radio" name="mode" value="simultaneous" defaultChecked={initial.mode === "simultaneous"} /> All at the same time (first to accept)</label>
      </fieldset>
      <label className="flex items-center gap-2 font-semibold">
        <input type="checkbox" name="accept" defaultChecked={initial.accept} /> Person answering must press 1 to accept (so a personal voicemail never takes the call)
      </label>
      {ringKey === "0" && (
        <label className="block">
          <span className="label">What the person answering hears (all keys)</span>
          <input name="acceptText" defaultValue={initial.acceptText} className="input" />
        </label>
      )}
      <div className="flex items-center gap-3">
        <button className="btn-dark" disabled={pending}>{pending ? "Saving..." : "Save"}</button>
        {state?.message && <span role="status" className={`text-sm font-semibold ${state.ok ? "text-[#13895C]" : "text-[#C83A2F]"}`}>{state.message}</span>}
      </div>
    </form>
  );
}
