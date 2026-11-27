import { describe, expect, it, vi } from "vitest";

/* Abraham, Nov 27, 2026 (item 6): 845-415-7585 in the sign-up boxes, a very light grey placeholder only, never a value. */
vi.mock("@/app/text-alerts/actions", () => ({ signUpForTexts: async () => ({}) }));

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import SignUpForm from "@/app/text-alerts/SignUpForm";
import StayInformed from "@/components/site/StayInformed";
import { SAMPLE_PHONE_CLASS, SAMPLE_PHONE_PLACEHOLDER } from "@/lib/sms-grey-line";

describe("sample number in the sign-up boxes", () => {
  it("homepage and /text-alerts: placeholder 845-415-7585 in very light grey, never a prefilled value", () => {
    expect(SAMPLE_PHONE_PLACEHOLDER).toBe("845-415-7585");
    expect(SAMPLE_PHONE_CLASS).toContain("placeholder:text-[#C9D1DB]");
    const pages = [
      renderToStaticMarkup(createElement(StayInformed, { marketingText: "x", smsNumber: "(845) 415-7585", notActive: null, disabledReason: null })),
      renderToStaticMarkup(createElement(SignUpForm as never, { transactionalText: "a", marketingText: "b", smsNumber: "(845) 415-7585", disabledReason: null, v3: true })),
    ];
    for (const html of pages) {
      const input = html.match(/<input[^>]*name="phone"[^>]*>/)![0];
      expect(input).toContain('placeholder="845-415-7585"');
      expect(input).toContain("placeholder:text-[#C9D1DB]");
      expect(input).not.toMatch(/\svalue=/);
    }
  });
});
