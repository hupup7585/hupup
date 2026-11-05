import LegalPage from "@/components/site/LegalPage";
import { BUSINESS_NAME_NB } from "@/lib/site-copy";

export const metadata = { title: "Terms and Conditions | Hup Up Attractions" };
export const revalidate = 3600;

export default function Terms() {
  return (
    <LegalPage title="Terms and Conditions" updated="November 2026">
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
