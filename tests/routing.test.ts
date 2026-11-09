import { beforeEach, describe, expect, it, vi } from "vitest";

/* "Speak to someone" routing through handleVoice, on an in-memory database. Nothing is dialed for real. */
const h = vi.hoisted(() => ({
  session: { callSid: "CArt1", fromNumber: "+18455550199", orderId: null, data: {} as Record<string, unknown>, status: "in_progress", outcome: "browsing" },
  ensured: [] as string[],
}));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/ivr/session", () => ({
  ensureSession: async (sid: string) => (h.ensured.push(sid), h.session),
  getSession: async (sid: string) => (sid === "CArt1" ? h.session : null),
  updateSession: async (_sid: string, patch: Record<string, unknown>) => Object.assign(h.session, patch),
}));
vi.mock("@/lib/ivr/prompts", async (orig) => ({ ...(await orig<typeof import("@/lib/ivr/prompts")>()), loadPromptOverrides: async () => ({}) }));
vi.mock("@/lib/business-hours", async (orig) => ({ ...(await orig<typeof import("@/lib/business-hours")>()), officeOpenNow: () => true }));
vi.mock("@/lib/notify", () => ({ sendSms: async () => ({ sent: true }), sendEmail: async () => ({ sent: true }) }));

import { handleVoice } from "@/lib/ivr/flow";
import { saveSetting } from "@/lib/settings";
import { parseTargets, routeSummary, routeTargets } from "@/lib/ivr/routing";

const call = (action: string, body: Record<string, string> = {}, query = "", sid = "CArt1") =>
  handleVoice({ action, query: new URLSearchParams(query), body: { CallSid: sid, ...body }, callSid: sid, from: body.From ?? "+18455550199" });
const TARGETS = "Abraham | (845) 777-7585 | 20\nOffice | 845-555-0100 | 15\nYossi | +1 845 555 0111 | 10";

beforeEach(async () => {
  process.env.PUBLIC_BASE_URL = "https://hupup.example";
  h.ensured.length = 0;
  await saveSetting("operatorTargets", TARGETS);
  await saveSetting("operatorMode", "sequential");
  await saveSetting("operatorAcceptPrompt", true);
});

describe("routing list", () => {
  it("parses label | phone | seconds, reports bad lines, and summarizes", () => {
    const { targets, errors } = parseTargets(`${TARGETS}\nBad | 123 | 20\nSlow | 8455550122 | 200`);
    expect(targets.map((t) => [t.label, t.phone, t.ringSeconds])).toEqual([["Abraham", "+18457777585", 20], ["Office", "+18455550100", 15], ["Yossi", "+18455550111", 10]]);
    expect(errors).toHaveLength(2);
    expect(routeSummary(targets, "sequential")).toBe("Rings Abraham (20s) → Office (15s) → Yossi (10s) → voicemail");
    expect(routeSummary(targets, "simultaneous")).toBe("Rings Abraham (20s) + Office (15s) + Yossi (10s) at the same time → voicemail");
    process.env.FORWARD_PHONE = "+18457777585";
    expect(routeTargets({ operatorTargets: "" })).toEqual([{ label: "Office", phone: "+18457777585", ringSeconds: 25 }]);
    delete process.env.FORWARD_PHONE;
  });
});

describe("sequential: one after another, each must press 1", () => {
  it("rings #1 for its own time with the accept prompt, then #2, then #3, then the missed-call line and voicemail", async () => {
    const first = await call("ring", {}, "k=0");
    expect(first).toMatch(/<Dial [^>]*timeout="20"[^>]*action="[^"]*operator-done\?i=0&amp;k=0"/);
    expect(first).toContain(`<Number url="https://hupup.example/api/voice/whisper?from=%2B18455550199" method="POST">+18457777585</Number>`);
    const second = await call("operator-done", { DialCallStatus: "no-answer" }, "i=0&k=0");
    expect(second).toMatch(/timeout="15"[^>]*operator-done\?i=1&amp;k=0/);
    expect(second).toContain(">+18455550100</Number>");
    const third = await call("operator-done", { DialCallStatus: "busy" }, "i=1&k=0");
    expect(third).toContain(">+18455550111</Number>");
    const end = await call("operator-done", { DialCallStatus: "no-answer" }, "i=2&k=0");
    expect(end).toContain("Sorry, we missed your call, our team is busy helping others right now. Please leave a message after the tone and someone will get back to you shortly. Thank you and have a wonderful day!");
    expect(end).toContain("/api/voice/voicemail?after=1"); // straight to the beep
    expect(await call("operator-done", { DialCallStatus: "completed" }, "i=1&k=0")).toContain("<Hangup/>");
  });
});

describe("simultaneous: everyone at once, first to press 1 wins", () => {
  it("dials all numbers in one Dial with the longest ring time; no answer goes to the missed-call line and voicemail", async () => {
    await saveSetting("operatorMode", "simultaneous");
    const xml = await call("ring", {}, "k=0");
    expect(xml).toMatch(/<Dial [^>]*timeout="20"/);
    expect((xml.match(/<Number /g) || []).length).toBe(3);
    expect(xml).not.toContain("?i=");
    expect(await call("operator-done", { DialCallStatus: "no-answer" })).toContain("/api/voice/voicemail?after=1");
  });
});

describe("the staff member's side", () => {
  it("hears the accept prompt with the caller's number; 1 connects, 2 or silence passes; never logged as a caller", async () => {
    const w = await call("whisper", {}, "from=%2B18455550199", "CAstaffleg");
    expect(w).toContain("Call from the Hup Up Attractions hotline. To accept, press 1. To pass, press 2.");
    expect(w).toContain("The caller's number is 8 4 5 5 5 5 0 1 9 9.");
    expect(w).toMatch(/<Hangup\/><\/Response>$/);
    expect(await call("whisper-accept", { Digits: "1" }, "", "CAstaffleg")).toBe('<?xml version="1.0" encoding="UTF-8"?><Response/>');
    expect(await call("whisper-accept", { Digits: "2" }, "", "CAstaffleg")).toContain("<Hangup/>");
    expect(h.ensured).not.toContain("CAstaffleg");
  });
  it("accept prompt off: numbers ring straight through", async () => {
    await saveSetting("operatorAcceptPrompt", false);
    expect(await call("ring", {}, "k=0")).toContain("<Number>+18457777585</Number>");
  });
});

describe("pauses between menu options (Abraham)", () => {
  it("three-quarters of a second after the greeting and between options (750 ms silent clip)", async () => {
    const pause = "<Play>https://hupup.example/audio/pause-750ms.wav</Play>";
    // The greeting now opens the main menu (first pass): a pause after it and between every line, none after the last
    const xml = await call("menu", {}, "first=1");
    const menu = xml.slice(xml.indexOf("<Gather"), xml.indexOf("</Gather>"));
    const lines = (menu.match(/<Say /g) || []).length;
    expect(lines).toBeGreaterThan(1);
    expect(menu.split(pause).length - 1).toBe(lines - 1);
    expect(menu).not.toContain("<Pause");
  });
  it("the clip is exactly 0.75 seconds of silence", async () => {
    const { readFileSync } = await import("node:fs");
    const wav = readFileSync("public/audio/pause-750ms.wav");
    const rate = wav.readUInt32LE(24), bytes = wav.readUInt32LE(40), bits = wav.readUInt16LE(34);
    expect(bytes / (rate * (bits / 8))).toBe(0.75);
    expect(wav.subarray(44).every((b) => b === 0)).toBe(true);
  });
});
