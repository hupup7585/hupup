import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PROMOS_PER_YEAR } from "@/lib/sms-consent-copy";

/* Abraham, Nov 26, 2026 (Hark's Admin check, item 4): promo texts 5 a year everywhere (was 6), the website included. */
describe("website promo count matches the SMS Terms (5 a year)", () => {
  it("sign-up page and Stay Informed read the same number as the SMS Terms", () => {
    expect(PROMOS_PER_YEAR).toBe(5);
    for (const f of ["src/app/text-alerts/SignUpForm.tsx", "src/components/site/StayInformed.tsx"]) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/Up to 6|\b6 promo/);
      expect(src, f).toMatch(/Up to \$?\{PROMOS_PER_YEAR\} promo texts a year, never more\./);
    }
    expect(readFileSync("src/app/sms-terms/SmsTermsV3.tsx", "utf8")).toContain("limited to 5 per customer per calendar year");
  });
});
