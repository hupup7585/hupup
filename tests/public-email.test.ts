import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { LIVE_PUBLIC_EMAIL, NEW_EMAIL_LIVE, NEW_PUBLIC_EMAIL, publicEmail } from "@/lib/config";
import { HELP_REPLY } from "@/lib/sms-inbound";

describe("public email (preview: info@, live: gmail until Abraham confirms)", () => {
  it("previews show info@hupupattractions.com; the live site keeps gmail", () => {
    expect(NEW_EMAIL_LIVE).toBe(false);
    expect(NEW_PUBLIC_EMAIL).toBe("info@hupupattractions.com");
    expect(publicEmail({ VERCEL_ENV: "preview" })).toBe("info@hupupattractions.com");
    expect(publicEmail({})).toBe("info@hupupattractions.com");
    expect(publicEmail({ VERCEL_ENV: "production" })).toBe(LIVE_PUBLIC_EMAIL);
    expect(LIVE_PUBLIC_EMAIL).toBe("hupupattractions@gmail.com");
    expect(publicEmail({ VERCEL_ENV: "preview" }, "someone@example.com")).toBe("info@hupupattractions.com");
  });
  it("footer, contact, legal pages and the business schema all use the one setting", () => {
    expect(readFileSync("src/lib/site-content.ts", "utf8")).toContain("publicEmail(process.env");
    for (const f of ["src/app/privacy/page.tsx", "src/app/terms/page.tsx", "src/app/sms-terms/page.tsx"]) {
      const s = readFileSync(f, "utf8");
      expect(s, f).toContain("{publicEmail()}");
      expect(s, f).not.toContain("hupupattractions@gmail.com");
    }
    const home = readFileSync("src/app/page.tsx", "utf8");
    expect(home).toContain("email: c.email");
    expect(readFileSync("src/components/site/SiteFooter.tsx", "utf8")).toContain("c.email");
  });
  it("the HELP text message is unchanged (a text, not the website; changing it waits for Abraham)", () => {
    expect(HELP_REPLY).toContain("hupupattractions@gmail.com");
  });
});
