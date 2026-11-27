"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { HEADER_LOGO } from "@/components/site/parts";
import { ERROR_PAGE_DRAFT, brandedErrorPageShown } from "@/lib/error-page-copy";

/**
 * A public page that broke while loading: the site's logo, a short line with the phone number, Try again, and a way
 * home, instead of a blank technical screen. Preview only until Abraham approves the words (W1); the live site and
 * Admin pages pass the error on to Next's standard screen, exactly as before.
 */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const path = usePathname() ?? "";
  useEffect(() => {
    console.error("[website error]", error.digest ?? "", error.message);
  }, [error]);
  if (!brandedErrorPageShown() || path.startsWith("/admin")) throw error; // unchanged behavior
  return (
    <main className="grid min-h-screen place-items-center bg-hu-tint px-4 py-10 font-display text-hu-deep" data-error-page>
      <div className="w-full max-w-md rounded-2xl border-2 border-hu-deep bg-white p-6 text-center">
        <a href="/" aria-label="Hup Up Attractions home" className="inline-block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={HEADER_LOGO.src} srcSet={HEADER_LOGO.srcSet} width={91} height={96} alt="Hup Up Attractions" className="mx-auto h-20 w-auto" />
        </a>
        <h1 className="mt-4 text-2xl font-extrabold">{ERROR_PAGE_DRAFT.title}</h1>
        <p className="mt-2 text-lg">
          {ERROR_PAGE_DRAFT.body.replace("(845) 777-7585.", "")}
          <a href="tel:+18457777585" className="font-bold underline underline-offset-4">(845) 777-7585</a>.
        </p>
        <div className="mt-6 flex flex-col gap-3">
          <button type="button" onClick={() => reset()} className="btn-dark w-full py-3" data-error-retry>
            {ERROR_PAGE_DRAFT.retry}
          </button>
          <a href="/" className="inline-flex h-12 items-center justify-center rounded-full bg-hu-yellow px-8 text-lg font-bold text-hu-deep hover:brightness-95" data-home-link>
            Hup Up Attractions
          </a>
        </div>
      </div>
    </main>
  );
}
