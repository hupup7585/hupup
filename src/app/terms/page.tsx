import LegalPage from "@/components/site/LegalPage";

export const metadata = { title: "Terms and Conditions | Hup Up Attractions" };
export const revalidate = 3600;

export default function Terms() {
  return (
    <LegalPage title="Terms and Conditions" updated="November 2026">
      <p>These terms apply to rentals booked with Hup Up Attractions by phone or with our team.</p>
      <h2>Reservations</h2>
      <p>Reservations are made over the phone. A reservation is confirmed once payment is received or our team confirms it with you.</p>
      <h2>Delivery and pickup</h2>
      <p>We deliver rentals on your event date and pick them up as arranged with you. Please make sure the setup area is accessible and suitable for the rental.</p>
      <h2>Safety</h2>
      <p>Rentals must be used as instructed by our team and under adult supervision at all times.</p>
      <h2>Text messages</h2>
      <p>By giving us your mobile number for a booking, you agree to receive texts about that booking. Promotional texts are sent only if you opt in, up to 5 per year. Message and data rates may apply. Reply STOP to unsubscribe or HELP for help.</p>
      <h2>Contact</h2>
      <p>Call (845) 415-7585 or email hupupattractions@gmail.com.</p>
    </LegalPage>
  );
}
