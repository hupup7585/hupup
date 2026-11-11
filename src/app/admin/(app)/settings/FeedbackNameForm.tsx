"use client";

import { useActionState, useState } from "react";
import { saveFeedbackNameAction } from "./routing-actions";
import { FEEDBACK_KEY_DEFAULT_NAME } from "@/lib/ivr/routing";

/** Key 9 (feedback and comments voicemail): its name in voicemail alerts. */
export default function FeedbackNameForm({ initial }: { initial: string }) {
  const [state, action, pending] = useActionState(saveFeedbackNameAction, null);
  const [name, setName] = useState(initial);
  return (
    <form action={action} className="grid gap-3" data-ring-key="9">
      <label className="block">
        <span className="label">Extension name (shown in voicemail alerts)</span>
        <input name="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className="input" placeholder={FEEDBACK_KEY_DEFAULT_NAME} />
        <span className="mt-1 block text-sm">Alerts say: &ldquo;Extension 9, {name.trim() || FEEDBACK_KEY_DEFAULT_NAME}&rdquo;</span>
      </label>
      <div className="flex items-center gap-3">
        <button className="btn-dark" disabled={pending}>{pending ? "Saving..." : "Save"}</button>
        {state?.message && <span role="status" className={`text-sm font-semibold ${state.ok ? "text-[#13895C]" : "text-[#C83A2F]"}`}>{state.message}</span>}
      </div>
    </form>
  );
}
