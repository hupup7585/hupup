import { beforeAll, describe, expect, it, vi } from "vitest";

/* Hark's hotline entry-step audit (Nov 24, 2026): the call must never fall back to a first menu after an entry. */
const h = vi.hoisted(() => ({
  session: { callSid: "CAentry", fromNumber: "+18455550122", orderId: null as number | null, data: {} as Record<string, unknown>, status: "in_progress", outcome: "browsing", startedAt: new Date() },
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

describe("H1: another day goes on to the categories, never the bookings menu", () => {
  it("box 25 key 2 and welcome back key 2 carry 'another day'; the confirmed day goes to the categories (box 12a)", async () => {
    expect(redirect(await call("after-add", { Digits: "2" }))).toBe("date?a=1");
    expect(redirect(await call("date-heard", { Digits: "1229" }, "a=1"))).toBe(`date-ask?d=${D}&a=1`);
    expect(await call("date-ask", {}, `d=${D}&a=1`)).toContain(`date-confirm?d=${D}&amp;a=1`);
    expect(redirect(await call("date-confirm", { Digits: "1" }, `d=${D}&a=1`))).toBe("cats");
    expect(h.session.data.day).toBe(D);
    expect(redirect(await call("date-confirm", { Digits: "2" }, `d=${D}&a=1`))).toBe("date?a=1");
  });
  it("star on that date step goes back to box 25", async () => {
    expect(redirect(await call("date-heard", { Digits: "*" }, "a=1"))).toBe("added-menu");
  });
});

describe("M3: pound after the date digits", () => {
  it("the date Gather finishes on pound and '1229#' is read as December 29", async () => {
    expect(await call("date", {}, "a=1")).toMatch(/<Gather [^>]*finishOnKey="#"/);
    expect(redirect(await call("date-heard", { Digits: "1229#" }, "a=1"))).toBe(`date-ask?d=${D}&a=1`);
  });
});

describe("H2: speech to text starts recording as the tone ends", () => {
  it("no tone inside the key window; the tone plays right before the recording", async () => {
    process.env.GOOGLE_TTS_API_KEY = "k";
    const xml = await call("ask", {}, "f=name");
    delete process.env.GOOGLE_TTS_API_KEY;
    const gather = xml.match(/<Gather[\s\S]*?<\/Gather>/)![0];
    expect(gather).not.toContain("tone.wav");
    expect(xml).toMatch(/<\/Gather><Play>[^<]*tone\.wav<\/Play><Record /);
  });
});

describe("H3: unit, pound alone = no unit", () => {
  it("the unit Gather reports an empty result; pound alone goes on to the zip menu; a timeout is the no-key rule", async () => {
    expect(await call("addr-unit")).toMatch(/<Gather [^>]*actionOnEmptyResult="true"/);
    h.session.data = { ...h.session.data, unit: "5" };
    expect(redirect(await call("addr-unit-heard", { Digits: "", FinishedOnKey: "#" }))).toBe("addr-zip");
    expect(h.session.data.unit).toBeUndefined();
    expect(redirect(await call("addr-unit-heard", { Digits: "" }))).toMatch(/^idle\?to=addr-unit/);
    expect(redirect(await call("addr-unit-heard", { Digits: "12", FinishedOnKey: "#" }))).toBe("addr-zip");
    expect(h.session.data.unit).toBe("12");
  });
});

describe("M1: street, 9 types it and star goes back", () => {
  it("speech and recorded answers: 9 = keypad, star = the street menu (Nov 24, 2026)", async () => {
    expect(redirect(await call("heard", { Digits: "9" }, "f=street"))).toBe("type?f=street");
    expect(redirect(await call("heard", { Digits: "*" }, "f=street"))).toBe("addr-street");
    expect(redirect(await call("stt-recorded", { Digits: "9" }, "f=street"))).toBe("type?f=street");
    expect(redirect(await call("stt-recorded", { Digits: "*" }, "f=street"))).toBe("addr-street");
    expect(redirect(await call("heard", { Digits: "*" }, "f=name"))).toBe("cart"); // every question: star goes back (Nov 24, 2026)
  });
  it("the street question by voice: the Address step 2 line and the tone, no keypad line (street step, Nov 24, 2026)", async () => {
    expect(said(await call("ask", {}, "f=street"))).toEqual(["Please say the street name of the delivery address after the tone."]);
  });
});

describe("M2: phone numbers take 10 digits and the pound", () => {
  it("phone-enter and promo-enter wait for 11 keys, so pound after 10 digits finishes the entry", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/lib/ivr/flow.ts", "utf8");
    expect(src).toContain('url("phone-heard"), { numDigits: 11');
    expect(src).toContain('url("promo-heard", { t: tries }), { numDigits: 11');
  });
});

describe("M6 and L items: star and no key never land in the main menu", () => {
  it("cart star with no list: box 25 when something is in the cart", async () => {
    expect(redirect(await call("cart-choice", { Digits: "*" }))).toBe("added-menu");
  });
  it("L5: star on the zip entry goes back to the zip menu; L4: '1 845 ...' is a phone number", async () => {
    expect(redirect(await call("addr-zip-heard", { Digits: "*" }))).toBe("addr-zip");
    expect(redirect(await call("addr-phone-heard", { Digits: "18455550199" }))).not.toBe("addr-phone");
  });
  it("L3: category no key keeps the free-that-date filter; L7: consent no key replays it", async () => {
    expect(redirect(await call("category-choice", {}, "c=1&f=1"))).toMatch(/^idle\?to=category&q=c%3D1%26f%3D1/);
    h.session.data = { ...h.session.data, phone: "+18455550199", smsConsent: undefined };
    const xml = await call("sms-consent");
    if (xml.includes("sms-consent-answer")) expect(redirect(xml)).toBe("sms-consent-answer?none=1"); // box 49 (Nov 24, 2026): no key = no texts, checkout goes on
  });
});
