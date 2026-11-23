import { beforeAll, describe, expect, it, vi } from "vitest";

/* Abraham, Nov 22, 2026 (2:38 PM answers): box 103 keypad directions for every email typed, the address directions, the shared did-not-catch line. */
const h = vi.hoisted(() => ({
  session: { callSid: "CAecho22", fromNumber: "+18455550122", orderId: null as number | null, data: {} as Record<string, unknown>, status: "in_progress", outcome: "browsing" },
}));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/ivr/session", () => ({
  ensureSession: async () => h.session,
  getSession: async () => h.session,
  updateSession: async (_sid: string, patch: Record<string, unknown> & { data?: Record<string, unknown> }) =>
    Object.assign(h.session, { ...patch, data: { ...h.session.data, ...(patch.data ?? {}) } }),
}));
vi.mock("@/lib/ivr/prompts", async (orig) => ({ ...(await orig<typeof import("@/lib/ivr/prompts")>()), loadPromptOverrides: async () => ({}) }));
vi.mock("@/lib/business-hours", async (orig) => ({ ...(await orig<typeof import("@/lib/business-hours")>()), officeOpenNow: () => true, lateHoursToday: () => null }));
vi.mock("@/lib/notify", () => ({ sendSms: async () => ({ sent: true }), sendEmail: async () => ({ sent: true }), sendMessage: async () => ({ sent: true }) }));

import { handleVoice } from "@/lib/ivr/flow";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";

const call = (action: string, body: Record<string, string> = {}, query = "") =>
  handleVoice({ action, query: new URLSearchParams(query), body: { CallSid: h.session.callSid, ...body }, callSid: h.session.callSid, from: "+18455550122" });
const redirect = (xml: string) => xml.match(/<Redirect method="POST">([^<]+)<\/Redirect>/)?.[1].replace("https://hupup.example/api/voice/", "").replace(/&amp;/g, "&");
const said = (xml: string) => [...xml.matchAll(/<Say [^>]*>([^<]+)<\/Say>/g)].map((m) => m[1].replace(/&apos;/g, "'").replace(/&amp;/g, "&"));

describe("keypad echo, one key at a time (preview only, Nov 22, 2026)", () => {
  it("each key is said back; pressing again cycles; 1 second keeps it; star goes back one; pound finishes", async () => {
    process.env.KEYPAD_ECHO = "on";
    try {
      const start = await call("type", {}, "f=email");
      expect(start).toMatch(/<Gather [^>]*numDigits="1"/);
      const k = async (d: string) => call("kt-key", { Digits: d }, "f=name");
      const one = await k("9");
      expect(said(one)).toEqual(["W"]);
      expect(one).toMatch(/<Gather [^>]*numDigits="1"[^>]*timeout="1"/);
      expect(said(await k("9"))).toEqual(["X"]);
      expect(said(await k("9"))).toEqual(["Y"]);
      await call("kt-keep", {}, "f=name"); // 1 second with no key: Y is kept
      expect(said(await k("6"))).toEqual(["M"]);
      expect(said(await k("6"))).toEqual(["N"]);
      expect(said(await k("6"))).toEqual(["O"]);
      expect(said(await k("1"))).toEqual(["1"]); // a new key keeps O
      expect(said(await k("1"))).toEqual(["dot"]);
      await call("kt-keep", {}, "f=name");
      await k("2");
      await k("*"); // back one letter: the A being typed is gone
      expect(said(await k("4"))).toEqual(["G"]);
      const done = await k("#");
      expect(String(h.session.data.heard)).toMatch(/^yo\.g$/i);
      expect(said(done)[0]).toMatch(/^You typed: Yo\.g/i);
    } finally {
      delete process.env.KEYPAD_ECHO;
    }
  });
  it("off on the live line and in local runs: the old typing step", async () => {
    const { keypadEchoOn } = await import("@/lib/ivr/flow");
    expect(keypadEchoOn({ VERCEL_ENV: "production" })).toBe(false);
    expect(keypadEchoOn({ VERCEL_ENV: "preview" })).toBe(true);
    expect(await call("type", {}, "f=email")).toMatch(/<Gather [^>]*finishOnKey="#"/);
  });
});
