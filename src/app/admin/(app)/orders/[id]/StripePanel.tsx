"use client";

import { useState, useTransition } from "react";
import { disputeEvidenceAction, refundAction } from "./stripe-actions";

type Refund = { id: number; amount: string; when: string; by: string; status: string; error: string | null };
type Dispute = { id: number; amount: string; reason: string; status: string; dueBy: string | null; sentAt: string | null };

/** Stripe phone payment on the order (Owner only): refunds full or part, and disputes with Send proof to Stripe. */
export default function StripePanel(props: { orderId: number; refundable: string; refundableCents: number; status: string | null; refunds: Refund[]; disputes: Dispute[]; writeReady: boolean }) {
  const [amount, setAmount] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, start] = useTransition();
  const refund = (kind: "full" | "part") => {
    const shown = kind === "full" ? props.refundable : `$${amount.replace(/^\$/, "")}`;
    if (!window.confirm(`Refund ${shown} to the customer's card through Stripe? This can't be undone.`)) return;
    start(async () => setMsg(await refundAction(props.orderId, kind, amount)));
  };
  return (
    <div className="card p-5" data-stripe-panel>
      <h2 className="mb-1 font-bold">Stripe phone payment</h2>
      {props.status && <p className="mb-2 text-sm font-bold text-coral-dark">{props.status}</p>}
      {props.disputes.map((d) => (
        <div key={d.id} className="mb-3 rounded-lg border border-[#E8B4AE] bg-[#FDF1EF] p-3 text-sm" data-dispute>
          <b>Dispute: {d.amount}</b> ({d.reason}) · {d.status}
          {d.dueBy && <div>Send proof by {d.dueBy}</div>}
          {d.sentAt ? (
            <div className="mt-1 font-semibold">Proof sent {d.sentAt}</div>
          ) : (
            <button
              className="btn-dark mt-2 !py-1.5 text-sm"
              disabled={pending || !props.writeReady}
              onClick={() => {
                if (!window.confirm("Send Stripe the proof for this dispute (the order, the phone read-back record and the delivery record)? It can be sent only once.")) return;
                start(async () => setMsg(await disputeEvidenceAction(props.orderId, d.id)));
              }}
            >
              Send proof to Stripe
            </button>
          )}
        </div>
      ))}
      {props.refundableCents > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn-ghost !py-1.5 text-sm" disabled={pending || !props.writeReady} onClick={() => refund("full")}>
            Refund full ({props.refundable})
          </button>
          <input className="input w-28 !py-1.5 text-sm" inputMode="decimal" placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Refund amount" />
          <button className="btn-ghost !py-1.5 text-sm" disabled={pending || !props.writeReady || !amount.trim()} onClick={() => refund("part")}>
            Refund part
          </button>
        </div>
      ) : (
        <p className="text-sm text-muted">Nothing left to refund.</p>
      )}
      {!props.writeReady && <p className="mt-2 text-sm"><b>Not active yet:</b> refunds and dispute proof need STRIPE_WRITE_KEY in Vercel.</p>}
      {props.refunds.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm" data-refunds>
          {props.refunds.map((r) => (
            <li key={r.id}>
              {r.status === "failed" ? "Refund failed" : "Refunded"} {r.amount} · {r.when} · {r.by}
              {r.error && <span className="text-coral-dark"> ({r.error})</span>}
            </li>
          ))}
        </ul>
      )}
      {msg?.message && <p className={`mt-2 text-sm font-semibold ${msg.ok ? "text-[#13895C]" : "text-coral-dark"}`}>{msg.message}</p>}
    </div>
  );
}
