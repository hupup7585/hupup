"use client";

import { useActionState } from "react";
import { saveMailingAddressAction } from "./email-actions";

/** Owner: the mailing address printed at the bottom of promotional emails. */
export default function MailingAddressForm({ initial }: { initial: string }) {
  const [state, action, pending] = useActionState(saveMailingAddressAction, null);
  return (
    <form action={action} className="grid gap-2" data-mailing-address-form>
      <input name="address" defaultValue={initial} className="input" placeholder="Street, town, state and ZIP" />
      <span className="text-xs text-muted">Printed at the bottom of every promotional email, with the unsubscribe link. A street address or a P.O. box both work.</span>
      <div className="flex items-center gap-3">
        <button className="btn-dark" disabled={pending}>{pending ? "Saving..." : "Save"}</button>
        {state?.message && <span role="status" className={`text-sm font-semibold ${state.ok ? "text-[#13895C]" : "text-[#C83A2F]"}`}>{state.message}</span>}
      </div>
    </form>
  );
}
