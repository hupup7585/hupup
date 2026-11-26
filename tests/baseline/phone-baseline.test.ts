import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/*
 * Phase 1 baseline (Admin handoff, Abraham, Nov 26, 2026): what every phone step returns today, with no Admin
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

import { handleVoice, handlerNames } from "@/lib/ivr/flow";

/** Anything that changes from run to run (ids, signatures, times) is masked so only real behavior is compared. */
const stable = (xml: string) =>
  xml
    .replace(/([?&;](sig|exp|t|ts|token|v)=)[^&"<]+/g, "$1*")
    .replace(/\/prompt-recordings?\/[^"<?]+/g, "/prompt-recording/*")
    .replace(/CA[a-zA-Z0-9]{2,}/g, "CA*");

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2027-01-13T17:00:00Z"));
  process.env.PUBLIC_BASE_URL = "https://hupup.example";
});
afterAll(() => vi.useRealTimers());

describe("baseline: every phone step as it plays today", () => {
  const names = handlerNames().sort();
  it("the inventory of phone steps", () => {
    expect(names.length).toBeGreaterThan(100);
    expect(names).toMatchSnapshot();
  });
  for (const name of names) {
    it(name, async () => {
      h.session.data = {};
      h.session.orderId = null;
      let out: string;
      try {
        out = stable(await handleVoice({ action: name, query: new URLSearchParams(), body: { CallSid: "CAbase" }, callSid: "CAbase", from: "+18455550100" }));
      } catch (e) {
        out = `THROWS: ${(e as Error).message.split("\n")[0]}`;
      }
      expect(out).toMatchSnapshot();
    });
  }
});
