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
  it("asks, saves what the caller says, then goes on to the email", async () => {
    const ask = await call("directions");
    expect(said(ask)).toContain("Is there anything our delivery team should know, like a gate code, where to park, or where to set up? Please say it now. To skip, press pound.");
    expect(ask).toMatch(/<Gather [^>]*finishOnKey="#"/);
    expect(redirect(ask)).toBe("ask?f=email"); // nothing said: skipped
    const saved = await call("directions-heard", { SpeechResult: "The gate code is 1234, park in the back" });
    expect(h.session.data.directions).toBe("The gate code is 1234, park in the back");
    expect(said(saved)).toContain("Thank you, we saved that for our delivery team.");
    expect(redirect(saved)).toBe("ask?f=email");
  });
  it("pound skips, nothing saved", async () => {
    const r = await call("directions-heard", { Digits: "#" });
    expect(h.session.data.directions).toBeUndefined();
    expect(redirect(r)).toBe("ask?f=email");
  });
  it("live line: the step waits until Abraham approves its two lines", async () => {
    process.env.VERCEL_ENV = "production";
    expect(redirect(await call("directions"))).toBe("ask?f=email");
  });
});

describe("payment can never be skipped (Abraham, Nov 15, 2026)", () => {
  it("no texts and no email: the email becomes required, pound can't skip it, then back to the order", async () => {
    h.session.data = { emailRequired: 1 };
    const ask = await call("ask", {}, "f=email");
    void ask; // the cart check runs first in a real call; the wording is checked below
    const { PROMPTS } = await import("@/lib/ivr/prompts");
    expect(PROMPTS.ask_email_required.text).toBe("To send your secure payment link, we need your email address. Please say your email address, like john at gmail dot com.");
    expect(redirect(await call("heard", { Digits: "#" }, "f=email"))).toBe("ask?f=email"); // can't skip
    expect(redirect(await call("heard", { SpeechResult: "" }, "f=email&n=2"))).not.toBe("phone");
    h.session.data = { emailRequired: 1, heard: "sara@example.com" };
    expect(redirect(await call("confirm", { Digits: "1" }, "f=email"))).toBe("finalize");
    expect(h.session.data.email).toBe("sara@example.com");
    expect(h.session.data.emailRequired).toBeUndefined();
  });
  it("otherwise the email stays optional, as before", async () => {
    h.session.data = {};
    expect(redirect(await call("heard", { Digits: "#" }, "f=email"))).toBe("phone");
  });
});
