import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/components/site/LegalPage", () => ({ default: ({ children }: { children: unknown }) => children }));

/* SMS Terms v2 changed lines (Abraham, Nov 9, 2026): preview only until approved; the live page is unchanged. */
const render = async () => {
  const { default: SmsTerms } = await import("@/app/sms-terms/page");
  return renderToStaticMarkup(SmsTerms()).replace(/\s+/g, " ").replace(/&#x27;|&rsquo;/g, "'").replace(/&ldquo;|&rdquo;|&quot;|“|”/g, '"').replace(/’/g, "'");
};
afterEach(() => {
  delete process.env.SMS_TERMS_V2;
});

describe("SMS Terms v2 lines", () => {
  it("v2: 6 promos a year, JOIN or YES within 24 hours, NO PROMO, the new promo ending, gmail, /privacy", async () => {
    process.env.SMS_TERMS_V2 = "1";
    process.env.PUBLIC_BASE_URL = "https://hupup.vercel.app";
    const h = await render();
    expect(h).toContain("Promotional texts: up to 6 promotional texts per year.");
    expect(h).toContain("given by replying JOIN or YES to our confirmation text within 24 hours");
    expect(h).toContain("or by texting JOIN to (845) 415-7585");
    expect(h).toContain("NO PROMO (or NOPROMO) is our own keyword that stops promotional texts only");
    expect(h).toContain('ends with <strong>"Reply NO PROMO to stop promos, STOP to end all texts."</strong>');
    expect(h).toContain("hupupattractions@gmail.com");
    expect(h).not.toContain("info@hupupattractions.com");
    expect(h).toContain('href="/privacy">https://hupup.vercel.app/privacy</a>');
  });
  it("live page is unchanged", async () => {
    const h = await render();
    expect(h).toContain("Message frequency varies. Message and data rates may apply.");
    expect(h).toContain('Every promotional text begins with <strong>"Hup Up Attractions: Reply STOP to opt out."</strong>');
    expect(h).not.toContain("JOIN");
  });
});
