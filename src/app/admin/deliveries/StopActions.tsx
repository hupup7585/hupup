"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, Camera, CheckCircle2, MessageSquareText, Phone, Truck } from "lucide-react";
import { DELIVERY_TEMPLATES, type TemplateKey } from "@/lib/delivery-templates";
import { markDoneAction, sendTemplateAction, stageAction } from "./actions";

export default function StopActions({ orderId, phone, stop, done, stage }: { orderId: number; phone: string | null; stop: "delivery" | "pickup"; done: boolean; stage?: string }) {
  const [problem, setProblem] = useState<string | null>(null);
  const [tpl, setTpl] = useState<TemplateKey>(stop === "delivery" ? "on_the_way" : "pickup_reminder");
  const [msg, setMsg] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="no-print mt-3 space-y-2">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[auto_1fr_auto]">
        {phone ? (
          <a href={`tel:${phone}`} className="btn-ghost">
            <Phone className="h-4 w-4" aria-hidden /> Call
          </a>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <select className="input" value={tpl} onChange={(e) => setTpl(e.target.value as TemplateKey)} aria-label="Message to send">
            {Object.entries(DELIVERY_TEMPLATES).map(([k, t]) => (
              <option key={k} value={k}>
                {t.label}
              </option>
            ))}
          </select>
          <button type="button" className="btn-ghost shrink-0" disabled={pending} onClick={() => start(async () => setMsg(await sendTemplateAction(orderId, tpl)))}>
            <MessageSquareText className="h-4 w-4" aria-hidden /> Send template text
          </button>
        </div>
        <button type="button" className="btn-ghost" disabled title="Photo storage is waiting for Abraham's approval">
          <Camera className="h-4 w-4" aria-hidden /> Add photo
        </button>
      </div>
      {!done && stage !== "out_for_delivery" && stage !== "out_for_pickup" && (
        <button type="button" className="btn-ghost w-full" data-stage-out disabled={pending} onClick={() => start(async () => setMsg(await stageAction(orderId, stop, stop === "delivery" ? "out_for_delivery" : "out_for_pickup")))}>
          <Truck className="h-4 w-4" aria-hidden /> {stop === "delivery" ? "Out for delivery" : "Out for pickup"}
        </button>
      )}
      <button type="button" className="btn-dark w-full" disabled={pending || done} onClick={() => start(async () => setMsg(await markDoneAction(orderId, stop)))}>
        <CheckCircle2 className="h-4 w-4" aria-hidden /> {done ? (stop === "delivery" ? "Delivered" : "Picked up") : stop === "delivery" ? "Mark delivered" : "Mark picked up"}
      </button>
      {problem === null ? (
        <button type="button" className="btn-ghost w-full text-[#b3261e]" data-stage-problem disabled={pending} onClick={() => setProblem("")}>
          <AlertTriangle className="h-4 w-4" aria-hidden /> Report a problem
        </button>
      ) : (
        <div className="space-y-2">
          <textarea className="input" rows={2} value={problem} onChange={(e) => setProblem(e.target.value)} placeholder="What happened? For example: no one home, wrong address, item damaged" aria-label="What is the problem" />
          <button type="button" className="btn-dark w-full" disabled={pending || !problem.trim()} onClick={() => start(async () => { const r = await stageAction(orderId, stop, "problem", problem); setMsg(r); if (r.ok) setProblem(null); })}>
            Send to the office
          </button>
        </div>
      )}
      {msg && <p className={`text-sm font-semibold ${msg.ok ? "text-navy" : "text-[#b3261e]"}`}>{msg.message}</p>}
    </div>
  );
}
