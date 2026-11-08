"use client";

import { useActionState } from "react";
import { saveRecordingAction } from "./recording-actions";

/** Owner: call recording switch (default OFF). */
export default function RecordingForm({ on, notice }: { on: boolean; notice: string }) {
  const [state, action, pending] = useActionState(saveRecordingAction, null);
  return (
    <form action={action} className="grid gap-3" data-recording-form>
      <p className="text-sm">
        Status: <b className={on ? "text-[#C83A2F]" : ""}>{on ? "ON: calls are being recorded" : "OFF: calls are not recorded"}</b>
      </p>
      <div className="rounded-lg bg-bg p-3 text-sm">
        <div className="mb-1 font-bold">Notice every caller hears first (proposed, waiting for your approval):</div>
        <q>{notice}</q>
      </div>
      <p className="text-xs text-muted">
        Card numbers and CVVs are never collected on calls: payment is on Sola&rsquo;s secure page from a texted link. Twilio charges per recorded minute
        while this is on.
      </p>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="callRecording" defaultChecked={on} /> Record calls
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="approveNotice" /> I approve the notice wording above
      </label>
      <div className="flex items-center gap-3">
        <button className="btn-dark" disabled={pending}>{pending ? "Saving..." : "Save"}</button>
        {state?.message && <span role="status" className={`text-sm font-semibold ${state.ok ? "text-[#13895C]" : "text-[#C83A2F]"}`}>{state.message}</span>}
      </div>
    </form>
  );
}
