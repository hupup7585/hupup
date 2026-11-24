import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/* Box 40 and box 41 (Abraham, Nov 24, 2026). In-memory database. */
const h = vi.hoisted(() => ({
  session: { callSid: "CAb4041", fromNumber: "+18455550199", orderId: null as number | null, data: {} as Record<string, unknown>, status: "in_progress", outcome: "browsing", startedAt: new Date() },
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

import { handleVoice } from "@/lib/ivr/flow";
import { PROMPTS } from "@/lib/ivr/prompts";

const call = (action: string, body: Record<string, string> = {}, q = "") =>
  handleVoice({ action, query: new URLSearchParams(q), body: { CallSid: "CAb4041", ...body }, callSid: "CAb4041", from: "+18455550199" });
const said = (xml: string) => [...xml.matchAll(/<Say [^>]*>([^<]+)<\/Say>/g)].map((m) => m[1].replace(/&apos;/g, "'"));
const redirect = (xml: string) => xml.match(/<Redirect method="POST">([^<]+)<\/Redirect>/)?.[1].replace(/^.*\/api\/voice\//, "").replace(/&amp;/g, "&");

beforeAll(async () => {
  process.env.PUBLIC_BASE_URL = "https://hupup.example";
  process.env.FORWARD_PHONE = "+18457777585"; // a person is set up, and still never rung from box 41
});
beforeEach(() => {
  h.session.data = { name: "Sara Klein" };
});

describe("box 40: skipping the email", () => {
  it("goes straight to the texting number step with no line in between", async () => {
    const x = await call("heard", { SpeechResult: "" }, "f=email&n=1");
    expect(said(x)).toEqual([]);
    expect(x).not.toContain("skip the email");
    expect(redirect(x)).toBe("phone");
  });
});

describe("box 41: I am having a little trouble hearing you", () => {
  for (const f of ["name", "email", "address", "unit", "directions"]) {
    it(`${f}: the line, then the field's first menu (say it again or 9 to type); no person, no typing on its own`, async () => {
      if (f === "email") h.session.data.emailRequired = true;
      const x = await call("heard", { SpeechResult: "" }, `f=${f}&n=2`);
      expect(said(x)).toEqual([PROMPTS.field_trouble.text]);
      expect(redirect(x)).toBe(`ask?f=${f}`);
      expect(x).not.toContain("<Dial");
      expect(redirect(x)).not.toMatch(/operator|type\?/);
    });
  }
  it("street: the line, then the street menu (voice or keypad)", async () => {
    const x = await call("heard", { SpeechResult: "" }, "f=street&n=2");
    expect(said(x)).toEqual([PROMPTS.field_trouble.text]);
    expect(redirect(x)).toBe("addr-street");
  });
});
