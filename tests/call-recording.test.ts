import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

/* Call recording (Abraham O): Owner switch, default OFF; notice first; nothing recorded before it. Nothing real is called. */
const h = vi.hoisted(() => ({
  session: { callSid: "CArec", fromNumber: "+18455550155", orderId: null, data: {} as Record<string, unknown>, status: "in_progress", outcome: "browsing" },
  started: [] as string[],
  role: "owner" as "owner" | "secretary",
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
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/auth", () => ({
  requireOwner: async () => {
    if (h.role !== "owner") throw new Error("NEXT_REDIRECT");
    return { userId: 1, role: "owner" };
  },
}));

import { handleVoice } from "@/lib/ivr/flow";
import { setTwilioForTests } from "@/lib/twilio-client";
import { getSettings, saveSetting } from "@/lib/settings";
import { saveRecordingAction } from "@/app/admin/(app)/settings/recording-actions";

const call = (action: string, body: Record<string, string> = {}) =>
  handleVoice({ action, query: new URLSearchParams(), body: { CallSid: "CArec", ...body }, callSid: "CArec", from: "+18455550155" });
const redirect = (xml: string) => xml.match(/<Redirect method="POST">([^<]+)<\/Redirect>/)?.[1].replace("https://hupup.example/api/voice/", "").replace(/&amp;/g, "&");
const NOTICE = "This call may be recorded for quality and training. Please don&apos;t share card numbers or security codes on this call.";

beforeEach(() => {
  process.env.PUBLIC_BASE_URL = "https://hupup.example";
  h.started.length = 0;
  h.role = "owner";
  setTwilioForTests({ calls: (sid: string) => ({ recordings: { create: async () => (h.started.push(sid), { sid: "RE1" }) } }) });
});

describe("call recording", () => {
  it("OFF by default: no notice, nothing recorded, straight to the main menu", async () => {
    expect((await getSettings()).callRecording).toBe(false);
    const xml = await call("incoming");
    expect(xml).not.toContain("recorded");
    expect(redirect(xml)).toBe("menu?first=1");
    expect(h.started).toEqual([]);
  });

  it("ON: the notice plays first; recording starts only after it; then the main menu", async () => {
    await saveSetting("callRecording", true);
    const first = await call("incoming");
    expect(first.replace(/'/g, "&apos;")).toContain(NOTICE);
    expect(redirect(first)).toBe("record-start");
    expect(h.started).toEqual([]); // nothing recorded while the notice plays
    expect(redirect(await call("record-start"))).toBe("menu?first=1");
    expect(h.started).toEqual(["CArec"]);
    await saveSetting("callRecording", false);
  });

  it("Owner switch: can't be turned on without approving the notice; Secretary can't change it; logged", async () => {
    const on = new FormData();
    on.set("callRecording", "on");
    expect((await saveRecordingAction(null, on)).ok).toBe(false);
    on.set("approveNotice", "on");
    expect((await saveRecordingAction(null, on)).ok).toBe(true);
    expect((await getSettings()).callRecording).toBe(true);
    expect((await saveRecordingAction(null, new FormData())).message).toBe("Call recording is OFF.");
    h.role = "secretary";
    await expect(saveRecordingAction(null, on)).rejects.toThrow();
    expect((await getSettings()).callRecording).toBe(false);
  });

  it("card numbers are never taken on a call (payment is a texted Sola link); a pause helper is ready if that ever changes", () => {
    const flow = readFileSync("src/lib/ivr/flow.ts", "utf8");
    expect(flow).not.toMatch(/\.pay\(|<Pay/);
    expect(readFileSync("src/lib/call-recording.ts", "utf8")).toContain('status: "paused"');
  });
});
