import { getSiteContent } from "@/lib/site-content";
import SiteHeader from "@/components/site/SiteHeader";
import MockBanner from "../MockBanner";

export const dynamic = "force-dynamic";
export const metadata = { title: "Header mock-up | Hup Up Attractions" };

/** Proposed header: Hours added, links evenly spaced, phone grouped with CALL TO BOOK behind a divider. */
export default async function HeaderMockup() {
  const c = await getSiteContent();
  return (
    <div className="min-h-screen bg-hu-tint font-display text-hu-deep">
      <MockBanner title="Header" note="Proposed: phone number grouped with CALL TO BOOK, separated from Contact Us by a thin divider; Hours link added." />
      <section className="py-8 [&_header]:static">
        <h2 className="mx-auto mb-3 max-w-6xl px-4 text-lg font-extrabold sm:px-6">Proposed</h2>
        <SiteHeader logoUrl={c.logoUrl} phoneDisplay={c.phoneDisplay} phoneE164={c.phoneE164} variant="mockup" />
      </section>
      <section className="py-8 [&_header]:static">
        <h2 className="mx-auto mb-3 max-w-6xl px-4 text-lg font-extrabold sm:px-6">Current (for comparison)</h2>
        <SiteHeader logoUrl={c.logoUrl} phoneDisplay={c.phoneDisplay} phoneE164={c.phoneE164} />
      </section>
      <p className="mx-auto max-w-6xl px-4 pb-10 text-base sm:px-6">On a phone, open the menu button to see Hours in the menu.</p>
    </div>
  );
}
