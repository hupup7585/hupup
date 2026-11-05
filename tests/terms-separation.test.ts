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
      "To re-enroll after opting out, reply START and follow the confirmation instructions. Re-enrollment applies only to the messaging program for which you provide new consent. Your previous opt-out remains documented in our records.",
      "We use the customer's confirmed local time zone whenever available. If it is unavailable, promotional messages will be sent only when the permitted hours are satisfied in both the telephone number's area-code time zone and Eastern Time.",
      "A HELP response identifies Hup Up Attractions and provides our customer support telephone number and email address.",
      "We use reasonable administrative, technical, and organizational safeguards designed to protect customer information against unauthorized access, use, alteration, or disclosure.",
      'See our Privacy Policy at{" "} <a className="underline" href="/privacy-policy"> https://hupupattractions.com/privacy-policy </a>',
    ])
      expect(page).toContain(s);
  });
  it("replaced wording is gone (nothing stated twice)", () => {
    for (const old of ["To start again, reply START", "We use the time zone you give us", "New York (Eastern) time", "stored securely", "See our <a"]) expect(page).not.toContain(old);
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
