import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Abraham's main menu, key by key, with the office open and closed. Runs through handleVoice on an in-memory
 * database; nothing is dialed for real.
 */
const h = vi.hoisted(() => ({
  session: { callSid: "CAmm", fromNumber: "+18455550199", orderId: null, data: {} as Record<string, unknown>, status: "in_progress", outcome: "browsing" },
  open: true,
}));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/ivr/session", () => ({
  ensureSession: async () => h.session,
  getSession: async () => h.session,
  updateSession: async (_sid: string, patch: Record<string, unknown>) => Object.assign(h.session, patch),
}));
vi.mock("@/lib/ivr/prompts", async (orig) => ({ ...(await orig<typeof import("@/lib/ivr/prompts")>()), loadPromptOverrides: async () => ({}) }));
vi.mock("@/lib/business-hours", async (orig) => ({ ...(await orig<typeof import("@/lib/business-hours")>()), officeOpenNow: () => h.open, lateHoursToday: () => null }));
vi.mock("@/lib/notify", () => ({ sendSms: async () => ({ sent: true }), sendEmail: async () => ({ sent: true }) }));

import { handleVoice } from "@/lib/ivr/flow";
import { saveSetting } from "@/lib/settings";
import { db, schema } from "@/lib/db";

const call = (action: string, body: Record<string, string> = {}, query = "") =>
  handleVoice({ action, query: new URLSearchParams(query), body: { CallSid: "CAmm", ...body }, callSid: "CAmm", from: "+18455550199" });
const press = (d: string) => call("menu-choice", { Digits: d });
const redirect = (xml: string) => xml.match(/<Redirect method="POST">([^<]+)<\/Redirect>/)?.[1].replace("https://hupup.example/api/voice/", "").replace(/&amp;/g, "&");
const MISSED = "Sorry, we missed your call, our team is busy helping others right now. Please leave a message after the tone and someone will get back to you shortly. Thank you and have a wonderful day!";

beforeEach(async () => {
  process.env.PUBLIC_BASE_URL = "https://hupup.example";
  h.open = true;
  await saveSetting("operatorTargets", "Operator | (845) 777-7585 | 20");
  await saveSetting("operatorMode", "sequential");
  await saveSetting("operatorAcceptPrompt", true);
  await saveSetting("ringTargets2", "Corporate desk | (845) 555-0102 | 25");
  for (const k of ["4", "5", "6"] as const) await saveSetting(`ringTargets${k}`, "");
});

describe("Abraham's main menu wording", () => {
  it("greeting, then every option exactly as dictated, with a 0.75-second pause between them", async () => {
    expect(await call("incoming")).toContain("Hi! Thank you for calling Hup Up Attractions, bringing something special to every occasion!");
    const xml = await call("menu");
    const menu = xml.slice(xml.indexOf("<Gather"), xml.indexOf("</Gather>"));
    const said = [...menu.matchAll(/<Say [^>]*>([^<]+)<\/Say>/g)].map((m) => m[1].replace(/&amp;/g, "&"));
    expect(said).toEqual([
      "For bookings with our automatic easy system, press 1.",
      "For corporates & organizations, press 2.",
      "To learn more about our entertainment rentals, press 3.",
      "For customer service, press 4.",
      "For questions or problems during your rental, press 5.",
      "For delivery and pickup information, press 6.",
      "For our hours of operation, press 7.",
      "To leave a message in our general voicemail, press 9.",
      "To speak with an operator, press 0.",
    ]);
    expect(menu.split("pause-750ms.wav").length - 1).toBe(8);
  });
});

describe("every key, office open", () => {
  it("1 opens the rental list; 3 does too until its message is approved", async () => {
    expect(redirect(await press("1"))).toBe("book");
    expect(redirect(await press("3"))).toBe("book");
  });
  it("2, 4, 5, 6 and 0 ring a live employee; 7 rings the operator until its message is approved", async () => {
    for (const k of ["2", "4", "5", "6", "0"]) expect(redirect(await press(k))).toBe(`ring?k=${k}`);
    expect(redirect(await press("7"))).toBe("ring?k=0");
  });
  it("2 rings its own list; 4, 5 and 6 (empty) fall back to the operator list; press 1 to accept", async () => {
    const two = await call("ring", {}, "k=2");
    expect(two).toContain(">+18455550102</Number>");
    expect(two).toContain("whisper");
    for (const k of ["4", "5", "6", "0"]) expect(await call("ring", {}, `k=${k}`)).toContain(">+18457777585</Number>");
  });
  it("no one answers: Abraham's missed-call line, then the general voicemail beep", async () => {
    const xml = await call("operator-done", { DialCallStatus: "no-answer" }, "i=0&k=2");
    expect(xml).toContain(MISSED);
    expect(redirect(xml)).toBe("voicemail?after=1");
  });
  it("9 goes straight to the general voicemail, no ringing", async () => {
    expect(redirect(await press("9"))).toBe("voicemail");
    const vm = await call("voicemail");
    expect(vm).toMatch(/<Record /);
    expect(vm).not.toContain("<Dial");
  });
  it("8 is not an option; star repeats the menu", async () => {
    const eight = await press("8");
    expect(eight).toContain("that's not one of the choices");
    expect(redirect(eight)).toBe("menu");
    expect(redirect(await press("*"))).toBe("menu");
  });
  it("the rental list uses the existing lines; 9 there is the cart and star goes back", async () => {
    await db.insert(schema.categories).values({ name: "Jumping Balloons", spokenName: "Jumping Balloons", ivrDigit: 1, sortOrder: 1, active: true });
    const book = await call("book");
    expect(book).toContain("For Jumping Balloons, press 1.");
    expect(book).toContain("To go back to the main menu, press star.");
    expect(redirect(await call("book-choice", { Digits: "9" }))).toBe("cart");
    expect(redirect(await call("book-choice", { Digits: "*" }))).toBe("menu");
  });
});

describe("every key, office closed", () => {
  it("1 and 3 still book (24/7); 2, 4, 5, 6, 7 and 0 play the missed-call line and go to voicemail; 9 is voicemail", async () => {
    h.open = false;
    expect(redirect(await press("1"))).toBe("book");
    expect(redirect(await press("3"))).toBe("book");
    for (const k of ["2", "4", "5", "6", "0"]) {
      const xml = await call("ring", {}, `k=${k}`);
      expect(xml).toContain(MISSED);
      expect(xml).not.toContain("<Dial");
      expect(redirect(xml)).toBe("voicemail?after=1");
    }
    expect(redirect(await press("7"))).toBe("ring?k=0");
    expect(redirect(await press("9"))).toBe("voicemail");
  });
});
