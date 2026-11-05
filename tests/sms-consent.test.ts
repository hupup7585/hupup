import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { CONSENT_WORDING_VERSION, MIN_SPEECH_CONFIDENCE, parseConsentAnswer, shouldAskMarketing, wordingVersion, MARKETING_CONFIRMATION_SMS } from "@/lib/sms-consent";
import { PROMPTS, promptAudio } from "@/lib/ivr/prompts";
import { detectKeyword, detectKeywordDetail } from "@/lib/sms-inbound";
import { inMarketingHours, marketingBody } from "@/lib/sms";

describe("phone consent language (A2P 10DLC)", () => {
  it("transactional disclosure: brand, program, frequency, rates, STOP, HELP, terms, keypad and voice options", () => {
    const t = PROMPTS.consent_transactional.text;
    for (const part of ["Hup Up Attractions", "reservation, order, payment, delivery, pickup, and customer service", "authorize Hup Up Attractions to share your phone number with service providers only as necessary to deliver these messages", "Message frequency varies.", "Message and data rates may apply.", "reply STOP to opt out", "HELP for help", "text message terms and privacy policy", "press 1 or say yes", "press 2 or say no"])
      expect(t).toContain(part);
  });
  it("promotional disclosure is separate, says it is not a condition of purchase, and covers provider sharing", () => {
    const t = PROMPTS.consent_marketing.text;
    for (const part of ["promotional text messages from Hup Up Attractions", "authorize Hup Up Attractions to share your phone number with service providers only as necessary to deliver these messages", "Consent is not a condition of purchase.", "Message frequency varies.", "Message and data rates may apply.", "reply STOP to opt out", "HELP for help", "press 1 or say yes", "press 2 or say no"])
      expect(t).toContain(part);
    expect(t).not.toBe(PROMPTS.consent_transactional.text);
  });
  it("consent prompts are always spoken from the stored text, never a recording", () => {
    expect(promptAudio({ consent_transactional: { text: null, audioUrl: "https://x/a.mp3" } }, "consent_transactional")).toBeNull();
    expect(promptAudio({ consent_marketing: { text: null, audioUrl: "https://x/b.mp3" } }, "consent_marketing")).toBeNull();
  });
  it("version: dated default, custom-<hash> when edited (same text = same version)", () => {
    const def = PROMPTS.consent_marketing.text;
    expect(wordingVersion(def, def)).toBe(CONSENT_WORDING_VERSION);
    const a = wordingVersion("Edited text", def);
    expect(a).toMatch(/^custom-[0-9a-f]{12}$/);
    expect(wordingVersion("Edited text", def)).toBe(a);
    expect(wordingVersion("Edited text!", def)).not.toBe(a);
  });
  it("promotional confirmation text names the business, frequency, rates, HELP and STOP", () => {
    for (const part of ["Hup Up Attractions:", "Msg frequency varies", "Msg & data rates may apply", "HELP", "STOP"]) expect(MARKETING_CONFIRMATION_SMS).toContain(part);
  });
});

describe("reading the caller's answer", () => {
  it("keypad: 1 yes, 2 no, anything else unclear", () => {
    expect(parseConsentAnswer({ digits: "1" })).toBe("yes");
    expect(parseConsentAnswer({ digits: "2" })).toBe("no");
    expect(parseConsentAnswer({ digits: "5" })).toBe("unclear");
  });
  it("speech: clear yes / no", () => {
    for (const s of ["Yes", "yes please", "Sure.", "I agree", "okay"]) expect(parseConsentAnswer({ speech: s, confidence: "0.92" }), s).toBe("yes");
    for (const s of ["No", "no thanks", "Nope", "skip", "not interested"]) expect(parseConsentAnswer({ speech: s, confidence: "0.9" }), s).toBe("no");
  });
  it("speech: mixed, empty, unrelated or low-confidence answers are never taken as yes", () => {
    for (const s of ["I don't agree", "yes no", "", "what", "maybe later"]) expect(parseConsentAnswer({ speech: s, confidence: "0.9" }), s).toBe("unclear");
    expect(parseConsentAnswer({ speech: "yes", confidence: String(MIN_SPEECH_CONFIDENCE - 0.1) })).toBe("unclear");
    expect(parseConsentAnswer({})).toBe("unclear");
  });
});

describe("promotional question is asked only when appropriate", () => {
  const now = new Date("2026-11-05T15:00:00Z");
  const none = { transactional: null, marketing: null };
  it("asked when there is no decision yet", () => {
    expect(shouldAskMarketing(none, null, now)).toBe(true);
    expect(shouldAskMarketing(none, { smsOptOut: false, marketingOptIn: false }, now)).toBe(true);
  });
  it("not asked when already opted in, after STOP, or within 12 months of a no", () => {
    expect(shouldAskMarketing(none, { smsOptOut: false, marketingOptIn: true }, now)).toBe(false);
    expect(shouldAskMarketing(none, { smsOptOut: true, marketingOptIn: false }, now)).toBe(false);
    expect(shouldAskMarketing({ transactional: null, marketing: { action: "declined", at: new Date("2026-06-01T00:00:00Z") } }, null, now)).toBe(false);
  });
  it("asked again more than 12 months after a no", () => {
    expect(shouldAskMarketing({ transactional: null, marketing: { action: "declined", at: new Date("2025-10-01T00:00:00Z") } }, null, now)).toBe(true);
  });
});

describe("opt-out words (STOP and NY GBL 399-z list)", () => {
  it("every listed word is honored on its own, any case or punctuation", () => {
    for (const w of ["stop", "STOP", "Stop.", "unsubscribe", "cancel", "end", "quit", "opt out", "Opt-Out", "optout", "revoke", "stopall"])
      expect(detectKeyword(w), w).toBe("stop");
  });
  it("clear opt-out phrases count too, and get our own confirmation", () => {
    for (const w of ["please stop", "Stop texting me", "unsubscribe me please", "opt me out", "please opt out", "I revoke consent"]) {
      const d = detectKeywordDetail(w);
      expect(d.keyword, w).toBe("stop");
      expect(d.exact, w).toBe(false);
    }
    expect(detectKeywordDetail("STOP").exact).toBe(true);
  });
  it("ordinary messages that merely contain cancel/end are not opt-outs", () => {
    for (const w of ["cancel my order", "can you deliver by end of day", "is it ok to end at 6", "we need to quit early tomorrow", "stop by at 5?", "where is the bus stop near you"])
      expect(detectKeyword(w), w).toBeNull();
  });
  it("START, HELP, NOPROMO unchanged", () => {
    expect(detectKeyword("start")).toBe("start");
    expect(detectKeyword("help")).toBe("help");
    expect(detectKeyword("NOPROMO")).toBe("nopromo");
  });
});

describe("promotional text rules (Abram's SMS Terms requirements 1 and 2)", () => {
  it("every promo begins with exactly 'Hup Up Attractions: Reply STOP to opt out.' and then the offer", () => {
    expect(marketingBody("20% off jumping balloons this week!")).toBe("Hup Up Attractions: Reply STOP to opt out. 20% off jumping balloons this week!");
    expect(marketingBody("Hup Up Attractions: Sale on paddle boats! Reply STOP to opt out.")).toBe("Hup Up Attractions: Reply STOP to opt out. Sale on paddle boats!");
    expect(marketingBody("Hup Up Attractions: Reply STOP to opt out. Spring deals")).toBe("Hup Up Attractions: Reply STOP to opt out. Spring deals");
  });
  it("New York numbers: 8 AM to 9 PM Eastern (DST aware)", () => {
    const ny = "+18455550100";
    expect(inMarketingHours(ny, new Date("2026-07-01T11:59:00Z"))).toBe(false); // 7:59 AM EDT
    expect(inMarketingHours(ny, new Date("2026-07-01T12:00:00Z"))).toBe(true); // 8:00 AM EDT
    expect(inMarketingHours(ny, new Date("2026-07-02T00:59:00Z"))).toBe(true); // 8:59 PM EDT
    expect(inMarketingHours(ny, new Date("2026-07-02T01:00:00Z"))).toBe(false); // 9:00 PM EDT
    expect(inMarketingHours(ny, new Date("2026-12-01T13:00:00Z"))).toBe(true); // 8:00 AM EST
    expect(inMarketingHours(ny, new Date("2026-12-01T12:59:00Z"))).toBe(false); // 7:59 AM EST
  });
});

describe("migration 0004 (written, not applied)", () => {
  const sql = readFileSync("drizzle/0004_sms_consent_phone.sql", "utf8");
  it("only adds columns, an index and the append-only triggers", () => {
    expect(sql).not.toMatch(/\b(DROP|DELETE FROM|UPDATE\s+"|TRUNCATE\s+"|ALTER COLUMN|RENAME)\b/i);
    for (const col of ["method", "wording_version", "response", "speech_confidence", "caller_phone", "order_id"])
      expect(sql).toContain(`ALTER TABLE "sms_consents" ADD COLUMN "${col}"`);
    expect(sql).toContain('CREATE INDEX "sms_consents_phone_scope_idx"');
    expect(sql).toContain("BEFORE UPDATE OR DELETE ON \"sms_consents\"");
    expect(sql).toContain("BEFORE TRUNCATE ON \"sms_consents\"");
  });
  it("is registered in the migration journal", () => {
    expect(readFileSync("drizzle/meta/_journal.json", "utf8")).toContain('"tag": "0004_sms_consent_phone"');
  });
});
