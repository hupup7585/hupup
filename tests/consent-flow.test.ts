import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Phone consent steps, end to end through handleVoice, with the database and messaging mocked
 * (no database is touched). Checks what gets recorded and what the caller hears next.
 */

const h = vi.hoisted(() => ({
  session: { callSid: "CA1", fromNumber: "+18455550100", orderId: 7, data: {} as Record<string, unknown>, status: "in_progress", outcome: "carted" },
  customer: null as null | { id: number; phone: string; smsOptOut: boolean; marketingOptIn: boolean },
  state: { transactional: null, marketing: null } as Record<string, { action: string; at: Date } | null>,
  recorded: [] as Record<string, unknown>[],
  sms: [] as { to: string; body: string; opts?: Record<string, unknown> }[],
  emails: [] as { to: string }[],
  messages: [] as Record<string, unknown>[],
  zones: [] as { phone: string; zone: string; source: string }[],
  terms: [] as Record<string, unknown>[],
  sendOk: true,
  promoMode: "owner_test" as "off" | "owner_test" | "live",
  promoRequests: [] as { to: string; how: string }[],
  promoResult: { sendConfirmation: true, reason: "pending_created" } as { sendConfirmation: boolean; reason: string },
}));

vi.mock("@/lib/db", async () => {
  const schema = await vi.importActual<typeof import("@/lib/db/schema")>("@/lib/db/schema");
  const chain = (): unknown =>
    new Proxy(() => undefined, {
      get: (_t, k) => (k === "transaction" ? (cb: (tx: unknown) => unknown) => cb(chain()) : k === "then" ? (res: (v: unknown) => void) => res(h.customer ? [h.customer] : []) : () => chain()),
      apply: () => chain(),
    });
  return { db: chain(), schema };
});
vi.mock("@/lib/ivr/session", () => ({
  ensureSession: async () => h.session,
  getSession: async () => h.session,
  updateSession: async (_sid: string, patch: { data?: Record<string, unknown> }) => {
    if (patch.data) h.session.data = { ...h.session.data, ...patch.data };
  },
}));
// The promo steps wait for Abraham's OK (they never play until approved); these tests check them as approved.
vi.mock("@/lib/ivr/prompts", async (orig) => {
  const m = await orig<typeof import("@/lib/ivr/prompts")>();
  const approved = Object.fromEntries(Object.keys(m.PROMPTS).filter((k) => k.startsWith("promo_")).map((k) => [k, { text: null, audioUrl: null, approvedAt: new Date() }]));
  return { ...m, loadPromptOverrides: async () => approved };
});
vi.mock("@/lib/sms-consent", async (orig) => ({
  ...(await orig<typeof import("@/lib/sms-consent")>()),
  consentState: async () => h.state,
  recordConsent: async (input: Record<string, unknown>) => {
    h.recorded.push(input);
    return 42;
  },
  setCustomerTimeZone: async (phone: string, zone: string, source: string) => {
    h.zones.push({ phone, zone, source });
    return true;
  },
}));
vi.mock("@/lib/phone-promo", async (orig) => ({ ...(await orig<typeof import("@/lib/phone-promo")>()), phonePromoMode: () => h.promoMode }));
vi.mock("@/lib/sms-reenroll", async (orig) => ({
  ...(await orig<typeof import("@/lib/sms-reenroll")>()),
  requestPromoConfirmation: async (_tx: unknown, _c: unknown, to: string, how: string) => (h.promoRequests.push({ to, how }), h.promoResult),
}));
vi.mock("@/lib/notify", () => ({
  sendSms: async (to: string, body: string, opts?: Record<string, unknown>) => {
    h.sms.push({ to, body, opts });
    return { sent: true };
  },
  sendEmail: async (to: string) => {
    h.emails.push({ to });
    return { sent: true };
  },
}));
vi.mock("@/lib/sms", async (orig) => ({
  ...(await orig<typeof import("@/lib/sms")>()),
  sendMessage: async (input: Record<string, unknown>) => {
    h.messages.push(input);
    return { sent: h.sendOk };
  },
}));
vi.mock("@/lib/settings", async (orig) => {
  const m = await orig<typeof import("@/lib/settings")>();
  return { ...m, getSettings: async () => ({ ...m.SETTING_DEFAULTS }) };
});
vi.mock("@/lib/rental-terms", async (orig) => ({
  ...(await orig<typeof import("@/lib/rental-terms")>()),
  recordTermsAcceptance: async (input: Record<string, unknown>) => {
    h.terms.push(input);
    return 1;
  },
}));
vi.mock("@/lib/orders", async (orig) => ({
  ...(await orig<typeof import("@/lib/orders")>()),
  upsertCustomer: async () => 42,
  getOrderWithItems: async () => ({
    order: { id: 7, status: "HOLD", eventDate: "2026-11-15", pickupDate: "2026-11-16", subtotalCents: 25000 },
    items: [{ qty: 1, name: "Castle Bouncer" }],
  }),
  // The payment link reads the reservation as priced at checkout (KJ: $10 delivery + 8.125% tax)
  getPaymentGroup: async () => {
    const o = { order: { id: 7, status: "PENDING_PAYMENT", eventDate: "2026-11-15", pickupDate: "2026-11-16", subtotalCents: 25000, deliveryFeeCents: 1000, taxCents: 2113, totalCents: 28113, paidCents: 0 }, items: [{ qty: 1, name: "Castle Bouncer" }], customer: { id: 42 } };
    return { primary: o, orders: [o], due: (globalThis as { __due?: number }).__due ?? 28113 };
  },
}));

const { handleVoice } = await import("@/lib/ivr/flow");
const { PROMPTS } = await import("@/lib/ivr/prompts");
const { CONSENT_WORDING_VERSION } = await import("@/lib/sms-consent");

const call = (action: string, body: Record<string, string> = {}, query = "") =>
  handleVoice({ action, query: new URLSearchParams(query), body, callSid: "CA1", from: "+18455550100" });

beforeEach(() => {
  h.session.data = { name: "Yossi Friedman", address: "12 Forest Road, Kiryas Joel", phone: "+18455550100", termsAccepted: true };
  h.terms = [];
  h.customer = null;
  h.state = { transactional: null, marketing: null };
  h.recorded = [];
  h.sms = [];
  h.emails = [];
  h.messages = [];
  h.zones = [];
  h.promoMode = "owner_test";
  h.sendOk = true;
  h.promoRequests = [];
  h.promoResult = { sendConfirmation: true, reason: "pending_created" };
  process.env.ADMIN_PHONE = "+18455550100"; // owner test mode: this test caller is the Owner
  process.env.PUBLIC_BASE_URL = "https://hupup.vercel.app";
  process.env.AUTH_SECRET = "test-secret-at-least-24-characters-long";
});

describe("transactional consent step (before the payment link)", () => {
  it("confirming the number leads to the consent question, not straight to finalize", async () => {
    const xml = await call("phone-choice", { Digits: "1" });
    expect(xml).toContain("/api/voice/sms-consent");
  });
  it("box 49 (Abraham, Nov 24, 2026): the one line, keys only; no key 2, no long disclosure", async () => {
    const xml = await call("sms-consent");
    expect(xml).toContain('input="dtmf"');
    expect(xml).not.toContain("speech");
    expect(xml).toContain("To receive text updates to your phone number, about your reservation, press 1.");
    expect(xml).not.toContain("press 2");
    expect(xml).not.toContain("Message frequency varies");
    expect(xml).toContain("/api/voice/sms-consent-answer");
    expect(xml).toContain("/api/voice/sms-consent-answer?none=1"); // no key: no texts, checkout continues
  });
  it("press 1 records an opt-in with number, method, exact language, version, call and order; then the thank-you with the number", async () => {
    const xml = await call("sms-consent-answer", { Digits: "1" });
    expect(h.recorded).toHaveLength(1);
    expect(h.recorded[0]).toMatchObject({
      phone: "+18455550100",
      scope: "transactional",
      action: "opt_in",
      source: "phone",
      method: "keypad",
      wording: PROMPTS.consent_transactional.text,
      wordingVersion: CONSENT_WORDING_VERSION,
      response: "pressed 1",
      callSid: "CA1",
      callerPhone: "+18455550100",
      orderId: 7,
    });
    expect(h.session.data.smsConsent).toBe("yes");
    expect(xml).toContain("Thank you. You will get text updates about your reservation, to 8 4 5, 5 5 5, 0 1 0 0. Message and data rates may apply.");
    expect(xml).toContain("/api/voice/finalize");
  });
  it("no key: no texts (recorded as declined, no answer), checkout continues", async () => {
    const xml = await call("sms-consent-answer", {}, "none=1");
    expect(h.recorded[0]).toMatchObject({ action: "declined", response: "no answer" });
    expect(h.session.data.smsConsent).toBe("no");
    expect(xml).toContain("/api/voice/finalize");
  });
  it("a wrong key: the shared line and the question once more; then like no key", async () => {
    let xml = await call("sms-consent-answer", { Digits: "2" });
    expect(h.recorded).toHaveLength(0);
    expect(xml).toContain(PROMPTS.not_valid.text);
    expect(xml).toContain("/api/voice/sms-consent?n=1");
    xml = await call("sms-consent-answer", { Digits: "2" }, "n=1");
    expect(h.recorded[0]).toMatchObject({ action: "declined" });
    expect(xml).toContain("/api/voice/finalize");
  });
  it("already opted in: not asked again", async () => {
    h.state.transactional = { action: "opt_in", at: new Date() };
    const xml = await call("sms-consent");
    expect(xml).not.toContain("text updates");
    expect(xml).toContain("/api/voice/finalize");
    expect(h.session.data.smsConsent).toBe("existing");
  });
  it("number that replied STOP: box 49 skipped; the opt-out line (Nov 25, 2026); nothing recorded", async () => {
    h.customer = { id: 9, phone: "+18455550100", smsOptOut: true, marketingOptIn: false };
    const xml = await call("sms-consent");
    expect(xml).toContain("This number has opted out of our messages. To get messages again, text the word START to 8 4 5 4 1 5 7 5 8 5.");
    expect(xml).not.toContain("text updates");
    expect(xml).toContain("/api/voice/finalize");
    expect(h.recorded).toHaveLength(0);
    expect(h.session.data.smsConsent).toBe("stopped");
  });
});

describe("payment link: box 141, text or email (Abraham, Nov 17, 2026)", () => {
  it("after the order: the link choice (box 141), nothing sent yet", async () => {
    const xml = await call("finalize");
    expect(xml).toContain("/api/voice/paylink?o=7");
    expect(h.sms).toHaveLength(0);
    expect(h.emails).toHaveLength(0);
    expect(await call("paylink", {}, "o=7")).toContain("To receive the payment link by text, press 1. To receive by email, press 2.");
  });
  it("text to the caller's number with consent: one order text (STOP line added by the text system when due), box 146, then the promotional question", async () => {
    h.session.data.smsConsent = "yes";
    expect(await call("tx-which", {}, "p=pay&o=7")).toContain("To text it to the number you are calling from, press 1. To enter a different number, press 2.");
    const xml = await call("tx-which-choice", { Digits: "1" }, "p=pay&o=7");
    expect(h.sms).toHaveLength(1);
    expect(h.sms[0].to).toBe("+18455550100");
    expect(h.sms[0].body).not.toContain("Reply HELP for help, STOP to opt out.");
    expect(h.sms[0].opts).toMatchObject({ kind: "transactional", orderId: 7, callSid: "CA1" });
    expect(xml).toContain("Done! We just sent you the payment link. To keep your booking, please complete your payment within the next ten minutes. Otherwise, the booking will be released. Thank you for choosing Hup Up Attractions!");
    expect(xml).toContain("/api/voice/promo-consent");
    expect(xml).not.toContain("0100"); // the caller's number is never read out
  });
  it("no consent yet: the approved consent question first; no means the email steps", async () => {
    h.session.data.smsConsent = undefined;
    expect(await call("tx-which-choice", { Digits: "1" }, "p=pay&o=7")).toContain("/api/voice/pay-consent?o=7");
    const no = await call("pay-consent-answer", { Digits: "2" }, "o=7");
    expect(h.sms).toHaveLength(0);
    expect(no).toContain("/api/voice/catalog-email?p=pay&amp;o=7");
  });
  it("by email: the key 8 email steps, then the link by email and box 146", async () => {
    expect(await call("paylink-choice", { Digits: "2" }, "o=7")).toContain("/api/voice/catalog-email?p=pay&amp;o=7");
    await call("catalog-email", {}, "p=pay&o=7");
    h.session.data = { ...h.session.data, catLocal: "yossi", catDomain: "gmail.com" };
    const xml = await call("catalog-final-choice", { Digits: "1" });
    expect(h.emails).toEqual([{ to: "yossi@gmail.com" }]);
    expect(xml).toContain("Done! We just sent you the payment link.");
    expect(xml).toContain("/api/voice/promo-consent");
  });
});

describe("promo texts by phone, keys only (Abraham, Nov 10, 2026)", () => {
  const plain = (x: string) => x.replace(/&apos;/g, "'");
  it("Step 1 after the order: exact wording, keys only (no speech), pound or nothing skips", async () => {
    const xml = plain(await call("promo-consent"));
    expect(xml).toContain("To get seasonal offers, discounts, and deals by text, up to 6 a year, press 1.");
    expect(xml).toContain("To skip, press pound."); // the shared skip line (Nov 19, 2026)
    expect(xml).toContain('input="dtmf"');
    expect(xml).not.toContain("speech");
    expect(xml).not.toContain("say yes");
    expect(xml).toContain("/api/voice/promo-consent-answer");
    for (const body of [{ Digits: "#" }, {}] as Record<string, string>[]) {
      const out = await call("promo-consent-answer", body);
      expect(out).toContain("/api/voice/goodbye");
    }
    expect(h.recorded.map((r) => [r.scope, r.action, r.wording])).toEqual([
      ["marketing", "declined", PROMPTS.promo_ask.text],
      ["marketing", "declined", PROMPTS.promo_ask.text],
    ]);
    expect(h.messages).toHaveLength(0);
  });
  it("the long spoken question is never played", async () => {
    const xml = plain(await call("promo-consent"));
    expect(xml).not.toContain(PROMPTS.consent_marketing_v2.text);
    expect(xml).not.toContain("One more question");
  });
  it("Step 2: press 1 texts the approved confirmation to the caller's number, then the Final and Disclosure lines", async () => {
    expect(await call("promo-consent-answer", { Digits: "1" })).toContain("/api/voice/promo-which");
    expect(plain(await call("promo-which"))).toContain("To get texts at the number you are calling from, press 1. To use a different phone number, press 2.");
    const xml = plain(await call("promo-which-answer", { Digits: "1" }));
    expect(h.promoRequests).toHaveLength(1);
    expect(h.promoRequests[0].to).toBe("+18455550100");
    expect(h.promoRequests[0].how).toContain("number chosen: caller's number +18455550100");
    expect(h.promoRequests[0].how).toMatch(/phone \(keys only\)/);
    expect(h.promoRequests[0].how).toMatch(/20\d\d/); // the year
    expect(h.promoRequests[0].how).toMatch(/New York time/); // date and time
    const m = h.messages.find((x) => x.event === "promo_confirm_request")!;
    expect(m.to).toBe("+18455550100");
    const { promoConfirmRequestSms } = await import("@/lib/sms-terms-v2");
    expect(m.body).toBe(promoConfirmRequestSms()); // word for word as approved
    const fin = xml.indexOf("Thanks! We just sent a text. Reply YES within 24 hours to finish signing up.");
    const dis = xml.indexOf("Message and data rates may apply, and you are signed up only after you reply YES to our confirmation text.");
    expect(fin).toBeGreaterThan(-1);
    expect(dis).toBeGreaterThan(fin);
    expect(xml).toContain("/api/voice/goodbye");
    expect(h.recorded.filter((r) => r.action === "opt_in")).toEqual([]); // nothing is signed up until YES
  });
  it("Step 3 (boxes 143 and 144): a different number is read back in groups, confirmed with 1, and the text goes to that number", async () => {
    expect(await call("promo-which-answer", { Digits: "2" })).toContain("/api/voice/promo-enter");
    const ask = await call("promo-enter");
    expect(ask).toContain("Please enter the 10-digit phone number. When you are finished, please press pound.");
    expect(ask).toContain('finishOnKey="#"');
    const heard = await call("promo-heard", { Digits: "8455551234" });
    expect(heard).toContain("I have 8 4 5, 5 5 5, 1 2 3 4. If that is correct, press 1. To enter a different number, press 2.");
    const xml = await call("promo-confirm", { Digits: "1" });
    expect(h.promoRequests[0].to).toBe("+18455551234");
    expect(h.promoRequests[0].how).toContain("number chosen: entered number +18455551234");
    expect(h.messages.find((x) => x.event === "promo_confirm_request")!.to).toBe("+18455551234");
    expect(xml).toContain("Thanks! We just sent a text.");
  });
  it("Step 3: press 2 enters it again; not 10 digits says sorry, and after 2 tries skips", async () => {
    await call("promo-heard", { Digits: "8455551234" });
    expect(await call("promo-confirm", { Digits: "2" })).toContain("/api/voice/promo-enter");
    const bad = plain(await call("promo-heard", { Digits: "84555" }));
    expect(bad).toContain("Sorry, that number did not work. Please try again.");
    expect(bad).toContain("/api/voice/promo-enter?t=1");
    const second = await handleVoice({ action: "promo-heard", query: new URLSearchParams("t=1"), body: { Digits: "123" }, callSid: "CA1", from: "+18455550100" });
    expect(second).toContain("/api/voice/goodbye");
    expect(second).not.toContain("didn&apos;t work");
    expect(h.messages).toHaveLength(0);
  });
  it("a number that replied STOP gets no text and no 'we just sent a text'", async () => {
    h.promoResult = { sendConfirmation: false, reason: "opted_out" };
    const xml = await call("promo-which-answer", { Digits: "1" });
    expect(h.messages).toHaveLength(0);
    expect(xml).not.toContain("We just sent a text");
  });
  it("not live yet: other callers skip straight to goodbye; only the Owner's own phone hears it (owner test)", async () => {
    process.env.ADMIN_PHONE = "+18457777585";
    expect(await call("promo-consent")).toContain("/api/voice/goodbye");
    h.promoMode = "off";
    process.env.ADMIN_PHONE = "+18455550100";
    expect(await call("promo-consent")).not.toContain("seasonal offers");
  });
  it("once live: no 'we just sent a text' unless the text really went out (texting off until A2P)", async () => {
    h.promoMode = "live";
    h.sendOk = false;
    const xml = await call("promo-which-answer", { Digits: "1" });
    expect(xml).not.toContain("We just sent a text");
    expect(xml).toContain("/api/voice/goodbye");
  });
  it("once live: skipped when the caller already decided recently", async () => {
    h.promoMode = "live";
    h.state.marketing = { action: "declined", at: new Date() };
    process.env.ADMIN_PHONE = "+18457777585";
    const xml = await call("promo-consent");
    expect(xml).not.toContain("seasonal offers");
    expect(xml).toContain("/api/voice/goodbye");
  });
  it("goodbye reads the delivery and pickup dates and hangs up (paid order)", async () => {
    h.session.data.placedOrderId = 7;
    (globalThis as { __due?: number }).__due = 0;
    try {
      const xml = await call("goodbye");
      expect(xml).toContain("Thanks so much for choosing Hup Up Attractions");
      expect(xml).toContain("<Hangup/>");
    } finally {
      delete (globalThis as { __due?: number }).__due;
    }
  });
  it("Batch 3 item 2: an unpaid order (payment link not paid yet) gets no order goodbye, just the hang-up", async () => {
    h.session.data.placedOrderId = 7;
    const xml = await call("goodbye");
    expect(xml).not.toContain("<Say");
    expect(xml).not.toContain("<Play");
    expect(xml).toContain("<Hangup/>");
  });
});

describe("no time zone question (Abraham, Nov 16, 2026): every customer is on Eastern time", () => {
  it("the phone line never asks for a time zone", async () => {
    const { PROMPTS } = await import("@/lib/ivr/prompts");
    for (const k of ["tz_ask", "tz_pick", "tz_saved"]) expect(PROMPTS).not.toHaveProperty(k);
    const { readFileSync } = await import("node:fs");
    expect(readFileSync("src/lib/ivr/flow.ts", "utf8")).not.toMatch(/"tz-answer"|"tz-pick"|PHONE_TZ_KEYS/);
    expect(h.zones).toEqual([]);
  });
});

describe("checkout pricing, delivery area and terms (Abram's final decisions)", () => {
  it("an address outside the delivery area stops checkout and asks again", async () => {
    h.session.data.heard = "5 Main Street, Albany";
    const xml = await call("confirm", { Digits: "1" }, "f=address");
    // Batch 2 item 6 (Nov 25, 2026): the approved step 5 screen (addr_outside) replaces the old line
    expect(xml).toContain("/api/voice/addr-outside");
  });
  it("an in-area address continues", async () => {
    h.session.data.heard = "5 Main Street, Monroe";
    const xml = await call("confirm", { Digits: "1" }, "f=address");
    expect(xml).not.toContain("we only deliver");
  });
  it("finalize asks for the terms first, with the exact notice", async () => {
    h.session.data.termsAccepted = undefined;
    let xml = await call("finalize");
    expect(xml).toContain("/api/voice/terms");
    xml = await call("terms");
    expect(xml).toContain("By pressing #, you agree to our Terms and Conditions. To review them, go to hupupattractions.com/terms. To get the link by text message, press 1. To continue, press #.");
  });
  it("pressing # logs time, phone, order and terms version, then continues", async () => {
    h.session.data.termsAccepted = undefined;
    const xml = await call("terms-answer", { Digits: "#" });
    expect(h.terms[0]).toMatchObject({ orderId: 7, phone: "+18455550100", termsVersion: "terms-2026-11-06-AE", method: "phone_hash" });
    expect(String(h.terms[0].acceptanceStatement)).toMatch(/^Pressed "#" for reservation #\d+ after hearing: "By pressing #/);
    expect(h.session.data.termsAccepted).toBe(true);
    expect(xml).toContain("/api/voice/finalize");
  });
  it("not pressing # twice ends the call without an order", async () => {
    h.session.data.termsAccepted = undefined;
    const xml = await call("terms-answer", {}, "n=1");
    expect(xml).toContain("you need to accept our Terms and Conditions");
    expect(xml).toContain("<Hangup/>");
    expect(h.terms).toEqual([]);
  });
  it("the payment text and read-back include delivery and tax (KJ: $10 + 8.125% on everything)", async () => {
    h.session.data.smsConsent = "yes";
    const xml = await call("finalize");
    expect(xml).toContain("Your total is");
    await call("tx-which-choice", { Digits: "1" }, "p=pay&o=7");
    // $250.00 rentals + $10.00 delivery = $260.00; tax 8.125% = $21.13; total $281.13
    expect(h.sms[0].body).toContain("Rentals $250.00 + delivery $10.00 + sales tax $21.13 = total $281.13.");
  });
});

describe("Terms on the phone: text the link (press 1)", () => {
  it("with text consent: texts the /terms link, then repeats the notice", async () => {
    h.session.data.smsConsent = "yes";
    const xml = await call("terms-answer", { Digits: "1" });
    expect(h.sms[0].body).toContain("/terms");
    expect(xml).toContain("We just texted you the link");
    expect(xml).toContain("/api/voice/terms");
  });
  it("without text consent: no text, gives the address instead", async () => {
    h.session.data.smsConsent = "no";
    const xml = await call("terms-answer", { Digits: "1" });
    expect(h.sms).toEqual([]);
    expect(xml).toContain("you can read our Terms at hupupattractions.com/terms");
  });
  it("payment text links to the review-and-pay page (Terms box), not straight to Sola", async () => {
    h.session.data.smsConsent = "yes";
    await call("tx-which-choice", { Digits: "1" }, "p=pay&o=7");
    expect(h.sms[0].body).toMatch(/https:\/\/hupup\.vercel\.app\/pay\/7\?t=/);
  });
});

describe("the opt-out line (Abraham, Nov 24, 2026, 8:38 PM): a STOP number hears it in all three places", () => {
  const STOPPED = "This number has opted out of our messages. To get messages again, text the word START to 8 4 5 4 1 5 7 5 8 5.";
  it("the exact approved text", () => {
    expect(PROMPTS.consent_stopped.text).toBe(STOPPED);
  });
  it("box 49, the payment link by text, and the promo sign-up", async () => {
    h.customer = { id: 9, phone: "+18455550100", smsOptOut: true, marketingOptIn: false };
    h.session.data = { phone: "+18455550100" };
    expect(await call("sms-consent")).toContain(STOPPED);
    h.session.data = {};
    const pay = await call("tx-which-choice", { Digits: "1" }, "p=pay&o=7");
    expect(pay).toContain(STOPPED);
    h.promoResult = { sendConfirmation: false, reason: "opted_out" };
    const promo = await call("promo-which-answer", { Digits: "1" });
    expect(promo).toContain(STOPPED);
  });
  it("a number that never replied STOP never hears it", async () => {
    h.customer = null;
    h.session.data = { phone: "+18455550100" };
    expect(await call("sms-consent")).not.toContain("opted out");
    h.session.data = { smsConsent: "yes", phone: "+18455550100" };
    expect(await call("tx-which-choice", { Digits: "1" }, "p=pay&o=7")).not.toContain("opted out");
  });
});
