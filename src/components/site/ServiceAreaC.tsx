import { Home, MapPin, Truck } from "lucide-react";
import type { SiteContent } from "@/lib/site-content";
import { DELIVERY_FEE_SHORT, SERVICE_AREA_DELIVERY_NOTE, noLonelyWord } from "@/lib/site-copy";
import { CallButton, ICON_STROKE, IconTile, SectionTitle } from "./parts";

/**
 * Hero-board look (Abraham): one solid navy border, the same thickness on every side (even edge contrast, 19b49c6),
 * plus the same solid navy offset shadow as the hero "Call to book" card.
 */
const CARD = "relative flex flex-col rounded-[2rem] border-4 border-hu-deep bg-white p-6 shadow-[8px_8px_0_#123D73] sm:p-8";
const EYEBROW = "text-sm font-extrabold uppercase tracking-[0.18em] opacity-75";

/**
 * Service Area on the home page (Option C, approved by Abraham; also shown on /mockups/service-area): both cards styled like the hero call-to-book board (even border),
 * light-blue icon tiles beside each line, thin dividers (no badge on this card, Abraham). Same wording as the live section.
 */
export default function ServiceAreaC({ c, badge }: { c: SiteContent; badge?: string }) {
  return (
    <section id={badge ? undefined : "service-area"} data-sa-option="C" className="scroll-mt-20 bg-hu-sky py-14 sm:py-16">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        {badge && <p className="mb-6 inline-block rounded-full bg-hu-deep px-4 py-1.5 text-sm font-bold text-white">{badge}</p>}
        <SectionTitle kicker="Right to your door" title="Service Area" />
        <div data-sa-layout className="mt-8 grid gap-8 lg:grid-cols-[5fr_7fr] lg:items-stretch">
          <div className={CARD}>
            <p className={EYEBROW}>{c.serviceArea.mainLabel}</p>
            <ul className="mt-4 divide-y-2 divide-hu-deep/10 border-t-2 border-hu-deep/10">
              <li className="flex items-center gap-4 py-4">
                <IconTile icon={MapPin} tone="sky" />
                <span>
                  <span className="block text-3xl font-extrabold leading-tight sm:text-4xl">{c.serviceArea.main}</span>
                  <span className="block text-base font-medium text-hu-deep/80">{c.serviceArea.mainSub}</span>
                </span>
              </li>
              <li className="flex items-center gap-4 py-4">
                <IconTile icon={Truck} tone="sky" />
                <span className="text-lg font-bold">{noLonelyWord(SERVICE_AREA_DELIVERY_NOTE)}</span>
              </li>
            </ul>
            <CallButton phone={c.phoneE164} className="mt-6 self-start lg:mt-auto" />
          </div>

          <div className={CARD}>
            <p className={EYEBROW}>{c.serviceArea.alsoTitle}</p>
            {/* 2 per row on phones, 3 per row from 768px; every tile the same size */}
            <ul data-town-grid className="mt-4 grid auto-rows-fr grid-cols-2 gap-3 border-t-2 border-hu-deep/10 pt-4 md:grid-cols-3">
              {c.serviceArea.also.map((town) => (
                <li key={town} className="flex h-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-hu-deep/15 bg-white px-1.5 py-3.5 text-center sm:px-3">
                  <IconTile icon={Home} tone="sky" size="sm" />
                  <span className="text-[15px] font-bold leading-snug min-[400px]:text-base">
                    {town.includes(" and ") ? (
                      <>
                        {town.split(" and ")[0]} and
                        <span className="block">{town.split(" and ")[1]}</span>
                      </>
                    ) : (
                      town
                    )}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-5 border-t-2 border-hu-deep/10 pt-4 text-base lg:mt-auto font-medium leading-7">{noLonelyWord(`All in ${c.serviceArea.region}. ${DELIVERY_FEE_SHORT}`)}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
