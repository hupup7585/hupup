/* eslint-disable @next/next/no-img-element */
import { Menu, Phone } from "lucide-react";
import { getSiteContent } from "@/lib/site-content";
import { NAV } from "@/components/site/SiteHeader";
import { CallButton, ICON_STROKE, LOGO_SRC } from "@/components/site/parts";
import MockBanner from "../MockBanner";

export const dynamic = "force-dynamic";
export const metadata = { title: "Logo mock-up | Hup Up Attractions" };

/** Abraham's rule for this mock-up: the logo always sits on light blue #8CCBFF, never on white or navy. */
const LOGO_TILE = "inline-flex items-center justify-center rounded-2xl bg-[#8CCBFF]";

function LogoOnBlue({ size = "h-14 sm:h-16", pad = "px-3 py-1.5" }: { size?: string; pad?: string }) {
  return (
    <span className={`${LOGO_TILE} ${pad}`} data-logo-tile>
      <img src={LOGO_SRC} alt="Hup Up Attractions" className={`${size} w-auto`} />
    </span>
  );
}

function Label({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <p className="mx-auto mb-3 max-w-6xl px-4 text-base font-extrabold sm:px-6">
      {n}. {children}
    </p>
  );
}

/** Where the logo would go, each on light blue. Nothing here changes the real pages. */
export default async function LogoMockup() {
  const c = await getSiteContent();
  return (
    <div className="bg-hu-tint pb-16 font-display text-hu-deep">
      <MockBanner title="Logo on light blue #8CCBFF" note="Header, footer, browser tab (favicon), a section break and the final call to book. Not on the real pages yet." />

      <section className="pt-8">
        <Label n={1}>Header (desktop): logo on a light-blue tile, everything else unchanged</Label>
        <header className="border-y-2 border-hu-deep/10 bg-white">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 py-3 sm:px-6">
            <LogoOnBlue />
            <nav className="hidden flex-1 items-center justify-evenly text-[15px] font-semibold lg:-mx-4 lg:flex">
              {NAV.map(([label]) => (
                <span key={label} className="whitespace-nowrap">{label}</span>
              ))}
            </nav>
            <div className="flex items-center gap-2 lg:border-l-2 lg:border-hu-deep/15 lg:pl-6 xl:gap-4">
              <span className="hidden font-bold xl:inline">{c.phoneDisplay}</span>
              <CallButton phone={c.phoneE164} className="hidden !min-h-11 !px-5 !py-2 sm:inline-flex" />
              <span className="grid h-11 w-11 place-items-center rounded-full border-2 border-hu-deep lg:hidden" aria-hidden>
                <Menu className="h-6 w-6" strokeWidth={ICON_STROKE} />
              </span>
            </div>
          </div>
        </header>
      </section>

      <section className="pt-10">
        <Label n={2}>Footer: logo on a light-blue panel (never directly on navy)</Label>
        <div className="bg-hu-deep text-white">
          <div className="mx-auto grid max-w-6xl gap-6 px-4 py-10 sm:px-6 md:grid-cols-[auto_1fr] md:items-center">
            <LogoOnBlue size="h-20" pad="px-4 py-2" />
            <p className="max-w-xl text-white/85">Jumping balloons, laser tag, inflatable mazes, and paddle boats for parties, schools, celebrations, and special occasions. Reservations by phone.</p>
          </div>
        </div>
      </section>

      <section className="pt-10">
        <Label n={3}>Browser tab icon (favicon): logo on a light-blue square</Label>
        <div className="mx-auto flex max-w-6xl flex-wrap items-end gap-6 px-4 sm:px-6">
          {/* Browser tab preview */}
          <div className="w-full max-w-sm rounded-t-xl border-2 border-b-0 border-hu-deep/20 bg-white">
            <div className="flex items-center gap-2 rounded-t-xl bg-[#e9edf2] px-3 py-2">
              <span className="flex items-center gap-2 rounded-lg bg-white px-3 py-1.5 text-sm shadow-sm">
                <span className="grid h-4 w-4 place-items-center overflow-hidden rounded-[4px] bg-[#8CCBFF]"><img src={LOGO_SRC} alt="" className="h-[15px] w-auto" /></span>
                Hup Up Attractions
              </span>
            </div>
          </div>
          {[16, 32, 48, 64, 180].map((px) => (
            <figure key={px} className="text-center text-xs font-semibold">
              <span className="grid place-items-center overflow-hidden bg-[#8CCBFF]" style={{ width: px, height: px, borderRadius: Math.max(3, px / 5) }} data-favicon-size={px}>
                <img src={LOGO_SRC} alt={`Hup Up Attractions icon ${px} pixels`} style={{ height: px * 0.9, width: "auto" }} />
              </span>
              <figcaption className="mt-1">{px}px{px === 180 ? " (phone home screen)" : ""}</figcaption>
            </figure>
          ))}
        </div>
        <p className="mx-auto mt-3 max-w-6xl px-4 text-sm text-hu-deep/75 sm:px-6">At the smallest tab size (16px) the full logo is very small; the 32px and larger sizes show it clearly.</p>
      </section>

      <section className="pt-10">
        <Label n={4}>Section break between sections: a small logo badge on light blue, spaced well apart</Label>
        <div className="bg-white py-10">
          <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 sm:px-6">
            <span className="h-1 flex-1 rounded bg-[#8CCBFF]" aria-hidden />
            <LogoOnBlue size="h-12" pad="px-3 py-1" />
            <span className="h-1 flex-1 rounded bg-[#8CCBFF]" aria-hidden />
          </div>
        </div>
      </section>

      <section className="pt-10">
        <Label n={5}>Final call to book: logo on a light-blue tile above the heading</Label>
        <div className="bg-hu-yellow">
          <div className="mx-auto max-w-4xl px-4 py-12 text-center sm:px-6">
            <LogoOnBlue size="h-20" pad="px-4 py-2" />
            <h2 className="mt-5 text-3xl font-extrabold leading-tight sm:text-5xl">READY TO MAKE YOUR EVENT SPECIAL?</h2>
            <a href={`tel:${c.phoneE164}`} className="mt-6 inline-flex min-h-14 items-center gap-3 rounded-full bg-hu-deep px-9 py-4 text-lg font-bold tracking-wide text-white">
              <Phone className="h-5 w-5" strokeWidth={ICON_STROKE} aria-hidden /> CALL NOW TO BOOK
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
