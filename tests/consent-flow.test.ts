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
}));

vi.mock("@/lib/db", async () => {
  const schema = await vi.importActual<typeof import("@/lib/db/schema")>("@/lib/db/schema");
  const chain = (): unknown =>
    new Proxy(() => undefined, {
      get: (_t, k) => (k === "then" ? (res: (v: unknown) => void) => res(h.customer ? [h.customer] : []) : () => chain()),
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
  h.session.data = { name: "Yossi Friedman", address: "12 Forest Road", phone: "+18455550100" };
  h.customer = null;
  h.state = { transactional: null, marketing: null };
  h.recorded = [];
  h.sms = [];
  h.emails = [];
  h.messages = [];
  process.env.PUBLIC_BASE_URL = "https://hupup.vercel.app";
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
  it("with consent: order text with HELP/STOP footer, then the promotional question", async () => {
    h.session.data.smsConsent = "yes";
    const xml = await call("finalize");
    expect(h.sms).toHaveLength(1);
    expect(h.sms[0].body).toContain("Reply HELP for help, STOP to opt out.");
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

describe("promotional consent (separate, never automatic)", () => {
  it("asked after the order with its own disclosure", async () => {
    const xml = await call("promo-consent");
    expect(xml).toContain("Agreeing is not required to book or buy anything.");
    expect(xml).toContain("/api/voice/promo-consent-answer");
  });
  it("yes: records marketing opt-in and texts the confirmation", async () => {
    const xml = await call("promo-consent-answer", { Digits: "1" });
    expect(h.recorded[0]).toMatchObject({ scope: "marketing", action: "opt_in", method: "keypad", wording: PROMPTS.consent_marketing.text });
    expect(h.messages).toHaveLength(1);
    expect(String(h.messages[0].body)).toContain("You're subscribed to promotional texts");
    expect(xml).toContain("/api/voice/goodbye");
  });
  it("no, silence or an unclear answer never enrolls", async () => {
    await call("promo-consent-answer", { Digits: "2" });
    await call("promo-consent-answer", {}, "n=1");
    await call("promo-consent-answer", { SpeechResult: "yes", Confidence: "0.2" }, "n=1");
    expect(h.recorded.map((r) => r.action)).toEqual(["declined", "declined", "declined"]);
    expect(h.messages).toHaveLength(0);
  });
  it("skipped when already decided recently", async () => {
    h.state.marketing = { action: "declined", at: new Date() };
    const xml = await call("promo-consent");
    expect(xml).not.toContain("promotional and marketing");
    expect(xml).toContain("/api/voice/goodbye");
  });
  it("goodbye reads the delivery and pickup dates and hangs up", async () => {
    h.session.data.placedOrderId = 7;
    const xml = await call("goodbye");
    expect(xml).toContain("Thanks so much for choosing Hup Up Attractions");
    expect(xml).toContain("<Hangup/>");
  });
});
