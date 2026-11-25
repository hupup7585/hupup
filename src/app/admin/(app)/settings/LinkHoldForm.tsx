"use client";

import { useActionState } from "react";
import { saveLinkHoldsAction } from "./hold-actions";

/** Owner: how long a payment link holds the rentals, phone and Admin separately. */
export default function LinkHoldForm({ phone, admin }: { phone: string; admin: string }) {
  const [state, action, pending] = useActionState(saveLinkHoldsAction, null);
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2" data-link-hold-form>
      <label className="block">
        <span className="label">Payment link sent from the phone line (minutes)</span>
        <input name="phone" type="number" min={1} max={240} defaultValue={phone} className="input" />
        <span className="mt-1 block text-xs text-muted">How long the rentals stay held after a caller gets a payment link. Now 10. The phone line and its text say &ldquo;ten minutes&rdquo;, so change the wording too if you change this.</span>
      </label>
      <label className="block">
        <span className="label">Payment link sent from Admin, New booking (minutes)</span>
        <input name="admin" type="number" min={1} max={240} defaultValue={admin} className="input" />
        <span className="mt-1 block text-xs text-muted">How long the rentals stay held after staff send a payment link. Now 25. The text to the customer shows this number.</span>
      </label>
      <div className="flex items-center gap-3 sm:col-span-2">
        <button className="btn-dark" disabled={pending}>{pending ? "Saving..." : "Save"}</button>
        {state?.message && <span role="status" className={`text-sm font-semibold ${state.ok ? "text-[#13895C]" : "text-[#C83A2F]"}`}>{state.message}</span>}
      </div>
    </form>
  );
}
