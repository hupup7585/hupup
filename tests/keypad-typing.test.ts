import { beforeEach, describe, expect, it, vi } from "vitest";
import { decodeMultitap, titleCase } from "@/lib/ivr/multitap";

/* Keypad typing for spoken answers (Abraham L). */

/** How a caller types text: presses per letter, a star between letters on the same key, two stars for a space. */
function encode(text: string): string {
  const keys: Record<string, string> = { "2": "abc", "3": "def", "4": "ghi", "5": "jkl", "6": "mno", "7": "pqrs", "8": "tuv", "9": "wxyz" };
  const sym: Record<string, string> = { ".": "1", "@": "11" };
  let out = "";
  let lastKey = "";
  for (const ch of text) {
    if (ch === " ") {
      out += "**";
      lastKey = "";
      continue;
    }
    let press = sym[ch];
    if (!press) {
      if (/\d/.test(ch)) press = ch === "0" || ch === "1" ? ch : ch.repeat(keys[ch].length + 1);
      else {
        const k = Object.keys(keys).find((x) => keys[x].includes(ch))!;
        press = k.repeat(keys[k].indexOf(ch) + 1);
      }
    }
    if (press[0] === lastKey) out += "*";
    out += press;
    lastKey = press[0];
  }
  return out;
}
describe("multi-tap decoding", () => {
  it.each([
    ["2", "a"], ["22", "b"], ["222", "c"], ["2222", "2"], ["22222", "a"],
    ["2*22", "ab"], ["22*2", "ba"], ["444", "i"], ["7777", "s"], ["9999", "z"], ["99999", "9"],
    ["2**22", "a b"], ["0", "0"], ["1", "1"],
  ])("%s -> %s", (keys, text) => expect(decodeMultitap(keys)).toBe(text));
  it("a whole name and an address with numbers (typed exactly as a caller would)", () => {
    expect(encode("yossi friedman")).toBe("9996667777*7777444**33377744433*36266");
    expect(titleCase(decodeMultitap(encode("yossi friedman")))).toBe("Yossi Friedman");
    expect(titleCase(decodeMultitap(encode("12 forest road")))).toBe("12 Forest Road");
  });
  it("email: key 1 is dot (once) and at (twice)", () => {
    for (const e of ["yossi@gmail.com", "k.weiss@yahoo.com", "info@hupupattractions.com"]) expect(decodeMultitap(encode(e), "email")).toBe(e);
  });
});

const h = vi.hoisted(() => ({ session: { callSid: "CAty", fromNumber: "+18455550166", orderId: null, data: {} as Record<string, unknown>, status: "in_progress", outcome: "carted" } }));
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
import { handleVoice } from "@/lib/ivr/flow";
const call = (action: string, body: Record<string, string> = {}, query = "") =>
  handleVoice({ action, query: new URLSearchParams(query), body: { CallSid: "CAty", ...body }, callSid: "CAty", from: "+18455550166" });
const redirect = (xml: string) => xml.match(/<Redirect method="POST">([^<]+)<\/Redirect>/)?.[1].replace("https://hupup.example/api/voice/", "").replace(/&amp;/g, "&");
const said = (xml: string) => [...xml.matchAll(/<Say [^>]*>([^<]+)<\/Say>/g)].map((m) => m[1].replace(/&apos;/g, "'"));

describe("typing in the call", () => {
  beforeEach(() => {
    process.env.PUBLIC_BASE_URL = "https://hupup.example";
    h.session.data = {};
  });
  it("name, address and email: say it, or press star to type; the question tells callers about star", async () => {
    const xml = await call("heard", { Digits: "*" }, "f=name");
    expect(redirect(xml)).toBe("type?f=name");
    expect(redirect(await call("heard", { Digits: "*" }, "f=address"))).toBe("type?f=address");
    expect(redirect(await call("heard", { Digits: "*" }, "f=email"))).toBe("type?f=email");
    expect(redirect(await call("heard", { Digits: "#" }, "f=email"))).toBe("phone"); // # still skips the email
  });
  it("typing plays the instructions, collects keys until #, then reads back what was typed", async () => {
    const t = await call("type", {}, "f=name");
    expect(t).toMatch(/<Gather [^>]*finishOnKey="#"/);
    expect(said(t)[0]).toMatch(/^To type, press each key until you reach the letter: press 2 once for A, twice for B, three times for C/);
    const back = await call("typed", { Digits: encode("yossi friedman") }, "f=name");
    expect(said(back)).toContain("You typed: Yossi Friedman. If that's right, press 1. To try again, press 2.");
    expect(h.session.data.heard).toBe("Yossi Friedman");
    expect(said(await call("type", {}, "f=email"))).toContain("For a dot, press 1 once. For the at sign, press 1 twice.");
  });
  it("nothing usable typed: try again (instructions not repeated)", async () => {
    const xml = await call("typed", { Digits: "" }, "f=address");
    expect(redirect(xml)).toBe("type?f=address&again=1");
  });
});
