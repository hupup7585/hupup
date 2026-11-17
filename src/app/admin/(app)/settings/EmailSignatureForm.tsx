"use client";

import { useActionState } from "react";
import { saveEmailSignatureAction } from "./email-actions";

/** Owner edits the email signature (every email from info@ ends with it). */
export default function EmailSignatureForm({ initial, fallback }: { initial: string; fallback: string }) {
  const [state, action, pending] = useActionState(saveEmailSignatureAction, null);
  return (
    <form action={action} className="grid gap-3" data-email-signature>
      <label className="block">
        <span className="label">Signature (one line per row)</span>
        <textarea name="signature" defaultValue={initial || fallback} rows={7} maxLength={800} className="input font-mono text-sm" />
        <span className="mt-1 block text-sm text-muted">The logo and &ldquo;Hup Up Attractions Inc.&rdquo; are at the top of every email; this signature is at the bottom. Phone numbers, emails and web addresses become links.</span>
      </label>
      <div className="flex items-center gap-3">
        <button className="btn-dark" disabled={pending}>{pending ? "Saving..." : "Save signature"}</button>
        {state?.message && <span role="status" className={`text-sm font-semibold ${state.ok ? "text-[#13895C]" : "text-[#C83A2F]"}`}>{state.message}</span>}
      </div>
    </form>
  );
}
