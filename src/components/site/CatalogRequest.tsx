"use client";

import { useActionState } from "react";
import { requestCatalogAction, textCatalogAction } from "@/app/catalog-actions";
import { CATALOG_EMAIL_BUTTON, CATALOG_FORM_DRAFT, CATALOG_TEXT_BUTTON, CATALOG_TEXT_LINE } from "@/lib/catalog-request-copy";

/** "Or text CATALOG to (845) 415-7585." and the "Email me the catalog" box (Abraham, Nov 18, 2026). */
export default function CatalogRequest() {
  const [state, action, pending] = useActionState(requestCatalogAction, null);
  const [tState, tAction, tPending] = useActionState(textCatalogAction, null);
  return (
    <div className="mt-3" data-catalog-request>
      <p className="text-lg leading-relaxed text-hu-deep/85" data-catalog-text-line>
        {CATALOG_TEXT_LINE.before}
        <a href={`sms:${CATALOG_TEXT_LINE.sms}?&body=CATALOG`} className="font-bold underline decoration-hu-yellow decoration-[3px] underline-offset-4 [text-decoration-skip-ink:none]">
          {CATALOG_TEXT_LINE.phone}
        </a>
        {CATALOG_TEXT_LINE.after}
      </p>
      <form action={action} className="mt-4 flex max-w-xl flex-col gap-3 sm:flex-row" data-catalog-email-form>
        <label className="sr-only" htmlFor="catalog-email">Email address</label>
        <input id="catalog-email" name="email" type="email" required autoComplete="email" placeholder={CATALOG_FORM_DRAFT.placeholder} className="min-h-12 flex-1 rounded-full border-2 border-hu-deep/20 bg-white px-5 text-lg text-hu-deep outline-none focus:border-hu-deep" />
        {/* left empty by people; robots fill it */}
        <input name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />
        <button disabled={pending} className="hu-btn !min-h-12 whitespace-nowrap !px-6 text-base">
          {CATALOG_EMAIL_BUTTON}
        </button>
      </form>
      {state?.message && (
        <p role="status" className={`mt-2 text-base font-semibold ${state.ok ? "text-[#13895C]" : "text-[#C83A2F]"}`}>
          {state.message}
        </p>
      )}
      {/* Text me the catalog (Abraham, Nov 18, 2026) */}
      <form action={tAction} className="mt-3 flex max-w-xl flex-col gap-3 sm:flex-row" data-catalog-text-form>
        <label className="sr-only" htmlFor="catalog-phone">Cell phone number</label>
        <input id="catalog-phone" name="phone" type="tel" required inputMode="tel" autoComplete="tel" placeholder={CATALOG_FORM_DRAFT.phonePlaceholder} className="min-h-12 flex-1 rounded-full border-2 border-hu-deep/20 bg-white px-5 text-lg text-hu-deep outline-none focus:border-hu-deep" />
        <input name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />
        <button disabled={tPending} className="hu-btn !min-h-12 whitespace-nowrap !px-6 text-base">
          {CATALOG_TEXT_BUTTON}
        </button>
      </form>
      {tState?.message && (
        <p role="status" className={`mt-2 text-base font-semibold ${tState.ok ? "text-[#13895C]" : "text-[#C83A2F]"}`}>
          {tState.message}
        </p>
      )}
    </div>
  );
}
