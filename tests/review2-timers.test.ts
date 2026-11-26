import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

/* Hark's Phases 1-3 review, item 5 (Nov 26, 2026): every wait on the phone line is a timer in Admin (Phone timing),
 * starting at exactly today's value; the star 7 4 voicemail reads its own timers. */
const h = vi.hoisted(() => ({ session: { callSid: "CATIMER", fromNumber: "+18455550901", orderId: null, data: {} as Record<string, unknown>, status: "in_progress", outcome: null, startedAt: new Date() } }));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/ivr/session", () => ({
  ensureSession: async () => h.session,
  getSession: async () => h.session,
  updateSession: async (_s: string, patch: Record<string, unknown> & { data?: Record<string, unknown> }) => Object.assign(h.session, { ...patch, data: { ...h.session.data, ...(patch.data ?? {}) } }),
}));
vi.mock("@/lib/ivr/prompts", async (orig) => ({ ...(await orig<typeof import("@/lib/ivr/prompts")>()), loadPromptOverrides: async () => ({}) }));

import { handleVoice } from "@/lib/ivr/flow";
import { PHONE_TIMERS } from "@/lib/ivr/timers";
import { clearSettingsCache, saveSetting } from "@/lib/settings";

const call = (action: string) => handleVoice({ action, query: new URLSearchParams(), body: { CallSid: "CATIMER" }, callSid: "CATIMER", from: "+18455550901" });
const timeoutOf = (xml: string) => xml.match(/<Gather [^>]*timeout="(\d+)"/)?.[1];

describe("every phone wait is an Admin timer", () => {
  it("no fixed number of seconds is left in the phone steps (except the payment line's one-second polling)", () => {
    const allow = [/vr\.pause\(\{ length: 1 \}\);\n\s*return back\(vr, "pay-leg-wait"/]; // the hold line checks every second while the card line connects: not a wait the caller feels
    for (const f of ["src/lib/ivr/flow.ts", "src/lib/ivr/vmail.ts"]) {
      let s = readFileSync(f, "utf8");
      for (const a of allow) s = s.replace(a, "");
      expect(s.match(/\b(timeout|maxLength): \d+/g), f).toBeNull();
      expect(s.match(/maxLength = \d+/g), f).toBeNull();
      expect(s.match(/pause\(\{ length: \d+ \}\)/g), f).toBeNull();
    }
  });
  it("the new timers start at exactly today's values, with plain-English help", () => {
    const want: Record<string, number> = { timerSpeechWait: 7, timerSpokenSilence: 3, timerHeardKey: 1, timerClosedKey: 1, timerCsClosedKey: 1, timerNoMusicPause: 8, timerCatalogKey: 3, timerCatalogRecordMax: 15, timerCatalogRecordSilence: 3, timerCatalogSpeech: 6, timerSecondOffer: 5, timerSecondOfferAgain: 4, timerPhonePayOption: 5, timerPhonePayRetry: 1, timerVmNoKey: 5, timerVmPlaybackKey: 1, timerVmPauseKey: 30, timerVmNoteKey: 4, timerVmGreetingMax: 180 };
    for (const [k, v] of Object.entries(want)) {
      const t = PHONE_TIMERS.find((x) => x.key === k)!;
      expect(t, k).toBeTruthy();
      expect(t.default, k).toBe(v);
      expect(t.min <= v && v <= t.max, k).toBe(true);
      for (const part of [t.what, t.where, t.ifChanged]) expect(part.length, k).toBeGreaterThan(20);
    }
  });
  it("the older staff voicemail timers say they cover only the older password steps", () => {
    expect(PHONE_TIMERS.find((x) => x.key === "timerStaffMenus")!.label).toContain("older staff menu");
  });
  it("changing the star 7 4 menu timer in Admin changes that menu's wait", async () => {
    process.env.VM_ACCESS_ON = "1";
    const before = timeoutOf(await call("vm-num"));
    expect(before).toBe("5");
    await saveSetting("timerVmNoKey" as never, 12 as never, null);
    clearSettingsCache();
    expect(timeoutOf(await call("vm-num"))).toBe("12");
  });
});

describe("the Phone timing page", () => {
  it("lists what is fixed for safety and the handoff items not built yet", () => {
    const p = readFileSync("src/app/admin/(app)/phone/timing/page.tsx", "utf8");
    expect(p).toContain("data-timers-locked");
    expect(p).toContain("Needs Claude to connect");
    expect(p.match(/<li>/g)!.length).toBeGreaterThanOrEqual(8);
  });
});

describe("item 6, until the staff-wait music is connected", () => {
  it("the staff accept timer says the caller hears ringing, not hold music", () => {
    const t = PHONE_TIMERS.find((x) => x.key === "timerStaffAccept")!;
    expect(t.where).toContain("The caller hears ringing");
    expect(t.where).not.toContain("hold music meanwhile");
  });
});
