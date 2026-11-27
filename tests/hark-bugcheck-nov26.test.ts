import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

/* Hark's bug check (Nov 26, 2026, evening): bugs 5, 8, 12, 13 and 22. */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/ivr/prompts", async (orig) => ({ ...(await orig<typeof import("@/lib/ivr/prompts")>()), loadPromptOverrides: async () => ({}) }));

import { handleVoice } from "@/lib/ivr/flow";
const call = (action: string, body: Record<string, string> = {}, q = "") => handleVoice({ action, query: new URLSearchParams(q), body: { CallSid: "CAbugs26", ...body }, callSid: "CAbugs26", from: "+18455550191" });
const redirect = (xml: string) => xml.match(/<Redirect method="POST">([^<]+)<\/Redirect>/)?.[1].replace(/^.*\/api\/voice\//, "").replace(/&amp;/g, "&");

describe("Hark's bug check", () => {
  it("bug 5: no key on welcome back plays the no-choice line, then the same welcome back screen", async () => {
    process.env.PUBLIC_BASE_URL = "https://hupup.example";
    expect(redirect(await call("resume-choice", {}))).toBe("idle?to=resume");
  });
  it("bug 8: a wrong key on the resumed balloon keeps key 9 (ocean balls) working", async () => {
    expect(redirect(await call("resume-added-choice", { Digits: "5" }, "d=2027-01-12&o=2027-01-12"))).toContain("o=2027-01-12");
  });
  it("Abraham, Nov 27, 12:47 AM (replaces A4): star on the payment link menu plays the card offer (box 140), never 'not valid' or the empty cart", async () => {
    process.env.SOLA_PHONEPAY_PIN = "4321"; // phone card payment offered (Sola PhonePay, the default provider)
    const xml = await call("paylink-choice", { Digits: "*" }, "o=12");
    expect(xml).toContain("If you would like to pay by credit or debit card, please stay on the line.");
    expect(xml).toContain("phonepay-option?o=12");
    expect(xml).not.toContain("not a valid");
    expect(redirect(xml)).toBe("phonepay-go?o=12&c=1");
  });
  it("deep check 06:00 M6: with phone card payment not offered, star never dials Sola (not valid, then box 141 again)", async () => {
    const pin = process.env.SOLA_PHONEPAY_PIN;
    delete process.env.SOLA_PHONEPAY_PIN; // no PhonePay PIN = card on the phone not offered
    const xml = await call("paylink-choice", { Digits: "*" }, "o=12");
    process.env.SOLA_PHONEPAY_PIN = pin;
    expect(xml).not.toContain("phonepay-option");
    expect(xml).not.toContain("<Dial");
    expect(redirect(xml)).toBe("paylink?o=12");
  });
  it("bug 12: a staff phone calling in is never rung itself; bug 22: the Terms line can play its recording", () => {
    const s = readFileSync("src/lib/ivr/flow.ts", "utf8");
    expect(s).toContain("const others = list.targets.filter((t) => toE164(t.phone) !== self);");
    expect(s).toContain('sp(g, ctx, "terms_notice");');
  });
  it("deep check 06:00 M47: the ring steps leave out the caller's own staff phone (both the direct ring and the hold-music ring)", () => {
    const s = readFileSync("src/lib/ivr/flow.ts", "utf8");
    expect(s).toContain("const steps = ringSteps(list, ringAttempts(settings, k), ctx.session?.fromNumber ?? ctx.from);");
    expect(s).toContain("const steps = ringSteps(list, ringAttempts(settings, k), s.fromNumber);");
    expect(s).not.toContain("const steps = (list.mode === \"simultaneous\" ? 1 : list.targets.length)");
  });
});
