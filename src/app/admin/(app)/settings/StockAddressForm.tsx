"use client";

import { useActionState } from "react";
import { saveStockAddressAction } from "./stock-actions";

/** Owner: stock / warehouse address for the delivery run (start and return stop). */
export default function StockAddressForm({ initial }: { initial: string }) {
  const [state, action, pending] = useActionState(saveStockAddressAction, null);
  return (
    <form action={action} className="grid gap-3">
      <label className="block">
        <span className="label">Stock / warehouse address</span>
        <input name="stockAddress" defaultValue={initial} className="input" placeholder="Street, town, NY ZIP" autoComplete="off" />
        <span className="mt-1 block text-xs text-muted">The Delivery screen uses it as the start of the day&rsquo;s run and the &ldquo;back to stock&rdquo; stop. Leave empty to start routes from the driver&rsquo;s location.</span>
      </label>
      <div className="flex items-center gap-3">
        <button className="btn-dark" disabled={pending}>{pending ? "Saving..." : "Save address"}</button>
        {state?.message && <span role="status" className={`text-sm font-semibold ${state.ok ? "text-[#13895C]" : "text-[#C83A2F]"}`}>{state.message}</span>}
      </div>
    </form>
  );
}
