import LegalPage from "@/components/site/LegalPage";
import { config } from "@/lib/config";

/** SMS Terms v3, Abraham's final text (Nov 10, 2026), word for word; only the Privacy Policy link is filled in. */
export default function SmsTermsV3() {
  const privacy = `${config.baseUrl()}/privacy`;
  return (
    <LegalPage title="SMS Terms" updated="November 2026">
      <div data-sms-terms="v3">
        <p>{`Hup Up Attractions sends text messages from (845) 415-7585 through two separate programs: order and service texts, and promotional texts. You choose each program on its own. No box is ever checked for you, and consent to promotional texts is not a condition of purchase.`}</p>

        <h2>Order and Service Texts</h2>
        <p>{`Texts about your reservations, orders, payments, deliveries, pickups, and questions, including verification codes. You may agree on our website, on our phone line, or with our team. These may include picture messages (MMS), such as a photo confirming your delivery. Message frequency varies.`}</p>

        <h2>Promotional Texts</h2>
        <p>{`Seasonal offers, discount codes, and rental deals, limited to 5 per customer per calendar year. Each promotional text begins with "Hup Up Attractions:" and ends with "Reply NOPROMO to stop promos, STOP to stop all texts." Promotional texts are sent only between 8:00 AM and 9:00 PM your local time. If your time zone is unknown, we send only when both your area code's time zone and Eastern Time are within those hours.`}</p>

        <h2>How to Join Promotional Texts</h2>
        <p>{`You may request our confirmation text by checking the promotional box on our website, pressing a key on our phone line, asking our team, or texting JOIN to (845) 415-7585. You are enrolled only when you reply YES to that confirmation text within 24 hours. Your YES reply is your express written consent. Texting JOIN alone does not enroll you.`}</p>

        <h2>Automated and Staff Messages</h2>
        <p>{`Some texts are sent automatically by our booking system. Authorized Hup Up Attractions staff may also send texts using approved templates and reply to your questions.`}</p>

        <h2>Cost</h2>
        <p>{`Message and data rates may apply. Carriers are not liable for delayed or undelivered messages.`}</p>

        <h2>How to Stop</h2>
        <p>{`Reply STOP, UNSUBSCRIBE, CANCEL, END, QUIT, OPT OUT, or REVOKE to stop all texts, both order and promotional. Any scheduled messages are cancelled immediately, and you will receive one final text confirming your opt-out. We also honor any other clear request to stop.`}</p>
        <p>{`Reply NOPROMO (or NO PROMO) to stop promotional texts only. Order and service texts continue.`}</p>
        <p>{`To resume order and service texts after STOP, reply START, then reply YES to our confirmation text within 24 hours. START never resumes promotional texts. To receive them again, request a new confirmation and reply YES within 24 hours.`}</p>

        <h2>Help and Wrong Number</h2>
        <p>{`Reply HELP to (845) 415-7585, call (845) 777-7585, or email hupupattractions@gmail.com. If you received a text in error, reply STOP or WRONG NUMBER, and we will remove the number from our messaging system.`}</p>

        <h2>Message Examples</h2>
        <p>{`"Your order is confirmed." "Your delivery is on the way." "Here is your delivery confirmation photo." "Your pickup is scheduled." "A seasonal offer is available."`}</p>

        <h2>Records</h2>
        <p>{`We keep permanent records of your text consent, every change to it, opt-outs, and the texts we send. These include your phone number, the type of consent, the date and time, how consent was given, and the exact wording you saw or heard. Original records are never edited or deleted. Any correction is added as a separate, dated entry that references the original record.`}</p>

        <h2>Privacy and Security</h2>
        <p>
          {`Your mobile number and text consent are never sold, rented, or shared with third parties or affiliates for their marketing or promotional purposes. Service providers, such as Twilio, process this information only to deliver and operate our messaging services. Access is limited to authorized staff, and we use reasonable administrative, technical, and organizational safeguards to protect it. See our Privacy Policy:`}{" "}
          <a className="underline" href="/privacy">
            {privacy}
          </a>
          .
        </p>
      </div>
    </LegalPage>
  );
}
