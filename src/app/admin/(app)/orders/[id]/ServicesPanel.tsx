"use client";

import { useState, useTransition } from "react";
import { addServiceAction, removeServiceAction, updateServiceAction, type ServiceResult } from "./services-actions";

type Service = { id: number; name: string; amountCents: number; note: string | null; showNoteOnReceipt: boolean; taxable: boolean; locked: boolean };
type Help = Record<"name" | "amount" | "note" | "showNoteOnReceipt" | "taxable" | "box", { what: string; where: string; ifChanged: string; askAccountant?: boolean }>;

const money = (c: number) => `$${(c / 100).toFixed(2)}`;

/** One line of help under a field: what it does, where it is used, what happens if it changes. */
function Hint({ h }: { h: Help[keyof Help] }) {
  return (
    <details className="mt-1 text-xs text-muted" data-service-help>
      <summary className="cursor-pointer select-none font-semibold">What is this?</summary>
      <p className="mt-1">{h.what}</p>
      <p className="mt-1"><b>Where it is used:</b> {h.where}</p>
      <p className="mt-1"><b>If you change it:</b> {h.ifChanged}</p>
    </details>
  );
}

function Fields({ help, s }: { help: Help; s?: Service }) {
  return (
    <div className="grid gap-3 sm:grid-cols-[1.4fr_0.8fr]">
      <label className="block text-sm">
        <span className="font-semibold">Name</span>
        <input name="name" required maxLength={80} defaultValue={s?.name ?? ""} placeholder="Extra setup" className="input mt-1 w-full" />
        <Hint h={help.name} />
      </label>
      <label className="block text-sm">
        <span className="font-semibold">Amount ($)</span>
        <input name="amount" required inputMode="decimal" defaultValue={s ? (s.amountCents / 100).toFixed(2) : ""} placeholder="25.00" className="input mt-1 w-full" />
        <Hint h={help.amount} />
      </label>
      <label className="block text-sm sm:col-span-2">
        <span className="font-semibold">Note (optional)</span>
        <input name="note" maxLength={500} defaultValue={s?.note ?? ""} placeholder="What it is, for staff" className="input mt-1 w-full" />
        <Hint h={help.note} />
      </label>
      <div className="text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" name="showNoteOnReceipt" defaultChecked={s?.showNoteOnReceipt ?? false} /> Show the note on the receipt
        </label>
        <Hint h={help.showNoteOnReceipt} />
      </div>
      <div className="text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" name="taxable" defaultChecked={s?.taxable ?? true} /> Taxable
        </label>
        <Hint h={help.taxable} />
      </div>
    </div>
  );
}

export default function ServicesPanel({ orderId, services, help, cancelled }: { orderId: number; services: Service[]; help: Help; cancelled: boolean }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<ServiceResult | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const run = (fn: () => Promise<ServiceResult>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      setMsg(r);
      if (r.ok) after?.();
    });
  const total = services.reduce((n, s) => n + s.amountCents, 0);

  return (
    <div className="card p-5" data-services-panel>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-bold">Services{services.length ? ` (${money(total)})` : ""}</h2>
        {!cancelled && !adding && (
          <button type="button" className="btn-ghost" onClick={() => { setAdding(true); setEditing(null); setMsg(null); }} data-add-service>
            Add a service
          </button>
        )}
      </div>
      <Hint h={help.box} />
      {services.length > 0 && (
        <ul className="mt-3 divide-y divide-line text-sm" data-service-list>
          {services.map((s, n) =>
            editing === s.id ? (
              <li key={s.id} className="py-3">
                <form action={(f) => run(() => updateServiceAction(orderId, s.id, f), () => setEditing(null))} className="space-y-3">
                  <div className="text-xs font-bold uppercase tracking-wide text-muted">Service {n + 1}</div>
                  <Fields help={help} s={s} />
                  <div className="flex gap-2">
                    <button className="btn-dark" disabled={pending}>Save</button>
                    <button type="button" className="btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
                  </div>
                </form>
              </li>
            ) : (
              <li key={s.id} className="flex flex-wrap items-start justify-between gap-2 py-2" data-service-row={n + 1}>
                <div>
                  <div className="text-xs font-bold uppercase tracking-wide text-muted">Service {n + 1}</div>
                  <div className="font-semibold">{s.name}</div>
                  {s.note && <div className="text-xs text-muted">Note: {s.note}{s.showNoteOnReceipt ? " (also on the receipt)" : " (staff only)"}</div>}
                  <div className="text-xs text-muted">{s.taxable ? "Taxable" : "Not taxed"}{s.locked ? " · Paid for: locked (use Refund to give money back)" : ""}</div>
                </div>
                <div className="text-right">
                  <div className="font-bold">{money(s.amountCents)}</div>
                  {!s.locked && !cancelled && (
                    <div className="mt-1 flex gap-2">
                      <button type="button" className="text-xs font-bold text-navy underline" onClick={() => { setEditing(s.id); setAdding(false); setMsg(null); }}>Edit</button>
                      <button
                        type="button"
                        className="text-xs font-bold text-coral underline"
                        disabled={pending}
                        onClick={() => { if (confirm(`Remove ${s.name} (${money(s.amountCents)}) from this order? The total and sales tax go down.`)) run(() => removeServiceAction(orderId, s.id)); }}
                      >
                        Remove
                      </button>
                    </div>
                  )}
                </div>
              </li>
            ),
          )}
        </ul>
      )}
      {adding && (
        <form action={(f) => run(() => addServiceAction(orderId, f), () => setAdding(false))} className="mt-3 space-y-3 rounded-xl border border-line p-3" data-new-service>
          <div className="text-xs font-bold uppercase tracking-wide text-muted">Service {services.length + 1}</div>
          <Fields help={help} />
          <div className="flex gap-2">
            <button className="btn-dark" disabled={pending}>Add service</button>
            <button type="button" className="btn-ghost" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </form>
      )}
      {!services.length && !adding && <p className="mt-2 text-sm text-muted">No services on this order. Use Add a service for a charge that is not a rental item.</p>}
      {msg && <p className={`mt-3 text-sm font-semibold ${msg.ok ? "text-[#13895C]" : "text-coral-dark"}`} role="status">{msg.message}</p>}
    </div>
  );
}
