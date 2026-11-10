"use client";

import { useState, useTransition } from "react";
import { recordStaffConsentAction } from "../consent-actions";
import { SELECTABLE_TIME_ZONES } from "@/lib/area-code-tz";
import type { ConsentScope, StaffResponse } from "@/lib/sms-consent";

/**
 * Staff records text consent by phone or in person. The full disclosure is shown to read aloud; a yes can only
 * be recorded after confirming it was read in full. Silence or an unclear answer is recorded as no consent.
 */
export default function ConsentPanel({
  orderId,
  phoneDisplay,
  disclosures,
  stopped = false,
  scopes = ["transactional", "marketing"],
}: {
  orderId: number;
  phoneDisplay: string;
  disclosures: Record<ConsentScope, string>;
  stopped?: boolean;
  /** Promo sign-up has its own box (PromoSignupPanel); the order page shows order texts only here. */
  scopes?: ConsentScope[];
}) {
  const [scope, setScope] = useState<ConsentScope>("transactional");
  const [read, setRead] = useState(false);
  const [response, setResponse] = useState<StaffResponse | "">("");
  const [timeZone, setTimeZone] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, start] = useTransition();

  const text = disclosures[scope].replace("{phone}", phoneDisplay);
  const canSave = response !== "" && (response !== "clear_yes" || read);

  return (
    <div className="card p-5">
      <h2 className="mb-1 font-bold">Text message consent</h2>
      {stopped && (
        <p data-stopped className="mb-3 rounded-lg bg-coral/10 p-2 text-sm font-semibold text-coral">
          This customer replied STOP. Staff can&rsquo;t turn texts back on: the customer must text START and reply YES (order texts only). Promotions need a new sign-up after that.
        </p>
      )}
      <p className="mb-3 text-sm text-muted">Read the whole disclosure to the customer, word for word, before recording their answer. If they are silent, unsure, or unclear, record &ldquo;No clear answer&rdquo;: that is not consent.</p>
      {scopes.length > 1 && <div className="mb-3 flex gap-2">
        {scopes.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => {
              setScope(s);
              setRead(false);
              setResponse("");
              setMsg(null);
            }}
            className={`rounded-full px-3 py-1.5 text-sm font-bold ${scope === s ? "bg-[#123D73] text-white" : "bg-bg"}`}
          >
            {s === "transactional" ? "Order texts" : "Promotional texts"}
          </button>
        ))}
      </div>}
      <blockquote data-disclosure className="mb-3 rounded-xl border-l-4 border-sky bg-bg p-3 text-sm leading-relaxed">{text}</blockquote>
      <label className="mb-3 flex items-start gap-2 text-sm font-semibold">
        <input type="checkbox" checked={read} onChange={(e) => setRead(e.target.checked)} className="mt-0.5 h-4 w-4" />I read the entire disclosure above to the customer, word for word.
      </label>
      <fieldset className="mb-3 space-y-1 text-sm">
        <legend className="mb-1 font-semibold">Customer&rsquo;s answer</legend>
        {(
          [
            ["clear_yes", "Customer clearly said yes"],
            ["said_no", "Customer said no"],
            ["unclear_or_silent", "No clear answer, unsure, or silent (no consent)"],
          ] as const
        ).map(([v, label]) => (
          <label key={v} className="flex items-center gap-2">
            <input type="radio" name={`resp-${orderId}`} checked={response === v} disabled={stopped && v === "clear_yes"} onChange={() => setResponse(v)} />
            {label}
          </label>
        ))}
      </fieldset>
      {scope === "marketing" && response === "clear_yes" && (
        <label className="mb-3 block text-sm">
          <span className="font-semibold">Ask: &ldquo;Which time zone are you in?&rdquo;</span>
          <select value={timeZone} onChange={(e) => setTimeZone(e.target.value)} className="mt-1 block w-full rounded-lg border px-2 py-1.5">
            <option value="">Customer didn&rsquo;t say (use the fallback rule)</option>
            {SELECTABLE_TIME_ZONES.map((o) => (
              <option key={o.zone} value={o.zone}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {response === "clear_yes" && !read && <p className="mb-2 text-sm font-semibold text-coral">Check the box above first: a yes can only be recorded after the full disclosure was read.</p>}
      <button
        type="button"
        className="btn-dark w-full"
        disabled={!canSave || pending}
        onClick={() =>
          start(async () => {
            const r = await recordStaffConsentAction(orderId, { scope, response: response as StaffResponse, disclosureRead: read, timeZone });
            setMsg(r);
            if (r.ok) {
              setRead(false);
              setResponse("");
            }
          })
        }
      >
        {pending ? "Saving..." : "Record answer"}
      </button>
      {msg && <p className={`mt-2 text-sm font-semibold ${msg.ok ? "text-[#13895C]" : "text-coral"}`}>{msg.message}</p>}
    </div>
  );
}
