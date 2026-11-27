import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { PROMPTS, RETIRED_PROMPTS, type PromptDef } from "@/lib/ivr/prompts";
import { shortForm } from "@/lib/prompt-versions";
import { spokenDate } from "@/lib/ivr/flow";
import { PAYMENT_HOLD_MINUTES } from "@/lib/orders";
import { IDLE_MINUTES } from "@/lib/late-payment";

/* Payment flow and phone rules (Abraham, Nov 17, 2026): his exact wording, word for word. */
describe("the approved lines, word for word", () => {
  it("laser packs (box 25b) is live", () => {
    expect(PROMPTS.laser_packs.text).toBe("Would you like to add more laser guns? To add a six-pack laser tag for $75, press 1. To add a four-pack laser tag for $50, press 2."); // Nov 19, 2026; then the shared skip line
    expect((PROMPTS.laser_packs as PromptDef).pending).toBeUndefined();
  });
  it("payment flow, boxes 140 to 146", () => {
    expect(PROMPTS.pay_card_line.text).toBe("If you would like to pay by credit or debit card, please stay on the line. To receive a payment link instead, press 0."); // approved Nov 24, 2026
    expect(PROMPTS.pay_link_how.text).toBe("To receive the payment link by text, press 1. To receive by email, press 2.");
    expect(PROMPTS.text_which.text).toBe("To text it to the number you are calling from, press 1. To enter a different number, press 2.");
    expect(PROMPTS.text_enter.text).toBe("Please enter the 10-digit phone number. When you are finished, please press pound.");
    expect(PROMPTS.text_heard.text).toBe("I have {number}. If that is correct, press 1. To enter a different number, press 2.");
    expect(PROMPTS.pay_link_sent.text).toBe("Done! We just sent you the payment link. To keep your booking, please complete your payment within the next ten minutes. Otherwise, the booking will be released. Thank you for calling Hup Up Attractions!");
  });
  it("the old key 8 number lines and the booking email lines are no longer played", () => {
    for (const k of ["catalog_text_which", "catalog_text_enter", "catalog_text_heard", "ask_email", "ask_email_required", "phone_confirm", "phonepay_link_option"]) expect(RETIRED_PROMPTS.has(k)).toBe(true);
    const flow = readFileSync("src/lib/ivr/flow.ts", "utf8");
    for (const k of ["catalog_text_which", "catalog_text_enter", "catalog_text_heard", "phonepay_link_option", "promo_enter", "promo_heard"]) expect(flow).not.toContain(`"${k}"`);
  });
});

describe("no short forms in any phone prompt", () => {
  it("every spoken line is spelled out", () => {
    const found = Object.entries(PROMPTS)
      .filter(([, d]) => !(d as PromptDef).message)
      .map(([k, d]) => [k, shortForm(d.text)] as const)
      .filter(([, s]) => s);
    expect(found).toEqual([["cart_empty", "Let's"], ["field_unclear", "Let's"]]); // Abraham's approved exceptions (Nov 22, 2026)
  });
  it("Admin refuses a short form in a spoken line (possessives are fine)", () => {
    expect(shortForm("It's also available")).toBe("It's");
    expect(shortForm("We'll text it")).toBe("We'll");
    expect(shortForm("If that’s correct")).toBe("that’s");
    expect(shortForm("Abraham's line")).toBeNull();
  });
  it("the database wording edited in Admin is spelled out too (migration 0071)", () => {
    const sql = readFileSync("drizzle/0071_phone_rules.sql", "utf8");
    expect(sql).toContain("'it is'");
    expect(sql).toContain("'that is'");
    expect(sql).toContain("'we will'");
  });
});

describe("dates: week day, month, day in month", () => {
  it("Sunday, November twenty-second (no 22nd)", () => {
    expect(spokenDate("2026-11-22")).toBe("Sunday, November twenty-second");
    expect(spokenDate("2026-12-01")).toBe("Tuesday, December first");
  });
});

describe("payment link hold", () => {
  it("10 minutes after the link is sent, 4 more if it was opened", () => {
    expect(PAYMENT_HOLD_MINUTES).toBe(10);
    expect(IDLE_MINUTES).toBe(4);
    const flow = readFileSync("src/lib/ivr/flow.ts", "utf8");
    // the phone hold setting (10), renewed only while the items are still free (Hark's 2nd phone check, A3)
    expect(flow).toContain('const taken = await renewPaymentHold(ids, await linkHoldMinutes("phone"));');
    expect(flow).toContain('.set({ linkHoldKind: "phone", linkOpenedAt: null })');
  });
});
