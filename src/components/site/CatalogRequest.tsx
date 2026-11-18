"use client";

import { useActionState } from "react";
import { requestCatalogAction, textCatalogAction } from "@/app/catalog-actions";
import { CATALOG_EMAIL_BUTTON, CATALOG_FORM_DRAFT, CATALOG_TEXT_BUTTON, CATALOG_TEXT_LINE } from "@/lib/catalog-request-copy";

/* Formal look (Abraham, Nov 18, 2026): white inputs with a thin gray border, navy buttons with white text, small corners,
   both rows lined up (same input width, same button width and height); smaller and tighter on phones. */
const INPUT = "h-10 w-full min-w-0 sm:w-auto sm:flex-1 rounded-md border border-[#C9D1DB] bg-white px-3 text-base text-hu-deep outline-none placeholder:text-[#7A8797] focus:border-hu-deep focus:ring-1 focus:ring-hu-deep sm:h-11";
const BUTTON = "h-10 w-full shrink-0 whitespace-nowrap rounded-md bg-hu-deep px-4 text-sm font-semibold text-white transition-colors hover:bg-[#1D5394] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hu-deep disabled:opacity-60 sm:h-11 sm:w-56 sm:text-base";

/** "Or text CATALOG to (845) 415-7585." and the "Email me the catalog" box (Abraham, Nov 18, 2026). */
export default function CatalogRequest() {
  const [state, action, pending] = useActionState(requestCatalogAction, null);
  const [tState, tAction, tPending] = useActionState(textCatalogAction, null);
  return (
    <div className="mt-2" data-catalog-request>
      <p className="text-base leading-relaxed text-hu-deep sm:text-lg" data-catalog-text-line>
        {CATALOG_TEXT_LINE.before}
        <a href={`sms:${CATALOG_TEXT_LINE.sms}?&body=CATALOG`} className="font-bold text-hu-deep underline decoration-1 underline-offset-2 hover:decoration-2">
          {CATALOG_TEXT_LINE.phone}
        </a>
        {CATALOG_TEXT_LINE.after}
      </p>
      <form action={action} className="mt-4 flex flex-col gap-2 sm:flex-row sm:gap-3" data-catalog-email-form>
        <label className="sr-only" htmlFor="catalog-email">Email address</label>
        <input id="catalog-email" name="email" type="email" required autoComplete="email" placeholder={CATALOG_FORM_DRAFT.placeholder} className={INPUT} />
        {/* left empty by people; robots fill it */}
        <input name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />
        <button disabled={pending} className={BUTTON}>
          {CATALOG_EMAIL_BUTTON}
        </button>
      </form>
      {state?.message && (
        <p role="status" className={`mt-2 text-sm font-semibold sm:text-base ${state.ok ? "text-[#13895C]" : "text-[#C83A2F]"}`}>
          {state.message}
        </p>
      )}
      {/* Text me the catalog (Abraham, Nov 18, 2026) */}
      <form action={tAction} className="mt-3 flex flex-col gap-2 sm:flex-row sm:gap-3" data-catalog-text-form>
        <label className="sr-only" htmlFor="catalog-phone">Cell phone number</label>
        <input id="catalog-phone" name="phone" type="tel" required inputMode="tel" autoComplete="tel" placeholder={CATALOG_FORM_DRAFT.phonePlaceholder} className={INPUT} />
        <input name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />
        <button disabled={tPending} className={BUTTON}>
          {CATALOG_TEXT_BUTTON}
        </button>
      </form>
      {tState?.message && (
        <p role="status" className={`mt-2 text-sm font-semibold sm:text-base ${tState.ok ? "text-[#13895C]" : "text-[#C83A2F]"}`}>
          {tState.message}
        </p>
      )}
    </div>
  );
}
