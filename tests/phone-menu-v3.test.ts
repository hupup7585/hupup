import { beforeAll, describe, expect, it, vi } from "vitest";

/*
 * Phone Menu v3 and Phone Recordings (Abraham, Nov 12, 2026). Simulated calls on an in-memory database; nothing is
 * dialed, texted or emailed.
 */
const h = vi.hoisted(() => ({
  session: { callSid: "CAv3", fromNumber: "+18455550133", orderId: null, data: {} as Record<string, unknown>, status: "in_progress", outcome: "browsing" },
  overrides: {} as Record<string, unknown>,
}));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/ivr/session", () => ({
  ensureSession: async () => h.session,
  getSession: async () => h.session,
  updateSession: async (_sid: string, patch: Record<string, unknown> & { data?: Record<string, unknown> }) => Object.assign(h.session, patch, patch.data ? { data: { ...h.session.data, ...patch.data } } : {}),
}));
vi.mock("@/lib/jewish-calendar", async (orig) => ({ ...(await orig<typeof import("@/lib/jewish-calendar")>()), isShabbosOrYomTov: () => false }));
vi.mock("@/lib/ivr/prompts", async (orig) => ({ ...(await orig<typeof import("@/lib/ivr/prompts")>()), loadPromptOverrides: async () => h.overrides }));
vi.mock("@/lib/business-hours", async (orig) => ({ ...(await orig<typeof import("@/lib/business-hours")>()), officeOpenNow: () => true, lateHoursToday: () => null }));
vi.mock("@/lib/notify", () => ({ sendSms: async () => ({ sent: true }), sendEmail: async () => ({ sent: true }) }));

import { db, schema } from "@/lib/db";
import { handleVoice } from "@/lib/ivr/flow";
import { PROMPTS, promptAudio, promptWaiting } from "@/lib/ivr/prompts";
import { lineRingsNow, staffAnnouncement } from "@/lib/ivr/routing";
import { decodeCatalogKeys } from "@/lib/ivr/catalog-keys";
import { isCatalogSubject, handleCatalogEmail } from "@/lib/catalog-send";
import { promptRecordingLink, verifyPromptRecordingLink } from "@/lib/signed-link";
import { audioKind, chooseGoogleVoice, chooseRecording, googleVoiceName, makeGoogleRecording, recordingBytes, recordingsByKey, saveRecordingChunk, startRecordingUpload } from "@/lib/prompt-recordings";

const call = (action: string, body: Record<string, string> = {}, q = "") =>
  handleVoice({ action, query: new URLSearchParams(q), body: { CallSid: "CAv3", ...body }, callSid: "CAv3", from: "+18455550133" });
const said = (xml: string) => [...xml.matchAll(/<Say [^>]*>([^<]+)<\/Say>/g)].map((m) => m[1].replace(/&apos;/g, "'").replace(/&amp;/g, "&"));
const redirect = (xml: string) => xml.match(/<Redirect method="POST">([^<]+)<\/Redirect>/)?.[1].replace(/^.*\/api\/voice\//, "").replace(/&amp;/g, "&");

let balloons = 0;
let castle = 0;
beforeAll(async () => {
  process.env.PUBLIC_BASE_URL = "https://hupup.example";
  const [c] = await db.insert(schema.categories).values({ name: "Jumping Balloons", spokenName: "Jumping Balloons", ivrDigit: 1, sortOrder: 1, active: true }).returning();
  balloons = c.id;
  const [p] = await db.insert(schema.products).values({ categoryId: c.id, name: "Royal Castle", priceCents: 20000, quantity: 3, active: true, sortOrder: 1 }).returning();
  castle = p.id;
});

describe("section 2 and 3: ringing staff, after hours", () => {
  const at = (iso: string) => new Date(iso);
  const S = { ringAfterHours0: true, ringAfterHours5: true, ringAfterHours6: true, ringAfterHours4: false, ringAfterHours8: false };
  const weekday = { officeOpen: false, shabbosOrYomTov: false, candleLighting: null };
  it("0 and 5 ring after hours; 3 (line 4) and corporate go to voicemail; office open: all ring", () => {
    const night = at("2026-11-17T03:00:00Z"); // Mon 10 PM New York
    expect(lineRingsNow("0", night, S, weekday)).toBe(true);
    expect(lineRingsNow("5", night, S, weekday)).toBe(true);
    expect(lineRingsNow("4", night, S, weekday)).toBe(false);
    expect(lineRingsNow("8", night, S, weekday)).toBe(false);
    expect(lineRingsNow("4", night, S, { ...weekday, officeOpen: true })).toBe(true);
  });
  it("6 rings 8:00 AM to 10:30 PM; Friday and Erev Yom Tov until 4:00 PM or an hour before candle lighting, whichever is earlier", () => {
    expect(lineRingsNow("6", at("2026-11-17T12:59:00Z"), S, weekday)).toBe(false); // 7:59 AM
    expect(lineRingsNow("6", at("2026-11-17T13:00:00Z"), S, weekday)).toBe(true); // 8:00 AM
    expect(lineRingsNow("6", at("2026-11-18T03:29:00Z"), S, weekday)).toBe(true); // 10:29 PM
    expect(lineRingsNow("6", at("2026-11-18T03:30:00Z"), S, weekday)).toBe(false); // 10:30 PM
    const fri = { ...weekday, candleLighting: at("2026-11-20T21:13:00Z") }; // 4:13 PM candles -> stop at 3:13 PM
    expect(lineRingsNow("6", at("2026-11-20T20:12:00Z"), S, fri)).toBe(true);
    expect(lineRingsNow("6", at("2026-11-20T20:13:00Z"), S, fri)).toBe(false);
    const summerFri = { ...weekday, candleLighting: at("2027-06-25T23:59:00Z") }; // late candles -> 4:00 PM
    expect(lineRingsNow("6", at("2027-06-25T19:59:00Z"), S, summerFri)).toBe(true);
    expect(lineRingsNow("6", at("2027-06-25T20:00:00Z"), S, summerFri)).toBe(false);
  });
  it("Shabbos and Yom Tov: nothing rings; Admin can turn after-hours ringing off per line", () => {
    const shabbos = { ...weekday, officeOpen: true, shabbosOrYomTov: true };
    for (const k of ["0", "5", "6", "4"] as const) expect(lineRingsNow(k, at("2026-11-21T17:00:00Z"), S, shabbos)).toBe(false);
    expect(lineRingsNow("0", at("2026-11-17T03:00:00Z"), { ...S, ringAfterHours0: false }, weekday)).toBe(false);
  });
  it("staff hear the extension number and name; corporate has no number", () => {
    expect(staffAnnouncement("4", "Customer Service")).toBe("Call from Hup Up Attractions, extension 3, Customer Service. Press 1 to accept, or press 2 to reject.");
    expect(staffAnnouncement("8", "Schools and Corporate Orders")).toBe("Call from Hup Up Attractions, Schools and Corporate Orders extension. Press 1 to accept, or press 2 to reject.");
  });
  it("the staff side plays the corporate announcement from Admin settings", async () => {
    expect(said(await call("whisper", {}, "k=8"))).toContain("Call from Hup Up Attractions, Schools and Corporate Orders extension. Press 1 to accept, or press 2 to reject.");
  });
});

describe("section 4: voicemail re-record line", () => {
  it("is Abraham's wording, played before the tone", () => {
    expect(PROMPTS.vm_rerecord.text).toBe("Please re-record your message. When you're finished, press pound.");
  });
});

describe("section 8: bookings reminders", () => {
  it("the item list: cart line, then the items, then the same cart line; no cart line in the category menu", async () => {
    const list = said(await call("category", {}, `c=${balloons}`));
    const cart = "To go to your shopping cart, press 0.";
    expect(list.indexOf(cart)).toBeLessThan(list.indexOf("For the Royal Castle, press 1."));
    expect(list.lastIndexOf(cart)).toBeGreaterThan(list.indexOf("For the Royal Castle, press 1."));
    expect(list.filter((l) => l === cart)).toHaveLength(2);
    expect(said(await call("book"))).not.toContain(cart);
  });
  it("empty cart: Abraham's line, then the same item list", async () => {
    h.session.data = {};
    const xml = await call("category-choice", { Digits: "0" }, `c=${balloons}`);
    expect(redirect(xml)).toBe(`cart?c=${balloons}`);
    const empty = await call("cart", {}, `c=${balloons}`);
    expect(said(empty)).toContain("Your cart is empty. Let's start shopping!");
    expect(redirect(empty)).toBe(`category?c=${balloons}`);
  });
  it("before a bounce house is added: the water note; after the cart is read, the same item list; before checkout: the tax note", async () => {
    const date = new Date(Date.now() + 40 * 86_400_000).toISOString().slice(0, 10);
    const added = said(await call("add", { Digits: "1" }, `p=${castle}&d=${date}`));
    expect(added[0]).toBe("Please note, our bounce houses are not for water use.");
    const cart = await call("cart", {}, `c=${balloons}`);
    expect(said(cart).join(" ")).toContain("Royal Castle");
    expect(redirect(cart)).toBe(`category?c=${balloons}`);
    const checkout = await call("cart-choice", { Digits: "1" }, `c=${balloons}`);
    expect(said(checkout)).toEqual(["Taxes will be calculated after checkout."]);
    expect(redirect(checkout)).toBe("ask?f=name");
    expect(redirect(await call("cart-choice", { Digits: "*" }, `c=${balloons}`))).toBe(`category?c=${balloons}`);
  });
});

describe("section 6: key 8 catalog keypad", () => {
  it("letters, one star between letters on the same key, two stars erase, three go back, 0 switches to numbers, 1 is . _ -", () => {
    expect(decodeCatalogKeys("2*22").text).toBe("ab");
    expect(decodeCatalogKeys("7777").text).toBe("s");
    expect(decodeCatalogKeys("44433**3").text).toBe("id"); // 444 = i, 33 = e, two stars erase it, 3 = d
    expect(decodeCatalogKeys("999666881").text).toBe("you.");
    expect(decodeCatalogKeys("0123").text).toBe("123");
    expect(decodeCatalogKeys("2***").back).toBe(true);
  });
});

describe("section 9: info@ catalog requests", () => {
  it("subject Catalog or catalogue, any capitals", () => {
    for (const s of ["Catalog", "catalogue", "CATALOG", " Re: catalog ", "Fwd: Catalogue"]) expect(isCatalogSubject(s), s).toBe(true);
    for (const s of ["catalog please", "price list", "", null]) expect(isCatalogSubject(s as string), String(s)).toBe(false);
  });
  it("auto-reply is off until Abraham approves the wording: logged, nothing sent", async () => {
    let sent = 0;
    const r = await handleCatalogEmail("Someone@Example.com", "Catalog", new Date(), async () => (sent++, { sent: true }));
    expect(r).toEqual({ replied: false, reason: "autoreply_off" });
    expect(sent).toBe(0);
    const rows = await db.select().from(schema.catalogEmailRequests);
    expect(rows.at(-1)!.sender).toBe("someone@example.com");
  });
});

describe("Phone Recordings (Abraham)", () => {
  const mp3 = Buffer.concat([Buffer.from("ID3"), Buffer.alloc(200, 7)]);
  it("recognizes MP3 and WAV, nothing else", () => {
    expect(audioKind(mp3)).toBe("audio/mpeg");
    expect(audioKind(Buffer.from([0xff, 0xfb, 0x90, 0x00]))).toBe("audio/mpeg");
    expect(audioKind(Buffer.from("RIFF\0\0\0\0WAVEfmt "))).toBe("audio/wav");
    expect(audioKind(Buffer.from("%PDF-1.7 ......"))).toBeNull();
  });
  it("upload replaces the Google voice on that line right away; Use Google voice switches back; old recordings are kept", async () => {
    const r = await startRecordingUpload("main_thanks", "thanks.mp3", mp3.length, null);
    await saveRecordingChunk(r.id, 0, mp3, true, null);
    const [row] = await db.select().from(schema.voicePrompts).where((await import("drizzle-orm")).eq(schema.voicePrompts.key, "main_thanks"));
    expect(row.recordingId).toBe(r.id);
    expect((await recordingBytes(r.id))!.equals(mp3)).toBe(true);
    // the phone plays it
    h.overrides = { main_thanks: { text: null, audioUrl: null, recordingId: r.id } };
    const menu = await call("menu", {}, "first=1");
    expect(menu).toContain(`<Play>${promptRecordingLink(r.id).replace(/&/g, "&amp;")}</Play>`);
    expect(said(menu)).not.toContain("Thank you for choosing Hup Up Attractions.");
    // a second upload; then back to Google voice; both kept
    const r2 = await startRecordingUpload("main_thanks", "thanks2.wav", 44, null);
    await saveRecordingChunk(r2.id, 0, Buffer.concat([Buffer.from("RIFF\0\0\0\0WAVE"), Buffer.alloc(32)]), true, null);
    await chooseGoogleVoice("main_thanks", null);
    const [after] = await db.select().from(schema.voicePrompts).where((await import("drizzle-orm")).eq(schema.voicePrompts.key, "main_thanks"));
    expect(after.recordingId).toBeNull();
    expect((await recordingsByKey()).get("main_thanks")!.map((x) => x.fileName)).toEqual(["thanks2.wav", "thanks.mp3"]);
    await chooseRecording("main_thanks", r.id, null); // "Use this one" on an older recording
    h.overrides = {};
    expect(said(await call("menu", {}, "first=1"))).toContain("Thank you for choosing Hup Up Attractions.");
  });
  it("rejects files that aren't MP3 or WAV, and lines with changing parts (they stay live Google voice)", async () => {
    await expect(startRecordingUpload("main_thanks", "x.pdf", 10, null)).rejects.toThrow("MP3 or WAV");
    const bad = await startRecordingUpload("main_thanks", "fake.mp3", 8, null);
    await expect(saveRecordingChunk(bad.id, 0, Buffer.from("%PDF-1.7"), true, null)).rejects.toThrow("isn't an MP3 or WAV");
    await expect(startRecordingUpload("added", "a.mp3", 10, null)).rejects.toThrow("changing parts");
    expect(promptAudio({ added: { text: null, audioUrl: null, recordingId: 5 } }, "added")).toBeNull();
  });
  it("signed links: Twilio can play them, guessing doesn't work", () => {
    const link = new URL(promptRecordingLink(12));
    expect(verifyPromptRecordingLink(12, link.searchParams.get("sig"))).toBe(true);
    expect(verifyPromptRecordingLink(13, link.searchParams.get("sig"))).toBe(false);
  });
  it("lines waiting for approval never play; approved, they do", () => {
    expect(promptWaiting({}, "instr_balloons")).toBe(true);
    expect(promptWaiting({ instr_balloons: { text: null, audioUrl: null, approvedAt: new Date() } }, "instr_balloons")).toBe(false);
    expect(promptWaiting({}, "main_thanks")).toBe(false);
    for (const k of ["promo_ask", "promo_which", "promo_final", "promo_disclosure"] as const) expect(promptWaiting({}, k), k).toBe(true);
  });
  it("Google voice recording: Not active yet without a Google Text-to-Speech key; with one, saved in the hotline voice and reused", async () => {
    delete process.env.GOOGLE_TTS_API_KEY;
    expect(await makeGoogleRecording("main_thanks", PROMPTS.main_thanks.text, null)).toBeNull();
    process.env.GOOGLE_TTS_API_KEY = "test-key";
    process.env.IVR_VOICE = "Google.en-US-Chirp3-HD-Puck";
    expect(googleVoiceName()).toBe("en-US-Chirp3-HD-Puck");
    const bodies: string[] = [];
    const fake = (async (_u: string, init: RequestInit) => {
      bodies.push(String(init.body));
      return new Response(JSON.stringify({ audioContent: mp3.toString("base64") }));
    }) as unknown as typeof fetch;
    const g = await makeGoogleRecording("main_thanks", PROMPTS.main_thanks.text, null, fake);
    expect(g!.source).toBe("google");
    expect(JSON.parse(bodies[0]).voice.name).toBe("en-US-Chirp3-HD-Puck");
    await makeGoogleRecording("main_thanks", PROMPTS.main_thanks.text, null, fake);
    expect(bodies).toHaveLength(1); // same wording: reused
    delete process.env.GOOGLE_TTS_API_KEY;
    delete process.env.IVR_VOICE;
  });
});

describe("Nov 12 decisions: staff reject, caller ID, after hours, keypad pay, CATALOG text", () => {
  it("staff press 2: the caller goes straight to that extension's voicemail", async () => {
    h.session.data = {};
    await handleVoice({ action: "whisper-accept", query: new URLSearchParams("k=4"), body: { CallSid: "CAstaff", ParentCallSid: "CAv3", Digits: "2" }, callSid: "CAstaff", from: "+18457990925" });
    expect(typeof h.session.data.rejectedAt).toBe("number");
    const xml = await call("operator-done", { DialCallStatus: "completed" }, "i=0&k=4");
    expect(redirect(xml)).toBe("voicemail?x=4");
    expect(h.session.data.missed).toBe("rejected");
    // press 1 connects (empty response)
    expect(await handleVoice({ action: "whisper-accept", query: new URLSearchParams(), body: { CallSid: "CAstaff2", ParentCallSid: "CAv3", Digits: "1" }, callSid: "CAstaff2", from: "+18457990925" })).toBe('<?xml version="1.0" encoding="UTF-8"?><Response/>');
  });
  it("staff phones show the caller's own number; blocked or unknown shows the hotline", async () => {
    const { staffCallerId } = await import("@/lib/ivr/flow");
    const env = { TWILIO_PHONE_NUMBER: "+18454157585" };
    expect(staffCallerId("+18455550133", env)).toBe("+18455550133");
    expect(staffCallerId("anonymous", env)).toBe("+18454157585");
    expect(staffCallerId(null, env)).toBe("+18454157585");
    expect(await call("ring", {}, "k=4")).toContain('callerId="+18455550133"');
  });
  it("after hours every extension goes to voicemail by default (Admin can switch one back on)", async () => {
    const { SETTING_DEFAULTS } = await import("@/lib/settings");
    const night = new Date("2026-11-17T03:00:00Z");
    const weekday = { officeOpen: false, shabbosOrYomTov: false, candleLighting: null };
    for (const k of ["0", "2", "4", "5", "6", "8"] as const) expect(lineRingsNow(k, night, SETTING_DEFAULTS, weekday), k).toBe(false);
    expect(lineRingsNow("0", night, { ...SETTING_DEFAULTS, ringAfterHours0: true }, weekday)).toBe(true);
  });
  it("the draft after-hours greeting waits for approval; the closed greeting plays until then", () => {
    expect(PROMPTS.vm_after_hours.text).toBe("Thank you for calling Hup Up Attractions! Our office is closed right now. Please leave your name, phone number, and a short message after the tone, and we'll call you back as soon as we open. To book anytime, visit hupupattractions.com. Have a wonderful day!");
    expect(promptWaiting({}, "vm_after_hours")).toBe(true);
    expect(PROMPTS.vm_closed.text).toBe("Thank you for calling Hup Up Attractions. Our office is closed right now. Please leave a message after the tone and we will get back to you as soon as possible. When you are finished, you may hang up or press the pound key.");
  });
  it("pay by keypad: prepared only, not active", async () => {
    const { keypadPayOn, KEYPAD_PAY_MODE } = await import("@/lib/phone-pay");
    expect(KEYPAD_PAY_MODE).toBe("off");
    expect(keypadPayOn()).toBe(false);
  });
  it("text CATALOG: any capitals or catalogue; not active until texting is approved; once on, once per number per day, never after STOP", async () => {
    const { isCatalogText, replyToCatalogText, SMS_CATALOG_REPLY_ON } = await import("@/lib/catalog-send");
    expect(SMS_CATALOG_REPLY_ON).toBe(false);
    for (const t of ["catalog", "CATALOG", "Catalogue", " catalog. "]) expect(isCatalogText(t), t).toBe(true);
    for (const t of ["send me a catalog", "cat", ""]) expect(isCatalogText(t), t).toBe(false);
    const sent: string[] = [];
    const send = async (to: string, body: string) => {
      sent.push(body);
      await db.insert(schema.messages).values({ direction: "out", fromNumber: "+18454157585", toNumber: to, contactPhone: to, body, kind: "transactional", event: "catalog_reply", status: "sent" });
      return { sent: true };
    };
    expect(await replyToCatalogText("+18455550188", { optedOut: false, send })).toEqual({ replied: false, reason: "not_active" });
    expect(sent).toHaveLength(0);
    expect((await replyToCatalogText("+18455550188", { optedOut: false, on: true, send })).replied).toBe(true);
    expect(sent[0]).toBe("Hup Up Attractions: Here is our catalog: hupupattractions.com/#rentals To book, call (845) 777-7585.");
    expect((await replyToCatalogText("+18455550188", { optedOut: false, on: true, send })).reason).toBe("already_today");
    expect((await replyToCatalogText("+18455550199", { optedOut: true, on: true, send })).reason).toBe("opted_out");
    expect((await db.select().from(schema.smsConsents)).filter((r) => r.scope === "marketing" && r.action === "opt_in")).toHaveLength(0);
  });
});
