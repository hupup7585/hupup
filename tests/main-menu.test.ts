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
  await saveSetting("operatorTargets", "Operator | (845) 555-0175 | 20");
  await saveSetting("operatorMode", "sequential");
  await saveSetting("operatorAcceptPrompt", true);
  await saveSetting("ringTargets8", "Corporate desk | (845) 555-0102 | 25");
  for (const k of ["2", "4", "5", "6"] as const) await saveSetting(`ringTargets${k}`, "");
});

const MENU = [
  "If you know your desired extension, you may enter it at any time.",
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
  "To hear this menu again, press the star key.",
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
    expect(gatherOf(xml)).toMatch(/<Gather [^>]*input="dtmf"[^>]*numDigits="1"/); // keys only
    expect(gatherOf(xml).split("pause-750ms.wav").length - 1).toBe(MENU.length); // 0.75 s after each line
  });
  it("any valid key works at any time: the whole menu, greeting included, is one Gather", async () => {
    const xml = await call("menu", {}, "first=1");
    expect(xml.indexOf("<Gather")).toBeLessThan(xml.indexOf(GREETING)); // the keypad is listening before the first word
    expect(xml.indexOf("</Gather>")).toBeGreaterThan(xml.lastIndexOf(MENU[MENU.length - 1]));
    for (const k of ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "*"]) expect(await press(k)).not.toContain("Oops");
  });
  it("star replays the entire main menu, from the greeting", async () => {
    expect(redirect(await press("*"))).toBe("menu?first=1");
    expect(saidIn(await call("menu", {}, "first=1"))).toEqual([GREETING, ...MENU]);
  });
  it("waits 4 seconds after the last line; no choice replays the whole menu; after 3 plays, the goodbye line and hang up", async () => {
    const first = await call("menu", {}, "first=1");
    expect(gatherOf(first)).toMatch(/<Gather [^>]*timeout="4"/);
    expect(redirect(first)).toBe("menu?first=1&n=1"); // 2nd play, from the greeting, no extra line in between
    expect(first.slice(first.indexOf("</Gather>"))).not.toContain("<Say");
    const second = await call("menu", {}, "first=1&n=1");
    expect(saidIn(second)).toEqual([GREETING, ...MENU]);
    expect(redirect(second)).toBe("menu?first=1&n=2"); // 3rd play
    const third = await call("menu", {}, "first=1&n=2");
    const after = third.slice(third.indexOf("</Gather>"));
    expect(after).toContain("It sounds like we got disconnected. Please call us back anytime, we'd love to help. Thanks for calling Hup Up Attractions. Bye for now!");
    expect(after).toContain("<Hangup/>");
    expect(redirect(third)).toBeUndefined();
    // the count travels with the keypad, so an empty answer on the 3rd play also ends the call; a key press always works
    expect(gatherOf(third)).toContain("menu-choice?n=2");
    expect(await call("menu-choice", {}, "n=2")).toContain("<Hangup/>");
    expect(redirect(await call("menu-choice", { Digits: "1" }, "n=2"))).toBe("book");
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
  it("1 opens the rental list; 2 opens instructions and 3 learn about our rentals (Abraham W)", async () => {
    expect(redirect(await press("1"))).toBe("book");
    expect(redirect(await press("2"))).toBe("instructions");
    expect(redirect(await press("3"))).toBe("learn");
  });
  it("4, 5, 6, 8 and 0 ring a live employee; 7 plays our hours (never rings the operator)", async () => {
    for (const k of ["4", "5", "6", "8", "0"]) expect(redirect(await press(k))).toBe(`ring?k=${k}`);
    expect(redirect(await press("7"))).toBe("hours");
  });
  it("8 rings the corporate list key 2 used to ring; 2 (equipment, empty), 4, 5 and 6 fall back to the operator list", async () => {
    const eight = await call("ring", {}, "k=8");
    expect(eight).toContain(">+18455550102</Number>");
    expect(eight).toContain("whisper");
    for (const k of ["2", "4", "5", "6", "0"]) expect(await call("ring", {}, `k=${k}`)).toContain(">+18455550175</Number>");
  });
  it("each main-menu choice is recorded on the call for the dashboard (nothing spoken)", async () => {
    h.session.data = {};
    await press("8");
    await press("*");
    await press("#"); // not a choice: not recorded
    expect(h.session.data.menuKeys).toEqual(["8", "*"]);
  });
  it("2 rings its own list once the owner adds one", async () => {
    await saveSetting("ringTargets2", "Equipment help | (845) 555-0123 | 20");
    expect(await call("ring", {}, "k=2")).toContain(">+18455550123</Number>");
  });
  it("no one answers: that extension's own voicemail (the greeting, then the tone)", async () => {
    const xml = await call("operator-done", { DialCallStatus: "no-answer" }, "i=0&k=8");
    expect(xml).not.toContain(MISSED);
    expect(redirect(xml)).toBe("voicemail?x=8");
  });
  it("missed calls are marked for the dashboard: no answer, or office closed", async () => {
    h.session.data = {};
    await call("operator-done", { DialCallStatus: "no-answer" }, "i=0&k=8");
    expect(h.session.data.missed).toBe("no_answer");
    h.session.data = {};
    await call("operator-done", { DialCallStatus: "completed" }, "i=0&k=8");
    expect(h.session.data.missed).toBeUndefined(); // answered: not missed
    h.open = false;
    await call("ring", {}, "k=4");
    expect(h.session.data.missed).toBe("closed");
  });
  it("9 goes straight to the general voicemail, no ringing", async () => {
    expect(redirect(await press("9"))).toBe("voicemail");
    const vm = await call("voicemail");
    expect(vm).toMatch(/<Record /);
    expect(vm).not.toContain("<Dial");
  });
  it("# is not an option: Abraham's line, then the main menu again; star repeats the whole menu", async () => {
    const hash = await press("#");
    expect(hash).toContain("Sorry, that is not a valid selection. Please try again.");
    expect(hash).not.toContain("Oops");
    expect(redirect(hash)).toBe("menu");
    expect(redirect(await press("*"))).toBe("menu?first=1");
  });
  it("key 1 lists the categories first (item first, then the date); cart line, 0 = cart, star goes back", async () => {
    h.session.data = {};
    await db.insert(schema.categories).values({ name: "Jumping Balloons", spokenName: "Jumping Balloons", ivrDigit: 1, sortOrder: 1, active: true });
    const book = await call("book");
    expect(book).toContain("Let's find the right rental for your event.");
    expect(book).toContain("For Jumping Balloons, press 1.");
    expect(book).toContain("To go back to the main menu, press star.");
    expect(book).toContain("To go to your shopping cart, press 0.");
    expect(redirect(await call("book-choice", { Digits: "0" }))).toBe("cart");
    expect(redirect(await call("book-choice", { Digits: "*" }))).toBe("menu");
  });
});

describe("star returns to the main menu from the sub-menus", () => {
  it("rental list, cart and after-adding an item", async () => {
    expect(redirect(await call("book-choice", { Digits: "*" }))).toBe("menu");
    expect(redirect(await call("cart-choice", { Digits: "*" }))).toBe("menu");
    expect(redirect(await call("after-add", { Digits: "*" }))).toBe("menu");
  });
});

describe("# is never a menu key; star returns (Abraham, spec item 5)", () => {
  it("# in the main menu, rental list, after-adding and cart menus: the approved invalid line, then the same menu", async () => {
    h.session.data = { day: "2026-12-01" };
    for (const [action, back] of [["menu-choice", "menu"], ["book-choice", "book"], ["after-add", undefined], ["cart-choice", "cart"]] as const) {
      const xml = await call(action, { Digits: "#" });
      expect(xml, action).toContain("Sorry, that is not a valid selection. Please try again.");
      if (back) expect(redirect(xml), action).toBe(back);
      expect(redirect(xml), action).not.toBe("menu?first=1");
    }
    // star: main menu from the booking menus
    for (const action of ["book-choice", "after-add", "cart-choice"]) expect(redirect(await call(action, { Digits: "*" })), action).toBe("menu");
  });
});

describe("menus are keys only (Abraham): no speech in any menu", () => {
  const OLD_OOPS = "Oops, that's not one of the choices. No problem, let's try again.";
  const NOT_VALID = "Sorry, that is not a valid selection. Please try again.";
  it("the main menu and the key 1 rental list listen for keys only, and # comes in as a key", async () => {
    h.session.data = { day: "2026-12-01" };
    for (const xml of [await call("menu", {}, "first=1"), await call("book")]) {
      const tag = xml.match(/<Gather [^>]*>/)![0];
      expect(tag).toContain('input="dtmf"');
      expect(tag).not.toMatch(/speech|hints=/);
      expect(tag).toContain('finishOnKey=""');
    }
  });
  it("anything a caller says in a menu is ignored (counts as no choice); the old Oops line is gone", async () => {
    const xml = await call("menu-choice", { SpeechResult: "jumping balloons", Confidence: "0.9" });
    expect(redirect(xml)).toBe("menu?first=1&n=1");
    expect(xml).not.toContain("Oops");
    const { PROMPTS } = await import("@/lib/ivr/prompts");
    expect(Object.values(PROMPTS).map((p) => p.text)).not.toContain(OLD_OOPS);
  });
  it("# and other wrong keys in every menu: Abraham's approved line, then that menu again", async () => {
    const [cat] = await db.insert(schema.categories).values({ name: "Paddle Boats", spokenName: "Paddle Boats", ivrDigit: 3, sortOrder: 3, active: true }).returning();
    const [prod] = await db.insert(schema.products).values({ categoryId: cat.id, name: "Paddle Boat", priceCents: 4500, quantity: 8, active: true, sortOrder: 1 }).returning();
    const cases: [string, Record<string, string>, string, string][] = [
      ["menu-choice", { Digits: "#" }, "", "menu"],
      ["book-choice", { Digits: "#" }, "", "book"],
      ["book-choice", { Digits: "7" }, "", "book"],
      ["category-choice", { Digits: "#" }, `c=${cat.id}`, `category?c=${cat.id}`],
      ["product-choice", { Digits: "#" }, `p=${prod.id}`, `product?p=${prod.id}&again=1`],
    ];
    for (const [action, body, query, back] of cases) {
      const xml = await call(action, body, query);
      expect(xml, action).toContain(NOT_VALID);
      expect(xml, action).not.toContain("Oops");
      expect(redirect(xml), action).toBe(back);
    }
  });
  it("speech stays only where a prompt asks the caller to say something", async () => {
    const { readFileSync } = await import("node:fs");
    const flow = readFileSync("src/lib/ivr/flow.ts", "utf8");
    expect(flow).not.toContain("category-speech");
    expect((flow.match(/= speech\(vr, url\("(\w|-)+"/g) || []).map((m) => m.match(/url\("([\w-]+)"/)![1]).sort()).toEqual(["heard", "sms-consent-answer"]); // the booking date is keys only (Abraham, Nov 9)
  });
});

describe("every key, office closed", () => {
  it("1 books and 2 and 3 play their information 24/7; 4, 5, 6, 8 and 0 go to their own voicemail; 9 is voicemail", async () => {
    h.open = false;
    expect(redirect(await press("1"))).toBe("book");
    expect(redirect(await press("2"))).toBe("instructions");
    expect(redirect(await press("3"))).toBe("learn");
    for (const k of ["2", "4", "5", "6", "8", "0"]) {
      const xml = await call("ring", {}, `k=${k}`);
      expect(xml).not.toContain("<Dial");
      expect(redirect(xml)).toBe(`voicemail?x=${k}`);
    }
    expect(redirect(await press("7"))).toBe("hours");
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

describe("key 7: our hours (Abraham, Nov 9, 2026)", () => {
  it("reads the hours from Admin as approved for the website (dashes read as 'to'), then the main menu; logs Open or Closed", async () => {
    const { hoursForSpeech } = await import("@/lib/ivr/flow");
    const { getSettings } = await import("@/lib/settings");
    const lines = hoursForSpeech(await getSettings());
    expect(lines).toContain("Monday - Thursday: 10:30 AM to 7:00 PM.".replace("Monday - Thursday", "Monday to Thursday"));
    expect(lines).toContain("Motzei Shabbos: Winter: 2 hours after Shabbos to 11:00 PM.");
    expect(lines).toContain("Summer: 2 hours after Shabbos to 12:00 AM.");
    h.open = true;
    const xml = await call("hours", { CallSid: "CAhours1" });
    expect(xml).toContain("10:30 AM to 7:00 PM.");
    expect(xml).not.toContain("<Dial");
    expect(redirect(xml)).toBe("menu");
    h.open = false;
    const closed = await call("hours", { CallSid: "CAhours2" });
    expect(closed).not.toContain("<Dial");
    expect(redirect(closed)).toBe("menu");
  });
});
