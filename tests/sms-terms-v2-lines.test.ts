import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/components/site/LegalPage", async () => { const { createElement } = await import("react"); return { default: ({ title, children }: { title: string; children: unknown }) => [createElement("h2", { key: "t" }, title), children] }; });

/* SMS Terms v3 (Abraham, Nov 9, 2026, message 3 of 3): the whole page, word for word; only the Privacy link is filled in. */
const render = async () => {
  const { default: SmsTerms } = await import("@/app/sms-terms/page");
  const html = renderToStaticMarkup(SmsTerms() as never);
  return html
    .replace(/<\/(p|h2)>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&#x27;|&rsquo;|’/g, "'")
    .replace(/&ldquo;|&rdquo;|&quot;|“|”/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
};
afterEach(() => {
  delete process.env.SMS_TERMS_V2;
});

const V3 = [
  "SMS Terms",
  "These terms cover text messages from Hup Up Attractions, sent from (845) 415-7585. We offer two separate text programs, and you choose each one on its own. No box is ever checked for you, and agreeing to promotional texts is never required to book or buy.",
  "Order and Service Texts",
  "Texts about your reservations, orders, payments, deliveries, pickups, and questions, including verification codes. You can agree on our website, on our phone line, or with our team. These may include picture messages (MMS), such as a photo confirming your delivery. Message frequency varies.",
  "Promotional Texts",
  'Seasonal offers, discount codes, and rental deals, up to 5 per customer per calendar year. Our system will never send more. Each promotional text begins with "Hup Up Attractions:" and ends with "Reply NOPROMO to stop promos, STOP to stop all texts." Promotional texts are sent only between 8:00 AM and 9:00 PM your local time. If we do not know your time zone, we send only when both your area code\'s time zone and Eastern Time are within those hours.',
  "How to Join Promotional Texts",
  "Request our confirmation text by checking the promotional box on our website, pressing a key on our phone line, asking our team, or texting JOIN to (845) 415-7585. You are signed up only when you reply YES to that confirmation text within 24 hours. Your YES reply is your express written consent. Sending JOIN alone does not subscribe you.",
  "Automated and Staff Messages",
  "Some texts are sent automatically by our booking system. Authorized Hup Up Attractions staff may also send texts using approved templates and reply to your questions.",
  "Cost",
  "Message and data rates may apply. Carriers are not liable for delayed or undelivered messages.",
  "How to Stop",
  "Reply STOP, UNSUBSCRIBE, CANCEL, END, QUIT, OPT OUT, or REVOKE to stop all texts, order and promotional. Scheduled messages are cancelled immediately, and you will receive one final text confirming your opt-out. We also honor any other clear request to stop.",
  "Reply NOPROMO (or NO PROMO) to stop promotional texts only. Order and service texts continue.",
  "To restart order and service texts after STOP, reply START, then YES to our confirmation text within 24 hours. START never restarts promotional texts. To receive them again, request a new confirmation and reply YES within 24 hours.",
  "Help and Wrong Number",
  "Reply HELP to (845) 415-7585, call (845) 777-7585, or email hupupattractions@gmail.com. If you received a text not meant for you, reply STOP or WRONG NUMBER and we will remove the number from our messaging system.",
  "Message Examples",
  '"Your order is confirmed." "Your delivery is on the way." "Here is your delivery confirmation photo." "Your pickup is scheduled." "A seasonal offer is available."',
  "Records",
  "We keep permanent records of your text consent, every change to it, opt-outs, and the texts we send. These include your phone number, the type of consent, the date and time, how you gave it, and the exact wording you saw or heard. Original records are never edited or deleted. Any correction is added as a separate, dated entry referencing the original record.",
  "Privacy and Security",
  "Your phone number and text consent are never sold, rented, or shared with anyone for their own marketing. Service providers, such as Twilio, process this information only to deliver and operate our messaging services. Access is limited to authorized staff, and we use reasonable administrative, technical, and organizational safeguards to protect it. See our Privacy Policy: https://hupup.vercel.app/privacy.",
];

describe("SMS Terms v3 page", () => {
  it("is Abraham's text word for word, in order, and nothing else", async () => {
    process.env.SMS_TERMS_V2 = "1";
    process.env.PUBLIC_BASE_URL = "https://hupup.vercel.app";
    expect(await render()).toEqual(V3);
  });
});
