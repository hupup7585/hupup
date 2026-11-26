import { describe, expect, it, vi } from "vitest";

/* Hark, Nov 23, 2026, 11:38 PM: Abraham's newest approved hotline lines and Admin recording slots. In-memory database. */
const h = vi.hoisted(() => ({
  overrides: {} as Record<string, { approvedAt?: Date }>,
  session: { callSid: "CAconfirm", fromNumber: "+18455550122", orderId: null as number | null, data: {} as Record<string, unknown>, status: "in_progress", outcome: "browsing" },
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
vi.mock("@/lib/ivr/prompts", async (orig) => ({ ...(await orig<typeof import("@/lib/ivr/prompts")>()), loadPromptOverrides: async () => h.overrides }));
vi.mock("@/lib/business-hours", async (orig) => ({ ...(await orig<typeof import("@/lib/business-hours")>()), officeOpenNow: () => true, lateHoursToday: () => null }));
vi.mock("@/lib/hours-schedule", async (orig) => ({ ...(await orig<typeof import("@/lib/hours-schedule")>()), lineOpen: () => true })); // each line follows the test's open/closed (Hours page, Nov 25, 2026)
vi.mock("@/lib/notify", () => ({ sendSms: async () => ({ sent: true }), sendEmail: async () => ({ sent: true }), sendMessage: async () => ({ sent: true }) }));

import { beforeAll } from "vitest";
import { handleVoice } from "@/lib/ivr/flow";

const call = (action: string, body: Record<string, string> = {}, query = "") =>
  handleVoice({ action, query: new URLSearchParams(query), body: { CallSid: h.session.callSid, ...body }, callSid: h.session.callSid, from: "+18455550122" });
const redirect = (xml: string) => xml.match(/<Redirect method="POST">([^<]+)<\/Redirect>/)?.[1].replace("https://hupup.example/api/voice/", "").replace(/&amp;/g, "&");
const said = (xml: string) => [...xml.matchAll(/<Say [^>]*>([^<]+)<\/Say>/g)].map((m) => m[1].replace(/&apos;/g, "'").replace(/&amp;/g, "&"));
const ENDING = "If that is correct, press 1. To try again, press 2.";
beforeAll(() => {
  process.env.PUBLIC_BASE_URL = "https://hupup.example";
  process.env.AUTH_SECRET = "test-secret";
});

import { PROMPTS } from "@/lib/ivr/prompts";
import { slotsWithStatus } from "@/lib/slot-status";

describe("1. ask_name (Checkout)", () => {
  it("the new approved text, word for word; the slot is Waiting until the text is confirmed for the new recording", async () => {
    expect(PROMPTS.ask_name.text).toBe("Let us complete your booking. Please say your first and last name after the tone."); // Abraham, Nov 24, 2026: "Thank you." removed
    expect(PROMPTS.ask_name.group).toBe("Checkout");
    const slot = (await slotsWithStatus()).find((s) => s.key === "ask_name");
    expect(slot).toMatchObject({ text: PROMPTS.ask_name.text, status: "waiting" });
  });
});

describe("2. no 'press pound to continue': every confirm or read-back ends with the shared Confirm ending", () => {
  it("the Confirm ending slot, word for word; the confirm lines no longer carry their own ending", async () => {
    expect(PROMPTS.confirm_ending.text).toBe(ENDING);
    expect(PROMPTS.confirm_ending.label).toMatch(/^Confirm ending/);
    for (const k of ["book_date_entered", "typed_back", "heard", "phone_heard", "promo_heard", "catalog_text_heard", "catalog_final", "spoken_readback"] as const) {
      expect(PROMPTS[k].text, k).not.toMatch(/pound|press 1|press 2/i);
    }
    expect(PROMPTS.catalog_got.text).toBe("We got {letters}. To continue, press pound. To start over, press 1. To add more, press 2."); // held as is
    expect((await slotsWithStatus()).find((s) => s.key === "confirm_ending")).toMatchObject({ text: ENDING, status: "waiting" });
  });

  const D = "2026-12-29";
  it("book_date_entered: the line, the ending, the star line; 1 confirms, 2 the date again, pound not valid, star back", async () => {
    h.session.data = {};
    expect(said(await call("date-ask", {}, `d=${D}`))).toEqual(["You entered Tuesday, December twenty-ninth.", ENDING, "To go back, press star."]);
    expect(redirect(await call("date-confirm", { Digits: "1" }, `d=${D}`))).toBe("cats"); // the categories for that day (audit H1)
    expect(redirect(await call("date-confirm", { Digits: "2" }, `d=${D}`))).toBe("date");
    const pound = await call("date-confirm", { Digits: "#" }, `d=${D}`);
    expect(said(pound)).toEqual(["Sorry, that is not a valid selection."]);
    expect(redirect(pound)).toBe(`date-ask?d=${D}`);
    expect(redirect(await call("date-confirm", { Digits: "*" }, `d=${D}`))).toBe("date");
  });

  it("typed_back: 1 confirms, 2 types again, pound not valid (same read-back), star back; no key replays the read-back", async () => {
    h.session.data = {};
    const xml = await call("typed", { Digits: "7777*2*7777" }, "f=name");
    expect(said(xml)).toEqual(["You typed: Sas.", ENDING]);
    expect(redirect(xml)).toBe("idle?to=readback&q=f%3Dname%26t%3D1"); // no key: the same read-back
    expect(redirect(await call("confirm", { Digits: "2" }, "f=name&t=1"))).toBe("type?f=name");
    const pound = await call("confirm", { Digits: "#" }, "f=name&t=1");
    expect(said(pound)).toEqual(["Sorry, that is not a valid selection."]);
    expect(redirect(pound)).toBe("readback?f=name&t=1");
    expect(said(await call("readback", {}, "f=name&t=1"))).toEqual(["You typed: Sas.", ENDING, "To go back, press star."]);
    expect(redirect(await call("confirm", { Digits: "*" }, "f=name&t=1"))).toBe("ask?f=name");
    expect(redirect(await call("confirm", { Digits: "1" }, "f=name&t=1"))).toBe("addr");
  });

  it("heard: 1 confirms, 2 asks again, pound not valid, star back", async () => {
    h.session.data = {};
    const xml = await call("heard", { SpeechResult: "Sara Klein", Digits: "" }, "f=name");
    expect(said(xml)).toEqual(["I heard: Sara Klein.", ENDING]);
    expect(redirect(await call("confirm", { Digits: "2" }, "f=name"))).toBe("ask?f=name");
    expect(redirect(await call("confirm", { Digits: "#" }, "f=name"))).toBe("readback?f=name");
    expect(said(await call("readback", {}, "f=name"))).toEqual(["I heard: Sara Klein.", ENDING, "To go back, press star."]);
    expect(redirect(await call("confirm", { Digits: "*" }, "f=name"))).toBe("ask?f=name");
    expect(redirect(await call("confirm", { Digits: "1" }, "f=name"))).toBe("addr");
  });

  it("box 48 (Nov 25, 2026): We have {number}, the box 144 ending; 1 confirms, 2 enters it again, pound not valid, star back", async () => {
    h.session.data = {};
    const BOX48_END = "If that is correct, press 1. To enter a different number, press 2.";
    const xml = await call("phone-heard", { Digits: "8455550123" });
    expect(said(xml)).toEqual(["We have 8 4 5, 5 5 5, 0 1 2 3.", BOX48_END, "To go back, press star."]);
    expect(redirect(await call("phone-confirm", { Digits: "2" }))).toBe("phone-enter");
    const pound = await call("phone-confirm", { Digits: "#" });
    expect(said(pound)[0]).toBe("Sorry, that is not a valid selection.");
    expect(said(pound)).toContain(BOX48_END);
    expect(h.session.data.phone).toBeUndefined();
    expect(redirect(await call("phone-confirm", { Digits: "*" }))).toBe("phone");
    expect(redirect(await call("phone-confirm", { Digits: "1" }))).toBe("sms-consent");
    expect(h.session.data.phone).toBe("+18455550123");
  });

  it("catalog_final: 1 sends, 2 starts the email over, pound not valid, star back", async () => {
    h.session.data = { catLocal: "sara", catDomain: "gmail.com" };
    const xml = await call("catalog-final");
    expect(said(xml).slice(-2)).toEqual([ENDING, "To go back, press star."]);
    expect(redirect(await call("catalog-final-choice", { Digits: "2" }))).toBe("catalog-email");
    const pound = await call("catalog-final-choice", { Digits: "#" });
    expect(said(pound)).toEqual(["Sorry, that is not a valid selection."]);
    expect(redirect(pound)).toBe("catalog-final");
    expect(redirect(await call("catalog-final-choice", { Digits: "*" }))).toBe("catalog-ending");
  });

  it("no key on a confirm step: the no-choice line, then the same read-back again", async () => {
    h.session.data = { heard: "Sara Klein" };
    const xml = await call("idle", {}, "to=readback&q=f%3Dname");
    expect(said(xml)).toEqual(["We did not get your choice. Please try again."]);
    expect(redirect(xml)).toMatch(/^readback\?f=name/);
  });
});

describe("3. the street step says how to type it (key 9, approved Nov 23, 2026, 11:41 PM)", () => {
  it("the approved street line says press 9; no separate star hint any more", () => {
    expect(PROMPTS.addr_street.text).toBe("Please say the street name of the delivery address after the tone."); // Nov 24, 2026: then type_hint
    expect(PROMPTS).not.toHaveProperty("addr_street_type_hint");
  });
  it("the unit step is keypad only and says so (no star line needed)", () => {
    expect(PROMPTS.addr_unit.text).toBe("Thanks, with your keypad, please enter the unit number.");
  });
});

describe("4. automated orders only: a slot, not in the call yet", () => {
  it("exact text, slot Waiting, Admin says Not active yet, and no step plays it", async () => {
    expect(PROMPTS.automated_only.text).toBe("Please note, orders can only be placed through our automated system.");
    expect((await slotsWithStatus()).find((s) => s.key === "automated_only")).toMatchObject({ text: PROMPTS.automated_only.text, status: "waiting" });
    const { lineStatus } = await import("@/lib/prompt-status");
    expect(lineStatus("automated_only", {}).status).toBe("Not used"); // retired, Nov 25, 2026 (item 1)
    const { readFileSync } = await import("node:fs");
    expect(readFileSync("src/lib/ivr/flow.ts", "utf8")).not.toContain('"automated_only"');
  });
  it("5. the three recorded lines have slots whose text matches word for word", async () => {
    const slots = await slotsWithStatus();
    const text = (k: string) => slots.find((s) => s.key === k)?.text;
    expect(text("confirm_ending")).toBe("If that is correct, press 1. To try again, press 2.");
    expect(text("ask_name")).toBe("Let us complete your booking. Please say your first and last name after the tone.");
    expect(text("automated_only")).toBe("Please note, orders can only be placed through our automated system.");
  });
});
