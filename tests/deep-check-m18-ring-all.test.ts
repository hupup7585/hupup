import { describe, expect, it, vi } from "vitest";

/* Deep check M18 (Nov 27, 2026): "ring all": staff A pressed 2, staff B pressed 1 and talked with the caller; when that
   conversation ends the call ends (no more ringing, no voicemail). M19: card entry by keypad pauses the recording. */
const h = vi.hoisted(() => ({ session: { callSid: "CAm18", fromNumber: "+18455550618", orderId: null, data: {} as Record<string, unknown>, status: "in_progress", outcome: "browsing" } }));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/ivr/session", () => ({
  ensureSession: async () => h.session,
  getSession: async () => h.session,
  updateSession: async (_s: string, patch: { data?: Record<string, unknown> } & Record<string, unknown>) => {
    const { data, ...rest } = patch;
    Object.assign(h.session, rest);
    if (data) h.session.data = { ...h.session.data, ...data };
  },
}));

import { readFileSync } from "node:fs";
import { handleVoice } from "@/lib/ivr/flow";

const call = (action: string, body: Record<string, string> = {}, query = "") => handleVoice({ action, query: new URLSearchParams(query), body: { CallSid: "CAm18", ...body }, callSid: "CAm18", from: "+18455550618" });

describe("ring all: press 2, then someone else takes the call", () => {
  it("staff A presses 2, staff B presses 1: after the talk the call ends", async () => {
    await call("whisper-accept", { Digits: "2", ParentCallSid: "CAm18" });
    await new Promise((r) => setTimeout(r, 5));
    await call("whisper-accept", { Digits: "1", ParentCallSid: "CAm18" });
    const xml = String(await call("operator-done", { DialCallStatus: "completed" }, "k=0&i=0"));
    expect(xml).toContain("<Hangup/>");
    expect(xml).not.toContain("<Dial");
  });
  it("staff pressed 2 and no one took it: the call moves on as before", async () => {
    h.session.data = {};
    await call("whisper-accept", { Digits: "2", ParentCallSid: "CAm18" });
    const xml = String(await call("operator-done", { DialCallStatus: "completed" }, "k=0&i=0"));
    expect(xml).not.toBe("");
    expect(h.session.data.rejectedAt).toBeUndefined(); // used up
  });
  it("M19: the Stripe keypad card entry pauses the call recording first", () => {
    expect(readFileSync("src/lib/stripe-pay-voice.ts", "utf8")).toMatch(/pauseRecording\(sid\)[\s\S]*vr\.pay\(/);
  });
});
