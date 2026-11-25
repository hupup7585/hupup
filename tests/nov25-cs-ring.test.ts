import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/* Item 5 (Abraham, Nov 25, 2026, 4:14-4:15 PM): customer service rings three full calls of 25 seconds; a call that ends
 * early (rejected, key 2, busy, failed) is waited out with the same ringing until its 25 seconds, then a new call. */
const h = vi.hoisted(() => ({
  session: { callSid: "CAcsring", fromNumber: "+18455550146", orderId: null as number | null, data: {} as Record<string, unknown>, status: "in_progress", outcome: "browsing", startedAt: new Date() },
}));
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
vi.mock("@/lib/notify", () => ({ sendSms: async () => ({ sent: true }), sendEmail: async () => ({ sent: true }) }));

import { handleVoice } from "@/lib/ivr/flow";
import { saveSetting } from "@/lib/settings";

const call = (action: string, body: Record<string, string> = {}, q: Record<string, string> = {}) =>
  handleVoice({ action, query: new URLSearchParams(q), body: { CallSid: "CAcsring", ...body }, callSid: "CAcsring", from: "+18455550146" });
const redirect = (xml: string) => xml.match(/<Redirect method="POST">([^<]+)<\/Redirect>/)?.[1].replace(/^.*\/api\/voice\//, "").replace(/&amp;/g, "&");
const dials = (xml: string) => (xml.match(/<Dial /g) ?? []).length;
const plays = (xml: string) => [...xml.matchAll(/<Play>[^<]*\/audio\/(ring-(?:on|off)-1s)\.wav<\/Play>/g)].map((m) => m[1]);
const T0 = new Date("2026-12-01T17:00:00Z").getTime(); // Tuesday noon: customer service open
const at = (sec: number) => vi.setSystemTime(new Date(T0 + sec * 1000));

beforeAll(async () => {
  process.env.PUBLIC_BASE_URL = "https://hupup.example";
  vi.useFakeTimers({ toFake: ["Date"] });
  await saveSetting("ringTargets4", "Sara | +18455550123 | 25");
  await saveSetting("ringAttempts4", "3");
});
beforeEach(() => {
  h.session.data = {};
  at(0);
});

describe("customer service: three full 25-second calls", () => {
  it("rejected at 3 seconds on call 1: ringing until 25 seconds, then call 2", async () => {
    const first = await call("ring", {}, { k: "4" });
    expect(dials(first)).toBe(1);
    expect(first).toContain("timeout=\"25\"");
    at(3);
    h.session.data.rejectedAt = Date.now();
    const wait = await call("operator-done", { DialCallStatus: "completed" }, { i: "0", k: "4" });
    expect(dials(wait)).toBe(0);
    expect(plays(wait)).toHaveLength(22); // seconds 3 to 25, no silence gaps beyond the ringing pattern
    expect(plays(wait)[0]).toBe("ring-off-1s"); // second 3 of the 2-on, 4-off pattern
    expect(redirect(wait)).toBe("operator-done?i=0&k=4&w=1&r=1");
    at(25);
    const second = await call("operator-done", {}, { i: "0", k: "4", w: "1" });
    expect(dials(second)).toBe(1);
    expect(second).toMatch(/operator-done\?i=1&amp;k=4/);
  });
  it("busy at 5 seconds: the same wait", async () => {
    await call("ring", {}, { k: "4" });
    at(5);
    const wait = await call("operator-done", { DialCallStatus: "busy" }, { i: "0", k: "4" });
    expect(plays(wait)).toHaveLength(20);
    expect(redirect(wait)).toBe("operator-done?i=0&k=4&w=1");
  });
  it("no answer on all three: exactly three calls, then the customer service voicemail at about 75 seconds", async () => {
    let xml = await call("ring", {}, { k: "4" });
    let n = dials(xml);
    for (let i = 0; i < 3; i++) {
      at(25 * (i + 1));
      xml = await call("operator-done", { DialCallStatus: "no-answer" }, { i: String(i), k: "4" });
      n += dials(xml);
      expect(plays(xml)).toHaveLength(0); // a full call: no waiting
    }
    expect(n).toBe(3);
    expect(redirect(xml)).toBe("voicemail?x=4");
  });
  it("answered (staff pressed 1) on call 3: connected, no more calls; on call 1: the same", async () => {
    await call("ring", {}, { k: "4" });
    at(10);
    const done = await call("operator-done", { DialCallStatus: "completed" }, { i: "2", k: "4" });
    expect(done).toContain("<Hangup/>");
    expect(dials(done)).toBe(0);
  });
  it("Admin: 20 seconds and 2 calls change the timing and the count", async () => {
    await saveSetting("ringTargets4", "Sara | +18455550123 | 20");
    await saveSetting("ringAttempts4", "2");
    const first = await call("ring", {}, { k: "4" });
    expect(first).toContain("timeout=\"20\"");
    at(4);
    const wait = await call("operator-done", { DialCallStatus: "failed" }, { i: "0", k: "4" });
    expect(plays(wait)).toHaveLength(16);
    at(20);
    expect(dials(await call("operator-done", {}, { i: "0", k: "4", w: "1" }))).toBe(1);
    at(40);
    expect(redirect(await call("operator-done", { DialCallStatus: "no-answer" }, { i: "1", k: "4" }))).toBe("voicemail?x=4");
    await saveSetting("ringTargets4", "Sara | +18455550123 | 25");
    await saveSetting("ringAttempts4", "3");
  });
  it("other lines are unchanged: an early end moves on right away", async () => {
    await saveSetting("ringTargets5", "Moshe | +18455550124 | 25");
    await call("ring", {}, { k: "5" });
    at(3);
    const next = await call("operator-done", { DialCallStatus: "busy" }, { i: "0", k: "5" });
    expect(plays(next)).toHaveLength(0);
  });
});
