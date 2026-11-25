"use client";

import { useActionState } from "react";
import { saveNameSpeedAction } from "./hold-actions";

/** Owner: how fast household names are said live on the phone. */
export default function NameSpeedForm({ rate }: { rate: string }) {
  const [state, action, pending] = useActionState(saveNameSpeedAction, null);
  return (
    <form action={action} className="grid gap-2" data-name-speed-form>
      <label className="block max-w-xs">
        <span className="label">Speed for spoken names</span>
        <input name="rate" type="number" step="0.05" min={0.5} max={2} defaultValue={rate} className="input" />
      </label>
      <span className="text-xs text-muted">How fast the phone says a family&rsquo;s name (for example in the address lookup). 1.0 is normal speed; 1.1 is 10 percent faster (recommended). Only names use this speed.</span>
      <div className="flex items-center gap-3">
        <button className="btn-dark" disabled={pending}>{pending ? "Saving..." : "Save"}</button>
        {state?.message && <span role="status" className={`text-sm font-semibold ${state.ok ? "text-[#13895C]" : "text-[#C83A2F]"}`}>{state.message}</span>}
      </div>
    </form>
  );
}
