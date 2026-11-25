import { beforeEach, describe, expect, it, vi } from "vitest";

/* Checkout (Abraham, Nov 15, 2026): name, address and phone can never be skipped; optional driver directions after
   the address, pound skips. */

const h = vi.hoisted(() => ({ session: { callSid: "CAreq", fromNumber: "+18455550188", orderId: null, data: {} as Record<string, unknown>, status: "in_progress", outcome: "carted" } }));
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

import { readFileSync } from "node:fs";
import { handleVoice } from "@/lib/ivr/flow";
const call = (action: string, body: Record<string, string> = {}, query = "") =>
  handleVoice({ action, query: new URLSearchParams(query), body: { CallSid: "CAreq", ...body }, callSid: "CAreq", from: "+18455550188" });
const redirect = (xml: string) => xml.match(/<Redirect method="POST">([^<]+)<\/Redirect>/)?.[1].replace("https://hupup.example/api/voice/", "").replace(/&amp;/g, "&");
const said = (xml: string) => [...xml.matchAll(/<Say [^>]*>([^<]+)<\/Say>/g)].map((m) => m[1].replace(/&apos;/g, "'"));

beforeEach(() => {
  process.env.PUBLIC_BASE_URL = "https://hupup.example";
  delete process.env.FORWARD_PHONE;
  delete process.env.VERCEL_ENV;
  h.session.data = {};
});

describe("required details", () => {
  it("name and address are never skipped: after 3 tries, box 41 and the field's first menu again (Abraham, Nov 24, 2026)", async () => {
    const name = await call("heard", { SpeechResult: "" }, "f=name&n=2");
    expect(redirect(name)).toBe("ask?f=name");
    const address = await call("heard", { SpeechResult: "" }, "f=address&n=2");
    expect(redirect(address)).toBe("ask?f=address");
    expect(redirect(address)).not.toBe("phone");
  });
  it("the address leads to the optional directions step, then the email", () => {
    const flow = readFileSync("src/lib/ivr/flow.ts", "utf8");
    expect(flow).toContain('next: "directions"');
  });
});

describe("Box 34 delivery instructions (Abraham, Nov 21 and 24, 2026)", () => {
  it("the menu word for word: 1 records, pound or silence skips, star back to the address, wrong key not valid", async () => {
    const menu = await call("directions");
    expect(said(menu)).toEqual(["To add any special delivery instructions, press 1. To skip, press pound. To go back, press star."]);
    expect(redirect(menu)).toBe("finalize"); // silence: skip
    expect(redirect(await call("directions-choice", { Digits: "#" }))).toBe("finalize");
    expect(redirect(await call("directions-choice", { Digits: "*" }))).toBe("addr-readback");
    expect(redirect(await call("directions-choice", { Digits: "1" }))).toBe("directions-record");
    const bad = await call("directions-choice", { Digits: "5" });
    expect(said(bad)).toEqual(["Sorry, that is not a valid selection."]);
    expect(redirect(bad)).toBe("directions");
  });
  it("after key 1: the message line, the shared pound line, the tone, a recording (not transcribed) ending on pound", async () => {
    const rec = await call("directions-record");
    expect(said(rec)).toEqual(["Please leave a clear and detailed message with all your delivery instructions after the tone.", "When you are done, press pound."]);
    expect(rec).toMatch(/tone\.wav<\/Play><Record [^>]*finishOnKey="#"/);
    expect(rec).not.toContain("transcribe=");
  });
});

describe("no email in the booking (Abraham, Nov 17, 2026)", () => {
  it("after the name and address (and directions), straight to the order; email only for a payment link by email", async () => {
    const src = (await import("node:fs")).readFileSync("src/lib/ivr/flow.ts", "utf8");
    expect(src).not.toContain('back(vr, "ask", { f: "email" })');
    expect(src).not.toContain("emailRequired: 1");
    expect(redirect(await call("directions-choice", { Digits: "#" }))).toBe("finalize");
  });
});
