import LegalPage from "@/components/site/LegalPage";
import { BUSINESS_NAME_NB } from "@/lib/site-copy";

export const metadata = {
  title: "Terms and Conditions | Hup Up Attractions",
  description: "The rental terms for bounce houses, laser tag, inflatable mazes and paddle boats from Hup Up Attractions: booking, delivery, safety and payment.",
};
export const revalidate = 3600;

export default function Terms() {
  return (
    <LegalPage title="TERMS AND CONDITIONS" updated="November 2026">
      {/* Approved wording (Abraham, sections A-E), verbatim. The full business terms (sections 1-34) follow once the blanks are filled in. */}
      <p data-terms-entity className="text-xl font-bold">HUP UP ATTRACTIONS INC. (&ldquo;Hup Up Attractions&rdquo;)</p>

      <h2>A. ACCEPTANCE OF TERMS</h2>
      <p>
        By reserving, paying for, accepting delivery of, or using any equipment or services provided by Hup Up Attractions, you acknowledge that you have read, understood, and agree to be bound by all
        terms, conditions, policies, and notices contained herein, as well as any additional terms published on our website (
        <a className="underline" href="/">
          https://hupupattractions.com
        </a>
        ).
      </p>

      <h2>B. NO SIGNATURE REQUIRED</h2>
      <p>
        Completing a reservation or payment, including pressing # on our phone line or paying by our payment link, constitutes full acceptance of these Terms. No physical or electronic signature is required
        to make these Terms and Conditions binding upon you.
      </p>

      <h2>C. GENERAL RULES AND REGULATIONS</h2>
      <p>
        See Sections 9 through 13 (Bounce Houses and Inflatable Attractions, Laser Tag and Inflatable Mazes, Paddle Boats and Water Safety, Supervision of Minors, Participant Conduct and Safety Rules).
      </p>

      <h2>D. LIABILITY AND WAIVERS</h2>
      <p>See Sections 15 through 18 (Injuries and Incidents, Assumption of Ordinary Activity Risks, Limitation of Liability, Customer Responsibility for Claims and Damage).</p>

      <h2>E. MODIFICATIONS TO TERMS</h2>
      <p>
        Hup Up Attractions may update or modify these Terms and Conditions at any time. The most current version, with its effective date, will always be available at{" "}
        <a className="underline" href="/terms">
          https://hupupattractions.com/terms
        </a>
        . Changes apply to reservations made after the update; a reservation already confirmed follows the Terms in effect when it was made.
      </p>

      <hr className="my-8 border-line" />
      <p>These terms apply to rentals booked with {BUSINESS_NAME_NB} by phone or with our team.</p>
      <h2>Reservations</h2>
      <p>Reservations are made over the phone. A reservation is confirmed once payment is received or our team confirms it with you.</p>
      <h2>Delivery and pickup</h2>
      <p>Delivery is available for an additional fee, which our team will quote when you book. We deliver rentals on your event date and pick them up as arranged with you. Please make sure the setup area is accessible and suitable for the rental.</p>
      <h2>Safety</h2>
      <p>Rentals must be used as instructed by our team and under adult supervision at all times.</p>
      <h2>Text messages</h2>
      <p>
        We text you only with your consent, and order texts and promotional texts are separate choices. Promotional texts are sent only if you opt in, and agreeing is not required to book. Message
        frequency varies. Message and data rates may apply. Reply STOP to unsubscribe or HELP for help. See our <a className="underline" href="/sms-terms">SMS Terms</a>.
      </p>
      <h2>Contact</h2>
      <p>Call (845) 777-7585 or email hupupattractions@gmail.com.</p>
    </LegalPage>
  );
}
