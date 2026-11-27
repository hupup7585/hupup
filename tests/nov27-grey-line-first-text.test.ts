import { describe, expect, it, vi } from "vitest";

/*
 * Abraham, Nov 27, 2026 (item 5): every grey line on the website = only "Message and data rates may apply." (homepage
 * sign-up box, /text-alerts, pay page text boxes, under "Text me the catalog"). STOP and HELP go in the FIRST text each
 * number gets from us: the first catalog text to a new number ends with " Reply STOP to stop, or HELP for help.", the
 * second does not.
 */
const h = vi.hoisted(() => ({ sent: [] as { to: string; body: string }[] }));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/twilio-client", () => ({
  getTwilio: () => ({ messages: { create: async (p: { to: string; body: string }) => (h.sent.push({ to: p.to, body: p.body }), { sid: `SM${h.sent.length}`, status: "queued" }) } }),
}));
vi.mock("@/app/pay/[orderId]/actions", () => ({ agreeAndPayAction: async () => ({}) }));
vi.mock("@/app/text-alerts/actions", () => ({ signUpForTexts: async () => ({}) }));
vi.mock("@/app/catalog-actions", () => ({ requestCatalogAction: async () => null, textCatalogAction: async () => null }));

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { db, schema } from "@/lib/db";
import { FIRST_TEXT_STOP_HELP, sendMessage } from "@/lib/sms";
import { SMS_GREY_LINE } from "@/lib/sms-grey-line";
import PayForm from "@/app/pay/[orderId]/PayForm";
import SignUpForm from "@/app/text-alerts/SignUpForm";
import StayInformed from "@/components/site/StayInformed";
import CatalogRequest from "@/components/site/CatalogRequest";

const greyLines = (html: string) => [...html.matchAll(/<p[^>]*data-sms-grey-line[^>]*>([^<]*)<\/p>/g)].map((m) => m[1]);

describe("grey line = only 'Message and data rates may apply.'", () => {
  it("all four places show only the short line", () => {
    expect(SMS_GREY_LINE).toBe("Message and data rates may apply.");
    const pages = {
      homepage: renderToStaticMarkup(createElement(StayInformed, { marketingText: "Promo texts. See our SMS Terms and Privacy Policy.", smsNumber: "(845) 415-7585", notActive: null, disabledReason: null })),
      textAlerts: renderToStaticMarkup(createElement(SignUpForm as never, { transactionalText: "Order texts.", marketingText: "Promo texts.", smsNumber: "(845) 415-7585", notActive: null, disabledReason: null, v3: true })),
      pay: renderToStaticMarkup(createElement(PayForm as never, { orderId: 7, token: "t", consent: { transactionalText: "Order texts.", marketingText: "Promo texts.", smsNumber: "(845) 415-7585" } })),
      catalog: renderToStaticMarkup(createElement(CatalogRequest)),
    };
    for (const [where, html] of Object.entries(pages)) {
      expect(greyLines(html), where).toEqual(["Message and data rates may apply."]);
      expect(html, where).not.toContain("Text STOP to opt out");
      expect(html, where).not.toContain("One text with our catalog");
    }
  });
});

describe("STOP and HELP in the first text each number gets", () => {
  process.env.TWILIO_PHONE_NUMBER = "+18454157585";
  const catalog = (to: string) => sendMessage({ to, body: "Hup Up Attractions: Here is our catalog! You can call us anytime to book with our automated system at (845) 777-7585 Ext. 1.", kind: "system", event: "catalog_request" });

  it("first catalog text to a new number ends with the STOP/HELP sentence; the second does not", async () => {
    await catalog("+18455550701");
    await catalog("+18455550701");
    const bodies = h.sent.filter((m) => m.to === "+18455550701").map((m) => m.body);
    expect(FIRST_TEXT_STOP_HELP).toBe(" Reply STOP to stop, or HELP for help.");
    expect(bodies[0].endsWith(" Reply STOP to stop, or HELP for help.")).toBe(true);
    expect(bodies[1]).not.toContain("Reply STOP to stop, or HELP for help.");
  });

  it("an order or payment link text that is a number's first text ends the same way (first text only)", async () => {
    const P = "+18455550702";
    const [c] = await db.insert(schema.customers).values({ phone: P, name: "T" }).returning();
    await db.insert(schema.smsConsents).values({ customerId: c.id, phone: P, scope: "transactional", action: "opt_in", source: "web", method: "checkbox", wording: "x" });
    await sendMessage({ to: P, body: "Hup Up Attractions order #1007: pay here https://hupupattractions.com/pay/1007", kind: "transactional", event: "order_payment_link" });
    await sendMessage({ to: P, body: "Hup Up Attractions: payment received for order #1007.", kind: "transactional", event: "order_paid" });
    const bodies = h.sent.filter((m) => m.to === P).map((m) => m.body);
    expect(bodies[0].endsWith(" Reply STOP to stop, or HELP for help.")).toBe(true);
    expect(bodies[1]).not.toContain("Reply STOP to stop, or HELP for help.");
  });

  it("a number that already got a text from us: no extra sentence; the sign-up confirmation (already has STOP and HELP) is unchanged", async () => {
    const P = "+18455550703";
    await db.insert(schema.messages).values({ direction: "out", toNumber: P, contactPhone: P, body: "earlier", kind: "system", event: "catalog_request", status: "delivered" });
    await catalog(P);
    expect(h.sent.filter((m) => m.to === P).at(-1)!.body).not.toContain("Reply STOP to stop, or HELP for help.");
    const { SEASONAL_JOIN_CONFIRM_TEXT, sendSeasonalJoinConfirm } = await import("@/lib/seasonal-confirm");
    await sendSeasonalJoinConfirm("+18455550704");
    expect(h.sent.filter((m) => m.to === "+18455550704").map((m) => m.body)).toEqual([SEASONAL_JOIN_CONFIRM_TEXT]);
  });
});
