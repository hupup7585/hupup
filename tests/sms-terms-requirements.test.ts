import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { FALLBACK_TIME_ZONE, inRecipientPromoHours, knownAreaCodes, timeZonesForPhone } from "@/lib/area-code-tz";
import { detectKeyword, detectKeywordDetail } from "@/lib/sms-inbound";
import { OPT_OUT_KEYWORDS, PROMO_OPENING, PROVIDER_DISCLOSURE, WEB_CONSENT_MARKETING, WEB_CONSENT_TRANSACTIONAL } from "@/lib/sms-consent-copy";

/* Abram's "Hup Up Attractions SMS Terms - Additional Requirements" (2026-11-05). */

describe("1. promotional hours in the recipient's local time (area code, New York fallback)", () => {
  it("maps area codes to zones", () => {
    expect(timeZonesForPhone("+18455550100")).toEqual({ zones: ["America/New_York"], source: "area_code" });
    expect(timeZonesForPhone("+13125550100").zones).toEqual(["America/Chicago"]);
    expect(timeZonesForPhone("+13035550100").zones).toEqual(["America/Denver"]);
    expect(timeZonesForPhone("+16025550100").zones).toEqual(["America/Phoenix"]);
    expect(timeZonesForPhone("+14155550100").zones).toEqual(["America/Los_Angeles"]);
    expect(timeZonesForPhone("+18085550100").zones).toEqual(["Pacific/Honolulu"]);
    expect(timeZonesForPhone("(907) 555-0100").zones).toEqual(["America/Anchorage"]);
    expect(timeZonesForPhone("+18505550100").zones).toEqual(["America/New_York", "America/Chicago"]); // FL panhandle spans two
  });
  it("unknown, toll-free or foreign numbers fall back to New York", () => {
    for (const p of ["+18005550100", "+19995550100", "+442071234567", "", null]) expect(timeZonesForPhone(p)).toEqual({ zones: [FALLBACK_TIME_ZONE], source: "fallback" });
  });
  it("blocks by local time, not New York time", () => {
    const noonNY = new Date("2026-07-01T16:00:00Z"); // 12:00 PM EDT, 9:00 AM PDT, 6:00 AM HST
    expect(inRecipientPromoHours("+18455550100", noonNY)).toBe(true);
    expect(inRecipientPromoHours("+14155550100", noonNY)).toBe(true);
    expect(inRecipientPromoHours("+18085550100", noonNY)).toBe(false); // 6 AM in Hawaii
    const ninePmNY = new Date("2026-07-02T01:30:00Z"); // 9:30 PM EDT, 6:30 PM PDT
    expect(inRecipientPromoHours("+18455550100", ninePmNY)).toBe(false);
    expect(inRecipientPromoHours("+14155550100", ninePmNY)).toBe(true);
  });
  it("an area code spanning two zones must be inside the window in both", () => {
    const eightAmEastern = new Date("2026-07-01T12:30:00Z"); // 8:30 AM EDT = 7:30 AM CDT
    expect(inRecipientPromoHours("+18505550100", eightAmEastern)).toBe(false);
    expect(inRecipientPromoHours("+18505550100", new Date("2026-07-01T13:30:00Z"))).toBe(true);
  });
  it("Arizona has no daylight saving", () => {
    expect(inRecipientPromoHours("+16025550100", new Date("2026-07-01T14:30:00Z"))).toBe(false); // 7:30 AM MST
    expect(inRecipientPromoHours("+16025550100", new Date("2026-07-01T15:00:00Z"))).toBe(true); // 8:00 AM MST
  });
  it("table is well formed: 3-digit codes, valid IANA zones, no code listed in two single-zone groups by mistake", () => {
    const src = readFileSync("src/lib/area-code-tz.ts", "utf8");
    const codes = knownAreaCodes();
    expect(codes.length).toBeGreaterThan(300);
    for (const c of codes) expect(c).toMatch(/^[2-9]\d\d$/);
    for (const c of codes) for (const z of timeZonesForPhone(`+1${c}5550100`).zones) expect(() => new Intl.DateTimeFormat("en-US", { timeZone: z })).not.toThrow();
    const listed = [...src.matchAll(/"(\d{3})"/g)].map((m) => m[1]);
    const dupes = listed.filter((c, i) => listed.indexOf(c) !== i);
    expect(dupes).toEqual([]);
  });
});

describe("2. promotional opening", () => {
  it("is exactly the required text", () => {
    expect(PROMO_OPENING).toBe("Hup Up Attractions: Reply STOP to opt out.");
  });
});

describe("3. service provider disclosure", () => {
  it("website checkboxes include the provider-sharing authorization", () => {
    expect(WEB_CONSENT_MARKETING).toBe(
      "I agree to receive promotional text messages from Hup Up Attractions and authorize Hup Up Attractions to share my phone number with service providers only as necessary to deliver these messages. Consent is not a condition of purchase. Message and data rates may apply. Message frequency varies. Reply STOP to opt out or HELP for help.",
    );
    expect(WEB_CONSENT_TRANSACTIONAL).toContain("authorize Hup Up Attractions to share my phone number with service providers only as necessary to deliver these messages");
    for (const part of ["Message frequency varies.", "Message and data rates may apply.", "Reply STOP to opt out or HELP for help."]) expect(WEB_CONSENT_TRANSACTIONAL).toContain(part);
  });
  it("disclosure text is on the SMS Terms and Privacy pages", () => {
    expect(PROVIDER_DISCLOSURE).toContain("will not be shared with third parties for their own marketing purposes");
    expect(readFileSync("src/app/sms-terms/page.tsx", "utf8")).toContain("{PROVIDER_DISCLOSURE}");
    expect(readFileSync("src/app/privacy/page.tsx", "utf8")).toContain("{PROVIDER_DISCLOSURE}");
  });
});

describe("4. records kept at least 24 months (migration 0005, written not applied)", () => {
  const sql = readFileSync("drizzle/0005_sms_records_retention.sql", "utf8");
  it("adds web consent evidence columns and protects message history", () => {
    for (const col of ["ip", "user_agent", "page_url"]) expect(sql).toContain(`ALTER TABLE "sms_consents" ADD COLUMN "${col}"`);
    expect(sql).toContain("interval '24 months'");
    expect(sql).toContain('BEFORE DELETE ON "messages"');
    expect(sql).toContain('BEFORE TRUNCATE ON "messages"');
    expect(sql).toContain('BEFORE UPDATE ON "messages"');
    expect(sql).not.toMatch(/\b(DROP|DELETE FROM|ALTER COLUMN|RENAME)\b/i);
  });
  it("no code deletes messages or consent records", () => {
    for (const f of ["src/lib/sms.ts", "src/lib/sms-inbound.ts", "src/lib/sms-consent.ts", "src/app/text-alerts/actions.ts"]) {
      const s = readFileSync(f, "utf8");
      expect(s, f).not.toMatch(/delete\(schema\.(messages|smsConsents)\)/);
    }
  });
  it("is registered in the migration journal", () => {
    expect(readFileSync("drizzle/meta/_journal.json", "utf8")).toContain('"tag": "0005_sms_records_retention"');
  });
});

describe("5. opt-out requests", () => {
  it("all seven listed keywords", () => {
    expect([...OPT_OUT_KEYWORDS]).toEqual(["STOP", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "OPT OUT", "REVOKE"]);
    for (const k of OPT_OUT_KEYWORDS) expect(detectKeyword(k), k).toBe("stop");
  });
  it("other reasonable requests to stop", () => {
    for (const w of ["Don't text me anymore", "please do not text this number", "No more texts please", "remove me from your list", "take me off your list", "I don't want these messages", "wrong number stop", "leave me alone"]) {
      const d = detectKeywordDetail(w);
      expect(d.keyword, w).toBe("stop");
      expect(d.exact, w).toBe(false); // the app sends the one confirmation itself
    }
  });
  it("ordinary customer messages are not opt-outs", () => {
    for (const w of ["Can you text me the address?", "please remove the slide from my order", "don't forget the extension cord", "cancel my order", "Can we end at 7?"]) expect(detectKeyword(w), w).toBeNull();
  });
});

describe("website enrollment and SMS Terms page", () => {
  const form = readFileSync("src/app/text-alerts/SignUpForm.tsx", "utf8");
  const page = readFileSync("src/app/sms-terms/page.tsx", "utf8");
  it("two separate checkboxes, unchecked by default, with Terms and Privacy links and STOP/HELP", () => {
    expect(form.match(/type="checkbox"/g)).toHaveLength(2);
    expect(form).not.toMatch(/defaultChecked|checked=\{?true/);
    expect(form).toContain('href="/sms-terms"');
    expect(form).toContain('href="/privacy"');
    expect(form).toContain("Text HELP to");
    expect(form).toContain("Text STOP to opt out");
  });
  it("no ordering, cart or payment on the sign-up page", () => {
    const all = form + readFileSync("src/app/text-alerts/page.tsx", "utf8") + readFileSync("src/app/text-alerts/actions.ts", "utf8");
    expect(all).not.toMatch(/cart|checkout|paymentLink|reserveItem/i);
  });
  it("server requires at least one box, blocks the preview site, rate-limits and records exact wording", () => {
    const a = readFileSync("src/app/text-alerts/actions.ts", "utf8");
    expect(a).toContain("Please check at least one box");
    expect(a).toContain('process.env.VERCEL_ENV === "preview"');
    expect(a).toContain("MAX_PER_PHONE_PER_DAY");
    expect(a).toContain("wording: WEB_CONSENT_MARKETING");
    expect(a).toContain("wording: WEB_CONSENT_TRANSACTIONAL");
  });
  it("SMS Terms page covers hours, opening, keywords, frequency, rates, help, providers and records", () => {
    for (const part of ["8:00 a.m. and 9:00 p.m. in your local time zone", "{PROMO_OPENING}", "OPT_OUT_KEYWORDS", "Message frequency varies", "Message and data rates may apply", "Reply HELP", "{PROVIDER_DISCLOSURE}", "RECORD_RETENTION_MONTHS", "never a condition of purchase"])
      expect(page).toContain(part);
  });
  it("footer links to SMS Terms and the sign-up page", () => {
    const f = readFileSync("src/components/site/SiteFooter.tsx", "utf8");
    expect(f).toContain('href="/sms-terms"');
    expect(f).toContain('href="/text-alerts"');
  });
});

describe("6. written SMS compliance policy", () => {
  it("exists in the repo and covers the required topics", () => {
    const d = readFileSync("docs/sms-compliance-policy.md", "utf8");
    for (const part of ["Approved templates", "Consent", "Quiet hours", "Opt-outs", "Protecting customer information", "Training", "24 months", "Hup Up Attractions: Reply STOP to opt out."]) expect(d).toContain(part);
    expect(d).not.toMatch(/h[o0]p[\s_-]?up/i);
  });
});
