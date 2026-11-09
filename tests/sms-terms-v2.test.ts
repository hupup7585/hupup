import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";

/* SMS Terms Version 2 (Abraham Q): preview only. Written promotional consent = website box or a YES reply. Nothing is sent. */
const h = vi.hoisted(() => ({
  sent: [] as { to: string; body: string; event?: string }[],
  session: { callSid: "CAv2", fromNumber: "+18455550177", orderId: null, data: { phone: "+18455550177" } as Record<string, unknown>, status: "in_progress", outcome: "browsing" },
}));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/sms", async (orig) => ({
  ...(await orig<typeof import("@/lib/sms")>()),
  sendMessage: async (m: { to: string; body: string; event?: string }) => (h.sent.push(m), { sent: true }),
  cancelQueuedPromotions: async () => {},
}));
vi.mock("@/lib/ivr/session", () => ({
  ensureSession: async () => h.session,
  getSession: async () => h.session,
  updateSession: async (_s: string, patch: Record<string, unknown> & { data?: Record<string, unknown> }) => Object.assign(h.session, { ...patch, data: { ...h.session.data, ...(patch.data ?? {}) } }),
}));
vi.mock("@/lib/ivr/prompts", async (orig) => ({ ...(await orig<typeof import("@/lib/ivr/prompts")>()), loadPromptOverrides: async () => ({}) }));

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { handleVoice } from "@/lib/ivr/flow";
import { detectKeywordDetail, handleInboundSms } from "@/lib/sms-inbound";
import { assertApprovedEnrollment } from "@/lib/sms-consent";
import { PROMPTS } from "@/lib/ivr/prompts";
import * as v2 from "@/lib/sms-terms-v2";
import SmsTerms from "@/app/sms-terms/page";

const PHONE = "+18455550177";
const call = (action: string, body: Record<string, string> = {}) =>
  handleVoice({ action, query: new URLSearchParams(), body: { CallSid: "CAv2", ...body }, callSid: "CAv2", from: PHONE });
const text = (Body: string, sid: string) => handleInboundSms({ From: PHONE, To: "+18454157585", Body, MessageSid: sid });
const customer = async () => (await db.select().from(schema.customers).where(eq(schema.customers.phone, PHONE)))[0];
const marketingRows = async () => (await db.select().from(schema.smsConsents).where(eq(schema.smsConsents.phone, PHONE))).filter((r) => r.scope === "marketing");

beforeAll(() => {
  process.env.PUBLIC_BASE_URL = "https://hupup.example";
  process.env.SMS_TERMS_V2 = "1";
});
afterAll(() => {
  delete process.env.SMS_TERMS_V2;
});
beforeEach(() => {
  h.sent.length = 0;
});

describe("SMS Terms v2 switch", () => {
  it("SMS v3 is on everywhere (Abraham approved it as final, Nov 9, 2026)", () => {
    expect(v2.SMS_TERMS_V2_LIVE).toBe(true);
    expect(v2.smsTermsV2Active({ VERCEL_ENV: "production" })).toBe(true);
    expect(v2.smsTermsV2Active({ VERCEL_ENV: "preview" })).toBe(true);
    expect(v2.smsTermsV2Active({})).toBe(true);
    expect(v2.webConsentCopy({ VERCEL_ENV: "production" }).version).toBe("web-2026-11-09-v3");
    expect(v2.webConsentCopy({ VERCEL_ENV: "preview" }).marketing).toContain("I am signed up only when I reply YES to that confirmation text within 24 hours.");
  });
});

describe("written promotional consent (phone keypress only sends a confirmation text)", () => {
  it("press 1 sends the confirmation text and enrolls nothing; YES enrolls; a second YES does nothing", async () => {
    const ask = await call("promo-consent");
    expect(ask.replace(/&apos;/g, "'")).toContain(PROMPTS.consent_marketing_v2.text);

    const after = await call("promo-consent-answer", { Digits: "1" });
    expect(after.replace(/&apos;/g, "'")).toContain(PROMPTS.consent_marketing_sent.text);
    expect(h.sent.map((m) => m.body)).toEqual([v2.promoConfirmRequestSms()]);
    expect(await marketingRows()).toHaveLength(0); // a keypress is not consent
    expect((await customer())?.marketingOptIn ?? false).toBe(false);

    await call("promo-consent-answer", { Digits: "1" }); // pressing again doesn't send a second text
    expect(h.sent).toHaveLength(1);

    h.sent.length = 0;
    await text("Yes", "SMv2yes1");
    const rows = await marketingRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: "opt_in", source: "sms_reply", method: "sms_reply", wording: v2.promoConfirmRequestSms(), wordingVersion: v2.PROMO_CONFIRM_VERSION });
    expect(rows[0].response).toContain("pressed 1 on call CAv2");
    expect((await customer()).marketingOptIn).toBe(true);
    expect(h.sent.map((m) => m.body)).toEqual([v2.PROMO_ENROLLED_SMS]);
    expect(v2.PROMO_ENROLLED_SMS).toBe("Hup Up Attractions: You're signed up for seasonal promo texts, up to 5 per year. Msg & data rates may apply. Reply NOPROMO to stop promos, STOP to stop all texts, HELP for help.");

    h.sent.length = 0;
    await text("YES", "SMv2yes2");
    expect(await marketingRows()).toHaveLength(1);
    expect(h.sent.filter((m) => m.to === PHONE)).toHaveLength(0); // (the owner may get a forwarded copy)
  });

  it("STOP cancels a waiting confirmation, so a late YES enrolls nothing", async () => {
    await db.update(schema.customers).set({ marketingOptIn: false }).where(eq(schema.customers.phone, PHONE));
    await call("promo-consent-answer", { Digits: "1" });
    await text("STOP", "SMv2stop");
    await text("YES", "SMv2late");
    expect((await customer()).marketingOptIn).toBe(false);
    expect((await marketingRows()).filter((r) => r.action === "opt_in")).toHaveLength(1); // only the earlier one
  });

  it("a text reply can enroll only as YES to the promotional confirmation", () => {
    expect(() => assertApprovedEnrollment({ action: "opt_in", scope: "marketing", source: "sms_reply", method: "sms_reply" })).toThrow();
    expect(() => assertApprovedEnrollment({ action: "opt_in", scope: "transactional", source: "sms_reply", method: "sms_reply", viaPromoConfirmation: true })).toThrow();
    expect(() => assertApprovedEnrollment({ action: "opt_in", scope: "marketing", source: "sms_reply", method: "sms_reply", viaPromoConfirmation: true })).not.toThrow();
  });

  it("staff can't enroll promotions in v2: a yes only sends the confirmation text", () => {
    const a = readFileSync("src/app/admin/(app)/orders/consent-actions.ts", "utf8");
    expect(a).toContain("requestPromoConfirmation");
    expect(v2.staffDisclosure({ VERCEL_ENV: "preview" }).marketing).toContain("you'll be signed up only after you reply YES to that text");
  });
});

describe("WRONG NUMBER (v2) and the terms page", () => {
  it("WRONG NUMBER removes the number in v2 only", () => {
    expect(detectKeywordDetail("Wrong number", true)).toEqual({ keyword: "stop", exact: false });
    expect(detectKeywordDetail("sorry wrong number!", true).keyword).toBe("stop");
    expect(detectKeywordDetail("Wrong number", false).keyword).toBeNull();
    expect(detectKeywordDetail("Is the bounce house the wrong size?", true).keyword).toBeNull();
  });

  it("SMS Terms v3 replaces the whole page (word-for-word check in sms-terms-v2-lines.test.ts)", async () => {
    const page = SmsTerms() as unknown as { type: (p: unknown) => unknown; props: unknown };
    expect(String(page.type)).toContain("SmsTermsV3");
  });

});

describe("Abraham U checks", () => {
  it("delivery staff text only approved templates, only for a current stop, only to that order's phone", async () => {
    const { isCurrentStop } = await import("@/lib/delivery-stops");
    const now = new Date("2026-11-08T15:00:00Z");
    expect(isCurrentStop({ status: "CONFIRMED", eventDate: "2026-11-08", pickupDate: "2026-11-09" }, now)).toBe(true);
    expect(isCurrentStop({ status: "DELIVERED", eventDate: "2026-11-07", pickupDate: "2026-11-08" }, now)).toBe(true);
    expect(isCurrentStop({ status: "CONFIRMED", eventDate: "2026-11-20", pickupDate: "2026-11-22" }, now)).toBe(false);
    expect(isCurrentStop({ status: "CANCELLED", eventDate: "2026-11-08", pickupDate: "2026-11-09" }, now)).toBe(false);
    const a = readFileSync("src/app/admin/deliveries/actions.ts", "utf8");
    expect(a).toContain("const t = DELIVERY_TEMPLATES[key]");
    expect(a).toContain("body: t.body");
    expect(a).toContain("phone: full.customer.phone");
    expect(a).toContain('staff.role === "delivery" && !isCurrentStop(full.order)');
  });

  it("HELP uses the same email as the live SMS Terms and Privacy Policy", async () => {
    const { HELP_REPLY, HELP_EMAIL } = await import("@/lib/sms-inbound");
    const { publicEmail } = await import("@/lib/config");
    expect(HELP_EMAIL).toBe(publicEmail({ VERCEL_ENV: "production" }));
    expect(HELP_REPLY).toContain(HELP_EMAIL);
  });
});

describe("JOIN and NO PROMO (Abraham, Nov 9, 2026)", () => {
  it("JOIN and NO PROMO are recognized in any case, with or without the space (JOIN only with SMS Terms v2)", async () => {
    const { detectKeywordDetail } = await import("@/lib/sms-inbound");
    expect(detectKeywordDetail("join", true).keyword).toBe("join");
    expect(detectKeywordDetail(" Join! ", true).keyword).toBe("join");
    expect(detectKeywordDetail("JOIN", false).keyword).toBe(null); // live site: waits for the SMS Terms v2 approval
    expect(detectKeywordDetail("No Promo", true).keyword).toBe("nopromo");
    expect(detectKeywordDetail("nopromo", false).keyword).toBe("nopromo");
  });
  it("the confirmation text is Abraham's v3 wording, 5 a year, YES within 24 hours, with the live Terms link", () => {
    expect(v2.promoConfirmRequestSms("https://hupupattractions.com")).toBe(
      "Hup Up Attractions: You requested to join our seasonal promotional text program. You may receive up to 5 promotional messages per calendar year, including seasonal offers, discount codes, and rental deals. Message and data rates may apply. Reply YES within 24 hours to confirm. Reply STOP to unsubscribe. Reply HELP for assistance. Terms: https://hupupattractions.com/sms-terms",
    );
  });
});

describe("JOIN by text, end to end (SMS Terms v2)", () => {
  const J = "+18455550188";
  const t = (Body: string, sid: string) => handleInboundSms({ From: J, To: "+18454157585", Body, MessageSid: sid });
  const promo = async () => (await db.select().from(schema.smsConsents).where(eq(schema.smsConsents.phone, J))).filter((r) => r.scope === "marketing");
  it("JOIN only requests the confirmation (v3): a second JOIN neither confirms nor repeats it; YES confirms; a plain question never signs anyone up", async () => {
    h.sent.length = 0;
    await t("Do you have paddle boats on Sunday?", "SMj0");
    expect(await promo()).toHaveLength(0);
    expect(h.sent.filter((m) => m.event === "promo_confirm_request")).toHaveLength(0);
    await t("join", "SMj1");
    expect(h.sent.at(-1)!.body).toBe(v2.promoConfirmRequestSms());
    expect(await promo()).toHaveLength(0);
    const before = h.sent.length;
    await t("JOIN", "SMj2");
    expect(await promo()).toHaveLength(0); // JOIN is never the confirmation reply
    expect(h.sent.length).toBe(before); // no duplicate confirmation while one is waiting
    await t("YES", "SMj2b");
    expect((await promo()).map((r) => r.action)).toEqual(["opt_in"]);
    expect(h.sent.at(-1)!.body).toBe(v2.PROMO_ENROLLED_SMS);
  });
  it("after STOP, JOIN signs nothing up and sends nothing", async () => {
    await t("STOP", "SMj3");
    h.sent.length = 0;
    await t("JOIN", "SMj4");
    expect(h.sent).toHaveLength(0);
    expect((await promo()).at(-1)!.action).toBe("opt_out");
  });
});
