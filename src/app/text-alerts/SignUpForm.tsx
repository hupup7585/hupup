"use client";

import { useActionState, useEffect, useState } from "react";
import { Check } from "lucide-react";
import { SELECTABLE_TIME_ZONES } from "@/lib/area-code-tz";
import { PROMO_BENEFITS, PROMO_BENEFITS_NOTE, PROMO_HEADING, PROMO_TITLE } from "@/lib/sms-consent-copy";
import { signUpForTexts, type SignUpState } from "./actions";
import ConsentText from "@/components/ConsentText";

/**
 * Website SMS enrollment. Two separate checkboxes, both unchecked by default; neither is required by the other,
 * and promotional consent is never tied to a purchase.
 */
export default function SignUpForm({ transactionalText, marketingText, smsNumber, disabledReason, v3 = false, notActive = null }: { transactionalText: string; marketingText: string; smsNumber: string; disabledReason: string | null; v3?: boolean; notActive?: string | null }) {
  const [state, action, pending] = useActionState<SignUpState, FormData>(signUpForTexts, {});
  // Pre-select the time zone this device reports; the customer can change it.
  const [zone, setZone] = useState("");
  useEffect(() => {
    try {
      const z = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (SELECTABLE_TIME_ZONES.some((o) => o.zone === z)) setZone(z);
    } catch {
      /* keep blank */
    }
  }, []);

  if (state.ok && v3) {
    return (
      <div data-signup-done className="rounded-2xl border-2 border-hu-deep bg-hu-tint p-6">
        <p className="text-xl font-bold">{state.promo ? "Almost done!" : "Thank you, you\u2019re signed up."}</p>
        {state.promo && <p className="mt-2">Check your phone and reply YES to our text to confirm.</p>}
        {state.orders && <p className="mt-2">We just texted you a confirmation for order and service texts.</p>}
        <p className="mt-2">Reply STOP to {smsNumber} at any time to stop all texts, or HELP for help.</p>
      </div>
    );
  }
  if (state.ok) {
    return (
      <div data-signup-done className="rounded-2xl border-2 border-hu-deep bg-hu-tint p-6">
        <p className="text-xl font-bold">Thank you, you&rsquo;re signed up.</p>
        <p className="mt-2">We just texted you a confirmation{state.orders && state.promo ? " for each program you chose" : ""}. Reply STOP to {smsNumber} at any time to opt out, or HELP for help.</p>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-6" noValidate>
      {disabledReason && <p className="rounded-xl bg-hu-yellow/40 p-3 font-semibold">{disabledReason}</p>}
      {state.stopped && (
        <p role="alert" className="rounded-xl bg-hu-yellow/40 p-3 font-semibold">
          This number replied STOP earlier, so our texts are blocked. Text START to {smsNumber} first, then sign up again.
        </p>
      )}
      {state.error && (
        <p role="alert" className="rounded-xl bg-red-50 p-3 font-semibold text-red-800">
          {state.error}
        </p>
      )}
      <label className="block">
        <span className="font-bold">Mobile phone number</span>
        <input name="phone" type="tel" inputMode="tel" autoComplete="tel-national" required placeholder="(845) 555-0123" className="mt-1 block w-full rounded-xl border-2 border-hu-deep/30 px-4 py-3 text-lg focus:border-hu-deep focus:outline-none" />
      </label>
      <label className="block">
        <span className="font-bold">First name</span> <span className="opacity-70">(optional)</span>
        <input name="firstName" type="text" autoComplete="given-name" className="mt-1 block w-full rounded-xl border-2 border-hu-deep/30 px-4 py-3 text-lg focus:border-hu-deep focus:outline-none" />
      </label>
      {/* Honeypot: hidden from people, bots fill it in */}
      <input name="company" type="text" tabIndex={-1} autoComplete="off" aria-hidden className="absolute left-[-9999px] h-px w-px opacity-0" />

      <fieldset className="space-y-4">
        <legend className="mb-2 font-bold">Choose the texts you want (check one or both)</legend>
        {/* Promotional list: the larger, highlighted choice (Abraham). Still unchecked; consent wording unchanged. */}
        <div data-consent="marketing" className="rounded-3xl border-[3px] border-hu-deep bg-hu-yellow/30 p-5 shadow-[6px_6px_0_#123D73] sm:p-7">
          <h2 data-promo-title className="text-2xl font-extrabold leading-tight sm:text-3xl">{PROMO_TITLE}</h2>
          <p data-promo-heading className="mt-1 text-lg font-extrabold uppercase tracking-[0.14em] sm:text-xl">{PROMO_HEADING}</p>
          <p className="mt-3 text-lg font-semibold">Members get:</p>
          <ul data-promo-benefits className="mt-2 grid gap-x-6 gap-y-1.5 text-lg sm:grid-cols-2">
            {PROMO_BENEFITS.map((b) => (
              <li key={b} className="flex items-start gap-2">
                <Check className="mt-1 h-5 w-5 shrink-0 text-hu-deep" strokeWidth={3} aria-hidden />
                {b}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-base">{v3 ? "Up to 5 promo texts a year, never more." : PROMO_BENEFITS_NOTE}</p>
          <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-2xl bg-white p-4">
            <input type="checkbox" name="marketing" className="mt-1 h-6 w-6 shrink-0 accent-hu-deep" />
            <span>
              <span className="block text-lg font-bold">Promotional text messages</span>
              <span className="mt-1 block text-base leading-relaxed">
                <ConsentText text={marketingText} />
              </span>
            </span>
          </label>
        </div>
        <label data-consent="transactional" className="flex items-start gap-3 rounded-2xl border-2 border-hu-deep/15 p-4">
          <input type="checkbox" name="transactional" className="mt-1 h-5 w-5 shrink-0 accent-hu-deep" />
          <span>
            <span className="block font-bold">Order and service notifications</span>
            <span className="mt-1 block text-base leading-relaxed">{transactionalText}</span>
          </span>
        </label>
      </fieldset>

      <label className="block">
        <span className="font-bold">Your time zone</span> <span className="opacity-70">{v3 ? "(optional)" : "(required for promotional texts)"}</span>
        <span className="mt-1 block text-base">We send promotional texts only between 8:00 a.m. and 9:00 p.m. in your time zone.</span>
        <select name="timeZone" value={zone} onChange={(e) => setZone(e.target.value)} className="mt-2 block w-full rounded-xl border-2 border-hu-deep/30 bg-white px-4 py-3 text-lg focus:border-hu-deep focus:outline-none">
          <option value="">Choose your time zone</option>
          {SELECTABLE_TIME_ZONES.map((o) => (
            <option key={o.zone} value={o.zone}>
              {o.label}
            </option>
          ))}
        </select>
      </label>

      <p className="text-base">
        {v3 && (
          <span data-join-instructions className="mb-2 block">
            You can also text JOIN to {smsNumber} to request a confirmation text. You are signed up only when you reply YES to that text within 24 hours.
          </span>
        )}
        Text HELP to {smsNumber} for help. Text STOP to opt out. See our{" "}
        <a href="/sms-terms" className="font-semibold underline underline-offset-4">
          SMS Terms
        </a>{" "}
        and{" "}
        <a href="/privacy" className="font-semibold underline underline-offset-4">
          Privacy Policy
        </a>
        .
      </p>

      {notActive ? (
        <p data-not-active="sms-signup" className="rounded-xl bg-hu-yellow/40 p-3 font-semibold">
          {notActive}
        </p>
      ) : (
        <button type="submit" disabled={pending || Boolean(disabledReason)} className="hu-btn disabled:opacity-60">
          {pending ? "Signing up..." : "SIGN UP"}
        </button>
      )}
    </form>
  );
}
