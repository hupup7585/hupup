import LegalPage from "@/components/site/LegalPage";
import { BUSINESS_NAME_NB } from "@/lib/site-copy";
import { OPT_OUT_KEYWORDS, PROMO_OPENING, PROVIDER_DISCLOSURE, RECORD_RETENTION_MONTHS } from "@/lib/sms-consent-copy";
import { smsNumberDisplay } from "@/lib/sms-number";

export const metadata = { title: "SMS Terms | Hup Up Attractions" };
export const revalidate = 3600;

/** SMS program terms (A2P 10DLC), including Abram's "Additional Requirements" of 2026-11-05. Draft for Abram to review. */
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
        <li>Promotional texts are sent only between 8:00 a.m. and 9:00 p.m. in your local time zone. Our system blocks promotional texts outside these hours.</li>
      </ul>

      <h2>Message frequency and cost</h2>
      <p>Message frequency varies. Message and data rates may apply. Carriers are not liable for delayed or undelivered messages.</p>

      <h2>How to stop texts</h2>
      <p>
        Reply with any of these words to {sms} at any time: {OPT_OUT_KEYWORDS.join(", ")}. We also honor other clear requests to stop, such as &ldquo;please stop texting me&rdquo;. We process
        opt-outs right away. You may get one final, non-promotional text confirming the opt-out, and no promotional texts after that. To stop promotional texts only and keep order updates, reply NOPROMO.
        To start again, reply START.
      </p>

      <h2>Help</h2>
      <p>
        Reply HELP to {sms}, call (845) 777-7585, or email hupupattractions@gmail.com.
      </p>

      <h2>Service providers</h2>
      <p>{PROVIDER_DISCLOSURE}</p>

      <h2>Records</h2>
      <p>
        We keep records of your text consent, changes to your consent, opt-out requests, and the texts we send for at least {RECORD_RETENTION_MONTHS} months, or longer where the law requires. These records
        include your phone number, the type of consent, the date and time, how you gave consent, and the exact consent wording you saw or heard.
      </p>

      <h2>Privacy</h2>
      <p>
        See our <a className="underline" href="/privacy">Privacy Policy</a>. Text messaging originator opt-in data and consent will not be shared with any third parties, except service providers as described
        above.
      </p>
    </LegalPage>
  );
}
