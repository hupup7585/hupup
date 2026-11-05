import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/* Abram: /sms-terms covers SMS messages only; all business and rental terms go on /terms. */
describe("SMS Terms and business Terms stay separate", () => {
  const sms = readFileSync("src/app/sms-terms/page.tsx", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "") // code comments aren't page text
    .replace("Carriers are not liable for delayed or undelivered messages.", "");
  it("/sms-terms has no business or rental terms", () => {
    expect(sms).not.toMatch(/cancell?ation|refund|deposit|weather|life jacket|negligen|waiver|release|\bpermits?\b|insurance|inspection|setup|damage|electronic signature|rental terms|sales tax|delivery fee/i);
  });
  it("rental terms acceptance (business terms) is not tied to the SMS Terms page", () => {
    expect(readFileSync("src/lib/rental-terms.ts", "utf8")).not.toContain("/sms-terms");
  });
});

describe("Abram's five final /sms-terms corrections", () => {
  const page = readFileSync("src/app/sms-terms/page.tsx", "utf8").replace(/\s+/g, " ").replace(/&rsquo;/g, "'");
  it("each sentence is present word for word", () => {
    for (const s of [
      "To re-enroll after opting out, reply START and follow the confirmation instructions: we will ask you to reply YES to confirm that you want order and service texts again. Replying START alone does not re-enroll you in any program, and it never re-enrolls you in promotional texts. To receive promotional texts again, you must give new promotional consent through our website, our phone line, or our team. Re-enrollment applies only to the messaging program for which you provide new consent. Your previous opt-out remains documented in our records.",
      "NOPROMO is our own keyword that stops promotional texts only, while order texts continue. NOPROMO does not restart promotional messages after a STOP and never undoes a STOP. To receive promotional texts again after opting out, a separate new promotional opt-in is required.",
      "Replying STOP (or any of the words above) stops both order and service texts and promotional texts. You will not receive either until you re-enroll in the relevant program.",
      "Original consent records are never edited or deleted. A correction is a separate dated entry with the reason, who made it, the date and time, a reference to the original record, and the corrected information.",
      "We use the customer's confirmed local time zone whenever available. If it is unavailable, promotional messages will be sent only when the permitted hours are satisfied in both the telephone number's area-code time zone and Eastern Time.",
      "A HELP response identifies Hup Up Attractions and provides our customer support telephone number and email address.",
      "We use reasonable administrative, technical, and organizational safeguards designed to protect customer information against unauthorized access, use, alteration, or disclosure.",
      'See our Privacy Policy at{" "} <a className="underline" href="/privacy-policy"> https://hupupattractions.com/privacy-policy </a>',
    ])
      expect(page).toContain(s);
  });
  it("replaced wording is gone (nothing stated twice)", () => {
    for (const old of ["To start again, reply START", "We use the time zone you give us", "New York (Eastern) time", "stored securely", "See our <a", "until you reply START", "separate, dated correction entry"]) expect(page).not.toContain(old);
  });
  it("/privacy-policy redirects to /privacy", () => {
    expect(readFileSync("next.config.ts", "utf8")).toContain('{ source: "/privacy-policy", destination: "/privacy", permanent: true }');
  });
});

describe("HELP auto-reply matches the SMS Terms", async () => {
  const { helpReply, HELP_REPLY } = await import("@/lib/sms-inbound");
  it("identifies Hup Up Attractions and gives the support phone and email", () => {
    for (const s of ["Hup Up Attractions", "(845) 777-7585", "hupupattractions@gmail.com"]) expect(HELP_REPLY).toContain(s);
  });
  it("a custom text missing any of them falls back to the compliant reply", () => {
    expect(helpReply("Hup Up Attractions: for help call or text us at this number. Reply STOP to opt out.")).toBe(HELP_REPLY);
    expect(helpReply("")).toBe(HELP_REPLY);
    const ok = "Hup Up Attractions help: (845) 777-7585, hupupattractions@gmail.com. Reply STOP to opt out.";
    expect(helpReply(ok)).toBe(ok);
  });
  it("HELP is always answered (not behind an off-by-default switch)", () => {
    const src = readFileSync("src/lib/sms-inbound.ts", "utf8");
    expect(src).toContain('} else if (keyword === "help") {');
    expect(src).not.toContain("settings.smsHelpReplyEnabled");
  });
});
