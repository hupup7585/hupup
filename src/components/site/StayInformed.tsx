"use client";

import { useActionState } from "react";
import { signUpForTexts, type SignUpState } from "@/app/text-alerts/actions";
import ConsentText from "@/components/ConsentText";
import { SectionTitle } from "@/components/site/parts";

/**
 * Homepage "Stay Informed" (Abraham, SMS v3): promo sign-up only. The box is never checked for the customer; signing
 * up sends the confirmation text, and only a YES reply within 24 hours adds them.
 */
export default function StayInformed({ marketingText, smsNumber, notActive, disabledReason }: { marketingText: string; smsNumber: string; notActive: string | null; disabledReason: string | null }) {
  const [state, action, pending] = useActionState<SignUpState, FormData>(signUpForTexts, {});
  return (
    <section id="stay-informed" data-stay-informed className="scroll-mt-20 bg-hu-tint py-14 sm:py-20">
      {/* Abraham: same page width, small line and title size as the other homepage sections; the form stays narrower inside */}
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div data-stay-informed-body className="max-w-3xl">
        <SectionTitle kicker="Never miss a deal" title="Stay Informed" />
        <p className="mt-3 text-lg leading-relaxed">Be the first to hear about seasonal deals, specials, and new rentals from Hup Up Attractions.</p>
        <p className="mt-1 text-sm font-semibold opacity-80">Up to 6 promo texts a year, never more.</p>
        {state.ok ? (
          <div data-stay-informed-done className="mt-6 rounded-2xl border-2 border-hu-deep bg-white p-5">
            <p className="text-lg font-bold">Almost done! Check your phone and reply YES to our text to confirm.</p>
          </div>
        ) : (
          <form action={action} className="mt-6 space-y-4" noValidate>
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
            <label className="block" htmlFor="stay-phone">
              <span className="font-bold">Mobile number</span>
              <input id="stay-phone" name="phone" type="tel" inputMode="tel" autoComplete="tel-national" required className="mt-1 block w-full rounded-xl border-2 border-hu-deep/30 bg-white px-4 py-3 text-lg focus:border-hu-deep focus:outline-none" />
            </label>
            <input name="company" type="text" tabIndex={-1} autoComplete="off" aria-hidden className="absolute left-[-9999px] h-px w-px opacity-0" />
            <label className="flex cursor-pointer items-start gap-3 rounded-2xl bg-white p-4">
              <input type="checkbox" name="marketing" className="mt-1 h-6 w-6 shrink-0 accent-hu-deep" />
              <span className="text-base leading-relaxed">
                <ConsentText text={marketingText} />
              </span>
            </label>
            {notActive ? (
              <p data-not-active="stay-informed" className="rounded-xl bg-hu-yellow/40 p-3 font-semibold">
                {notActive}
              </p>
            ) : (
              <button type="submit" disabled={pending || Boolean(disabledReason)} className="hu-btn disabled:opacity-60">
                {pending ? "Signing up..." : "Sign Me Up"}
              </button>
            )}
          </form>
        )}
        <p className="mt-4 text-base">Or text JOIN to {smsNumber}.</p>
        </div>
      </div>
    </section>
  );
}
