"use client";

import { useActionState } from "react";
import { saveDeliveryPricingAction, saveSalesTaxAction } from "./pricing-actions";

const dollars = (cents: string) => (Number(cents) / 100).toFixed(2);

function Status({ state }: { state: { ok?: boolean; message?: string } | null }) {
  return state?.message ? <span role="status" className={`text-sm font-semibold ${state.ok ? "text-[#13895C]" : "text-[#C83A2F]"}`}>{state.message}</span> : null;
}

/** Owner: delivery fees and zone towns (one place per line). */
export function DeliveryPricingForm({ initial }: { initial: { deliveryFeeKjCents: string; deliveryFeeAreaCents: string; zoneKjPlaces: string; zoneAreaPlaces: string } }) {
  const [state, action, pending] = useActionState(saveDeliveryPricingAction, null);
  return (
    <form action={action} className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="label">Kiryas Joel zone fee ($)</span>
          <input name="deliveryFeeKj" defaultValue={dollars(initial.deliveryFeeKjCents)} inputMode="decimal" className="input" />
        </label>
        <label className="block">
          <span className="label">Surrounding towns fee ($)</span>
          <input name="deliveryFeeArea" defaultValue={dollars(initial.deliveryFeeAreaCents)} inputMode="decimal" className="input" />
        </label>
        <label className="block">
          <span className="label">Kiryas Joel zone: places (one per line)</span>
          <textarea name="zoneKjPlaces" rows={5} defaultValue={initial.zoneKjPlaces} className="input" />
        </label>
        <label className="block">
          <span className="label">Surrounding towns: places (one per line)</span>
          <textarea name="zoneAreaPlaces" rows={5} defaultValue={initial.zoneAreaPlaces} className="input" />
        </label>
      </div>
      <div className="flex items-center gap-3">
        <button className="btn-dark" disabled={pending}>{pending ? "Saving..." : "Save fees and zones"}</button>
        <Status state={state} />
      </div>
    </form>
  );
}

/** Owner: sales tax percent (applies to the whole order including delivery). */
export function SalesTaxForm({ initial }: { initial: string }) {
  const [state, action, pending] = useActionState(saveSalesTaxAction, null);
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <label className="block">
        <span className="label">Sales tax (%)</span>
        <input name="salesTaxPercent" defaultValue={initial} inputMode="decimal" className="input w-32" />
      </label>
      <button className="btn-dark" disabled={pending}>{pending ? "Saving..." : "Save rate"}</button>
      <Status state={state} />
    </form>
  );
}
