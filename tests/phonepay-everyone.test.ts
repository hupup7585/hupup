import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { phonePayOffered } from "@/lib/sola-phonepay";

/* Sola PhonePay for every caller (Abraham, Nov 18, 2026: "It's passed the test"). */
describe("card payment by phone for everyone", () => {
  it("on, and not limited to the test numbers", () => {
    const env = { SOLA_PHONEPAY_PIN: "1234" };
    expect(phonePayOffered("+18455550199", { solaPhonePayOn: true, solaPhonePayOwnerOnly: false }, env)).toBe(true);
    const mig = readFileSync("drizzle/0078_phonepay_everyone.sql", "utf8");
    expect(mig).toContain("('solaPhonePayOwnerOnly', 'false'::jsonb)");
    expect(mig).toContain("('solaPhonePayOn', 'true'::jsonb)");
  });
});
