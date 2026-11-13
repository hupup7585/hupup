import { beforeEach, describe, expect, it, vi } from "vitest";

/* Speech to text (Abraham item 11, Nov 13, 2026): preview only until he approves the price per call. */

const h = vi.hoisted(() => ({
  session: { callSid: "CAstt", fromNumber: "+18455550177", orderId: null, data: {} as Record<string, unknown>, status: "in_progress", outcome: "carted" },
  later: [] as (() => Promise<unknown>)[],
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
vi.mock("@/lib/speech-to-text", async (orig) => ({ ...(await orig<typeof import("@/lib/speech-to-text")>()), runLater: (fn: () => Promise<unknown>) => h.later.push(fn) }));

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { handleVoice } from "@/lib/ivr/flow";
import { STT_LIVE_APPROVED, STT_MAX_WAITS, recognize, sttActive, transcribeAnswer } from "@/lib/speech-to-text";

const call = (action: string, body: Record<string, string> = {}, query = "") =>
  handleVoice({ action, query: new URLSearchParams(query), body: { CallSid: "CAstt", ...body }, callSid: "CAstt", from: "+18455550177" });
const redirect = (xml: string) => xml.match(/<Redirect method="POST">([^<]+)<\/Redirect>/)?.[1].replace("https://hupup.example/api/voice/", "").replace(/&amp;/g, "&");
const said = (xml: string) => [...xml.matchAll(/<Say [^>]*>([^<]+)<\/Say>/g)].map((m) => m[1].replace(/&apos;/g, "'"));

describe("speech to text: where it runs", () => {
  it("is not approved for the live line; preview only, and only with a Google key", () => {
    expect(STT_LIVE_APPROVED).toBe(false);
    expect(sttActive({ VERCEL_ENV: "production", GOOGLE_STT_API_KEY: "k" })).toBe(false);
    expect(sttActive({ VERCEL_ENV: "preview", GOOGLE_STT_API_KEY: "k" })).toBe(true);
    expect(sttActive({ VERCEL_ENV: "preview", GOOGLE_TTS_API_KEY: "k" })).toBe(true);
    expect(sttActive({ VERCEL_ENV: "preview" })).toBe(false);
  });
});

describe("speech to text: Google request", () => {
  beforeEach(() => {
    process.env.GOOGLE_STT_API_KEY = "test-key";
  });
  it("sends the phone-call model, the hints and the audio, and joins the words", async () => {
    let sent: { url: string; body: { config: Record<string, unknown>; audio: { content: string } } } | null = null;
    const fake = (async (u: string, init: RequestInit) => {
      sent = { url: u, body: JSON.parse(String(init.body)) };
      return new Response(JSON.stringify({ results: [{ alternatives: [{ transcript: "Yossi" }] }, { alternatives: [{ transcript: " Friedman " }] }] }));
    }) as unknown as typeof fetch;
    expect(await recognize(Buffer.from("wav"), ["Friedman"], fake)).toBe("Yossi Friedman");
    expect(sent!.url).toMatch(/^https:\/\/speech\.googleapis\.com\/v1\/speech:recognize\?key=/);
    expect(sent!.body.config).toMatchObject({ languageCode: "en-US", model: "phone_call", useEnhanced: true, speechContexts: [{ phrases: ["Friedman"] }] });
    expect(sent!.body.audio.content).toBe(Buffer.from("wav").toString("base64"));
  });
  it("only ever fetches recordings from api.twilio.com, and saves the text", async () => {
    process.env.TWILIO_ACCOUNT_SID = "AC1";
    process.env.TWILIO_AUTH_TOKEN = "t";
    const hosts: string[] = [];
    const fake = (async (u: string) => {
      hosts.push(new URL(u).hostname);
      return hosts.length === 1 ? new Response(new Uint8Array([1, 2, 3])) : new Response(JSON.stringify({ results: [{ alternatives: [{ transcript: "12 Forest Road" }] }] }));
    }) as unknown as typeof fetch;
    const [row] = await db.insert(schema.spokenAnswers).values({ callSid: "CAx", field: "address", recordingUrl: "https://api.twilio.com/2010-04-01/Accounts/AC1/Recordings/RE1", durationSec: 3 }).returning();
    await transcribeAnswer(row.id, [], fake);
    const [after] = await db.select().from(schema.spokenAnswers).where(eq(schema.spokenAnswers.id, row.id));
    expect(after).toMatchObject({ status: "done", text: "12 Forest Road" });
    expect(hosts).toEqual(["api.twilio.com", "speech.googleapis.com"]);
  });
});

describe("speech to text: the call", () => {
  beforeEach(() => {
    process.env.PUBLIC_BASE_URL = "https://hupup.example";
    h.session.data = {};
    h.later = [];
  });
  it("after the recording: the soft hold clip plays and the answer is typed up in the background", async () => {
    const xml = await call("stt-recorded", { RecordingUrl: "https://api.twilio.com/2010-04-01/Accounts/AC1/Recordings/RE2", RecordingSid: "RE2", RecordingDuration: "4" }, "f=name");
    expect(xml).toContain("<Play>https://hupup.example/audio/stt-hold.wav</Play>");
    expect(h.later).toHaveLength(1);
    const a = Number(redirect(xml)!.match(/a=(\d+)/)![1]);
    expect(redirect(xml)).toBe(`stt-check?f=name&a=${a}&w=1`);
    // still being typed up: the clip again, then (after the last wait) ask again
    expect(redirect(await call("stt-check", {}, `f=name&a=${a}&w=1`))).toBe(`stt-check?f=name&a=${a}&w=2`);
    expect(redirect(await call("stt-check", {}, `f=name&a=${a}&w=${STT_MAX_WAITS}`))).toBe(`heard?f=name&a=${a}`);
    // done: the read-back line with what Google heard
    await db.update(schema.spokenAnswers).set({ status: "done", text: "yossi friedman" }).where(eq(schema.spokenAnswers.id, a));
    expect(redirect(await call("stt-check", {}, `f=name&a=${a}&w=1`))).toBe(`heard?f=name&a=${a}`);
    const back = await call("heard", {}, `f=name&a=${a}`);
    expect(said(back)).toContain("We got Yossi Friedman. If that's correct, press 1. To say it again, press 2.");
    expect(h.session.data.heard).toBe("Yossi Friedman");
  });
  it("another call's answer is never read back", async () => {
    const [row] = await db.insert(schema.spokenAnswers).values({ callSid: "CAother", field: "name", recordingUrl: "https://api.twilio.com/x", status: "done", text: "Someone Else" }).returning();
    const xml = await call("heard", {}, `f=name&a=${row.id}`);
    expect(said(xml).join(" ")).not.toContain("Someone Else");
  });
  it("star types it on the keypad; pound with nothing said skips the email; silence is 'didn't catch that'", async () => {
    expect(redirect(await call("stt-recorded", { Digits: "*", RecordingDuration: "0" }, "f=name"))).toBe("type?f=name");
    const skip = await call("stt-recorded", { Digits: "#", RecordingDuration: "0" }, "f=email");
    expect(redirect(await call("heard", {}, redirect(skip)!.split("?")[1]))).toBe("phone");
    const quiet = await call("stt-recorded", { RecordingDuration: "0" }, "f=name");
    expect(redirect(quiet)).toBe("heard?f=name&empty=1");
    expect(redirect(await call("heard", {}, "f=name&empty=1"))).toBe("ask?f=name&n=1");
  });
  it("key 8 catalog email: spoken letters are recorded and typed up the same way", async () => {
    const xml = await call("catalog-stt-recorded", { RecordingUrl: "https://api.twilio.com/2010-04-01/Accounts/AC1/Recordings/RE5", RecordingSid: "RE5", RecordingDuration: "3" }, "part=local");
    expect(xml).toContain("<Play>https://hupup.example/audio/stt-hold.wav</Play>");
    const a = Number(redirect(xml)!.match(/a=(\d+)/)![1]);
    expect(redirect(xml)).toBe(`catalog-stt-check?part=local&a=${a}&w=1`);
    await db.update(schema.spokenAnswers).set({ status: "done", text: "y o s s i" }).where(eq(schema.spokenAnswers.id, a));
    expect(redirect(await call("catalog-stt-check", {}, `part=local&a=${a}&w=1`))).toBe(`catalog-said?part=local&a=${a}`);
    expect(redirect(await call("catalog-said", {}, `part=local&a=${a}`))).toBe("catalog-got?part=local");
    expect(h.session.data.catLocal).toBe("yossi");
    // nothing said: the same step again
    expect(redirect(await call("catalog-stt-recorded", { RecordingDuration: "0" }, "part=local"))).toBe("catalog-said?part=local&empty=1");
  });
});
