import { Truck } from "lucide-react";
import { getSiteContent } from "@/lib/site-content";
import { DELIVERY_FEE_SHORT, SERVICE_AREA_DELIVERY_NOTE, noLonelyWord } from "@/lib/site-copy";
import SiteHeader from "@/components/site/SiteHeader";
import { CallButton, ICON_STROKE, SectionTitle } from "@/components/site/parts";
import MockBanner from "../MockBanner";

export const dynamic = "force-dynamic";
export const metadata = { title: "Service Area mock-up | Hup Up Attractions" };

type Variant = {
  key: "A" | "B";
  name: string;
  /** Shared by both cards: one card style, no heavy border. */
  card: string;
  tile: string;
};

const VARIANTS: Variant[] = [
  {
    key: "A",
    name: "Option A: soft white cards",
    card: "rounded-[2rem] border-2 border-hu-deep/10 bg-white shadow-[0_14px_36px_rgba(18,61,115,0.14)]",
    tile: "bg-hu-tint",
  },
  {
    key: "B",
    name: "Option B: outlined cards with a yellow top accent",
    card: "rounded-[2rem] border-2 border-hu-deep/15 border-t-[6px] border-t-hu-yellow bg-white",
    tile: "border-2 border-hu-deep/15 bg-white",
  },
];

const EYEBROW = "text-base font-extrabold uppercase leading-snug tracking-[0.14em] text-hu-deep/75";

/** One proposed Service Area section. Same blue background and spacing as the live section. */
function ServiceAreaOption({ v, c }: { v: Variant; c: Awaited<ReturnType<typeof getSiteContent>> }) {
  return (
    <section data-sa-option={v.key} className="bg-hu-sky py-14 sm:py-16">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <p className="mb-6 inline-block rounded-full bg-hu-deep px-4 py-1.5 text-sm font-bold text-white">{v.name}</p>
        <SectionTitle kicker="Right to your door" title="Service Area" />
        {/* Equal-height cards; the towns card is wider so 3 tiles per row fit without names breaking awkwardly */}
        <div data-sa-layout className="mt-8 grid gap-6 lg:grid-cols-[5fr_7fr] lg:items-stretch">
          <div className={`flex flex-col justify-center p-5 sm:p-8 ${v.card}`}>
            <p className={EYEBROW}>Main service area:</p>
            <p className="mt-3 text-4xl font-extrabold leading-tight sm:text-5xl">{c.serviceArea.main}</p>
            <p className="mt-2 text-lg font-medium text-hu-deep/80">{c.serviceArea.mainSub}</p>
            <p className="mt-5 flex items-start gap-2 text-base leading-7">
              <Truck className="mt-[5px] h-[18px] w-[18px] shrink-0" strokeWidth={ICON_STROKE} aria-hidden />
              <span>{noLonelyWord(SERVICE_AREA_DELIVERY_NOTE)}</span>
            </p>
            <CallButton phone={c.phoneE164} className="mt-7 self-start" />
          </div>
          <div className={`flex flex-col justify-center p-5 sm:p-8 ${v.card}`}>
            <h3 className={EYEBROW}>{c.serviceArea.alsoTitle}</h3>
            <ul data-town-grid className="mt-5 grid auto-rows-fr grid-cols-2 gap-3 md:grid-cols-3">
              {c.serviceArea.also.map((town) => (
                <li key={town} className={`flex h-full min-h-[4.5rem] items-center justify-center rounded-2xl px-1.5 py-4 text-center text-[15px] font-bold min-[400px]:text-base sm:px-3 leading-snug sm:text-[17px] ${v.tile}`}>
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

export default async function ServiceAreaMockup() {
  const c = await getSiteContent();
  return (
    <div className="font-display text-hu-deep">
      <MockBanner title="Service Area, Options A and B" note="Equal-height cards in one style, larger town names, 3 tiles per row on desktop and 2 on phone." />
      <div className="[&_header]:static">
        <SiteHeader logoUrl={c.logoUrl} phoneDisplay={c.phoneDisplay} phoneE164={c.phoneE164} />
      </div>
      {/* White strip between the options so the two blue sections don't run together */}
      <div className="flex flex-col gap-4 bg-white">
        {VARIANTS.map((v) => (
          <ServiceAreaOption key={v.key} v={v} c={c} />
        ))}
      </div>
    </div>
  );
}
