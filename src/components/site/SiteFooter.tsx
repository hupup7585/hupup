import type { SiteContent } from "@/lib/site-content";
import { BUSINESS_NAME_NB } from "@/lib/site-copy";
import { NAV } from "./SiteHeader";
import { Mail, Phone } from "lucide-react";
import { ICON_STROKE, Wordmark } from "./parts";

export default function SiteFooter({ c }: { c: SiteContent }) {
  const year = new Date().getFullYear();
  return (
    <footer className="bg-hu-deep text-white">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1.2fr]">
        <div>
          <Wordmark logoUrl={c.logoUrl} light />
          <p className="mt-4 max-w-xs leading-relaxed text-white/85">
            Jumping balloons, laser tag, inflatable mazes, and paddle boats for parties, schools, celebrations, and special occasions. Reservations by phone.
          </p>
        </div>
        <div>
          <h3 className="mb-3 font-display text-lg font-bold">Explore</h3>
          <ul className="space-y-2 text-white/85">
            {NAV.map(([label, href]) => (
              <li key={href}>
                <a href={href} className="hover:text-hu-yellow">
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="mb-3 font-display text-lg font-bold">Rentals</h3>
          <ul className="space-y-2 text-white/85">
            {c.categories.map((cat) => (
              <li key={cat.id}>
                <a href={`/#${cat.slug}`} className="hover:text-hu-yellow">
                  {cat.name}
                </a>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="mb-3 font-display text-lg font-bold">Contact</h3>
          <a href={`tel:${c.phoneE164}`} className="flex items-center gap-2 text-xl font-bold text-hu-yellow">
            <Phone className="h-5 w-5" strokeWidth={ICON_STROKE} aria-hidden /> {c.phoneDisplay}
          </a>
          <a href={`mailto:${c.email}`} className="mt-2 flex items-center gap-2 break-all text-white/85 hover:text-hu-yellow">
            <Mail className="h-5 w-5 shrink-0" strokeWidth={ICON_STROKE} aria-hidden />
            {c.email}
          </a>
          {/* Contact info only (Abraham): service area and hours live in their own sections */}
        </div>
      </div>
      <div className="border-t border-white/15">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-5 text-sm text-white/75 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <span>© {year} {BUSINESS_NAME_NB}</span>
          <span className="flex flex-wrap gap-x-5 gap-y-2">
            <a href="/privacy" className="hover:text-hu-yellow">Privacy Policy</a>
            <a href="/terms" className="hover:text-hu-yellow">Terms and Conditions</a>
            <a href="/sms-terms" className="hover:text-hu-yellow">SMS Terms</a>
            <a href="/text-alerts" className="hover:text-hu-yellow">Text Updates</a>
          </span>
        </div>
      </div>
    </footer>
  );
}
