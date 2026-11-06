import { Truck } from "lucide-react";
import type { SiteContent } from "@/lib/site-content";
import { DELIVERY_FEE_SHORT, SERVICE_AREA_DELIVERY_NOTE, noLonelyWord } from "@/lib/site-copy";
import { CallButton, ICON_STROKE, SectionTitle } from "./parts";

/** Card styles Abraham reviewed on /mockups/service-area. Both cards share one style (no heavy border). */
export const SERVICE_AREA_STYLES = {
  A: { name: "Option A: soft white cards", card: "rounded-[2rem] border-2 border-hu-deep/10 bg-white shadow-[0_14px_36px_rgba(18,61,115,0.14)]", tile: "bg-hu-tint" },
  B: { name: "Option B: outlined cards with a yellow top accent", card: "rounded-[2rem] border-2 border-hu-deep/15 border-t-[6px] border-t-hu-yellow bg-white", tile: "border-2 border-hu-deep/15 bg-white" },
} as const;
export type ServiceAreaStyle = keyof typeof SERVICE_AREA_STYLES;

/** The live site uses this style. Change to "B" to switch. */
export const LIVE_SERVICE_AREA_STYLE: ServiceAreaStyle = "A";

const EYEBROW = "text-base font-extrabold uppercase leading-snug tracking-[0.14em] text-hu-deep/75";

/**
 * Service Area: Kiryas Joel card and the nearby-towns card, equal height, side by side from 1024px (the towns card
 * is wider so 3 tiles per row fit), stacked on phones. The blue background and spacing are unchanged (Abraham).
 */
export default function ServiceArea({ c, style = LIVE_SERVICE_AREA_STYLE, badge }: { c: SiteContent; style?: ServiceAreaStyle; badge?: string }) {
  const v = SERVICE_AREA_STYLES[style];
  return (
    <section id={badge ? undefined : "service-area"} data-sa-option={style} className="scroll-mt-20 bg-hu-sky py-14 sm:py-16">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        {badge && <p className="mb-6 inline-block rounded-full bg-hu-deep px-4 py-1.5 text-sm font-bold text-white">{badge}</p>}
        <SectionTitle kicker="Right to your door" title="Service Area" />
        <div data-sa-layout className="mt-8 grid gap-6 lg:grid-cols-[5fr_7fr] lg:items-stretch">
          <div className={`flex flex-col justify-center p-5 sm:p-8 ${v.card}`}>
            <p className={EYEBROW}>{c.serviceArea.mainLabel}</p>
            <p className="mt-3 text-4xl font-extrabold leading-tight sm:text-5xl">{c.serviceArea.main}</p>
            <p className="mt-2 text-lg font-medium text-hu-deep/80">{c.serviceArea.mainSub}</p>
            <p data-sa-delivery-note className="mt-5 flex items-start gap-2 text-base leading-7">
              <Truck className="mt-[5px] h-[18px] w-[18px] shrink-0" strokeWidth={ICON_STROKE} aria-hidden />
              <span>{noLonelyWord(SERVICE_AREA_DELIVERY_NOTE)}</span>
            </p>
            <CallButton phone={c.phoneE164} className="mt-7 self-start" />
          </div>
          <div className={`flex flex-col justify-center p-5 sm:p-8 ${v.card}`}>
            <h3 className={EYEBROW}>{c.serviceArea.alsoTitle}</h3>
            {/* Even grid: 2 per row on phones, 3 per row from 768px, every tile the same size */}
            <ul data-town-grid className="mt-5 grid auto-rows-fr grid-cols-2 gap-3 md:grid-cols-3">
              {c.serviceArea.also.map((town) => (
                <li key={town} className={`flex h-full min-h-[4.5rem] items-center justify-center rounded-2xl px-1.5 py-4 text-center text-[15px] font-bold leading-snug min-[400px]:text-base sm:px-3 sm:text-[17px] ${v.tile}`}>
                  {town.includes(" and ") ? (
                    <span>
                      {town.split(" and ")[0]} and
                      <span className="block">{town.split(" and ")[1]}</span>
                    </span>
                  ) : (
                    town
                  )}
                </li>
              ))}
            </ul>
            <p className="mt-5 text-base font-medium leading-7">{noLonelyWord(`All in ${c.serviceArea.region}. ${DELIVERY_FEE_SHORT}`)}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
