"use client";

import { useState, useTransition } from "react";
import { disputeEvidenceAction } from "./stripe-actions";

type Dispute = { id: number; amount: string; reason: string; status: string; dueBy: string | null; sentAt: string | null };

/** Disputes on a Stripe phone payment (Owner only), with Send proof to Stripe. */
export default function StripePanel(props: { orderId: number; disputes: Dispute[]; ready: boolean }) {
  const [msg, setMsg] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="card p-5" data-stripe-panel>
      <h2 className="mb-2 font-bold">Dispute</h2>
      {props.disputes.map((d) => (
        <div key={d.id} className="mb-3 rounded-lg border border-[#E8B4AE] bg-[#FDF1EF] p-3 text-sm" data-dispute>
          <b>Dispute: {d.amount}</b> ({d.reason}) · {d.status}
          {d.dueBy && <div>Send proof by {d.dueBy}</div>}
          {d.sentAt ? (
            <div className="mt-1 font-semibold">Proof sent {d.sentAt}</div>
          ) : (
            <button
              className="btn-dark mt-2 !py-1.5 text-sm"
              disabled={pending || !props.ready}
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
      {!props.ready && <p className="text-sm"><b>Not active yet:</b> sending proof needs STRIPE_DISPUTES_KEY in Vercel.</p>}
      {msg?.message && <p className={`mt-2 text-sm font-semibold ${msg.ok ? "text-[#13895C]" : "text-coral-dark"}`}>{msg.message}</p>}
    </div>
  );
}
