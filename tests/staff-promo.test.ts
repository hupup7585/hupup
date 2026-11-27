import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/app/admin/(app)/orders/staff-promo-actions", () => ({ staffPromoSignupAction: async () => ({}), staffPromoNoAction: async () => ({}) }));

import * as sp from "@/lib/staff-promo";
import PromoSignupPanel from "@/app/admin/(app)/orders/[id]/PromoSignupPanel";

/* Staff promo sign-up (Abraham, Promo Wording C, Nov 10, 2026) */
describe("staff promo sign-up wording and rules", () => {
  it("uses Abraham's three lines word for word", () => {
    expect(sp.STAFF_PROMO_STEP1).toBe("Would you like to get seasonal offers, discounts, and deals from Hup Up Attractions by text, up to 5 a year? It's never required to book.");
    expect(sp.staffPromoStep2("+18455550100")).toBe("Should we text (845) 555-0100, or a different number?");
    expect(sp.STAFF_PROMO_STEP3).toBe("Great, we just sent you a text. Reply YES within 24 hours to finish signing up. Message and data rates may apply.");
  });
  it("preview: the Owner and the Secretary see it; never Delivery", () => {
    expect(sp.STAFF_PROMO_MODE).toBe("owner_preview");
    expect(sp.staffPromoVisible("owner")).toBe(true);
    expect(sp.staffPromoVisible("secretary")).toBe(true); // Abraham, Nov 13: the Secretary handles promos
    expect(sp.staffPromoVisible("delivery")).toBe(false);
    expect(sp.staffPromoVisible("delivery", "live")).toBe(false);
    expect(sp.staffPromoVisible("secretary", "live")).toBe(true);
  });
  it("Send confirmation is disabled until staff marks that the customer said yes", () => {
    const html = renderToStaticMarkup(createElement(PromoSignupPanel, { orderId: 1, phoneDisplay: "(845) 555-0100", step2: sp.staffPromoStep2("+18455550100"), preview: true }));
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Send confirmation<\/button>/);
    expect(html.replace(/&#x27;/g, "'")).toContain(sp.STAFF_PROMO_STEP1);
    expect(html).toContain("Preview: the Owner and the Secretary see this");
    expect(html).not.toContain(sp.STAFF_PROMO_STEP3.slice(0, 20)); // Step 3 only after the text went out
  });
  it("the action checks the yes, sends the approved text word for word, and logs staff name, number, date, time and year", () => {
    const a = readFileSync("src/app/admin/(app)/orders/staff-promo-actions.ts", "utf8");
    expect(a).toContain("if (!form.saidYes)");
    expect(a).toContain("body: promoConfirmRequestSms()");
    expect(a).toContain("requestPromoConfirmation(");
    expect(a).toMatch(/staff: \$\{staff\.name\}/);
    expect(a).toContain("number used:");
    expect(a).toContain("logStamp()");
    expect(a).toContain("schema.auditLog");
    expect(a).toContain('replace(/\\D/g, "")'); // "845-555-0142" is accepted
    expect(a).toContain("TEXTING_NOT_ACTIVE"); // never says "sent" when texting is off
  });
  it("the old long read-aloud is no longer offered for promo texts", () => {
    expect(readFileSync("src/app/admin/(app)/orders/[id]/page.tsx", "utf8")).toContain('scopes={["transactional"]}');
    expect(readFileSync("src/app/admin/(app)/orders/consent-actions.ts", "utf8")).toContain("Use the Promo texts sign-up box for promo texts.");
  });
});
