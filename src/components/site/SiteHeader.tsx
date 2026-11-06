import { Menu, Phone, X } from "lucide-react";
import { CallButton, ICON_STROKE, Wordmark } from "./parts";

export const NAV = [
  ["Home", "/#top"],
  ["Our Rentals", "/#rentals"],
  ["How It Works", "/#how-it-works"],
  ["Service Area", "/#service-area"],
  ["Hours", "/#hours"],
  ["Contact Us", "/#contact"],
] as const;

/**
 * Links spread evenly between the logo and the contact block. The phone number sits with CALL TO BOOK behind a
 * thin divider so it doesn't read as another nav link (Abraham).
 */
export default function SiteHeader({ logoUrl, phoneDisplay, phoneE164 }: { logoUrl: string | null; phoneDisplay: string; phoneE164: string }) {
  return (
    <header className="sticky top-0 z-40 border-b-2 border-hu-deep/10 bg-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-3 py-3 min-[400px]:px-4 sm:gap-4 sm:px-6">
        <a href="/#top" className="shrink-0" aria-label="Hup Up Attractions home">
          <Wordmark logoUrl={logoUrl} />
        </a>
        <nav aria-label="Main" className="hidden flex-1 items-center justify-evenly text-[15px] font-semibold text-hu-deep lg:-mx-4 lg:flex">
          {NAV.map(([label, href]) => (
            <a key={href} href={href} className="whitespace-nowrap underline-offset-8 hover:underline">
              {label}
            </a>
          ))}
        </nav>
        <div data-header-contact className="flex items-center gap-2 lg:border-l-2 lg:border-hu-deep/15 lg:pl-6 xl:gap-6">
          <a href={`tel:${phoneE164}`} className="hidden font-bold text-hu-deep xl:inline">
            {phoneDisplay}
          </a>
          <CallButton phone={phoneE164} className="hidden !min-h-11 !px-5 !py-2 sm:inline-flex" />
          <a href={`tel:${phoneE164}`} className="hu-btn !min-h-11 !gap-1.5 !px-3 sm:hidden" aria-label={`Call ${phoneDisplay} to book`}>
            <Phone className="h-5 w-5" strokeWidth={ICON_STROKE} aria-hidden />
            <span className="hidden min-[360px]:inline">CALL</span>
          </a>
          {/* Mobile menu: no JavaScript needed */}
          <details className="group relative lg:hidden">
            <summary className="flex h-11 w-11 cursor-pointer list-none items-center justify-center rounded-full border-2 border-hu-deep text-hu-deep [&::-webkit-details-marker]:hidden" aria-label="Menu">
              <Menu className="h-6 w-6 group-open:hidden" strokeWidth={ICON_STROKE} aria-hidden />
              <X className="hidden h-6 w-6 group-open:block" strokeWidth={ICON_STROKE} aria-hidden />
            </summary>
            <nav aria-label="Mobile" className="absolute right-0 top-14 w-64 rounded-2xl border-2 border-hu-deep bg-white p-2 shadow-[6px_6px_0_#123D73]">
              {NAV.map(([label, href]) => (
                <a key={href} href={href} className="block rounded-xl px-4 py-3 text-lg font-semibold text-hu-deep hover:bg-hu-tint">
                  {label}
                </a>
              ))}
              <a href={`tel:${phoneE164}`} className="hu-btn mt-2 w-full">
                <Phone className="h-5 w-5" strokeWidth={ICON_STROKE} aria-hidden /> {phoneDisplay}
              </a>
            </nav>
          </details>
        </div>
      </div>
    </header>
  );
}
