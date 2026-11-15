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
    expect(verifyPhonePaySip(body)).toEqual({ orderId: 12, mainCallSid: "CAmain", cents: 23050 });
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
  });
  it("the connect line is Abraham's exact wording, named PhonePay connect, waiting until he approves the audio", () => {
    expect(PROMPTS.phonepay_intro).toMatchObject({ label: "PhonePay connect", text: "Thank you. Please hold for a moment while we connect you to our secure payment line.", pending: true });
  });
});
