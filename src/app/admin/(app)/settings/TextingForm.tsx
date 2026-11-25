"use client";

import { useActionState, useState } from "react";
import { saveTextingAction } from "./texting-actions";

/** Owner: customer texts for everyone, or only to the test numbers (Abraham, Nov 25, 2026). */
export default function TextingForm({ everyone, testNumbers = "", forwardOn = false, forwardPhone = "" }: { everyone: boolean; testNumbers?: string; forwardOn?: boolean; forwardPhone?: string }) {
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
      <label className="block text-sm" data-texting-test-numbers>
        <span className="label">Test numbers</span>
        <textarea name="testNumbers" rows={3} defaultValue={testNumbers} className="input font-mono" />
        <span className="mt-1 block text-xs text-muted">One phone number per line. While customer texts are off, only these numbers get customer texts. Suggested: your own cell and the office phone.</span>
      </label>
      <label className="flex items-center gap-2 text-sm" data-texting-forward>
        <input type="checkbox" name="forwardOn" defaultChecked={forwardOn} /> Send me a copy of every text a customer sends us
      </label>
      <label className="block text-sm">
        <span className="label">Number for those copies</span>
        <input name="forwardPhone" type="tel" inputMode="tel" defaultValue={forwardPhone} className="input" placeholder="(845) 415-7585" />
        <span className="mt-1 block text-xs text-muted">The copies go to this phone by text. Leave empty when the box above is off.</span>
      </label>
      <div className="flex items-center gap-3">
        <button className="btn-dark" disabled={pending}>{pending ? "Saving..." : "Save"}</button>
        {state?.message && <span role="status" className={`text-sm font-semibold ${state.ok ? "text-[#13895C]" : "text-[#C83A2F]"}`}>{state.message}</span>}
      </div>
    </form>
  );
}
