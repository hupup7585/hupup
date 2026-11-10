"use client";

import { useState, useTransition } from "react";
import { staffPromoNoAction, staffPromoSignupAction, type StaffPromoResult } from "../staff-promo-actions";
import { STAFF_PROMO_STEP1, STAFF_PROMO_STEP3 } from "@/lib/staff-promo";

/**
 * Promo texts sign-up for staff (Abraham, Nov 10, 2026): read Step 1, mark the answer, confirm or type the number in
 * Step 2, then Send confirmation (disabled until the customer said yes). Step 3 is shown once the text went out.
 */
export default function PromoSignupPanel({ orderId, phoneDisplay, step2, preview, stopped = false }: { orderId: number; phoneDisplay: string; step2: string; preview: boolean; stopped?: boolean }) {
  const [answer, setAnswer] = useState<"" | "yes" | "no">("");
  const [useCustomer, setUseCustomer] = useState(true);
  const [other, setOther] = useState("");
  const [result, setResult] = useState<StaffPromoResult | null>(null);
  const [pending, start] = useTransition();
  const otherOk = other.replace(/\D/g, "").length === 10;
  const canSend = answer === "yes" && (useCustomer ? Boolean(phoneDisplay) : otherOk) && !pending && !result?.sent;

  const step = "mb-1 text-xs font-bold uppercase tracking-wider text-muted";
  const quote = "mb-3 rounded-xl border-l-4 border-sky bg-bg p-3 text-sm leading-relaxed";

  return (
    <div className="card p-5" data-promo-signup>
      <h2 className="mb-1 font-bold">Promo texts sign-up</h2>
      {preview && <p data-promo-preview className="mb-3 rounded-lg bg-[#FFF8E1] px-3 py-2 text-sm font-semibold text-[#5C4600]">Preview for Abraham: only the Owner sees this until it&rsquo;s approved.</p>}
      {stopped && <p className="mb-3 rounded-lg bg-coral/10 p-2 text-sm font-semibold text-coral">This customer replied STOP. No texts can go to this number.</p>}

      <div className={step}>Step 1: read to the customer</div>
      <blockquote data-step="1" className={quote}>&ldquo;{STAFF_PROMO_STEP1}&rdquo;</blockquote>
      <div className="mb-4 flex gap-2">
        {(["yes", "no"] as const).map((v) => (
          <button
            key={v}
            type="button"
            disabled={Boolean(result)}
            onClick={() => setAnswer(v)}
            className={`rounded-full px-4 py-1.5 text-sm font-bold ${answer === v ? "bg-[#123D73] text-white" : "bg-bg"}`}
          >
            {v === "yes" ? "Customer said yes" : "Customer said no"}
          </button>
        ))}
      </div>

      {answer === "no" && !result && (
        <button type="button" className="btn-ghost w-full" disabled={pending} onClick={() => start(async () => setResult(await staffPromoNoAction(orderId)))}>
          Save &ldquo;No&rdquo; (nothing is sent)
        </button>
      )}

      {answer === "yes" && (
        <>
          <div className={step}>Step 2: ask</div>
          <blockquote data-step="2" className={quote}>&ldquo;{step2}&rdquo;</blockquote>
          <fieldset className="mb-3 space-y-2 text-sm" disabled={Boolean(result?.sent)}>
            <label className="flex items-center gap-2">
              <input type="radio" name={`promo-num-${orderId}`} checked={useCustomer} onChange={() => setUseCustomer(true)} disabled={!phoneDisplay} />
              Text {phoneDisplay || "the customer's number"}
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name={`promo-num-${orderId}`} checked={!useCustomer} onChange={() => setUseCustomer(false)} />
              A different number
            </label>
            {!useCustomer && (
              <input
                type="tel"
                inputMode="tel"
                placeholder="10-digit mobile number"
                value={other}
                onChange={(e) => setOther(e.target.value)}
                className="block w-full rounded-lg border px-3 py-2"
                aria-label="Different mobile number"
              />
            )}
          </fieldset>
        </>
      )}

      {answer !== "no" && (
        <button
          type="button"
          className="btn-dark w-full"
          disabled={!canSend || stopped}
          title={answer !== "yes" ? "Mark that the customer said yes first" : undefined}
          onClick={() => start(async () => setResult(await staffPromoSignupAction(orderId, { saidYes: answer === "yes", useCustomerNumber: useCustomer, otherNumber: other })))}
        >
          {result?.sent ? "Confirmation sent" : pending ? "Sending..." : "Send confirmation"}
        </button>
      )}
      {answer === "" && <p className="mt-2 text-xs text-muted">Send confirmation turns on after you mark that the customer said yes.</p>}

      {result && <p className={`mt-3 text-sm font-semibold ${result.ok ? "text-[#13895C]" : "text-coral"}`}>{result.message}</p>}
      {result?.sent && (
        <>
          <div className={`${step} mt-3`}>Step 3: read to the customer</div>
          <blockquote data-step="3" className={quote}>&ldquo;{STAFF_PROMO_STEP3}&rdquo;</blockquote>
        </>
      )}
    </div>
  );
}
