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
  updateSession: async (_sid: string, patch: Record<string, unknown> & { data?: Record<string, unknown> }) => Object.assign(h.session, patch, patch.data ? { data: { ...h.session.data, ...patch.data } } : {}), // merges data like the real session
}));
vi.mock("@/lib/jewish-calendar", async (orig) => ({ ...(await orig<typeof import("@/lib/jewish-calendar")>()), isShabbosOrYomTov: () => false })); // ringing rules: weekday (Phone Menu v3)
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

// Abraham's start of the call and main menu (Nov 16, 2026), word for word
const GREETING = "Hi, thank you for calling Hup Up Attractions! Bringing something special to every occasion!";
const CLOSED = "Our office is closed right now, but you can still book anytime using our automated system.";
const CATALOG = "To receive our catalog by text or email, press 8.";
const MAIN = [
  "If you know your desired extension, you may press it at any time.",
  "For reservations and bookings, press 1.",
  "For instructions and guidance on using our rental equipment, press 2.",
  "For customer service and general inquiries, press 3.",
  "For questions or assistance with any issues during your rental, press 4.",
  "For delivery and pickup information, press 5.",
  "To learn more about our rental attractions and the services we offer, press 6.",
  "To hear our hours of operation, press 7.",
  "To receive our catalog by text or email, press 8.",
  "For feedback and comments, press 9.",
  "To speak with an operator, press 0.",
  "To hear this menu again, press the star key.",
  "Thank you for choosing Hup Up Attractions!",
];
// The greeting is one prompt; spoken from the text, its two sentences are one Say
// Nov 19, 2026 (Hark for Abraham): the catalog offer is no longer in the greeting; the catalog line is key 8 in the menu
const FULL = [GREETING, ...MAIN];
const gatherOf = (xml: string) => xml.slice(xml.indexOf("<Gather"), xml.indexOf("</Gather>"));
const saidIn = (xml: string) => [...gatherOf(xml).matchAll(/<Say [^>]*>([^<]+)<\/Say>/g)].map((m) => m[1].replace(/&amp;/g, "&"));

describe("Abraham's start of the call and main menu (Nov 16, 2026)", () => {
  it("the call starts with the greeting inside the menu, so a key pressed during the greeting works", async () => {
    const incoming = await call("incoming");
    expect(redirect(incoming)).toBe("menu?first=1");
    expect(incoming).not.toContain("<Say"); // nothing plays before the keypad listens
    const xml = await call("menu", {}, "first=1");
    expect(saidIn(xml)).toEqual(FULL); // greeting, main menu: word for word, in order, one Gather
    expect(gatherOf(xml)).toMatch(/<Gather [^>]*input="dtmf"[^>]*numDigits="1"/); // keys only
    expect(gatherOf(xml).split("pause-500ms.wav").length - 1).toBe(FULL.length - 1); // half a second between lines
    expect(gatherOf(xml)).not.toContain("pause-750ms.wav");
  });
  it("any valid key works at any time: the whole menu, greeting included, is one Gather", async () => {
    const xml = await call("menu", {}, "first=1");
    expect(xml.indexOf("<Gather")).toBeLessThan(xml.indexOf("Hi, thank you"));
    expect(xml.indexOf("</Gather>")).toBeGreaterThan(xml.lastIndexOf(MAIN[MAIN.length - 1]));
    for (const k of ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "*"]) expect(await press(k)).not.toContain("Oops");
  });
  it("star replays only the main menu prompt, without the greeting prompts", async () => {
    expect(redirect(await press("*"))).toBe("menu");
    expect(saidIn(await call("menu"))).toEqual(MAIN);
  });
  it("waits 3 seconds after the last line; no choice replays the main menu only; ends only after 3 plays AND 20 seconds", async () => {
    const first = await call("menu", {}, "first=1");
    expect(gatherOf(first)).toMatch(/<Gather [^>]*timeout="3"/);
    const r1 = redirect(first)!;
    expect(r1).toMatch(/^no-key\?to=menu&np=1&t0=\d+$/);
    expect(first.slice(first.indexOf("</Gather>"))).not.toContain("<Say");
    const t0 = Number(r1.match(/t0=(\d+)/)![1]);
    expect(redirect(await call("no-key", {}, `to=menu&np=1&t0=${t0}`))).toBe(`menu?np=1&t0=${t0}`);
    const second = await call("menu", {}, `np=1&t0=${t0}`);
    expect(saidIn(second)).toEqual(MAIN);
    expect(redirect(second)).toBe(`no-key?to=menu&np=2&t0=${t0}`);
    // after 3 plays, but under 20 seconds: one more play
    expect(redirect(await call("no-key", {}, `to=menu&np=3&t0=${t0}`))).toBe(`menu?np=3&t0=${t0}`);
    // 3 plays and 20 seconds: the disconnect line
    const end = await call("no-key", {}, `to=menu&np=3&t0=${t0 - 25_000}`);
    expect(end).toContain("It sounds like we got disconnected, but you can call us back at any time. Thank you for calling Hup Up Attractions. Bye for now!");
    expect(end).toContain("<Hangup/>");
    // a key press always works
    expect(redirect(await call("menu-choice", { Digits: "1" }, `np=2&t0=${t0}`))).toBe("book");
  });
  it("office closed: the closed line plays after the greeting and before the main menu, inside the menu", async () => {
    h.open = false;
    expect(saidIn(await call("menu", {}, "first=1"))).toEqual([GREETING, CLOSED, ...MAIN]);
  });
  it("the Chol Hamoed and Chanukah lines, the Shabbes key 1 lines and the separate menu lines are gone", async () => {
    const { PROMPTS } = await import("@/lib/ivr/prompts");
    for (const k of ["late_cholhamoed", "late_chanukah", "booking_closed_shabbos", "booking_closed_yomtov", "main_hi", "main_slogan", "main_any_time", "main_catalog", "main_star_again", "main_thanks"]) expect(PROMPTS).not.toHaveProperty(k);
  });
});

describe("every key, office open", () => {
  it("1 opens the bookings menu; 2 instructions; 6 learn about our rentals (Nov 19, 2026); 8 the catalog", async () => {
    expect(redirect(await press("1"))).toBe("book");
    expect(redirect(await press("2"))).toBe("instructions");
    expect(redirect(await press("6"))).toBe("learn");
    expect(redirect(await press("8"))).toBe("catalog");
  });
  it("3 rings customer service; 4 issues (ring list 5), 5 delivery (ring list 6), 0 the operator; 7 plays our hours", async () => {
    expect(redirect(await press("3"))).toBe("ring?k=4");
    expect(redirect(await press("4"))).toBe("ring?k=5"); // issues during your rental (Nov 19, 2026: was key 5)
    expect(redirect(await press("5"))).toBe("ring?k=6"); // delivery and pickup (Nov 19, 2026: was key 6)
    expect(redirect(await press("0"))).toBe("ring?k=0");
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
    // Abraham (Phone Menu v3): the list rings 3 times; after the third no-answer, that extension's voicemail
    expect(await call("operator-done", { DialCallStatus: "no-answer" }, "i=0&k=8")).toContain("operator-done?i=1&amp;k=8");
    const xml = await call("operator-done", { DialCallStatus: "no-answer" }, "i=2&k=8");
    expect(xml).not.toContain(MISSED);
    expect(redirect(xml)).toBe("voicemail?x=8");
  });
  it("missed calls are marked for the dashboard: no answer, or office closed", async () => {
    h.session.data = {};
    await call("operator-done", { DialCallStatus: "no-answer" }, "i=2&k=8");
    expect(h.session.data.missed).toBe("no_answer");
    h.session.data = {};
    await call("operator-done", { DialCallStatus: "completed" }, "i=0&k=8");
    expect(h.session.data.missed).toBeUndefined(); // answered: not missed
    h.open = false;
    await call("ring", {}, "k=4");
    expect(h.session.data.missed).toBe("closed");
  });
  it("9 goes straight to the feedback and comments voicemail, no ringing", async () => {
    expect(redirect(await press("9"))).toBe("voicemail?x=9");
    const vm = await call("voicemail", {}, "x=9");
    expect(vm).toMatch(/<Record /);
    expect(vm).not.toContain("<Dial");
  });
  it("# or a wrong key: only Abraham's line, then the main menu prompt again; star repeats the main menu", async () => {
    for (const k of ["#"]) {
      const hash = await press(k);
      expect([...hash.matchAll(/<Say [^>]*>([^<]+)<\/Say>/g)].map((m) => m[1])).toEqual(["Sorry, that is not a valid selection."]);
      expect(redirect(hash)).toBe("menu");
    }
    expect(saidIn(await call("menu"))).toEqual(MAIN);
    expect(redirect(await press("*"))).toBe("menu");
  });
  it("key 1: the bookings menu, three recordings then the star line (Nov 19, 2026); 8 catalog, 0 customer service, 9 corporate, star back", async () => {
    h.session.data = {};
    await db.insert(schema.categories).values({ name: "Jumping Balloons", spokenName: "bounce houses and jumping balloons", ivrDigit: 1, sortOrder: 1, active: true });
    const book = await call("book");
    expect(saidIn(book)).toEqual([
      "To receive our catalog by text or email, press 8.",
      "Please note, orders can be placed only through our automated system.",
      "For information or questions, press 0 for customer service.",
      "For jumping balloons, press 1. For laser tag, press 2. For paddle boats, press 3.",
      "For schools, corporate events, and organizational bookings, press 9.",
      "To go back, press star.",
    ]);
    expect(redirect(await call("book-choice", { Digits: "8" }))).toBe("catalog");
    expect(gatherOf(book)).not.toContain("pause-750ms.wav");
    expect(redirect(await call("book-choice", { Digits: "0" }))).toBe("ring?k=4");
    expect(redirect(await call("book-choice", { Digits: "9" }))).toBe("ring?k=8");
    expect(redirect(await call("book-choice", { Digits: "*" }))).toBe("menu");
    await db.insert(schema.categories).values({ name: "Laser Tag", spokenName: "laser tag and inflatable mazes", ivrDigit: 4, sortOrder: 4, active: true });
    // star goes back one step in every booking menu (Abraham)
    const [cat] = await db.select().from(schema.categories).limit(1);
    const [prod] = await db.insert(schema.products).values({ categoryId: cat.id, name: "Castle", priceCents: 1000, quantity: 1, active: true, sortOrder: 1 }).returning();
    expect(saidIn(await call("category", {}, `c=${cat.id}`))).toContain("To go back, press star.");
    expect(redirect(await call("category-choice", { Digits: "*" }, `c=${cat.id}`))).toBe("cats"); // the categories menu (box 12a)
    expect(redirect(await call("date-heard", { Digits: "*" }, `p=${prod.id}`))).toBe(`category?c=${cat.id}`);
  });
});

describe("star returns to the main menu from the sub-menus", () => {
  it("rental list, cart and after-adding an item", async () => {
    expect(redirect(await call("book-choice", { Digits: "*" }))).toBe("menu");
    expect(redirect(await call("cart-choice", { Digits: "*" }))).toBe("book"); // one step back, never the main menu (Hark's audit M6, Nov 24, 2026)
    expect(redirect(await call("after-add", { Digits: "*" }))).toBe("book"); // one menu back (Abraham, Nov 18, 2026)
  });
});

describe("# is never a menu key; star returns (Abraham, spec item 5)", () => {
  it("# in the main menu, rental list, after-adding and cart menus: the approved invalid line, then the same menu", async () => {
    h.session.data = { day: "2026-12-01" };
    for (const [action, back] of [["menu-choice", "menu"], ["book-choice", "book"], ["after-add", undefined], ["cart-choice", "cart"]] as const) {
      const xml = await call(action, { Digits: "#" });
      expect(xml, action).toContain("Sorry, that is not a valid selection.");
      if (back) expect(redirect(xml), action).toBe(back);
      expect(redirect(xml), action).not.toBe("menu?first=1");
    }
    // star: main menu from the booking menus
    expect(redirect(await call("book-choice", { Digits: "*" }))).toBe("menu");
    expect(redirect(await call("cart-choice", { Digits: "*" }))).toBe("book"); // one step back (audit M6, Nov 24, 2026)
    expect(redirect(await call("after-add", { Digits: "*" }))).toBe("book"); // star: one menu back (Abraham, Nov 18, 2026)
  });
});

describe("menus are keys only (Abraham): no speech in any menu", () => {
  const OLD_OOPS = "Oops, that is not one of the choices. No problem, let us try again.";
  const NOT_VALID = "Sorry, that is not a valid selection.";
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
    expect(redirect(xml)).toMatch(/^no-key\?to=menu&np=1&t0=\d+$/);
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
    expect((flow.match(/= speech\(vr, url\("(\w|-)+"/g) || []).map((m) => m.match(/url\("([\w-]+)"/)![1]).sort()).toEqual(["heard"]); // only information is said (name, address, email); yes or no is keys only (Abraham, Nov 15); key 8 and directions have their own say-or-type steps
  });
});

describe("every key, office closed", () => {
  it("1 books and 2 and 6 play their information 24/7; after hours every extension goes to voicemail (Abraham, Nov 12); 9 is voicemail", async () => {
    h.open = false;
    expect(redirect(await press("1"))).toBe("book");
    expect(redirect(await press("2"))).toBe("instructions");
    expect(redirect(await press("6"))).toBe("learn");
    expect(redirect(await press("3"))).toBe("ring?k=4");
    await saveSetting("ringAfterHours6", false); // key 6 is switched on live (Nov 14); here: the rule with every switch off
    for (const k of ["2", "4", "5", "6", "8", "0"]) {
      const xml = await call("ring", {}, `k=${k}`);
      expect(xml).not.toContain("<Dial");
      expect(redirect(xml)).toBe(`voicemail?x=${k}`);
    }
    await saveSetting("ringAfterHours0", true); // Admin can switch one back on
    expect(await call("ring", {}, "k=0")).toContain("<Dial");
    await saveSetting("ringAfterHours0", false);
    await saveSetting("ringAfterHours6", true);
    expect(redirect(await press("7"))).toBe("hours");
    expect(redirect(await press("9"))).toBe("voicemail?x=9");
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
    expect(lines).toContain("Mutze Shabbes: Winter: 2 hours after Shabbes to 11:00 PM."); // the phone spelling (Nov 18, 2026)
    expect(lines).toContain("Summer: 2 hours after Shabbes to 12:00 AM.");
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

describe("wrong key everywhere (Abraham, Nov 16, 2026): the one shared line, then the same menu again", () => {
  const NOT_VALID = "Sorry, that is not a valid selection.";
  const says = (xml: string) => [...xml.matchAll(/<Say [^>]*>([^<]+)<\/Say>/g)].map((m) => m[1].replace(/&amp;/g, "&").replace(/&apos;/g, "'"));
  const cases: [string, string, string, string][] = [
    // step, query, key, where the caller goes back to
    ["menu-choice", "", "#", "menu"],
    ["catalog-choice", "", "5", "catalog"],
    ["attraction-choice", "m=l", "7", "learn?again=1"], // key 4
    ["attraction-choice", "m=i", "7", "instructions?again=1"], // key 2
    ["attraction-after", "m=l&t=1", "9", "attraction-options?m=l&t=1"],
    ["book-choice", "", "7", "book"], // 8 is the catalog (Nov 19, 2026)
    ["resume-choice", "", "5", "resume"],
    ["phone-choice", "", "7", "phone"],
    ["promo-which-answer", "", "5", "promo-which"],
    ["phonepay-retry-answer", "o=1&n=1&r=0", "5", "phonepay-retry?o=1&n=1&r=1"],
    ["vm-none-choice", "b=1&x=9", "5", "vm-none?b=1&x=9"],
  ];
  for (const [step, q, key, to] of cases)
    it(`${step} ${q}: key ${key}`, async () => {
      const xml = await call(step, { Digits: key }, q);
      expect(says(xml)).toEqual([NOT_VALID]);
      expect(redirect(xml)).toBe(to);
    });
  it("Item added: the shared line, then the same choices (no other wording)", async () => {
    const xml = await call("after-add", { Digits: "7" });
    expect(says(xml)).toEqual([NOT_VALID]);
    expect(redirect(xml)).toBe("added-menu");
    const menu = await call("added-menu");
    expect(says(menu)).toContain("To keep shopping, for same day, press 1. For another day, press 2."); // box 25 (Nov 22, 2026)
    expect(menu).toContain('action="https://hupup.example/api/voice/after-add"');
  });
  it("a read-back: the shared line, then the same read-back again", async () => {
    h.session.data = { heard: "Yossi Friedman" };
    const xml = await call("confirm", { Digits: "5" }, "f=name");
    expect(says(xml)).toEqual([NOT_VALID]);
    expect(redirect(xml)).toBe("readback?f=name");
    expect(says(await call("readback", {}, "f=name")).join(" ")).toContain("Yossi Friedman");
    h.session.data = {};
  });
});

describe("Abraham's answers (Nov 16, 2026)", () => {
  it("8 works during the start-of-call prompts: greeting, office closed and catalog offer are all inside the keypad listener", async () => {
    h.open = false;
    const xml = await call("menu", {}, "first=1");
    const g = gatherOf(xml);
    for (const line of [GREETING, CLOSED, CATALOG]) expect(g).toContain(line);
    expect(g).toMatch(/action="https:\/\/hupup\.example\/api\/voice\/menu-choice/);
    expect(redirect(await press("8"))).toBe("catalog");
  });
  it("the Shabbes and Yom Tov closed greetings are approved (live on the live line)", async () => {
    const { PROMPTS, promptWaiting } = await import("@/lib/ivr/prompts");
    for (const k of ["closed_shabbos_greeting", "closed_yomtov_greeting"] as const) {
      expect((PROMPTS[k] as { pending?: boolean }).pending).toBeUndefined();
      expect(promptWaiting({}, k)).toBe(false);
    }
    expect(PROMPTS.closed_yomtov_greeting.text).toBe("Thank you for calling Hup Up Attractions. We are closed now for Yom Tov, and we will be open again on {day} at {time}. Please leave your name, phone number, and a short message after the tone, and we will call you back after Yom Tov. Good Yom Tov!");
  });
  it("recording list: all eight lines that never play are dropped (the time zone lines are gone)", async () => {
    const { allSlots } = await import("@/lib/recording-slots");
    const s = allSlots();
    for (const k of ["product_intro", "product_options", "product_default_desc", "phonepay_choice", "phonepay_not_found", "tz_ask", "tz_pick", "tz_saved"]) expect(s.some((x) => x.key === k || x.key.startsWith(`${k}#`)), k).toBe(false);
  });
});
