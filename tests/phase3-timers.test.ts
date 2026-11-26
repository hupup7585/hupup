import { describe, expect, it, vi } from "vitest";

/* Admin handoff Phase 3 (section 9A, Nov 26, 2026): every wait on the phone line is an Admin setting whose starting
 * value is exactly the old built-in one (the phone baseline snapshot proves no call changed); a published change
 * reaches the next call; a value outside its limits falls back to the starting value. */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/ivr/session", () => {
  const session = { callSid: "CATIME", fromNumber: "+18455550909", orderId: null, data: {}, status: "in_progress", outcome: null, startedAt: new Date() };
  return { ensureSession: async () => session, getSession: async () => session, updateSession: async () => session };
});
vi.mock("@/lib/ivr/prompts", async (orig) => ({ ...(await orig<typeof import("@/lib/ivr/prompts")>()), loadPromptOverrides: async () => ({}) }));

import { readFileSync } from "node:fs";
import { handleVoice, MENU_MIN_SECONDS, MENU_PLAYS_BEFORE_END, MENU_WAIT_SECONDS, MULTI_KEY_WAIT_SECONDS, NO_KEY_END_MS, NO_KEY_SECONDS } from "@/lib/ivr/flow";
import { PHONE_TIMERS, TIMER_DEFAULTS, timerValues } from "@/lib/ivr/timers";
import { saveSetting, SETTING_DEFAULTS } from "@/lib/settings";
import { configDef } from "@/lib/config-registry";

process.env.PUBLIC_BASE_URL = "https://hupup.example";
const call = (action: string, q = "") => handleVoice({ action, query: new URLSearchParams(q), body: { CallSid: "CATIME" }, callSid: "CATIME", from: "+18455550909" });
const timeout = (xml: string) => Number(xml.match(/<Gather [^>]*timeout="(\d+)"/)?.[1]);

describe("starting values are the old built-in values", () => {
  it("menus and no key", () => {
    expect(TIMER_DEFAULTS.timerMenuWait).toBe(String(MENU_WAIT_SECONDS));
    expect(TIMER_DEFAULTS.timerMenuPlays).toBe(String(MENU_PLAYS_BEFORE_END));
    expect(TIMER_DEFAULTS.timerMenuMinSeconds).toBe(String(MENU_MIN_SECONDS));
    expect(TIMER_DEFAULTS.timerNoKey).toBe(String(NO_KEY_SECONDS));
    expect(TIMER_DEFAULTS.timerNoKeyEnd).toBe(String(NO_KEY_END_MS / 1000));
    expect(TIMER_DEFAULTS.timerTwoDigit).toBe(String(MULTI_KEY_WAIT_SECONDS));
  });
  it("every timer is a setting with limits, a label and an explanation; no hard-coded checkout wait is left", () => {
    for (const t of PHONE_TIMERS) {
      expect((SETTING_DEFAULTS as Record<string, unknown>)[t.key], t.key).toBe(String(t.default));
      const d = configDef(t.key)!;
      expect(d).toMatchObject({ type: "int", min: t.min, max: t.max, group: "Phone: timing" });
      expect(d.explain?.what, t.key).toBeTruthy();
      expect(t.default).toBeGreaterThanOrEqual(t.min);
      expect(t.default).toBeLessThanOrEqual(t.max);
    }
    const flow = readFileSync("src/lib/ivr/flow.ts", "utf8");
    expect(flow).not.toMatch(/terms-answer[^\n]*timeout: 8/);
    expect(flow).not.toMatch(/phone-heard[^\n]*timeout: 10/);
  });
});

describe("a change reaches the next call", () => {
  it("default: 5 seconds on a screen; Admin 9: 9 seconds; back to 5", async () => {
    expect(timeout(await call("catalog"))).toBe(5);
    await saveSetting("timerNoKey" as never, "9" as never, null);
    expect(timeout(await call("catalog"))).toBe(9);
    await saveSetting("timerNoKey" as never, "5" as never, null);
    expect(timeout(await call("catalog"))).toBe(5);
  });
  it("the main menu wait", async () => {
    expect(timeout(await call("menu"))).toBe(3);
    await saveSetting("timerMenuWait" as never, "6" as never, null);
    expect(timeout(await call("menu"))).toBe(6);
    await saveSetting("timerMenuWait" as never, "3" as never, null);
  });
  it("a value outside its limits falls back to the starting value", () => {
    expect(timerValues({ timerNoKey: "0" }).timerNoKey).toBe(5);
    expect(timerValues({ timerNoKey: "abc" }).timerNoKey).toBe(5);
    expect(timerValues({ timerNoKey: "31" }).timerNoKey).toBe(5);
    expect(timerValues({ timerNoKey: "12" }).timerNoKey).toBe(12);
  });
});

describe("Admin", () => {
  it("Phone timing page, Owner only, every timer with its explanation and a Change link to All settings", () => {
    const page = readFileSync("src/app/admin/(app)/phone/timing/page.tsx", "utf8");
    expect(page).toContain("await requireOwner()");
    expect(page).toContain("PHONE_TIMERS.map");
    for (const s of ["What it does:", "Where the caller meets it:", "If you change it:", "Now:", "/admin/config"]) expect(page).toContain(s);
  });
});
