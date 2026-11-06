"use client";

import { useActionState } from "react";
import { saveRoutingAction } from "./routing-actions";

/** One main-menu key's ring list: numbers, order or all at once, and the press-1 accept step. */
export default function RoutingForm({
  ringKey,
  initial,
  summary,
}: {
  ringKey: "2" | "4" | "5" | "6" | "0";
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
        <textarea name="targets" rows={3} defaultValue={initial.targets} className="input font-mono text-sm" placeholder={"Abram | (845) 777-7585 | 20\nOffice | (845) 555-0100 | 15"} />
        <span className="mt-1 block text-xs text-muted">
          {ringKey === "0"
            ? "Leave empty to ring the main forwarding number. When the office is closed or no one answers, callers hear the missed-call line and go to the general voicemail."
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
