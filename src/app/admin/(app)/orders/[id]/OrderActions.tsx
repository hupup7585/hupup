"use client";

import { useState, useTransition } from "react";
import type { OrderStatus } from "@/lib/db/schema";
import { recordPaymentAction, sendPayLinkAction, updateDetailsAction, updateStatusAction, type ActionResult } from "../actions";
import { DELIVERY_WINDOW, PICKUP_BY } from "@/lib/rental-days";

const NEXT: { status: OrderStatus; label: string; cls: string }[] = [
  { status: "CONFIRMED", label: "✅ Confirmed", cls: "btn-ghost" },
  { status: "DELIVERED", label: "🚚 Delivered", cls: "btn-ghost" },
  { status: "PICKED_UP", label: "↩️ Picked up", cls: "btn-ghost" },
  { status: "CANCELLED", label: "✖ Cancel order", cls: "btn-ghost !text-coral" },
];

export default function OrderActions(props: {
  orderId: number;
  status: OrderStatus;
  due: number;
  hasPhone: boolean;
  deliveryAddress: string;
  deliveryTime: string;
  notes: string;
  holdExpiresAt: string | null;
}) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<ActionResult | null>(null);
  const [amount, setAmount] = useState(props.due > 0 ? (props.due / 100).toFixed(2) : "");
  const [method, setMethod] = useState("cash");
  const run = (fn: () => Promise<ActionResult>) => start(async () => setMsg(await fn()));

  return (
    <div className="space-y-5">
      <div className="card p-5">
        <h2 className="mb-3 font-bold">Update status</h2>
        {props.holdExpiresAt && (props.status === "PENDING_PAYMENT" || props.status === "HOLD") && (
          <p className="mb-3 text-sm text-muted">Held until {new Date(props.holdExpiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} — released automatically if unpaid. Mark Confirmed to keep it regardless.</p>
        )}
        <div className="grid grid-cols-2 gap-2">
          {NEXT.filter((n) => n.status !== props.status).map((n) => (
            <button
              key={n.status}
              className={n.cls}
              disabled={pending}
              onClick={() => {
                if (n.status === "CANCELLED" && !confirm("Cancel this order and free the items?")) return;
                run(() => updateStatusAction(props.orderId, n.status));
              }}
            >
              {n.label}
            </button>
          ))}
        </div>
      </div>

      <div className="card p-5">
        <h2 className="mb-3 font-bold">Payment</h2>
        <button className="btn-dark mb-4 w-full" disabled={pending || !props.hasPhone || props.due <= 0} onClick={() => run(() => sendPayLinkAction(props.orderId))}>
          💬 Text Sola payment link
        </button>
        <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
          <input className="input" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount" inputMode="decimal" />
          <select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="cash">Cash</option>
            <option value="check">Check</option>
            <option value="sola">Card (Sola)</option>
            <option value="other">Other</option>
          </select>
          <button className="btn-ghost" disabled={pending} onClick={() => run(() => recordPaymentAction(props.orderId, amount, method))}>Record</button>
        </div>
      </div>

      <form className="card space-y-3 p-5" action={(fd) => run(() => updateDetailsAction(props.orderId, fd))}>
        <h2 className="font-bold">Delivery details</h2>
        <div><label className="label">Address</label><input name="deliveryAddress" defaultValue={props.deliveryAddress} className="input" /></div>
        <p className="text-sm text-muted">Delivery {DELIVERY_WINDOW} · pickup by {PICKUP_BY} (whole rental days)</p>
        <div><label className="label">Notes</label><textarea name="notes" defaultValue={props.notes} rows={3} className="input" /></div>
        <button className="btn-dark w-full" disabled={pending}>Save</button>
      </form>

      {msg && <p className={`rounded-xl p-3 text-sm font-semibold ${msg.ok ? "bg-mint/15 text-[#13895C]" : "bg-coral/10 text-coral-dark"}`}>{msg.message}</p>}
    </div>
  );
}
