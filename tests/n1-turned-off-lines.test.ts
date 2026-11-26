import { beforeEach, describe, expect, it, vi } from "vitest";

/* Hark, Nov 26, 2026, 3:56 PM, Priority 1 (review finding N1): a line the Owner turned off in Admin never plays, alone
 * or inside a combined recording. A combined recording that holds a turned-off line is not played; the lines still on
 * play one by one (their recording if any, else the live voice). Checked on a real phone step (the unit number). */
const h = vi.hoisted(() => ({
  session: { callSid: "CAN1", fromNumber: "+18455550701", orderId: null as number | null, data: {} as Record<string, unknown>, status: "in_progress", outcome: null, startedAt: new Date() },
  overrides: {} as Record<string, unknown>,
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
vi.mock("@/lib/ivr/prompts", async (orig) => ({ ...(await orig<typeof import("@/lib/ivr/prompts")>()), loadPromptOverrides: async () => h.overrides }));

import { handleVoice } from "@/lib/ivr/flow";
import { PROMPTS, lineSetFingerprint } from "@/lib/ivr/prompts";
import { saveSetting } from "@/lib/settings";

const call = (action: string) => handleVoice({ action, query: new URLSearchParams(), body: { CallSid: "CAN1" }, callSid: "CAN1", from: "+18455550701" });
const said = (xml: string) => [...xml.matchAll(/<Say [^>]*>([^<]+)<\/Say>/g)].map((m) => m[1].replace(/&apos;/g, "'"));
const plays = (xml: string, id: number) => new RegExp(`<Play>[^<]*\\b${id}\\b[^<]*</Play>`).test(xml);
const COMBINED = 9101;
const UNIT_REC = 9102;
const layout = async (on: Record<string, boolean>) =>
  saveSetting("screenEditor" as never, { layouts: { addr_unit: ["addr_unit", "pound_done", "star"].map((ref) => ({ ref, on: on[ref] ?? true })) }, extra: {}, keys: {} } as never, null);

beforeEach(async () => {
  process.env.PUBLIC_BASE_URL = "https://hupup.example";
  h.overrides = {};
  h.overrides = { whole_addr_unit: { text: null, audioUrl: null, recordingId: COMBINED, lineSet: lineSetFingerprint("addr_unit", {}) } };
  await layout({});
});

describe("N1: turned-off lines never play", () => {
  it("nothing turned off: the combined recording plays, as today", async () => {
    const x = await call("addr-unit");
    expect(plays(x, COMBINED)).toBe(true);
    expect(said(x)).not.toContain(PROMPTS.addr_unit.text);
  });
  it("a piece turned off inside the combined recording: the combined recording is not played; the other lines play one by one", async () => {
    await layout({ pound_done: false });
    const x = await call("addr-unit");
    expect(plays(x, COMBINED)).toBe(false);
    expect(said(x).join(" ")).toContain(PROMPTS.addr_unit.text); // still on: the live voice (no recording)
    expect(said(x).join(" ")).not.toContain(PROMPTS.pound_done.text); // turned off: never
  });
  it("a line still on uses its own recording when it has one", async () => {
    await layout({ pound_done: false });
    h.overrides = { ...h.overrides, addr_unit: { text: null, audioUrl: null, recordingId: UNIT_REC } };
    const x = await call("addr-unit");
    expect(plays(x, UNIT_REC)).toBe(true);
    expect(plays(x, COMBINED)).toBe(false);
  });
  it("a single line turned off: it never plays (alone)", async () => {
    h.overrides = {}; // no combined recording
    await layout({ addr_unit: false });
    const x = await call("addr-unit");
    expect(said(x).join(" ")).not.toContain(PROMPTS.addr_unit.text);
    expect(said(x).join(" ")).toContain(PROMPTS.pound_done.text);
  });
  it("every piece turned off: nothing from them plays, and not the combined recording", async () => {
    await layout({ addr_unit: false, pound_done: false, star: false });
    const x = await call("addr-unit");
    expect(plays(x, COMBINED)).toBe(false);
    expect(said(x).join(" ")).not.toContain(PROMPTS.addr_unit.text);
    expect(said(x).join(" ")).not.toContain(PROMPTS.pound_done.text);
  });
});
