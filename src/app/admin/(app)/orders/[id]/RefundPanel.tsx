"use client";

import { useState, useTransition } from "react";
import { refundAction } from "./stripe-actions";

type Refund = { id: number; when: string; amount: string; by: string; result: string; refundId: string | null; error: string | null };

/**
 * Refund from Admin (Owner only): full or part, then Abraham's question with Confirm and Cancel. Stripe phone
 * payments and Sola website payments. Each refund is its own dated entry.
 */
export default function RefundPanel(props: { orderId: number; provider: "Stripe" | "Sola"; leftCents: number; last4: string | null; status: string | null; ready: boolean; notReadyReason: string | null; refunds: Refund[] }) {
  const [part, setPart] = useState("");
  const [ask, setAsk] = useState<{ kind: "full" | "part"; cents: number } | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, start] = useTransition();
  const money = (c: number) => `$${(c / 100).toFixed(2)}`;
  const partCents = Math.round(Number(part.replace(/[$,\s]/g, "")) * 100);
  const question = ask ? `Refund ${money(ask.cents)} to ${props.last4 ? `card ending ${props.last4}` : "the card on file"}? This cannot be undone.` : "";
  return (
    <div className="card p-5" data-refund-panel>
      <h2 className="mb-1 font-bold">Refund ({props.provider})</h2>
      {props.status && <p className="mb-2 text-sm font-bold text-coral-dark">{props.status}</p>}
      {props.leftCents > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn-ghost !py-1.5 text-sm" disabled={pending || !props.ready} onClick={() => setAsk({ kind: "full", cents: props.leftCents })}>
            Refund full ({money(props.leftCents)})
          </button>
          <input className="input w-28 !py-1.5 text-sm" inputMode="decimal" placeholder="Amount" value={part} onChange={(e) => setPart(e.target.value)} aria-label="Partial refund amount" />
          <button
            className="btn-ghost !py-1.5 text-sm"
            disabled={pending || !props.ready || !(partCents > 0)}
            onClick={() => (partCents > props.leftCents ? setMsg({ ok: false, message: `At most ${money(props.leftCents)} can be refunded on this order.` }) : setAsk({ kind: "part", cents: partCents }))}
          >
            Refund part
          </button>
        </div>
      ) : (
        <p className="text-sm text-muted">Nothing left to refund.</p>
      )}
      {!props.ready && props.notReadyReason && <p className="mt-2 text-sm"><b>Not active yet:</b> {props.notReadyReason}</p>}
      {ask && (
        <div role="alertdialog" aria-label="Confirm refund" className="mt-3 rounded-lg border-2 border-coral bg-[#FDF1EF] p-3" data-refund-confirm>
          <p className="font-bold">{question}</p>
          <div className="mt-2 flex gap-2">
            <button
              className="btn-dark !py-1.5 text-sm"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await refundAction(props.orderId, ask.kind, ask.kind === "part" ? (ask.cents / 100).toFixed(2) : "");
                  setMsg(r);
                  setAsk(null);
                  if (r.ok) setPart("");
                })
              }
            >
              Confirm
            </button>
            <button className="btn-ghost !py-1.5 text-sm" disabled={pending} onClick={() => setAsk(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {msg?.message && <p className={`mt-2 text-sm font-semibold ${msg.ok ? "text-[#13895C]" : "text-coral-dark"}`}>{msg.message}</p>}
      {props.refunds.length > 0 && (
        <table className="mt-3 w-full text-sm" data-refunds>
          <thead>
            <tr><th className="th">Date and time</th><th className="th">Amount</th><th className="th">By</th><th className="th">Result</th><th className="th">Refund ID</th></tr>
          </thead>
          <tbody>
            {props.refunds.map((r) => (
              <tr key={r.id}>
                <td className="td">{r.when}</td>
                <td className="td">{r.amount}</td>
                <td className="td">{r.by}</td>
                <td className={`td ${r.result === "Failed" ? "font-bold text-coral-dark" : ""}`}>{r.result}{r.error ? `: ${r.error}` : ""}</td>
                <td className="td text-xs">{r.refundId ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
