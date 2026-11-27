import { beforeAll, describe, expect, it, vi } from "vitest";

/* Hold music while staff are rung (Abraham, Nov 27, 2026, 1:20 AM; Owner switch): the caller waits in a private queue
   hearing the staff-wait songs; staff phones are called; press 1 joins them; nobody answers -> the line's voicemail. */
const h = vi.hoisted(() => ({
  created: [] as { to: string; url: string; statusCallback: string }[],
  updated: [] as { sid: string; body: Record<string, unknown> }[],
  session: { callSid: "CAhold", fromNumber: "+18455550616", orderId: null as number | null, data: {} as Record<string, unknown>, status: "in_progress", outcome: "browsing" },
}));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/ivr/session", () => ({
  ensureSession: async () => h.session,
  getSession: async (sid: string) => (sid === "CAhold" ? h.session : null),
  updateSession: async (_s: string, patch: Record<string, unknown> & { data?: Record<string, unknown> }) => Object.assign(h.session, { ...patch, data: { ...h.session.data, ...(patch.data ?? {}) } }),
}));
vi.mock("@/lib/ivr/prompts", async (orig) => ({ ...(await orig<typeof import("@/lib/ivr/prompts")>()), loadPromptOverrides: async () => ({}) }));
vi.mock("@/lib/hours-schedule", async (orig) => ({ ...(await orig<typeof import("@/lib/hours-schedule")>()), lineOpen: () => true, effectiveLine: () => ({ on: true, schedule: {} }) }));
vi.mock("@/lib/business-hours", async (orig) => ({ ...(await orig<typeof import("@/lib/business-hours")>()), officeOpenNow: () => true }));
vi.mock("@/lib/jewish-calendar", async (orig) => ({ ...(await orig<typeof import("@/lib/jewish-calendar")>()), isShabbosOrYomTov: () => false, erevCandleLighting: () => null }));
vi.mock("@/lib/twilio-client", () => ({
  getTwilio: () => ({
    calls: Object.assign((sid: string) => ({ update: async (body: Record<string, unknown>) => (h.updated.push({ sid, body }), {}) }), {
      create: async (p: { to: string; url: string; statusCallback: string }) => (h.created.push(p), { sid: `CAstaff${h.created.length}` }),
    }),
  }),
}));

import { db, schema } from "@/lib/db";
import { saveSetting } from "@/lib/settings";
import { handleVoice } from "@/lib/ivr/flow";

const call = (action: string, body: Record<string, string> = {}, q = "", sid = "CAhold") => handleVoice({ action, query: new URLSearchParams(q), body: { CallSid: sid, ...body }, callSid: sid, from: "+18455550616" });

beforeAll(async () => {
  process.env.PUBLIC_BASE_URL = "https://hupup.example";
  process.env.TWILIO_PHONE_NUMBER = "+18454157585";
  await db.insert(schema.musicTracks).values({ name: "2 Phone Holding Music", pieces: 3, pieceSeconds: 8, complete: true });
  await saveSetting("staffHoldMusicOn", true);
  await saveSetting("ringTargets0" as never, "Office | +18455550101 | 20" as never);
  await saveSetting("ringMode0" as never, "sequential" as never);
  await saveSetting("ringAttempts0" as never, "1" as never);
  // the caller's session row (the staff legs and who took the call are saved on it in one database step)
  await db.insert(schema.callSessions).values({ callSid: "CAhold", fromNumber: "+18455550616" });
});

describe("hold music while staff are rung", () => {
  it("key 0: the connecting line, then the queue with music; the staff phone is called", async () => {
    const xml = await call("ring", {}, "k=0");
    expect(xml).toContain("One moment, please. We are connecting you to our team.");
    expect(xml).toMatch(/<Enqueue [^>]*waitUrl="[^"]*staff-hold\?k=0"[^>]*>staff-CAhold<\/Enqueue>/);
    expect(h.created).toHaveLength(1);
    expect(h.created[0].url).toContain("/staff-leg?c=CAhold&k=0"); // the operator list's first number
    const music = await call("staff-hold", { QueueTime: "5" }, "k=0");
    expect(music).toMatch(/<Play>[^<]*\/api\/music\/music\/\d+\/0\.wav<\/Play>/);
  });
  it("press 1 joins the caller; nobody answers: the caller goes to the line's voicemail", async () => {
    const take = await call("staff-leg-accept", { Digits: "1" }, "c=CAhold&k=0", "CAstaff1");
    expect(take).toContain("<Queue>staff-CAhold</Queue>");
    // a new caller, nobody answers
    h.session.data = {};
    h.created.length = 0;
    await call("ring", {}, "k=0");
    await call("staff-leg-status", { CallStatus: "no-answer" }, "c=CAhold&k=0&i=0", "CAstaff1");
    expect(h.updated.some((u) => u.sid === "CAhold" && String(u.body.url).includes("/voicemail?x=0"))).toBe(true);
  });
});

describe("deep check 06:00 M42, M43", () => {
  it("two staff pressing 1 at the same moment: one gets the caller, only the other is hung up", async () => {
    const { eq } = await import("drizzle-orm");
    await db.update(schema.callSessions).set({ data: {} }).where(eq(schema.callSessions.callSid, "CAhold"));
    h.session.data = {};
    const [a, b] = await Promise.all([
      call("staff-leg-accept", { Digits: "1" }, "c=CAhold&k=0", "CAstaffA"),
      call("staff-leg-accept", { Digits: "1" }, "c=CAhold&k=0", "CAstaffB"),
    ]);
    expect([a, b].filter((x) => x.includes("<Queue>staff-CAhold</Queue>"))).toHaveLength(1);
    expect([a, b].filter((x) => x.includes("<Hangup/>"))).toHaveLength(1);
  });
  it("a new ring round is saved on the session as it is now (one database step), never from an older copy", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/lib/ivr/flow.ts", "utf8").split("async function startStaffLegs")[1].split("\n}\n")[0];
    expect(src).toContain("jsonb_build_object('staffLegs'");
    expect(src).not.toContain("updateSession(callerSid, { data: { staffLegs");
  });
});

