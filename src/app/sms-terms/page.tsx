import LegalPage from "@/components/site/LegalPage";
import { BUSINESS_NAME_NB } from "@/lib/site-copy";
import { OPT_OUT_KEYWORDS, PROMO_OPENING, PROVIDER_DISCLOSURE, RECORD_RETENTION_MONTHS } from "@/lib/sms-consent-copy";
import { smsNumberDisplay } from "@/lib/sms-number";
import { publicEmail } from "@/lib/config";

export const metadata = {
  title: "SMS Terms | Hup Up Attractions",
  description: "How Hup Up Attractions text messages work: order and service texts, promotional texts, message frequency, and how to reply STOP or HELP.",
  alternates: { canonical: "/sms-terms" },
};
export const revalidate = 3600;

/** SMS program terms (A2P 10DLC): SMS messages only. Business and rental terms are on /terms. */
export default function SmsTerms() {
  const sms = smsNumberDisplay();
  return (
    <LegalPage title="SMS Terms" updated="November 2026">
      <p>
        These terms cover text messages from {BUSINESS_NAME_NB}, sent from {sms}. We run two separate text programs, and you choose each one separately. Neither box is checked for you, and
        consent to promotional texts is never a condition of purchase.
      </p>

      <h2>Order and service texts (transactional)</h2>
      <p>Texts about your reservations, orders, payments, deliveries, pickups, and customer service. You can agree on our website, on our phone line, or with our team.</p>

      <h2>Promotional texts</h2>
      <p>Offers and news from {BUSINESS_NAME_NB}, sent only if you agree to receive them. Agreeing is not required to book or buy anything.</p>
      <ul>
        <li>
          Every promotional text begins with <strong>&ldquo;{PROMO_OPENING}&rdquo;</strong>, followed by the offer.
        </li>
        <li>
          Promotional texts are sent only between 8:00 a.m. and 9:00 p.m. in your local time zone. We use the customer&rsquo;s confirmed local time zone whenever available. If it is unavailable,
          promotional messages will be sent only when the permitted hours are satisfied in both the telephone number&rsquo;s area-code time zone and Eastern Time. Our system blocks promotional texts
          outside these hours.
        </li>
      </ul>

      <h2>Message frequency and cost</h2>
      <p>Message frequency varies. Message and data rates may apply. Carriers are not liable for delayed or undelivered messages.</p>

      <h2>How to stop texts</h2>
      <p>
        Reply with any of these words to {sms} at any time: {OPT_OUT_KEYWORDS.join(", ")}. Replying STOP (or any of the words above) stops both order and service texts and promotional texts.
        You will not receive either until you re-enroll in the relevant program. We also honor other clear requests to stop, such as &ldquo;please stop texting me&rdquo;. Opt-outs take
        effect immediately, including for promotional texts that were already scheduled. You may get one final, non-promotional text confirming the opt-out, and no promotional texts after that.
      </p>
      <p>
        To re-enroll after opting out, reply START and follow the confirmation instructions: we will ask you to reply YES to confirm that you want order and service texts again. Replying START
        alone does not re-enroll you in any program, and it never re-enrolls you in promotional texts. To receive promotional texts again, you must give new promotional consent through our website,
        our phone line, or our team. Re-enrollment applies only to the messaging program for which you provide new consent. Your previous opt-out remains documented in our records.
      </p>
      <p>
        NOPROMO is our own keyword that stops promotional texts only, while order texts continue. NOPROMO does not restart promotional messages after a STOP and never undoes a STOP. To receive
        promotional texts again after opting out, a separate new promotional opt-in is required.
      </p>

      <h2>Help</h2>
      <p>
        Reply HELP to {sms}, call (845) 777-7585, or email {publicEmail()}. A HELP response identifies Hup Up Attractions and provides our customer support telephone number and email address.
      </p>

      <h2>Service providers</h2>
      <p>{PROVIDER_DISCLOSURE}</p>

      <h2>Records</h2>
      <p>
        We keep records of your text consent, changes to your consent, opt-out requests, and the texts we send for at least {RECORD_RETENTION_MONTHS} months, or longer where the law requires. These records
        include your phone number, the type of consent, the date and time, how you gave consent, and the exact consent wording you saw or heard. Original consent records are never edited or
        deleted. A correction is a separate dated entry with the reason, who made it, the date and time, a reference to the original record, and the corrected information.
      </p>

      <h2>Security</h2>
      <p>
        Access to your phone number, consent records, and messages is limited to authorized staff who need it to serve you. We use reasonable administrative, technical, and organizational safeguards designed to protect customer information against unauthorized access, use, alteration, or disclosure. Suspected
        unauthorized access to or disclosure of this information is reported to us immediately and handled as required by law.
      </p>

      <h2>Privacy</h2>
      <p>
        See our Privacy Policy at{" "}
        <a className="underline" href="/privacy-policy">
          https://hupupattractions.com/privacy-policy
        </a>
        . Text messaging originator opt-in data and consent will not be shared with any third parties, except service providers as described
        above.
      </p>
    </LegalPage>
  );
}
