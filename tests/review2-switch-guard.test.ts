import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

/* Hark's Phases 1-3 review, item 9 (Nov 26, 2026): turning ON call recording, the paid Google voice, PhonePay or Stripe
 * needs a fresh code sent to the Owner plus the typed words, while the Owner safety check is on. Off is never blocked. */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
const sent: string[] = [];
vi.mock("@/lib/notify", () => ({
  sendSms: async (_to: string, text: string) => { sent.push(text); return { sent: false, dev: true }; },
  sendEmail: async () => ({ sent: false }),
}));
process.env.ADMIN_PHONE = process.env.ADMIN_PHONE || "+18455550100";

import { saveSetting, clearSettingsCache } from "@/lib/settings";
import { checkSwitchCode, requestSwitchCode, sensitiveRefusal, SENSITIVE_SWITCHES } from "@/lib/switch-guard";

const form = (code: string, typed: string) => new Map([["switchCode", code], ["switchTyped", typed]]);
async function guard(on: boolean) {
  await saveSetting("sensitiveSwitchGuard", on, null);
  clearSettingsCache();
}

describe("sensitive switch safety check", () => {
  beforeEach(() => { sent.length = 0; });

  it("with the safety check off (the default), nothing changes", async () => {
    await guard(false);
    expect(await sensitiveRefusal(1, "callRecording", true, form("", ""))).toBeNull();
  });

  it("turning off is never blocked, even with the check on", async () => {
    await guard(true);
    expect(await sensitiveRefusal(1, "callRecording", false, form("", ""))).toBeNull();
  });

  for (const sw of Object.keys(SENSITIVE_SWITCHES) as (keyof typeof SENSITIVE_SWITCHES)[]) {
    it(`${sw}: refused without a code, allowed once with the fresh code and the typed words`, async () => {
      await guard(true);
      expect(await sensitiveRefusal(1, sw, true, form("", SENSITIVE_SWITCHES[sw].phrase))).toMatch(/Ask for a new code/);
      const r = await requestSwitchCode(1, sw);
      expect(r.ok).toBe(true);
      expect(r.devCode).toMatch(/^\d{6}$/);
      expect(sent[0]).toContain("Hup Up Attractions Admin");
      expect(await sensitiveRefusal(1, sw, true, form(r.devCode!, "wrong words"))).toMatch(/Type /);
      expect(await sensitiveRefusal(1, sw, true, form(r.devCode!, SENSITIVE_SWITCHES[sw].phrase.toLowerCase()))).toBeNull();
      // the code works once
      expect(await sensitiveRefusal(1, sw, true, form(r.devCode!, SENSITIVE_SWITCHES[sw].phrase))).toMatch(/Ask for a new code/);
    });
  }

  it("a code for one switch does not turn on another", async () => {
    const r = await requestSwitchCode(1, "callRecording");
    expect(await checkSwitchCode(1, "stripeProvider", r.devCode!, "USE STRIPE")).toMatch(/Ask for a new code/);
  });

  it("five wrong codes end it; a new code is needed", async () => {
    const r = await requestSwitchCode(1, "googleLiveVoice");
    const wrong = r.devCode === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) expect(await checkSwitchCode(1, "googleLiveVoice", wrong, "TURN ON GOOGLE VOICE")).toMatch(/not right/);
    expect(await checkSwitchCode(1, "googleLiveVoice", r.devCode!, "TURN ON GOOGLE VOICE")).toMatch(/Too many/);
  });

  it("the guard is wired into every switch's save, and the Admin setting is explained and off by default", () => {
    expect(readFileSync("src/app/admin/(app)/settings/recording-actions.ts", "utf8")).toContain('sensitiveRefusal(owner.userId ?? null, "callRecording"');
    expect(readFileSync("src/app/admin/(app)/phone/prompts/slots/actions.ts", "utf8")).toContain('"googleLiveVoice", on && !was');
    const pp = readFileSync("src/app/admin/(app)/phone/phonepay/actions.ts", "utf8");
    expect(pp).toContain('"solaPhonePayOn", payOn');
    expect(pp).toContain('"stripeProvider", stripeOn');
    expect(readFileSync("src/lib/settings.ts", "utf8")).toContain("sensitiveSwitchGuard: false");
    expect(readFileSync("src/lib/config-explanations.ts", "utf8")).toContain("sensitiveSwitchGuard");
  });
});
