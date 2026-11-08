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
  await saveSetting("ringTargets8", "Corporate desk | (845) 555-0102 | 25");
  for (const k of ["2", "4", "5", "6"] as const) await saveSetting(`ringTargets${k}`, "");
});

const MENU = [
  "If you know your desired extension, you may press it at any time.",
  "For reservations and bookings, press 1.",
  "For instructions and guidance on using our rental equipment, press 2.",
  "To learn more about our rental attractions and the services we offer, press 3.",
  "For customer service and general inquiries, press 4.",
  "For questions or assistance with any issues during your rental, press 5.",
  "For delivery and pickup information, press 6.",
  "To hear our hours of operation, press 7.",
  "For schools, corporate events, and organizational bookings, press 8.",
  "To leave a message in our general voicemail, press 9.",
  "To speak with an operator, press 0.",
  "To hear the menu again, press the star key.",
  "Thank you for choosing Hup Up Attractions. We look forward to serving you!",
];
const GREETING = "Hi! Thank you for calling Hup Up Attractions, bringing something special to every occasion!";
const gatherOf = (xml: string) => xml.slice(xml.indexOf("<Gather"), xml.indexOf("</Gather>"));
const saidIn = (xml: string) => [...gatherOf(xml).matchAll(/<Say [^>]*>([^<]+)<\/Say>/g)].map((m) => m[1].replace(/&amp;/g, "&"));

describe("Abraham's main menu wording (approved Nov 8, 2026)", () => {
  it("the call starts with the greeting inside the menu, so a key pressed during the greeting works", async () => {
    const incoming = await call("incoming");
    expect(redirect(incoming)).toBe("menu?first=1");
    expect(incoming).not.toContain("<Say"); // nothing plays before the keypad listens
    const xml = await call("menu", {}, "first=1");
    expect(saidIn(xml)).toEqual([GREETING, ...MENU]); // word for word, in order, all inside one Gather
    expect(gatherOf(xml)).toMatch(/<Gather [^>]*input="dtmf speech"[^>]*numDigits="1"/);
    expect(gatherOf(xml).split("pause-750ms.wav").length - 1).toBe(MENU.length); // 0.75 s after each line
  });
  it("star, a wrong key or silence replays the menu without the greeting", async () => {
    expect(redirect(await press("*"))).toBe("menu");
    expect(saidIn(await call("menu"))).toEqual(MENU);
  });
  it("office closed: the approved closed line plays right after the greeting, inside the menu", async () => {
    h.open = false;
    const said = saidIn(await call("menu", {}, "first=1"));
    expect(said[0]).toBe(GREETING);
    expect(said[1]).toBe("Our office is closed right now, but you can book anytime using this automated system.");
    expect(said.slice(2)).toEqual(MENU);
  });
});

describe("every key, office open", () => {
  it("1 opens the rental list; 3 does too until its message is approved", async () => {
    expect(redirect(await press("1"))).toBe("book");
    expect(redirect(await press("3"))).toBe("book");
  });
  it("2, 4, 5, 6, 8 and 0 ring a live employee; 7 rings the operator until its message is approved", async () => {
    for (const k of ["2", "4", "5", "6", "8", "0"]) expect(redirect(await press(k))).toBe(`ring?k=${k}`);
    expect(redirect(await press("7"))).toBe("ring?k=0");
  });
  it("8 rings the corporate list key 2 used to ring; 2 (equipment, empty), 4, 5 and 6 fall back to the operator list", async () => {
    const eight = await call("ring", {}, "k=8");
    expect(eight).toContain(">+18455550102</Number>");
    expect(eight).toContain("whisper");
    for (const k of ["2", "4", "5", "6", "0"]) expect(await call("ring", {}, `k=${k}`)).toContain(">+18457777585</Number>");
  });
  it("2 rings its own list once the owner adds one", async () => {
    await saveSetting("ringTargets2", "Equipment help | (845) 555-0123 | 20");
    expect(await call("ring", {}, "k=2")).toContain(">+18455550123</Number>");
  });
  it("no one answers: Abraham's missed-call line, then the general voicemail beep", async () => {
    const xml = await call("operator-done", { DialCallStatus: "no-answer" }, "i=0&k=8");
    expect(xml).toContain(MISSED);
    expect(redirect(xml)).toBe("voicemail?after=1");
  });
  it("9 goes straight to the general voicemail, no ringing", async () => {
    expect(redirect(await press("9"))).toBe("voicemail");
    const vm = await call("voicemail");
    expect(vm).toMatch(/<Record /);
    expect(vm).not.toContain("<Dial");
  });
  it("# is not an option: Abraham's line, then the main menu again; star repeats the menu", async () => {
    const hash = await press("#");
    expect(hash).toContain("Oops, that's not an option. Let's try that again!");
    expect(redirect(hash)).toBe("menu");
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
  it("1 and 3 still book (24/7); 2, 4, 5, 6, 7, 8 and 0 play the missed-call line and go to voicemail; 9 is voicemail", async () => {
    h.open = false;
    expect(redirect(await press("1"))).toBe("book");
    expect(redirect(await press("3"))).toBe("book");
    for (const k of ["2", "4", "5", "6", "8", "0"]) {
      const xml = await call("ring", {}, `k=${k}`);
      expect(xml).toContain(MISSED);
      expect(xml).not.toContain("<Dial");
      expect(redirect(xml)).toBe("voicemail?after=1");
    }
    expect(redirect(await press("7"))).toBe("ring?k=0");
    expect(redirect(await press("9"))).toBe("voicemail");
  });
});

describe("Terms switch for going live (Abraham: /terms stays on preview until filled in)", () => {
  it("on, everywhere except the live site while the Terms are a draft", async () => {
    const { termsActive } = await import("@/lib/rental-terms");
    const { TERMS_EFFECTIVE_DATE } = await import("@/lib/terms-content");
    expect(TERMS_EFFECTIVE_DATE).toBe("draft");
    expect(termsActive({ VERCEL_ENV: "preview" })).toBe(true);
    expect(termsActive({})).toBe(true);
    expect(termsActive({ VERCEL_ENV: "production" })).toBe(false);
  });
  it("live while draft: no /terms page or links, no hotline Terms step, no Terms box, no staff Terms question", async () => {
    const { readFileSync } = await import("node:fs");
    expect(readFileSync("src/app/terms/page.tsx", "utf8")).toContain("if (!termsActive()) notFound();");
    expect(readFileSync("src/components/site/SiteFooter.tsx", "utf8")).toContain('{termsActive() && <a href="/terms"');
    expect(readFileSync("src/app/sitemap.ts", "utf8")).toContain('...(termsActive() ? ["/terms"] : [])');
    expect(readFileSync("src/lib/ivr/flow.ts", "utf8")).toContain('if (termsActive() && !data.termsAccepted) return back(vr, "terms");');
    expect(readFileSync("src/app/pay/[orderId]/page.tsx", "utf8")).toContain("if (!termsActive() && o.status === \"PENDING_PAYMENT\" && due > 0) {");
    const pos = readFileSync("src/app/admin/(app)/pos/actions.ts", "utf8");
    expect(pos).toContain("if (termsActive() && !TERMS_VIA.includes(");
    expect(pos).toContain("if (termsActive()) await recordTermsAcceptance({");
  });
});
