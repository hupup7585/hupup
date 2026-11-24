import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { caretAfterDigits, formatPhoneTyping } from "@/lib/phone-format";
import { toE164 } from "@/lib/phone";

/* Abraham, Nov 24, 2026: every phone box adds the dashes while typing, so it looks like a phone number. */
describe("phone dashes while typing", () => {
  it("builds up 845-555-0123 as the digits come in", () => {
    const steps = ["8", "84", "845", "8455", "84555", "845555", "8455550", "84555501", "845555012", "8455550123"];
    expect(steps.map(formatPhoneTyping)).toEqual(["8", "84", "845", "845-5", "845-55", "845-555", "845-555-0", "845-555-01", "845-555-012", "845-555-0123"]);
  });
  it("pasted or typed any other way: the same dashed number", () => {
    for (const v of ["(845) 555-0123", "845 555 0123", "845.555.0123", "+1 845 555 0123", "18455550123", "1-845-555-0123"]) expect(formatPhoneTyping(v), v).toBe("845-555-0123");
  });
  it("leaves alone what is not a US number: a name, another country, too many digits", () => {
    for (const v of ["Klein", "+44 20 7946 0958", "845555012345", "845-555*"]) expect(formatPhoneTyping(v), v).toBe(v);
  });
  it("the dashed number is still read as the same phone everywhere it is saved", () => {
    expect(toE164("845-555-0123")).toBe("+18455550123");
  });
  it("the cursor stays after the same digit", () => {
    expect(caretAfterDigits("845-555-0123", 3)).toBe(3);
    expect(caretAfterDigits("845-555-0123", 4)).toBe(5);
    expect(caretAfterDigits("845-555-0123", 10)).toBe(12);
  });
  it("on every page, and every phone box is marked as a phone box", () => {
    expect(readFileSync("src/app/layout.tsx", "utf8")).toContain("<PhoneAutoFormat />");
    for (const f of ["src/app/admin/(app)/bookkeeping/page.tsx", "src/app/admin/(app)/discounts/page.tsx", "src/app/admin/(app)/phone/phonepay/page.tsx", "src/app/admin/(app)/messages/page.tsx", "src/app/admin/(app)/pos/PosForm.tsx", "src/app/admin/(app)/staff/StaffForms.tsx", "src/app/text-alerts/SignUpForm.tsx", "src/components/site/CatalogRequest.tsx", "src/components/site/StayInformed.tsx"]) {
      expect(readFileSync(f, "utf8"), f).toMatch(/inputMode="tel"/);
    }
  });
});
