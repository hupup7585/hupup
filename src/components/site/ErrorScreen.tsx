import { config, publicEmail } from "@/lib/config";
import { DEFAULT_CATEGORIES, slugify } from "@/lib/site-defaults";
import { TERMS_EFFECTIVE_DATE } from "@/lib/terms-content";
import { ERROR_PAGE_BUTTON, ERROR_PAGE_HEADING, ERROR_PAGE_LINE_BEFORE_PHONE, ERROR_PAGE_PHONE, ERROR_PAGE_PHONE_TEL } from "@/lib/error-page-copy";
import SiteHeader from "./SiteHeader";
import SiteFooterView from "./SiteFooterView";

/**
 * The website error page (Abraham, Nov 27, 2026, item 7): the full site header with the Hup Up Attractions logo and
 * the footer, the approved words centered in a clean white card, the phone number as a tap-to-call link, and one
 * button back to the homepage. Built only from fixed content (no database), so it shows even when the database is
 * down. No error codes or technical words.
 */
export default function ErrorScreen() {
  const c = {
    logoUrl: null,
    phoneDisplay: config.hotlineDisplay,
    phoneE164: config.hotlineE164,
    email: publicEmail({ VERCEL_ENV: process.env.HUP_SITE_ENV }),
    categories: DEFAULT_CATEGORIES.map((x) => ({ ...x, slug: slugify(x.name) })),
  };
  const termsLink = process.env.HUP_SITE_ENV !== "production" || TERMS_EFFECTIVE_DATE !== "draft";
  return (
    <div className="flex min-h-screen flex-col bg-white font-display text-hu-deep" data-error-page>
      <SiteHeader logoUrl={null} phoneDisplay={c.phoneDisplay} phoneE164={c.phoneE164} />
      <main className="flex flex-1 items-center justify-center bg-hu-tint px-4 py-16 sm:px-6 sm:py-24">
        <section className="w-full max-w-xl rounded-3xl border border-hu-deep/10 bg-white px-6 py-10 text-center shadow-[0_12px_40px_rgba(18,61,115,0.10)] sm:px-12 sm:py-14" data-error-card>
          <h1 className="text-2xl font-extrabold leading-snug sm:text-3xl">{ERROR_PAGE_HEADING}</h1>
          <p className="mx-auto mt-5 max-w-md font-sans text-lg leading-relaxed text-hu-deep/85 sm:text-xl" data-error-text>
            {ERROR_PAGE_LINE_BEFORE_PHONE}{" "}
            <a href={`tel:${ERROR_PAGE_PHONE_TEL}`} className="whitespace-nowrap font-bold text-hu-deep underline decoration-hu-yellow decoration-[3px] underline-offset-4 hover:decoration-hu-deep" data-error-phone>
              {ERROR_PAGE_PHONE}
            </a>
            .
          </p>
          <a href="/" className="hu-btn mt-9 inline-flex" data-error-home>
            {ERROR_PAGE_BUTTON}
          </a>
        </section>
      </main>
      <SiteFooterView c={c} termsLink={termsLink} />
    </div>
  );
}
