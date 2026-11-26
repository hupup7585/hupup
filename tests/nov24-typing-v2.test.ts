import { beforeAll, describe, expect, it, vi } from "vitest";

/* Hark's hotline entry-step audit (Nov 24, 2026): the call must never fall back to a first menu after an entry. */
const h = vi.hoisted(() => ({
  session: { callSid: "CAtyping2", fromNumber: "+18455550122", orderId: null as number | null, data: {} as Record<string, unknown>, status: "in_progress", outcome: "browsing", startedAt: new Date() },
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
vi.mock("@/lib/hours-schedule", async (orig) => ({ ...(await orig<typeof import("@/lib/hours-schedule")>()), lineOpen: () => true })); // each line follows the test's open/closed (Hours page, Nov 25, 2026)
vi.mock("@/lib/notify", () => ({ sendSms: async () => ({ sent: true }), sendEmail: async () => ({ sent: true }), sendMessage: async () => ({ sent: true }) }));

import { handleVoice } from "@/lib/ivr/flow";
import { db, schema } from "@/lib/db";

const call = (action: string, body: Record<string, string> = {}, query = "") =>
  handleVoice({ action, query: new URLSearchParams(query), body: { CallSid: h.session.callSid, ...body }, callSid: h.session.callSid, from: "+18455550122" });
const redirect = (xml: string) => xml.match(/<Redirect method="POST">([^<]+)<\/Redirect>/)?.[1].replace("https://hupup.example/api/voice/", "").replace(/&amp;/g, "&");
const said = (xml: string) => [...xml.matchAll(/<Say [^>]*>([^<]+)<\/Say>/g)].map((m) => m[1].replace(/&apos;/g, "'").replace(/&amp;/g, "&"));
const D = "2026-12-29"; // a Tuesday, open

beforeAll(async () => {
  process.env.PUBLIC_BASE_URL = "https://hupup.example";
  process.env.AUTH_SECRET = "test-secret";
  const [c] = await db.insert(schema.categories).values({ name: "Paddle Boats", spokenName: "Paddle Boats", ivrDigit: 3, sortOrder: 3, active: true }).returning();
  const [p] = await db.insert(schema.products).values({ categoryId: c.id, name: "paddle boat", priceCents: 10000, quantity: 3, active: true }).returning();
  const [o] = await db.insert(schema.orders).values({ eventDate: "2026-12-22", pickupDate: "2026-12-23", status: "HOLD", channel: "PHONE", subtotalCents: 10000, holdExpiresAt: new Date(Date.now() + 3_600_000) }).returning();
  await db.insert(schema.orderItems).values({ orderId: o.id, productId: p.id, qty: 1, unitPriceCents: 10000 });
  h.session.data = { dayOrderIds: [o.id] };
});

import { PROMPTS } from "@/lib/ivr/prompts";
import { decodeMultitap } from "@/lib/ivr/multitap";

describe("slot texts, word for word", () => {
  it("type_hint, type_instructions, ask_name and the street line", () => {
    expect(PROMPTS.type_hint.text).toBe("To type it with your keypad, press 9.");
    expect(PROMPTS.type_instructions.text).toBe("Press 2 once for A, twice for B, three times for C, and so on for all keys. If two letters in a row use the same key, press star between them. To type a number, press the key one more time. To go back, press star twice. Press 0 once for a space, and twice for number 0. Press 1 once for number 1, twice for a dot, three times for a dash, and four times for an underscore. When you are finished, press the pound key.");
    expect(PROMPTS.ask_name.text).toBe("Let us complete your booking. Please say your first and last name after the tone.");
    expect(PROMPTS.addr_street.text).toBe("Please say the street name of the delivery address after the tone.");
    expect(PROMPTS).not.toHaveProperty("addr_street_type_hint");
  });
});

describe("every typing step: the question, then type_hint; 9 types, star goes back", () => {
  it("name and street: the question then type_hint", async () => {
    expect(said(await call("ask", {}, "f=name"))).toEqual([PROMPTS.ask_name.text, PROMPTS.type_hint.text]);
    expect(said(await call("ask", {}, "f=street"))).toEqual([PROMPTS.addr_street.text]); // street step (Nov 24, 2026): voice was chosen in the street menu
  });
  it("9 before typing switches to typing (not W); star goes back to the last step", async () => {
    for (const f of ["name", "street", "email"]) expect(redirect(await call("heard", { Digits: "9" }, `f=${f}`)), f).toBe(`type?f=${f}`);
    expect(redirect(await call("heard", { Digits: "*" }, "f=name"))).toBe("cart");
    expect(redirect(await call("heard", { Digits: "*" }, "f=street"))).toBe("addr-street");
    expect(redirect(await call("stt-recorded", { Digits: "9" }, "f=name"))).toBe("type?f=name");
  });
  it("after 9: type_instructions, a short beep, then keys (one Gather, so a key during the directions is the first key)", async () => {
    const xml = await call("type", {}, "f=name");
    expect(said(xml)).toEqual([PROMPTS.type_instructions.text]);
    expect(xml).toMatch(/<Gather [^>]*finishOnKey="#"[^>]*>.*type_instructions|<Gather [^>]*finishOnKey="#"/s);
    expect(xml).toMatch(/<\/Say><Play>[^<]*tone\.wav<\/Play><\/Gather>/);
  });
  it("star once before typing goes back to the question; 9 inside typing is a letter", async () => {
    expect(redirect(await call("typed", { Digits: "*" }, "f=name"))).toBe("ask?f=name");
    expect(decodeMultitap("9", "text")).toBe("w");
  });
  it("catalog and payment-link email: the question then type_hint; 9 types, star back, other keys are not valid", async () => {
    const xml = await call("catalog-part", {}, "part=local");
    expect(said(xml).slice(-1)).toEqual([PROMPTS.type_hint.text]);
    expect(redirect(await call("catalog-key", { Digits: "9" }, "part=local"))).toBe("catalog-type?part=local");
    expect(redirect(await call("catalog-key", { Digits: "*" }, "part=domain"))).toBe("catalog-ending");
    const other = await call("catalog-key", { Digits: "2" }, "part=local");
    expect(said(other)).toEqual(["Sorry, that is not a valid selection."]);
    expect(redirect(other)).toBe("catalog-part?part=local");
    const typing = await call("catalog-type", {}, "part=local");
    expect(said(typing)).toEqual([PROMPTS.type_instructions.text]);
    expect(typing).toContain("tone.wav");
  });
  it("typed in the email part: a.1 = 2, 11, star, 1 → read back a dot 1", async () => {
    h.session.data = { ...h.session.data, catLocal: "", catDomain: "" };
    expect(redirect(await call("catalog-typed", { Digits: "211*1" }, "part=local"))).toBe("catalog-got?part=local");
    expect(h.session.data.catLocal).toBe("a.1");
    const got = said(await call("catalog-got", {}, "part=local")).join(" ");
    expect(got).toContain("a dot 1");
  });
});

describe("Abraham's decoder cases", () => {
  const cases: [string, string][] = [["2*22", "ab"], ["2222", "2"], ["77777", "7"], ["233**4", "ag"], ["2033", "a e"], ["20033", "a0e"], ["1", "1"], ["11", "."], ["111", "-"], ["1111", "_"]];
  it("all pass", () => {
    for (const [k, v] of cases) expect(decodeMultitap(k, "text"), k).toBe(v);
  });
});
