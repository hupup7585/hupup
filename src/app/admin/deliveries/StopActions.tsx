"use client";

import { useState, useTransition } from "react";
import { Camera, CheckCircle2, MessageSquareText, Phone } from "lucide-react";
import { DELIVERY_TEMPLATES, type TemplateKey } from "@/lib/delivery-templates";
import { markDoneAction, sendTemplateAction } from "./actions";

export default function StopActions({ orderId, phone, stop, done }: { orderId: number; phone: string | null; stop: "delivery" | "pickup"; done: boolean }) {
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
        <button type="button" className="btn-ghost" disabled title="Photo storage is waiting for Abram's approval">
          <Camera className="h-4 w-4" aria-hidden /> Add photo
        </button>
      </div>
      <button type="button" className="btn-dark w-full" disabled={pending || done} onClick={() => start(async () => setMsg(await markDoneAction(orderId, stop)))}>
        <CheckCircle2 className="h-4 w-4" aria-hidden /> {done ? (stop === "delivery" ? "Delivered" : "Picked up") : stop === "delivery" ? "Mark delivered" : "Mark picked up"}
      </button>
      {msg && <p className={`text-sm font-semibold ${msg.ok ? "text-navy" : "text-[#b3261e]"}`}>{msg.message}</p>}
    </div>
  );
}
