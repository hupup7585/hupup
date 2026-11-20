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
  it("name and address are never skipped: after 3 tries the caller types it on the keypad (or reaches a person)", async () => {
    const name = await call("heard", { SpeechResult: "" }, "f=name&n=2");
    expect(redirect(name)).toBe("type?f=name");
    const address = await call("heard", { SpeechResult: "" }, "f=address&n=2");
    expect(redirect(address)).toBe("type?f=address");
    expect(redirect(address)).not.toBe("phone");
  });
  it("the address leads to the optional directions step, then the email", () => {
    const flow = readFileSync("src/lib/ivr/flow.ts", "utf8");
    expect(flow).toContain('next: "directions"');
  });
});

describe("driver directions (optional)", () => {
  it("asks, saves what the caller says, then goes on to the order (no email in the booking)", async () => {
    const ask = await call("directions");
    expect(said(ask)).toContain("Is there anything our delivery team should know, like a gate code, where to park, or where to set up? Please say it now.");
    expect(said(ask)).toContain("To skip, press pound."); // the shared skip line (Nov 19, 2026)
    expect(ask).toContain("/audio/tone.wav</Play></Gather>"); // the tone after the question (Abraham, Nov 17, 2026)
    expect(redirect(ask)).toBe("finalize"); // nothing said: skipped
    const saved = await call("directions-heard", { SpeechResult: "The gate code is 1234, park in the back" });
    expect(h.session.data.directions).toBe("The gate code is 1234, park in the back");
    expect(said(saved)).toContain("Thank you, we saved that for our delivery team.");
    expect(redirect(saved)).toBe("finalize");
  });
  it("pound skips, nothing saved", async () => {
    const r = await call("directions-heard", { Digits: "#" });
    expect(h.session.data.directions).toBeUndefined();
    expect(redirect(r)).toBe("finalize");
  });
  it("live line: the step waits until Abraham approves its two lines", async () => {
    process.env.VERCEL_ENV = "production";
    expect(redirect(await call("directions"))).toBe("finalize");
  });
});

describe("no email in the booking (Abraham, Nov 17, 2026)", () => {
  it("after the name and address (and directions), straight to the order; email only for a payment link by email", async () => {
    const src = (await import("node:fs")).readFileSync("src/lib/ivr/flow.ts", "utf8");
    expect(src).not.toContain('back(vr, "ask", { f: "email" })');
    expect(src).not.toContain("emailRequired: 1");
    expect(redirect(await call("directions-heard", { Digits: "#" }))).toBe("finalize");
  });
});
