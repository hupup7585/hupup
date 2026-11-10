import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { LIVE_PUBLIC_EMAIL, NEW_EMAIL_LIVE, NEW_PUBLIC_EMAIL, publicEmail } from "@/lib/config";
import { HELP_REPLY } from "@/lib/sms-inbound";

describe("public email: info@hupupattractions.com everywhere (Abraham, Nov 10, 2026: it works now)", () => {
  it("previews and the live site both show info@hupupattractions.com, even if an old email was saved in Admin", () => {
    expect(NEW_EMAIL_LIVE).toBe(true);
    expect(NEW_PUBLIC_EMAIL).toBe("info@hupupattractions.com");
    expect(LIVE_PUBLIC_EMAIL).toBe("hupupattractions@gmail.com");
    expect(publicEmail({ VERCEL_ENV: "preview" })).toBe(NEW_PUBLIC_EMAIL);
    expect(publicEmail({})).toBe(NEW_PUBLIC_EMAIL);
    expect(publicEmail({ VERCEL_ENV: "production" }, "hupupattractions@gmail.com")).toBe(NEW_PUBLIC_EMAIL);
  });
  it("footer, contact, legal pages and the business schema all use the one setting", () => {
    expect(readFileSync("src/lib/site-content.ts", "utf8")).toContain("publicEmail(process.env");
    for (const f of ["src/app/privacy/page.tsx", "src/app/terms/page.tsx", "src/app/sms-terms/page.tsx"]) {
      const s = readFileSync(f, "utf8");
      expect(s, f).toMatch(/\{(?:v2 \? email : )?publicEmail\(\)\}/); // SMS Terms v2 (preview) uses the email that works today
      expect(s, f).not.toContain('"hupupattractions@gmail.com"');
    }
    const home = readFileSync("src/app/page.tsx", "utf8");
    expect(home).toContain("email: c.email");
    expect(readFileSync("src/components/site/SiteFooter.tsx", "utf8")).toContain("c.email");
  });
  it("the HELP text message and the SMS Terms give info@hupupattractions.com", () => {
    expect(HELP_REPLY).toContain("info@hupupattractions.com");
    expect(HELP_REPLY).not.toContain("gmail");
    expect(readFileSync("src/app/sms-terms/SmsTermsV3.tsx", "utf8")).toContain("or email info@hupupattractions.com.");
    expect(readFileSync("src/lib/settings.ts", "utf8")).not.toContain("hupupattractions@gmail.com");
  });
});
