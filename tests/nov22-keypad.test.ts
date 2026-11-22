import { beforeAll, describe, expect, it, vi } from "vitest";

/* Abraham, Nov 22, 2026 (2:38 PM answers): box 103 keypad directions for every email typed, the address directions, the shared did-not-catch line. */
const h = vi.hoisted(() => ({
  session: { callSid: "CAkeys22", fromNumber: "+18455550122", orderId: null as number | null, data: {} as Record<string, unknown>, status: "in_progress", outcome: "browsing" },
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

describe("keypad typing directions (Nov 22, 2026)", () => {
  it("every email typed on the keypad plays the box 103 recording, every time (pound line inside it)", async () => {
    const { PROMPTS } = await import("@/lib/ivr/prompts");
    const help = PROMPTS.catalog_keypad_help.text;
    expect(help.startsWith("Press a key once for the first letter, twice for the second letter, and three times for the third letter.")).toBe(true);
    expect(help.endsWith("To go back one letter, press star one time. When you are done, press pound, or you can hang up.")).toBe(true);
    expect(said(await call("type", {}, "f=email"))).toEqual([help]);
    expect(said(await call("type", {}, "f=email&again=1"))).toEqual([help]);
  });
  it("the address gets its own slot: the same how-to, the space line, then the pound line", async () => {
    const { PROMPTS } = await import("@/lib/ivr/prompts");
    const a = PROMPTS.address_keypad_help.text;
    expect(a).toBe(PROMPTS.catalog_keypad_help.text.replace(" When you are done", " To add a space between words, press star twice. When you are done"));
    expect(said(await call("type", {}, "f=address"))).toEqual([a]);
    const { allSlots } = await import("@/lib/recording-slots");
    const keys = allSlots().map((x) => x.key);
    expect(keys).toContain("address_keypad_help"); // one recording, like box 103
    expect(keys).toContain("catalog_keypad_help");
    expect(keys).toContain("field_unclear");
  });
  it("one shared did-not-catch slot, with Let's allowed", async () => {
    const { PROMPTS } = await import("@/lib/ivr/prompts");
    const { LETS_ALLOWED } = await import("@/lib/prompt-versions");
    expect(PROMPTS.field_unclear.text).toBe("Sorry, I did not catch that. Let's try again.");
    expect(LETS_ALLOWED.has("field_unclear")).toBe(true);
  });
});
