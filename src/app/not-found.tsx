import type { Metadata } from "next";
import { getSiteContent } from "@/lib/site-content";
import SiteHeader from "@/components/site/SiteHeader";
import SiteFooter from "@/components/site/SiteFooter";

export const metadata: Metadata = { title: "Page not found | Hup Up Attractions", robots: { index: false, follow: true } };

/**
 * Page not found (Nov 24, 2026): no longer a dead end. The site's own logo, menu and footer around it (the logo and
 * menu lead home); the wording is Next's standard line, unchanged.
 */
export default async function NotFound() {
  const c = await getSiteContent();
  return (
    <div className="font-display text-hu-deep" data-not-found>
      <SiteHeader logoUrl={c.logoUrl} phoneDisplay={c.phoneDisplay} phoneE164={c.phoneE164} />
      <main className="mx-auto grid min-h-[45vh] max-w-3xl place-items-center px-4 py-16 text-center sm:px-6">
        <div>
          <h1 className="text-6xl font-extrabold">404</h1>
          <p className="mt-3 text-xl">This page could not be found.</p>
          <a href="/" className="mt-8 inline-flex h-12 items-center rounded-full bg-hu-yellow px-8 text-lg font-bold text-hu-deep hover:brightness-95" data-home-link>
            Hup Up Attractions
          </a>
        </div>
      </main>
      <SiteFooter c={c} />
    </div>
  );
}
