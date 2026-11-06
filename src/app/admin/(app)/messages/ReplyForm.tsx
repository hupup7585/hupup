"use client";

import { useActionState, useEffect, useRef } from "react";
import { sendReplyAction } from "./actions";

/** Reply box under a conversation (Owner). Shows why a text was blocked (STOP, no consent, card number). */
export default function ReplyForm({ phone }: { phone: string }) {
  const [state, action, pending] = useActionState(sendReplyAction, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) ref.current?.reset();
  }, [state]);
  return (
    <form ref={ref} action={action} className="mt-4 space-y-2">
      <input type="hidden" name="phone" value={phone} />
      <textarea name="body" rows={3} maxLength={1000} required className="input" placeholder="Type a reply..." />
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn-dark" disabled={pending}>{pending ? "Sending..." : "Send text"}</button>
        {state?.ok && <span className="text-sm font-semibold text-[#13895C]">Sent.</span>}
        {state?.error && <span role="alert" className="text-sm font-semibold text-[#C83A2F]">{state.error}</span>}
      </div>
      <p className="text-xs text-muted">Sent from the hotline number. Customers who replied STOP, or never agreed to order texts, won&rsquo;t receive it.</p>
    </form>
  );
}
