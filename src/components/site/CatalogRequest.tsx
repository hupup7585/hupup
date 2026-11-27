"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { requestCatalogAction, textCatalogAction } from "@/app/catalog-actions";
import { CATALOG_EMAIL_BUTTON, CATALOG_FORM_DRAFT, CATALOG_TEXT_BUTTON, CATALOG_TEXT_CONSENT, CATALOG_TEXT_FINE_PRINT } from "@/lib/catalog-request-copy";

/* Balanced look (Abraham, Nov 18, 2026): between the first and the formal version. White inputs with a light-blue border,
   yellow email button and light-blue text button with navy text, medium corners; both rows lined up (same input width,
   same button width and height); on phones each box above its button, full width. */
const INPUT = "h-11 w-full min-w-0 rounded-xl border border-[#9FCFF7] bg-white px-4 text-[17px] text-hu-deep outline-none placeholder:text-[#B8C2CF] focus:border-hu-deep focus:ring-1 focus:ring-hu-deep sm:h-12 sm:w-auto sm:flex-1";
const BUTTON = "h-11 w-full shrink-0 whitespace-nowrap rounded-xl px-5 text-base font-bold text-hu-deep transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hu-deep disabled:opacity-60 sm:h-12 sm:w-60 sm:text-[17px]";

/** The "Email me the catalog" box (Abraham, Nov 18, 2026). The text-CATALOG line was removed (Abraham, Nov 24, 2026). */
export default function CatalogRequest() {
  const [state, action, pending] = useActionState(requestCatalogAction, null);
  const [tState, tAction, tPending] = useActionState(textCatalogAction, null);
  // Plan A (Abraham, Nov 27, 2026): the box starts unticked; the text button stays off until it is ticked
  const [agreed, setAgreed] = useState(false);
  return (
    <div className="mt-2" data-catalog-request>
      <form action={action} className="mt-4 flex flex-col gap-2 sm:flex-row sm:gap-3" data-catalog-email-form>
        <label className="sr-only" htmlFor="catalog-email">Email address</label>
        <input id="catalog-email" name="email" type="email" required autoComplete="email" placeholder={CATALOG_FORM_DRAFT.placeholder} className={INPUT} />
        {/* left empty by people; robots fill it */}
        <input name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />
        <button disabled={pending} className={`${BUTTON} bg-[#8CCBFF] hover:bg-[#74BEF9]`}>
          {CATALOG_EMAIL_BUTTON}
        </button>
      </form>
      {state?.message && (
        <p role="status" className={`mt-2 text-sm font-semibold sm:text-base ${state.ok ? "text-[#13895C]" : "text-[#C83A2F]"}`}>
          {state.message}
        </p>
      )}
      {/* Text me the catalog (Abraham, Nov 18, 2026) */}
      <form action={tAction} className="mt-3" data-catalog-text-form>
        <div className="flex flex-col gap-2 sm:flex-row sm:gap-3">
          <label className="sr-only" htmlFor="catalog-phone">Cell phone number</label>
          <input id="catalog-phone" name="phone" type="tel" required inputMode="tel" autoComplete="tel" placeholder={CATALOG_FORM_DRAFT.phonePlaceholder} className={INPUT} />
          <input name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />
          <button disabled={tPending || !agreed} className={`${BUTTON} bg-[#8CCBFF] hover:bg-[#74BEF9]`} data-catalog-text-button>
            {CATALOG_TEXT_BUTTON}
          </button>
        </div>
        <label className="mt-2 flex items-start gap-2 text-[15px] text-hu-deep" data-catalog-consent>
          <input type="checkbox" name="consent" value="yes" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-1 h-4 w-4 shrink-0 accent-hu-deep" />
          <span>{CATALOG_TEXT_CONSENT}</span>
        </label>
        <p className="mt-1 text-xs text-[#5B6B7F] sm:text-sm" data-catalog-fine-print>
          {CATALOG_TEXT_FINE_PRINT}{" "}
          <Link href="/sms-terms" className="underline">SMS Terms</Link> and <Link href="/privacy" className="underline">Privacy Policy</Link>.
        </p>
      </form>
      {tState?.message && (
        <p role="status" className={`mt-2 text-sm font-semibold sm:text-base ${tState.ok ? "text-[#13895C]" : "text-[#C83A2F]"}`}>
          {tState.message}
        </p>
      )}
    </div>
  );
}
