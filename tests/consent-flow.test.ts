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
vi.mock("@/lib/ivr/prompts", async (orig) => ({ ...(await orig<typeof import("@/lib/ivr/prompts")>()), loadPromptOverrides: async () => ({}) }));
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
    return { sent: true };
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
  it("asks with the exact disclosure, accepting keypad or speech", async () => {
    const xml = await call("sms-consent");
    expect(xml).toContain('input="speech dtmf"');
    expect(xml).toContain("Message frequency varies. Message and data rates may apply.");
    expect(xml).toContain("/api/voice/sms-consent-answer");
  });
  it("press 1 records an opt-in with number, method, exact language, version, call and order", async () => {
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
    expect(xml).toContain("/api/voice/finalize");
  });
  it("a spoken yes records method speech with the transcript and confidence", async () => {
    await call("sms-consent-answer", { SpeechResult: "Yes please", Confidence: "0.87" });
    expect(h.recorded[0]).toMatchObject({ action: "opt_in", method: "speech", response: 'said "Yes please"', speechConfidence: 0.87 });
  });
  it("an unclear answer is asked once more, then recorded as declined", async () => {
    let xml = await call("sms-consent-answer", { SpeechResult: "hmm", Confidence: "0.9" });
    expect(h.recorded).toHaveLength(0);
    expect(xml).toContain("/api/voice/sms-consent?n=1");
    xml = await call("sms-consent", {}, "n=1");
    expect(xml).toContain(PROMPTS.consent_unclear.text);
    xml = await call("sms-consent-answer", {}, "n=1");
    expect(h.recorded[0]).toMatchObject({ action: "declined", response: "no answer" });
    expect(h.session.data.smsConsent).toBe("no");
  });
  it("already opted in: not asked again", async () => {
    h.state.transactional = { action: "opt_in", at: new Date() };
    const xml = await call("sms-consent");
    expect(xml).not.toContain("Message frequency varies");
    expect(xml).toContain("/api/voice/finalize");
    expect(h.session.data.smsConsent).toBe("existing");
  });
  it("number that replied STOP: explained, not asked, nothing recorded", async () => {
    h.customer = { id: 9, phone: "+18455550100", smsOptOut: true, marketingOptIn: false };
    const xml = await call("sms-consent");
    expect(xml).toContain("text the word START");
    expect(h.recorded).toHaveLength(0);
    expect(h.session.data.smsConsent).toBe("stopped");
  });
});

describe("finalize sends texts only with consent", () => {
  it("with consent: order text (STOP line added by the text system when due), then the promotional question", async () => {
    h.session.data.smsConsent = "yes";
    const xml = await call("finalize");
    expect(h.sms).toHaveLength(1);
    // The STOP line is added by the text system (first order text, or after 30 days without one): see tests/order-stop-line.test.ts
    expect(h.sms[0].body).not.toContain("Reply HELP for help, STOP to opt out.");
    expect(h.sms[0].opts).toMatchObject({ kind: "transactional", orderId: 7, callSid: "CA1" });
    expect(xml).toContain("/api/voice/promo-consent");
    expect(xml).not.toContain("<Hangup");
  });
  it("without consent: no text; email link if we have an email", async () => {
    h.session.data.smsConsent = "no";
    h.session.data.email = "yossi@example.com";
    const xml = await call("finalize");
    expect(h.sms).toHaveLength(0);
    expect(h.emails).toEqual([{ to: "yossi@example.com" }]);
    expect(xml).toContain("We just emailed you a secure payment link");
  });
  it("without consent or email: no text, staff will call", async () => {
    h.session.data.smsConsent = "no";
    const xml = await call("finalize");
    expect(h.sms).toHaveLength(0);
    expect(xml).toContain("Someone from our team will call you shortly");
  });
});

describe("promo texts by phone, keys only (Abraham, Nov 10, 2026)", () => {
  const plain = (x: string) => x.replace(/&apos;/g, "'");
  it("Step 1 after the order: exact wording, keys only (no speech), pound or nothing skips", async () => {
    const xml = plain(await call("promo-consent"));
    expect(xml).toContain("To get seasonal offers, discounts, and deals by text, up to 6 a year, press 1. To skip, press pound.");
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
    expect(plain(await call("promo-which"))).toContain("To get texts at the number you're calling from, press 1. To use a different phone number, press 2.");
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
    const dis = xml.indexOf("Message and data rates may apply, and you're signed up only after you reply YES to our confirmation text.");
    expect(fin).toBeGreaterThan(-1);
    expect(dis).toBeGreaterThan(fin);
    expect(xml).toContain("/api/voice/goodbye");
    expect(h.recorded.filter((r) => r.action === "opt_in")).toEqual([]); // nothing is signed up until YES
  });
  it("Step 3: a different number is read back in groups, confirmed with 1, and the text goes to that number", async () => {
    expect(await call("promo-which-answer", { Digits: "2" })).toContain("/api/voice/promo-enter");
    const ask = await call("promo-enter");
    expect(ask).toContain("Please enter the 10-digit mobile number, then press pound.");
    expect(ask).toContain('finishOnKey="#"');
    const heard = await call("promo-heard", { Digits: "8455551234" });
    expect(heard).toContain("You entered 8 4 5, 5 5 5, 1 2 3 4. To confirm, press 1. To enter it again, press 2.");
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
    expect(bad).toContain("Sorry, that number didn't work. Please try again.");
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
  it("once live: skipped when the caller already decided recently", async () => {
    h.promoMode = "live";
    h.state.marketing = { action: "declined", at: new Date() };
    process.env.ADMIN_PHONE = "+18457777585";
    const xml = await call("promo-consent");
    expect(xml).not.toContain("seasonal offers");
    expect(xml).toContain("/api/voice/goodbye");
  });
  it("goodbye reads the delivery and pickup dates and hangs up", async () => {
    h.session.data.placedOrderId = 7;
    const xml = await call("goodbye");
    expect(xml).toContain("Thanks so much for choosing Hup Up Attractions");
    expect(xml).toContain("<Hangup/>");
  });
});

describe("time zone question (after a promotional yes)", () => {
  it("asks Eastern first; press 1 saves New York", async () => {
    let xml = await call("tz");
    expect(xml).toContain("Are you in the Eastern time zone, the same as New York?");
    xml = await call("tz-answer", { Digits: "1" });
    expect(h.zones).toEqual([{ phone: "+18455550100", zone: "America/New_York", source: "phone" }]);
    expect(xml).toContain("/api/voice/goodbye");
  });
  it("press 2 offers the other zones; press 4 saves Pacific", async () => {
    const xml = await call("tz-answer", { Digits: "2" });
    expect(xml).toContain("Pacific, press 4");
    await call("tz-pick", { Digits: "4" });
    expect(h.zones).toEqual([{ phone: "+18455550100", zone: "America/Los_Angeles", source: "phone" }]);
  });
  it("skipping or silence saves nothing (fallback rule applies)", async () => {
    await call("tz-answer", {});
    await call("tz-pick", { Digits: "0" });
    expect(h.zones).toEqual([]);
  });
});

describe("checkout pricing, delivery area and terms (Abram's final decisions)", () => {
  it("an address outside the delivery area stops checkout and asks again", async () => {
    h.session.data.heard = "5 Main Street, Albany";
    const xml = await call("confirm", { Digits: "1" }, "f=address");
    expect(xml).toContain("we only deliver in Kiryas Joel and nearby Orange County towns");
    expect(xml).toContain("/api/voice/ask?f=address");
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
    // $250.00 rentals + $10.00 delivery = $260.00; tax 8.125% = $21.13; total $281.13
    expect(h.sms[0].body).toContain("Rentals $250.00 + delivery $10.00 + sales tax $21.13 = total $281.13.");
    expect(xml).toContain("Your total is");
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
    await call("finalize");
    expect(h.sms[0].body).toMatch(/https:\/\/hupup\.vercel\.app\/pay\/7\?t=/);
  });
});
