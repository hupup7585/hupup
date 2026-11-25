"use client";

import { useActionState, useState } from "react";
import { saveTextingAction } from "./texting-actions";

/** Owner: customer texts for everyone, or only to the test numbers (Abraham, Nov 25, 2026). */
export default function TextingForm({ everyone }: { everyone: boolean }) {
  const [state, action, pending] = useActionState(saveTextingAction, null);
  const [on, setOn] = useState(everyone);
  return (
    <form action={action} className="grid gap-3" data-texting-form>
      <p className="text-sm">
        Status: <b>{everyone ? "ON: every customer gets texts" : "OFF: only the test numbers get customer texts"}</b>
      </p>
      <p className="text-xs text-muted">Consent, STOP, quiet hours and the card-number check apply either way. Staff sign-in codes and alerts are never held.</p>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="customerTexts" checked={on} onChange={(e) => setOn(e.target.checked)} /> Customer texts on for everyone
      </label>
      <div className="flex items-center gap-3">
        <button className="btn-dark" disabled={pending}>{pending ? "Saving..." : "Save"}</button>
        {state?.message && <span role="status" className={`text-sm font-semibold ${state.ok ? "text-[#13895C]" : "text-[#C83A2F]"}`}>{state.message}</span>}
      </div>
    </form>
  );
}
