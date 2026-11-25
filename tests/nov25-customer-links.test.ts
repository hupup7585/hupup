import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { customerSafe } from "@/lib/sms";
import { paymentLink } from "@/lib/sola";
import { invoiceCustomerLink } from "@/lib/signed-link";
import { payPageLink } from "@/lib/rental-terms";
import { PROMPTS } from "@/lib/ivr/prompts";
import { SETTING_DEFAULTS } from "@/lib/settings";

/* Item 7 (Batch 4 item 1, Abraham Nov 25, 2026): no customer text or email ever holds vercel.app or dev=1; every customer
 * link uses https://hupupattractions.com from one setting; hold times 10 (phone) and 25 (Admin), never "30 minutes". */
const saved = { ...process.env };
const live = () => Object.assign(process.env, { AUTH_SECRET: process.env.AUTH_SECRET || "test-secret", VERCEL: "1", VERCEL_ENV: "production", PUBLIC_BASE_URL: "https://hupup.vercel.app", PUBLIC_SITE_URL: "", SOLA_PAYMENTSITE_NAME: "hupup" });
afterEach(() => {
  for (const k of ["VERCEL", "VERCEL_ENV", "PUBLIC_BASE_URL", "PUBLIC_SITE_URL", "SOLA_PAYMENTSITE_NAME"]) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});
const clean = (s: string) => {
  expect(decodeURIComponent(s)).not.toMatch(/vercel\.app|dev=1/);
  expect(decodeURIComponent(s)).toContain("https://hupupattractions.com");
};

describe("customer links on the live site", () => {
  it("payment page, Sola card page (its return address too), invoice: the real site, never the webhook host", () => {
    live();
    clean(payPageLink(5));
    clean(paymentLink({ orderId: 5, amountCents: 10000 })!);
    clean(invoiceCustomerLink(5));
  });
  it("no Sola page name: no link at all on the live site (never a test link)", () => {
    live();
    delete process.env.SOLA_PAYMENTSITE_NAME;
    expect(paymentLink({ orderId: 5, amountCents: 10000 })).toBeNull();
  });
  it("every outgoing text or email body: vercel.app is replaced, dev=1 is never sent", () => {
    const env = { VERCEL_ENV: "production" };
    expect(customerSafe("Pay here: https://hupup.vercel.app/pay/1005?t=x", env)).toEqual({ body: "Pay here: https://hupupattractions.com/pay/1005?t=x", blocked: false });
    expect(customerSafe("https://hupupattractions.com/paid?invoice=HU-5&dev=1", env).blocked).toBe(true);
    const src = readFileSync("src/lib/notify.ts", "utf8");
    expect(src).toContain("customerSafe(text)"); // emails go through the same check
    expect(readFileSync("src/lib/sms.ts", "utf8")).toContain("containsTestPayLink(input.body)"); // and texts
  });
});

describe("hold times in the link texts", () => {
  it("phone links 10 minutes, Admin links 25; no template says 30 minutes", () => {
    expect(SETTING_DEFAULTS.phoneLinkHoldMinutes).toBe("10");
    expect(SETTING_DEFAULTS.adminLinkHoldMinutes).toBe("25");
    expect(PROMPTS.msg_payment_link.text).toContain("within {minutes} minutes");
    for (const [k, d] of Object.entries(PROMPTS)) expect(`${k}: ${(d as { text: string }).text}`).not.toMatch(/30 minutes|thirty minutes/i);
    expect(readFileSync("src/lib/ivr/flow.ts", "utf8")).toContain('minutes: await linkHoldMinutes("phone")');
  });
});
