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
  "Hup Up Attractions sends text messages from (845) 415-7585 through two separate programs: order and service texts, and promotional texts. You choose each program on its own. No box is ever checked for you, and consent to promotional texts is not a condition of purchase.",
  "Order and Service Texts",
  "Texts about your reservations, orders, payments, deliveries, pickups, and questions, including verification codes. You may agree on our website, on our phone line, or with our team. These may include picture messages (MMS), such as a photo confirming your delivery. Message frequency varies.",
  "Promotional Texts",
  "Seasonal offers, discount codes, and rental deals, limited to 6 per customer per calendar year. Each promotional text begins with \"Hup Up Attractions:\" and ends with \"Reply NOPROMO to stop promos, STOP to stop all texts.\" Promotional texts are sent only between 8:00 AM and 9:00 PM your local time. If your time zone is unknown, we send only when both your area code's time zone and Eastern Time are within those hours.",
  "How to Join Promotional Texts",
  "You may request our confirmation text by checking the promotional box on our website, pressing a key on our phone line, asking our team, or texting JOIN to (845) 415-7585. You are enrolled only when you reply YES to that confirmation text within 24 hours. Your YES reply is your express written consent. Texting JOIN alone does not enroll you.",
  "Automated and Staff Messages",
  "Some texts are sent automatically by our booking system. Authorized Hup Up Attractions staff may also send texts using approved templates and reply to your questions.",
  "Cost",
  "Message and data rates may apply. Carriers are not liable for delayed or undelivered messages.",
  "How to Stop",
  "Reply STOP, UNSUBSCRIBE, CANCEL, END, QUIT, OPT OUT, or REVOKE to stop all texts, both order and promotional. Any scheduled messages are cancelled immediately, and you will receive one final text confirming your opt-out. We also honor any other clear request to stop.",
  "Reply NOPROMO (or NO PROMO) to stop promotional texts only. Order and service texts continue.",
  "To resume order and service texts after STOP, reply START, then reply YES to our confirmation text within 24 hours. START never resumes promotional texts. To receive them again, request a new confirmation and reply YES within 24 hours.",
  "Help and Wrong Number",
  "Reply HELP to (845) 415-7585, call (845) 777-7585, or email hupupattractions@gmail.com. If you received a text in error, reply STOP or WRONG NUMBER, and we will remove the number from our messaging system.",
  "Message Examples",
  "\"Your order is confirmed.\" \"Your delivery is on the way.\" \"Here is your delivery confirmation photo.\" \"Your pickup is scheduled.\" \"A seasonal offer is available.\"",
  "Records",
  "We keep permanent records of your text consent, every change to it, opt-outs, and the texts we send. These include your phone number, the type of consent, the date and time, how consent was given, and the exact wording you saw or heard. Original records are never edited or deleted. Any correction is added as a separate, dated entry that references the original record.",
  "Privacy and Security",
  "Your mobile number and text consent are never sold, rented, or shared with third parties or affiliates for their marketing or promotional purposes. Service providers, such as Twilio, process this information only to deliver and operate our messaging services. Access is limited to authorized staff, and we use reasonable administrative, technical, and organizational safeguards to protect it. See our Privacy Policy: https://hupup.vercel.app/privacy."
];

describe("SMS Terms v3 page", () => {
  it("is Abraham's text word for word, in order, and nothing else", async () => {
    process.env.SMS_TERMS_V2 = "1";
    process.env.PUBLIC_BASE_URL = "https://hupup.vercel.app";
    expect(await render()).toEqual(V3);
  });
});

describe("Abraham's approved website wording (Nov 10, 2026)", () => {
  it("/text-alerts JOIN line and Stay Informed lines, exactly", async () => {
    const { readFileSync } = await import("node:fs");
    expect(readFileSync("src/app/text-alerts/SignUpForm.tsx", "utf8")).toContain("You can also text JOIN to {smsNumber} to request a confirmation text. You are signed up only when you reply YES to that text within 24 hours.");
    const si = readFileSync("src/components/site/StayInformed.tsx", "utf8");
    expect(si).toContain("Almost done! Check your phone and reply YES to our text to confirm.");
    expect(si).toContain("Or text JOIN to {smsNumber}.");
    expect(readFileSync("src/components/ConsentText.tsx", "utf8")).toContain('href="/privacy"');
  });

  it("Stay Informed title matches the other homepage sections (small line, size, page width)", async () => {
    const { readFileSync } = await import("node:fs");
    const si = readFileSync("src/components/site/StayInformed.tsx", "utf8");
    expect(si).toContain('<SectionTitle kicker="Never miss a deal" title="Stay Informed" />');
    expect(si).toContain('className="mx-auto max-w-6xl px-4 sm:px-6"');
    expect(si).not.toMatch(/<h2/);
  });
});
