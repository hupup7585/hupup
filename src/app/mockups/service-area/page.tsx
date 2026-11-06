import { getSiteContent } from "@/lib/site-content";
import SiteHeader from "@/components/site/SiteHeader";
import ServiceArea, { SERVICE_AREA_STYLES, type ServiceAreaStyle } from "@/components/site/ServiceArea";
import ServiceAreaC from "@/components/site/ServiceAreaC";
import MockBanner from "../MockBanner";

export const dynamic = "force-dynamic";
export const metadata = { title: "Service Area mock-up | Hup Up Attractions" };

/** Options A and B for Abraham to compare (the live site uses LIVE_SERVICE_AREA_STYLE). */
export default async function ServiceAreaMockup() {
  const c = await getSiteContent();
  return (
    <div className="font-display text-hu-deep">
      <MockBanner title="Service Area, Options A, B and C" note="Equal-height cards in one style, larger town names, 3 tiles per row on desktop and 2 on phone." />
      <div className="[&_header]:static">
        <SiteHeader logoUrl={c.logoUrl} phoneDisplay={c.phoneDisplay} phoneE164={c.phoneE164} />
      </div>
      <div className="flex flex-col gap-4 bg-white">
        {(Object.keys(SERVICE_AREA_STYLES) as ServiceAreaStyle[]).map((k) => (
          <ServiceArea key={k} c={c} style={k} badge={SERVICE_AREA_STYLES[k].name} />
        ))}
        <ServiceAreaC c={c} badge="Option C: hero card style (even navy border, solid navy shadow, icon tiles)" />
      </div>
    </div>
  );
}
