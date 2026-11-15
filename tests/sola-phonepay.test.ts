import { describe, expect, it } from "vitest";
import { buildSendDigits, digitsTemplateError, easternToDate, phonePayOffered, phonePaySipUri, pickMatch, verifyPhonePaySip, type SolaTxn } from "@/lib/sola-phonepay";
import { PROMPTS } from "@/lib/ivr/prompts";

/* Sola PhonePay (Abraham, Nov 14, 2026): card by phone through Sola's free PhonePay line. */
const env = { SOLA_PHONEPAY_PIN: "4321", TWILIO_PAY_SIP_DOMAIN: "hupup-pay.sip.twilio.com", TWILIO_PAY_SIP_USERNAME: "u", TWILIO_PAY_SIP_PASSWORD: "p", ADMIN_PHONE: "+18457777585" };

describe("Sola PhonePay", () => {
  it("off by default; when on, Owner test calls only until opened to everyone", () => {
    expect(phonePayOffered("+18457777585", { solaPhonePayOn: false }, env)).toBe(false);
    expect(phonePayOffered("+18457777585", { solaPhonePayOn: true, solaPhonePayOwnerOnly: true }, env)).toBe(true);
    expect(phonePayOffered("+18455550100", { solaPhonePayOn: true, solaPhonePayOwnerOnly: true }, env)).toBe(false);
    expect(phonePayOffered("+18455550100", { solaPhonePayOn: true, solaPhonePayOwnerOnly: false }, env)).toBe(true);
    expect(phonePayOffered("+18457777585", { solaPhonePayOn: true }, { ...env, SOLA_PHONEPAY_PIN: "" })).toBe(false); // no PIN, no offer
  });
  it("digit sequence: waits, PIN, amount and order number; anything else refused", () => {
    expect(buildSendDigits("wwww{pin}#ww{amount}#{order}#", { pin: "4321", amountCents: 23050, orderNumber: "1438" })).toBe("wwww4321#ww23050#1438#");
    expect(buildSendDigits("{dollars}#", { pin: "1", amountCents: 23050, orderNumber: "1" })).toBe("230#");
    expect(digitsTemplateError("ww{pin}#")).toBeNull();
    expect(digitsTemplateError("ww{pin}#abc")).toMatch(/only numbers/);
  });
  it("the hand-over to the subaccount is signed: order, call and amount can't be changed", () => {
    process.env.AUTH_SECRET = "test-secret-phonepay-0123456789";
    const uri = phonePaySipUri(12, "CAmain", 23050, env);
    const q = new URLSearchParams(uri.split("?")[1]);
    const body = Object.fromEntries([...q.entries()].map(([k, v]) => [`SipHeader_${k}`, v]));
    expect(verifyPhonePaySip(body)).toEqual({ orderId: 12, mainCallSid: "CAmain", cents: 23050, kind: "order" });
    expect(verifyPhonePaySip({ ...body, "SipHeader_X-Hup-Cents": "100" })).toBeNull();
  });
  it("matching: order number first, else one payment of the same amount in the call window; never a guess", () => {
    const from = new Date("2026-11-16T15:00:00Z");
    const to = new Date("2026-11-16T15:06:00Z");
    const t = (ref: string, cents: number, min: number, invoice: string | null = null): SolaTxn => ({ refNum: ref, amountCents: cents, at: new Date(from.getTime() + min * 60_000), invoice, last4: "1111", cardType: "Visa", approved: true });
    const want = { amountCents: 23050, orderNumber: "1438", from, to };
    expect(pickMatch([t("A", 23050, 2)], want).reason).toBe("found");
    expect(pickMatch([t("A", 23050, 2, "1438"), t("B", 23050, 3)], want).match?.refNum).toBe("A");
    expect(pickMatch([t("A", 23050, 2), t("B", 23050, 3)], want).reason).toBe("ambiguous");
    expect(pickMatch([t("A", 9999, 2)], want).reason).toBe("amount_mismatch");
    expect(pickMatch([], want).reason).toBe("not_found");
    expect(pickMatch([t("A", 23050, 30)], want).reason).toBe("not_found"); // outside the call window
    expect(pickMatch([t("A", 23050, 2)], want, new Set(["A"])).reason).toBe("not_found"); // already used for another order
  });
  it("Sola's New York times are read with daylight saving", () => {
    expect(easternToDate("2026-11-16 10:00:00").toISOString()).toBe("2026-11-16T15:00:00.000Z");
    expect(easternToDate("2026-07-01 10:00:00").toISOString()).toBe("2026-07-01T14:00:00.000Z");
    expect(easternToDate("11/16/2026 3:04:05 PM").toISOString()).toBe("2026-11-16T20:04:05.000Z");
    expect(easternToDate("11/16/2026 12:30:00 AM").toISOString()).toBe("2026-11-16T05:30:00.000Z");
  });
  it("the connect line is Abraham's exact wording, named PhonePay connect (approved; the audio waits for his OK)", () => {
    expect(PROMPTS.phonepay_intro).toMatchObject({ label: "PhonePay connect", text: "Thank you. Please hold for a moment while we connect you to our secure payment line." });
  });
});

describe("Owner custom charge (owner voicemail menu, key 7)", () => {
  it("amount entry: dollars and cents with no point, $1.00 up to the cap; zero, over the cap and bad input refused", async () => {
    const { parseCustomAmount, amountParts } = await import("@/lib/sola-phonepay");
    expect(parseCustomAmount("12500", 500000)).toBe(12500); // $125.00
    expect(parseCustomAmount("12550", 500000)).toBe(12550); // $125.50
    expect(parseCustomAmount("100", 500000)).toBe(100); // $1.00
    expect(parseCustomAmount("99", 500000)).toBeNull(); // under $1.00
    expect(parseCustomAmount("000", 500000)).toBeNull(); // zero
    expect(parseCustomAmount("500001", 500000)).toBeNull(); // over $5,000.00
    expect(parseCustomAmount("12*5", 500000)).toBeNull();
    expect(parseCustomAmount("", 500000)).toBeNull();
    expect(amountParts(12500)).toEqual({ dollars: 125, cents: 0 });
  });
  it("read-back wording and the menu key; a custom hand-over without an order number is still signed", async () => {
    const { PROMPTS: P, fill } = await import("@/lib/ivr/prompts");
    expect(fill(P.vma_charge_readback.text, { dollars: 125, cents: 0 })).toBe("You entered 125 dollars and 0 cents. Press 1 to confirm, or 2 to enter it again.");
    expect(P.vma_box.text).toContain("To charge a custom amount, press 7.");
    process.env.AUTH_SECRET = "test-secret-phonepay-0123456789";
    const uri = phonePaySipUri(0, "CAowner", 12500, env, "custom");
    const body = Object.fromEntries([...new URLSearchParams(uri.split("?")[1]).entries()].map(([k, v]) => [`SipHeader_${k}`, v]));
    expect(verifyPhonePaySip(body)).toEqual({ orderId: 0, mainCallSid: "CAowner", cents: 12500, kind: "custom" });
    expect(verifyPhonePaySip({ ...body, "SipHeader_X-Hup-Kind": "order" })).toBeNull(); // a customer hand-over needs a real order
  });
});

describe("PhonePay hand-off matches Abraham's Nov 15 test call", () => {
  it("default digits: wait for the greeting, PIN and pound, wait, amount in cents and pound, wait, 1 to confirm; nothing after", async () => {
    const { PHONEPAY_DIGITS_DEFAULT } = await import("@/lib/sola-phonepay");
    const d = buildSendDigits(PHONEPAY_DIGITS_DEFAULT, { pin: "4321", amountCents: 80000, orderNumber: "1438" });
    expect(d).toBe("wwwwwwwwww4321#wwwwwwwwwwwwwwwwwwwwwwww80000#wwwwwwwwww1");
    expect(d.endsWith("1")).toBe(true); // the caller types the card after this
  });
  it("test list: the Owner's phone and (845) 799-0925 are offered pay by card while it is test-only; others are not", async () => {
    const { paymentTestList } = await import("@/lib/sola-phonepay");
    const { SETTING_DEFAULTS } = await import("@/lib/settings");
    const s = { solaPhonePayOn: true, solaPhonePayOwnerOnly: true, paymentTestNumbers: SETTING_DEFAULTS.paymentTestNumbers };
    expect(paymentTestList(s, env)).toEqual(["+18457777585", "+18457990925"]);
    expect(phonePayOffered("+18457990925", s, env)).toBe(true);
    expect(phonePayOffered("(845) 777-7585", s, env)).toBe(true);
    expect(phonePayOffered("+18455550100", s, env)).toBe(false);
    expect(phonePayOffered("+18457990925", { ...s, solaPhonePayOn: false }, env)).toBe(false);
  });
});
