import { describe, expect, it, vi } from "vitest";

/* The pay page's small line under the text-consent boxes (Abraham, approved Nov 26, 2026, 01:29 ET). */
vi.mock("@/app/pay/[orderId]/actions", () => ({ agreeAndPayAction: async () => ({}) }));

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import PayForm from "@/app/pay/[orderId]/PayForm";
import TextConsentBoxes from "@/components/TextConsentBoxes";
import { PAY_SMS_HELP_LINE } from "@/app/pay/[orderId]/label";

const LINE = "Message and data rates may apply. Reply STOP to stop, or HELP for help.";
const page = () => renderToStaticMarkup(createElement(PayForm as never, { orderId: 7, token: "t", consent: { transactionalText: "Order texts.", marketingText: "Promo texts.", smsNumber: "(845) 415-7585" } }));

describe("pay page: the line under the texting consent boxes", () => {
  it("reads exactly the approved words, small and grey", () => {
    expect(PAY_SMS_HELP_LINE).toBe(LINE);
    const html = page();
    expect(html).toContain(`<p class="text-sm text-hu-deep/70" data-consent-help-line="true">${LINE}</p>`);
    expect(html).not.toContain("Text STOP to opt out");
  });
  it("the boxes stay unticked by default; the Terms box too; the SMS Terms and Privacy links are kept", () => {
    const html = page();
    for (const name of ["smsTransactional", "smsMarketing", "agree"]) {
      const box = html.match(new RegExp(`<input type="checkbox"[^>]*name="${name}"[^>]*>`))![0];
      expect(box).not.toContain("checked");
    }
    expect(html).toContain('href="/sms-terms"');
    expect(html).toContain('href="/privacy"');
  });
  it("the staff booking screen keeps its own line unchanged", () => {
    const html = renderToStaticMarkup(createElement(TextConsentBoxes, { transactionalText: "a", marketingText: "b", transactional: false, marketing: false, onChange: () => {}, smsNumber: "(845) 415-7585", staff: true }));
    expect(html).toContain("Text HELP to (845) 415-7585 for help. Text STOP to opt out. See our");
    expect(html).not.toContain(LINE);
  });
});
