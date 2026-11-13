import { beforeEach, describe, expect, it, vi } from "vitest";

/* Staff voicemail access from any phone (Abraham, Nov 13, 2026): preview only, every line a draft. */

const h = vi.hoisted(() => ({
  session: { callSid: "CAvma", fromNumber: "+18455550199", orderId: null, data: {} as Record<string, unknown>, status: "in_progress", outcome: "browsing" },
  emails: [] as { to: string; subject: string; body: string }[],
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
vi.mock("@/lib/notify", () => ({ sendSms: async () => ({ sent: true }), sendEmail: async (to: string, subject: string, body: string) => (h.emails.push({ to, subject, body }), { sent: true }) }));

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { handleVoice } from "@/lib/ivr/flow";
import { PROMPTS } from "@/lib/ivr/prompts";
import { lineStatus } from "@/lib/prompt-status";
import { mainBox } from "@/lib/voicemail";
import { VM_ACCESS_LIVE_APPROVED, callbackNumber, setVmPin, vmAccessActive, vmLockedUntil } from "@/lib/vm-access";

const call = (action: string, body: Record<string, string> = {}, query = "") =>
  handleVoice({ action, query: new URLSearchParams(query), body: { CallSid: "CAvma", ...body }, callSid: "CAvma", from: "+18455550199" });
const redirect = (xml: string) => xml.match(/<Redirect method="POST">([^<]+)<\/Redirect>/)?.[1].replace("https://hupup.example/api/voice/", "").replace(/&amp;/g, "&");
const said = (xml: string) => [...xml.matchAll(/<Say [^>]*>([^<]+)<\/Say>/g)].map((m) => m[1].replace(/&apos;/g, "'"));
const log = async () => (await db.select().from(schema.vmAccessLog)).map((r) => r.result);

beforeEach(async () => {
  process.env.PUBLIC_BASE_URL = "https://hupup.example";
  process.env.ADMIN_EMAIL = "owner@example.com";
  h.session.data = {};
  h.emails = [];
  await db.delete(schema.vmAccessLog);
});

describe("where it runs, and the wording", () => {
  it("preview only until Abraham approves; every new line is a draft waiting for approval", () => {
    expect(VM_ACCESS_LIVE_APPROVED).toBe(false);
    expect(vmAccessActive({ VERCEL_ENV: "production" })).toBe(false);
    expect(vmAccessActive({ VERCEL_ENV: "preview" })).toBe(true);
    const keys = Object.keys(PROMPTS).filter((k) => k.startsWith("vma_")) as (keyof typeof PROMPTS)[];
    expect(keys.length).toBeGreaterThanOrEqual(10);
    for (const k of keys) expect(lineStatus(k, {}).status, k).toBe("Waiting for approval");
  });
  it("call-backs only to US and Canada numbers, never premium", () => {
    expect(callbackNumber("+18455550123")).toBe("+18455550123");
    expect(callbackNumber("+19005550123")).toBeNull();
    expect(callbackNumber("+442071234567")).toBeNull();
    expect(callbackNumber(null)).toBeNull();
  });
});

describe("getting in", () => {
  it("7 then 4 during the greeting asks for the PIN; any other key just records; the greeting never mentions it", async () => {
    const vm = await call("voicemail", {}, "x=9");
    expect(vm).toMatch(/<Gather [^>]*numDigits="2"[^>]*action="https:\/\/hupup\.example\/api\/voice\/vm-greeting-key\?x=9"/);
    expect(said(vm).join(" ")).not.toMatch(/PIN|7|seven/i);
    expect(redirect(await call("vm-greeting-key", { Digits: "74" }, "x=9"))).toBe("vma-pin");
    expect(await call("vm-greeting-key", { Digits: "5" }, "x=9")).toContain("<Record");
  });
  it("no PIN set: refused and logged", async () => {
    const xml = await call("vma-pin");
    expect(xml).toContain("<Hangup/>");
    expect(await log()).toEqual(["no_pin"]);
  });
  it("PIN stored hashed; right PIN signs in and is logged", async () => {
    await setVmPin("4821", null);
    const [row] = await db.select().from(schema.appSettings).where(eq(schema.appSettings.key, "vm_access_pin_hash"));
    expect(String(row.value)).not.toContain("4821");
    expect(String(row.value)).toMatch(/^\$2[aby]\$/);
    expect(said(await call("vma-pin"))).toContain("Please enter your voicemail PIN, then press pound.");
    expect(redirect(await call("vma-pin-check", { Digits: "4821" }))).toBe("vma-box");
    expect(h.session.data.vmaOk).toBe(1);
    expect(await log()).toEqual(["ok"]);
  });
  it("3 wrong tries end the call, lock for 15 minutes, and email the Owner", async () => {
    await setVmPin("4821", null);
    expect(redirect(await call("vma-pin-check", { Digits: "1111" }, "t=0"))).toBe("vma-pin?t=1");
    expect(redirect(await call("vma-pin-check", { Digits: "2222" }, "t=1"))).toBe("vma-pin?t=2");
    const third = await call("vma-pin-check", { Digits: "3333" }, "t=2");
    expect(third).toContain("<Hangup/>");
    expect(await vmLockedUntil()).not.toBeNull();
    expect(h.emails).toHaveLength(1);
    expect(h.emails[0]).toMatchObject({ to: "owner@example.com", subject: "Hup Up Attractions: voicemail access locked" });
    expect(h.emails[0].body).toContain("(845) 555-0199");
    // locked: even the right PIN is refused, and logged
    expect(await call("vma-pin-check", { Digits: "4821" })).toContain("<Hangup/>");
    expect(await log()).toEqual(["wrong_pin", "wrong_pin", "wrong_pin", "locked", "refused_locked"]);
    // 15 minutes later it opens again
    expect(await vmLockedUntil(new Date(Date.now() + 16 * 60_000))).toBeNull();
  });
  it("the steps after the PIN refuse anyone not signed in on this call", async () => {
    expect(redirect(await call("vma-box-choice", { Digits: "0" }))).toBe("vma-pin");
    expect(redirect(await call("vma-choice", { Digits: "4" }, "b=1&i=0&v=1"))).toBe("vma-pin");
  });
});

describe("after the PIN", () => {
  it("choose a box, hear messages newest first with number, date and time; replay, next, mark heard, call back", async () => {
    h.session.data = { vmaOk: 1 };
    const box = await mainBox();
    const [older] = await db.insert(schema.voicemails).values({ boxId: box.id, fromNumber: "+18455550111", recordingSid: "REv1", recordingUrl: "https://api.twilio.com/x/REv1", durationSec: 9, state: "submitted", createdAt: new Date("2026-11-12T15:05:00Z") }).returning();
    const [newer] = await db.insert(schema.voicemails).values({ boxId: box.id, fromNumber: "+18455550122", recordingSid: "REv2", recordingUrl: "https://api.twilio.com/x/REv2", durationSec: 9, state: "submitted", createdAt: new Date("2026-11-13T01:00:00Z") }).returning();
    await db.insert(schema.voicemails).values({ boxId: box.id, fromNumber: "+18455550133", recordingSid: "REv3", recordingUrl: "https://api.twilio.com/x/REv3", durationSec: 9, state: "submitted", deletedAt: new Date() }); // hidden: never played

    const chose = await call("vma-box-choice", { Digits: "0" });
    expect(said(chose)).toContain("You have 2 messages, newest first.");
    expect(redirect(chose)).toBe(`vma-play?b=${box.id}&i=0`);

    const first = await call("vma-play", {}, `b=${box.id}&i=0`);
    expect(said(first)[0]).toBe("Message 1, from 8 4 5, 5 5 5, 0 1 2 2, on Thursday, November 12 at 8:00 PM.");
    expect(first).toContain(`/api/voicemail/play/${newer.id}?`);
    expect(redirect(first)).toBe(`vma-options?b=${box.id}&i=0&v=${newer.id}`);
    expect(said(await call("vma-options", {}, `b=${box.id}&i=0&v=${newer.id}`))).toContain("To replay this message, press 1. For the next message, press 2. To mark it as heard, press 3. To call this person back, press 4. To choose another box, press star.");

    expect(redirect(await call("vma-choice", { Digits: "1" }, `b=${box.id}&i=0&v=${newer.id}`))).toBe(`vma-play?b=${box.id}&i=0`);
    expect(redirect(await call("vma-choice", { Digits: "2" }, `b=${box.id}&i=0&v=${newer.id}`))).toBe(`vma-play?b=${box.id}&i=1`);
    expect(await call("vma-play", {}, `b=${box.id}&i=1`)).toContain(`/api/voicemail/play/${older.id}?`);

    await call("vma-choice", { Digits: "3" }, `b=${box.id}&i=0&v=${newer.id}`);
    const [heard] = await db.select().from(schema.voicemails).where(eq(schema.voicemails.id, newer.id));
    expect(heard.heardAt).not.toBeNull();

    const back = await call("vma-choice", { Digits: "4" }, `b=${box.id}&i=0&v=${newer.id}`);
    expect(back).toMatch(/<Dial [^>]*callerId="\+18457777585"[^>]*>\+18455550122<\/Dial>/);

    const end = await call("vma-play", {}, `b=${box.id}&i=2`);
    expect(said(end)).toContain("That was the last message. To choose another box, press star, or hang up.");
  });
  it("box by extension number: 3 is customer service (key 4); an unknown number asks again", async () => {
    h.session.data = { vmaOk: 1 };
    const none = await call("vma-box-choice", { Digits: "3" });
    expect(said(none)).toContain("There are no messages in this box.");
    expect(redirect(await call("vma-box-choice", { Digits: "7" }))).toBe("vma-box");
  });
});
