"use client";

import { useActionState } from "react";
import { saveRoutingAction } from "./routing-actions";

/** "Speak to someone" (option 0): numbers to ring, order or all at once, and the press-1 accept message. */
export default function RoutingForm({ initial, summary }: { initial: { operatorTargets: string; operatorMode: string; operatorAcceptPrompt: boolean; operatorAcceptText: string }; summary: string }) {
  const [state, action, pending] = useActionState(saveRoutingAction, null);
  return (
    <form action={action} className="grid gap-4">
      <p className="rounded-lg bg-bg p-3 text-sm font-semibold" data-route-summary>{summary}</p>
      <label className="block">
        <span className="label">Numbers to ring, one per line: Name | phone | seconds to ring (5 to 60)</span>
        <textarea name="operatorTargets" rows={4} defaultValue={initial.operatorTargets} className="input font-mono text-sm" placeholder={"Abram | (845) 777-7585 | 20\nOffice | (845) 555-0100 | 15"} />
        <span className="mt-1 block text-xs text-muted">Leave empty to ring the main forwarding number. Calls are only offered while the office is open; otherwise callers can leave a voicemail.</span>
      </label>
      <fieldset className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2 font-semibold"><input type="radio" name="operatorMode" value="sequential" defaultChecked={initial.operatorMode !== "simultaneous"} /> One after another (in this order)</label>
        <label className="flex items-center gap-2 font-semibold"><input type="radio" name="operatorMode" value="simultaneous" defaultChecked={initial.operatorMode === "simultaneous"} /> All at the same time (first to accept)</label>
      </fieldset>
      <label className="flex items-center gap-2 font-semibold">
        <input type="checkbox" name="operatorAcceptPrompt" defaultChecked={initial.operatorAcceptPrompt} /> Person answering must press 1 to accept (so a personal voicemail never takes the call)
      </label>
      <label className="block">
        <span className="label">What the person answering hears</span>
        <input name="operatorAcceptText" defaultValue={initial.operatorAcceptText} className="input" />
      </label>
      <div className="flex items-center gap-3">
        <button className="btn-dark" disabled={pending}>{pending ? "Saving..." : "Save call routing"}</button>
        {state?.message && <span role="status" className={`text-sm font-semibold ${state.ok ? "text-[#13895C]" : "text-[#C83A2F]"}`}>{state.message}</span>}
      </div>
    </form>
  );
}
