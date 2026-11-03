import LegalPage from "@/components/site/LegalPage";

export const metadata = { title: "Privacy Policy | Hup Up Attractions" };
export const revalidate = 3600;

export default function Privacy() {
  return (
    <LegalPage title="Privacy Policy" updated="November 2026">
      <p>Hup Up Attractions respects your privacy. This policy explains what information we collect when you call, text, or book with us, and how we use it.</p>
      <h2>Information we collect</h2>
      <ul>
        <li>Your name, phone number, email address, and delivery address when you make a reservation.</li>
        <li>Details of your booking, such as rental items, dates, and payment status.</li>
        <li>Calls and text messages you exchange with our hotline, including voicemail recordings.</li>
      </ul>
      <h2>How we use it</h2>
      <ul>
        <li>To take and manage your reservation, arrange delivery and pickup, and contact you about your booking.</li>
        <li>To send booking confirmations, payment links, and delivery updates by text message.</li>
        <li>To send occasional promotional texts, only if you agreed to receive them.</li>
      </ul>
      <h2>Payments</h2>
      <p>Payments are processed securely by our payment provider. We do not store your full card number.</p>
      <h2>Text messages</h2>
      <p>Message and data rates may apply. Reply STOP to stop receiving texts, or HELP for help. We do not sell or share your phone number with third parties for their marketing.</p>
      <h2>Sharing</h2>
      <p>We share information only with service providers that help us run our business, such as our phone, text messaging, and payment providers, and only as needed to provide our services.</p>
      <h2>Contact</h2>
      <p>Questions about this policy? Call us at (845) 415-7585 or email hupupattractions@gmail.com.</p>
    </LegalPage>
  );
}
