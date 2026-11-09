import LegalPage from "@/components/site/LegalPage";
import { config } from "@/lib/config";

/** SMS Terms v3 (Abraham, Nov 9, 2026): his text word for word; only the Privacy Policy link is filled in. */
export default function SmsTermsV3() {
  const privacy = `${config.baseUrl()}/privacy`;
  return (
    <LegalPage title="SMS Terms" updated="November 2026">
      <div data-sms-terms="v3">
        <p>
          These terms cover text messages from Hup Up Attractions, sent from (845) 415-7585. We offer two separate text programs, and you choose each one on its own. No box is ever checked for
          you, and agreeing to promotional texts is never required to book or buy.
        </p>

        <h2>Order and Service Texts</h2>
        <p>
          Texts about your reservations, orders, payments, deliveries, pickups, and questions, including verification codes. You can agree on our website, on our phone line, or with our team.
          These may include picture messages (MMS), such as a photo confirming your delivery. Message frequency varies.
        </p>

        <h2>Promotional Texts</h2>
        <p>
          Seasonal offers, discount codes, and rental deals, up to 5 per customer per calendar year. Our system will never send more. Each promotional text begins with &ldquo;Hup Up
          Attractions:&rdquo; and ends with &ldquo;Reply NOPROMO to stop promos, STOP to stop all texts.&rdquo; Promotional texts are sent only between 8:00 AM and 9:00 PM your local time. If we do
          not know your time zone, we send only when both your area code&rsquo;s time zone and Eastern Time are within those hours.
        </p>

        <h2>How to Join Promotional Texts</h2>
        <p>
          Request our confirmation text by checking the promotional box on our website, pressing a key on our phone line, asking our team, or texting JOIN to (845) 415-7585. You are signed up
          only when you reply YES to that confirmation text within 24 hours. Your YES reply is your express written consent. Sending JOIN alone does not subscribe you.
        </p>

        <h2>Automated and Staff Messages</h2>
        <p>Some texts are sent automatically by our booking system. Authorized Hup Up Attractions staff may also send texts using approved templates and reply to your questions.</p>

        <h2>Cost</h2>
        <p>Message and data rates may apply. Carriers are not liable for delayed or undelivered messages.</p>

        <h2>How to Stop</h2>
        <p>
          Reply STOP, UNSUBSCRIBE, CANCEL, END, QUIT, OPT OUT, or REVOKE to stop all texts, order and promotional. Scheduled messages are cancelled immediately, and you will receive one final
          text confirming your opt-out. We also honor any other clear request to stop.
        </p>
        <p>Reply NOPROMO (or NO PROMO) to stop promotional texts only. Order and service texts continue.</p>
        <p>
          To restart order and service texts after STOP, reply START, then YES to our confirmation text within 24 hours. START never restarts promotional texts. To receive them again, request a
          new confirmation and reply YES within 24 hours.
        </p>

        <h2>Help and Wrong Number</h2>
        <p>
          Reply HELP to (845) 415-7585, call (845) 777-7585, or email hupupattractions@gmail.com. If you received a text not meant for you, reply STOP or WRONG NUMBER and we will remove the
          number from our messaging system.
        </p>

        <h2>Message Examples</h2>
        <p>
          &ldquo;Your order is confirmed.&rdquo; &ldquo;Your delivery is on the way.&rdquo; &ldquo;Here is your delivery confirmation photo.&rdquo; &ldquo;Your pickup is scheduled.&rdquo;
          &ldquo;A seasonal offer is available.&rdquo;
        </p>

        <h2>Records</h2>
        <p>
          We keep permanent records of your text consent, every change to it, opt-outs, and the texts we send. These include your phone number, the type of consent, the date and time, how you gave
          it, and the exact wording you saw or heard. Original records are never edited or deleted. Any correction is added as a separate, dated entry referencing the original record.
        </p>

        <h2>Privacy and Security</h2>
        <p>
          Your phone number and text consent are never sold, rented, or shared with anyone for their own marketing. Service providers, such as Twilio, process this information only to deliver and
          operate our messaging services. Access is limited to authorized staff, and we use reasonable administrative, technical, and organizational safeguards to protect it. See our Privacy
          Policy:{" "}
          <a className="underline" href="/privacy">
            {privacy}
          </a>
          .
        </p>
      </div>
    </LegalPage>
  );
}
