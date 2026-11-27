import { seoMetadata } from "@/lib/site-seo";
import { getSiteContent } from "@/lib/site-content";
import SiteHeader from "@/components/site/SiteHeader";
import SiteFooter from "@/components/site/SiteFooter";
import { smsSignupNotActive, smsTermsV2Active, webConsentCopy } from "@/lib/sms-terms-v2";
import { smsNumberDisplay } from "@/lib/sms-number";
import SignUpForm from "./SignUpForm";
import { signUpsDisabledReason } from "./actions";

/** Title and description from Admin (website Phase W3, search listing), starting as today's; the rest as before. */
export async function generateMetadata() {
  return seoMetadata("textAlerts", {
    alternates: { canonical: "/text-alerts" },
  });
}
export const dynamic = "force-dynamic";

/** SMS enrollment only: nothing to order or pay for here (the site stays information only). */
export default async function TextAlerts() {
  const c = await getSiteContent();
  const copy = webConsentCopy();
  return (
    <div className="font-display text-hu-deep">
      <SiteHeader logoUrl={c.logoUrl} phoneDisplay={c.phoneDisplay} phoneE164={c.phoneE164} />
      <main className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
        <h1 className="text-4xl font-extrabold">Get text updates</h1>
        <p className="mt-3 text-lg leading-relaxed">Choose the texts you&rsquo;d like from Hup&nbsp;Up&nbsp;Attractions. You can opt out at any time.</p>
        <div className="mt-8">
          <SignUpForm
            transactionalText={copy.transactional}
            marketingText={copy.marketing}
            smsNumber={smsNumberDisplay()}
            disabledReason={await signUpsDisabledReason()}
            v3={smsTermsV2Active()}
            notActive={smsSignupNotActive()}
          />
        </div>
      </main>
      <SiteFooter c={c} />
    </div>
  );
}
