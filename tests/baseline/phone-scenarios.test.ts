import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/*
 * Scenario baseline (Hark's Phases 1-3 review, M9, Nov 26, 2026): what the phone does at the moments that change its
 * behavior, from the same harness as the Phase 1 baseline. Earlier note: Phase 1 baseline (Admin handoff, Abraham, Nov 26, 2026): what every phone step returns today, with no Admin
 * setting changed. Each later phase must leave these snapshots unchanged unless a setting is deliberately changed
 * (baseline parity). Fixed moment: Wednesday, January 13, 2027, 12:00 PM New York time (an ordinary open weekday).
 */
const h = vi.hoisted(() => ({
  session: { callSid: "CAbase", fromNumber: "+18455550100", orderId: null as number | null, data: {} as Record<string, unknown>, status: "in_progress", outcome: "browsing", startedAt: new Date("2027-01-13T17:00:00Z") },
}));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("../helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/ivr/session", () => ({
  ensureSession: async () => h.session,
  getSession: async () => h.session,
  updateSession: async () => h.session,
}));
vi.mock("@/lib/ivr/prompts", async (orig) => ({ ...(await orig<typeof import("@/lib/ivr/prompts")>()), loadPromptOverrides: async () => ({}) }));
vi.mock("@/lib/notify", () => ({ sendSms: async () => ({ sent: true }), sendEmail: async () => ({ sent: true }) }));
vi.mock("@/lib/twilio-client", () => ({ getTwilio: () => null }));

import { handleVoice } from "@/lib/ivr/flow";
import { RING_KEYS } from "@/lib/ivr/routing";

/** Anything that changes from run to run (ids, signatures, times) is masked so only real behavior is compared. */
const stable = (xml: string) =>
  xml
    .replace(/([?&;](sig|exp|t|ts|token|v)=)[^&"<]+/g, "$1*")
    .replace(/\/prompt-recordings?\/[^"<?]+/g, "/prompt-recording/*")
    .replace(/CA[a-zA-Z0-9]{2,}/g, "CA*");

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });

  process.env.PUBLIC_BASE_URL = "https://hupup.example";
});
afterAll(() => {
  vi.useRealTimers();
  process.env.HUP_CALENDAR_NOW = "2026-11-17T17:00:00Z";
});


/** Moments in New York time (January 2027, standard time: add 5 hours for UTC). */
const MOMENTS: [string, string][] = [
  ["weekday noon (open)", "2027-01-13T17:00:00Z"],
  ["weekday 11 PM (after hours)", "2027-01-14T04:00:00Z"],
  ["Friday 10 AM (before Chatzos)", "2027-01-15T15:00:00Z"],
  ["Friday 1:30 PM (after Chatzos, before candle lighting)", "2027-01-15T18:30:00Z"],
  ["Friday 4:45 PM (Shabbes has started)", "2027-01-15T21:45:00Z"],
  ["Shabbes noon", "2027-01-16T17:00:00Z"],
  ["Motzei Shabbes 5:30 PM (before reopening)", "2027-01-16T22:30:00Z"],
  ["Motzei Shabbes 9 PM (after reopening)", "2027-01-17T02:00:00Z"],
];
const run = async (action: string, q = "") => {
  h.session.data = {};
  h.session.orderId = null;
  try {
    return stable(await handleVoice({ action, query: new URLSearchParams(q), body: { CallSid: "CAbase" }, callSid: "CAbase", from: "+18455550100" }));
  } catch (e) {
    return `THROWS: ${(e as Error).message.split("\n")[0]}`;
  }
};

describe("scenarios: the phone at the moments that change what it does", () => {
  for (const [label, at] of MOMENTS) {
    it(label, async () => {
      vi.setSystemTime(new Date(at));
      process.env.HUP_CALENDAR_NOW = at;
      const out: Record<string, string> = { incoming: await run("incoming"), menu: await run("menu") };
      for (const k of RING_KEYS) out[`ring ${k}`] = await run("ring", `k=${k}`);
      expect(out).toMatchSnapshot();
    });
  }
});
