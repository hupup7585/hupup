import { beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

/* Sola PhonePay safety (Abraham, Nov 17, 2026, Missing Items 4 and 5). In-memory database; Sola and Twilio are stand-ins. */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
const h = vi.hoisted(() => ({ emails: [] as string[] }));
vi.mock("@/lib/notify", async (orig) => ({ ...(await orig<typeof import("@/lib/notify")>()), sendEmail: async (_to: string, subject: string) => (h.emails.push(subject), { sent: true }), sendSms: async () => ({ sent: true }) }));

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { classifyTry, isPhonePayInvoice, type SolaTxn } from "@/lib/sola-phonepay";
import { blockIfTooManyDeclines, isPhonePayBlocked, phonePayLimits, runWatchChunk, unlockNumber, verifyWatch, watchDecision, watchUrl, WATCH_STOP_MS } from "@/lib/phonepay-watch";

const start = new Date("2026-11-18T15:00:00Z");
const txn = (o: Partial<SolaTxn>): SolaTxn => ({ refNum: "R1", amountCents: 15000, at: new Date(start.getTime() + 30_000), invoice: "8454157585", last4: "4242", cardType: "Visa", approved: true, ...o });

beforeAll(() => {
  process.env.ADMIN_EMAIL = "owner@example.com";
  process.env.AUTH_SECRET = "test-secret";
});

describe("Invoice field: PhonePay charges carry a phone number (or nothing), never our order number", () => {
  it("phone numbers and empty count; order numbers do not", () => {
    expect(isPhonePayInvoice("8454157585")).toBe(true);
    expect(isPhonePayInvoice("(845) 415-7585")).toBe(true);
    expect(isPhonePayInvoice("18454157585")).toBe(true);
    expect(isPhonePayInvoice(null)).toBe(true);
    expect(isPhonePayInvoice("1042")).toBe(false);
    // the payment check now finds a PhonePay charge that has the phone number in Invoice
    expect(classifyTry([txn({})], { amountCents: 15000, from: start, to: new Date(start.getTime() + 60_000) }, new Set()).kind).toBe("paid");
    expect(classifyTry([txn({ invoice: "1042" })], { amountCents: 15000, from: start, to: new Date(start.getTime() + 60_000) }, new Set()).kind).toBe("none");
  });
});

describe("watching Sola while the call to Sola is up", () => {
  const a = { startedAt: start, endedAt: null, amountCents: 15000, result: null };
  it("a decline of this try's amount = hang up now (before Sola asks for a new amount); approved too", () => {
    expect(watchDecision(a, [txn({ approved: false })], new Date(start.getTime() + 40_000))).toBe("declined");
    expect(watchDecision(a, [txn({})], new Date(start.getTime() + 40_000))).toBe("approved");
  });
  it("deep check 06:00 M38: another caller's charge of the same amount (another phone in Invoice) never stops this call", () => {
    const now = new Date(start.getTime() + 40_000);
    const mine = { ...a, callerPhone: "+18455550100" };
    expect(watchDecision(mine, [txn({ invoice: "8455550199", approved: false })], now)).toBe("wait");
    expect(watchDecision(mine, [txn({ invoice: "8455550100", approved: false })], now)).toBe("declined");
    expect(watchDecision(mine, [txn({ invoice: "" })], now)).toBe("approved"); // no phone in Invoice: still counts
  });
  it("other amounts, our order numbers, older charges and used refs are ignored; no 4-minute timer (Nov 18, 2026)", () => {
    const now = new Date(start.getTime() + 40_000);
    expect(watchDecision(a, [txn({ amountCents: 999 }), txn({ invoice: "1042" }), txn({ at: new Date(start.getTime() - 5 * 60_000) })], now)).toBe("wait");
    expect(watchDecision(a, [txn({})], now, new Set(["R1"]))).toBe("wait");
    // still watching after 4 and 10 minutes; only stops looking (never hangs up) once a call to Sola cannot still be up
    expect(watchDecision(a, [], new Date(start.getTime() + 4 * 60_000))).toBe("wait");
    expect(watchDecision(a, [], new Date(start.getTime() + 10 * 60_000))).toBe("wait");
    expect(watchDecision(a, [], new Date(start.getTime() + WATCH_STOP_MS))).toBe("stop");
    expect(watchDecision({ ...a, solaSeen: "silence" }, [], now)).toBe("stop");
    expect(watchDecision({ ...a, endedAt: now }, [txn({})], now)).toBe("stop");
  });
  it("runWatchChunk hangs up the call to Sola once a charge shows, and notes what it saw", async () => {
    const [att] = await db.insert(schema.phonepayAttempts).values({ callSid: "CAwatch", amountCents: 15000, startedAt: start, payLegSid: "CAleg" }).returning();
    let calls = 0;
    const fetcher = (async (_u: string, init: { body: string }) => {
      calls++;
      const cmd = JSON.parse(init.body).xCommand;
      const rows = calls > 2 && cmd === "Report:Declined" ? [{ xRefNum: "D9", xAmount: "150.00", xEnteredDate: "2026-11-18 10:00:40", xInvoice: "8454157585" }] : [];
      return new Response(JSON.stringify({ xResult: "S", xReportData: rows }));
    }) as unknown as typeof fetch;
    process.env.SOLA_API_KEY = "test";
    let t = start.getTime() + 10_000;
    const ended: string[] = [];
    const waits: number[] = [];
    const more = await runWatchChunk(att.id, 30_000, { fetcher, declineWaitMs: 6000, helperOn: false, now: () => new Date(t), sleep: async (ms) => void (waits.push(ms), (t += ms)), end: async (x) => void ended.push(x.payLegSid ?? "") });
    expect(more).toBe(false);
    expect(ended).toEqual(["CAleg"]);
    // checked every second, then waited while Sola said the result, then hung up (Abraham, Nov 18, 2026)
    expect(waits.slice(0, -1).every((w) => w === 1000)).toBe(true);
    expect(waits.at(-1)).toBe(6000);
    const [after] = await db.select().from(schema.phonepayAttempts).where(eq(schema.phonepayAttempts.id, att.id));
    expect(after.solaSeen).toBe("declined");
  });
  it("approved: Sola reads the reference and hangs up by itself; we never cut it off", async () => {
    const [att] = await db.insert(schema.phonepayAttempts).values({ callSid: "CAok", amountCents: 15000, startedAt: start, payLegSid: "CAleg2" }).returning();
    const fetcher = (async (_u: string, init: { body: string }) =>
      new Response(JSON.stringify({ xResult: "S", xReportData: JSON.parse(init.body).xCommand === "Report:Approved" ? [{ xRefNum: "OK7", xAmount: "150.00", xEnteredDate: "2026-11-18 10:00:20", xInvoice: "8455550100" }] : [] }))) as unknown as typeof fetch;
    let t = start.getTime() + 10_000;
    const ended: string[] = [];
    expect(await runWatchChunk(att.id, 30_000, { fetcher, declineWaitMs: 6000, helperOn: false, now: () => new Date(t), sleep: async (ms) => void (t += ms), end: async (x) => void ended.push(x.payLegSid ?? "") })).toBe(false);
    expect(ended).toEqual([]);
    const [after] = await db.select().from(schema.phonepayAttempts).where(eq(schema.phonepayAttempts.id, att.id));
    expect(after.solaSeen).toBe("approved");
  });
  it("the watcher address is signed", () => {
    const s = new URL(watchUrl(7)).searchParams.get("s");
    expect(verifyWatch(7, s)).toBe(true);
    expect(verifyWatch(8, s)).toBe(false);
    expect(verifyWatch(7, "nope")).toBe(false);
  });
});

describe("limits: tries per call and declines per phone in 24 hours (Admin settings)", () => {
  it("defaults 3 and 5; Admin values used when sensible", () => {
    expect(phonePayLimits({})).toMatchObject({ triesPerCall: 3, callsPerDay: 5 });
    expect(phonePayLimits({ phonePayTriesPerCall: "4", phonePayCallsPerDay: "2" })).toMatchObject({ triesPerCall: 4, callsPerDay: 2 });
    expect(phonePayLimits({ phonePayTriesPerCall: "0", phonePayCallsPerDay: "x" })).toMatchObject({ triesPerCall: 3, callsPerDay: 5 });
  });
  it("the 5th decline in 24 hours blocks the number, emails the Owner; staff unlock it", async () => {
    const phone = "+18455550123";
    for (let i = 0; i < 4; i++) await db.insert(schema.phonepayAttempts).values({ callSid: `CAd${i}`, amountCents: 15000, callerPhone: phone, result: "declined" });
    expect(await blockIfTooManyDeclines(phone, 5, "order #1042")).toBe(false);
    await db.insert(schema.phonepayAttempts).values({ callSid: "CAd5", amountCents: 15000, callerPhone: phone, result: "declined" });
    h.emails.length = 0;
    expect(await blockIfTooManyDeclines(phone, 5, "order #1042")).toBe(true);
    expect(h.emails[0]).toBe("Hup Up Attractions: card payment by phone blocked for (845) 555-0123");
    expect(await isPhonePayBlocked(phone)).toBe(true);
    const [b] = await db.select().from(schema.phonepayBlocks).where(eq(schema.phonepayBlocks.phone, phone));
    await unlockNumber(b.id, 1);
    expect(await isPhonePayBlocked(phone)).toBe(false);
  });
  it("the call flow uses the settings, starts the watcher, and a blocked number gets the payment link (no new spoken line)", () => {
    const f = readFileSync("src/lib/ivr/flow.ts", "utf8");
    expect(f).not.toContain("PHONEPAY_MAX_TRIES");
    expect(f).toContain("await startPayWatch(attempt.id);");
    expect(f).toMatch(/if \(await isPhonePayBlocked\(callerPhoneOf\(ctx\)\)\) \{[\s\S]{0,300}?return back\(vr, "paylink", \{ o \}\);/); // now also in the call log (Nov 22, 2026)
    expect(f).toContain("blockIfTooManyCalls(callerPhoneOf(ctx), ctx.callSid, limits.callsPerDay");
    expect(readFileSync("src/app/admin/(app)/phone/card-blocks/page.tsx", "utf8")).toContain("await requireAdmin()");
    expect(readFileSync("src/components/Sidebar.tsx", "utf8")).toContain('"/admin/phone/card-blocks", CreditCard, "Card blocks", OS]');
  });
});

describe("matching each charge to its own call (Abraham, Nov 18, 2026): never guess", () => {
  const want = { amountCents: 15000, from: start, to: new Date(start.getTime() + 90_000) };
  it("the customer's phone in Invoice picks this caller's charge even when another caller paid the same amount", () => {
    const mine = txn({ refNum: "A", invoice: "8455550100" });
    const theirs = txn({ refNum: "B", invoice: "8455550199" });
    const c = classifyTry([mine, theirs], { ...want, phone: "+18455550100" }, new Set());
    expect(c.kind).toBe("paid");
    expect(c.paid?.refNum).toBe("A");
    expect(c.byPhone).toBe(true);
  });
  it("two charges of the amount with no phone to tell them apart = not certain", () => {
    const c = classifyTry([txn({ refNum: "A", invoice: "8454157585" }), txn({ refNum: "B", invoice: "8454157585" })], { ...want, phone: "+18455550100" }, new Set());
    expect(c.kind).toBe("ambiguous");
  });
  it("box 147 is the approved wording, and the flow plays it with press 1 to try again", async () => {
    const { PROMPTS } = await import("@/lib/ivr/prompts");
    expect(PROMPTS.phonepay_unclear.text).toBe("Sorry, we could not confirm your payment. To try again, press 1.");
    const f = readFileSync("src/lib/ivr/flow.ts", "utf8");
    expect(f).toContain('if (r.result === "unclear" || r.result === "check_failed") return back(vr, "phonepay-retry", { o, n, u: 1 });');
    expect(f).toContain('sp(g, ctx, "phonepay_unclear"');
  });
});

describe("calls with card tries per number in 24 hours (Abraham, Nov 18, 2026)", () => {
  it("the 6th call with card tries is blocked (5 earlier calls); tries on the same call count once; the Owner is emailed", async () => {
    const { blockIfTooManyCalls, cardCallsLast24h } = await import("@/lib/phonepay-watch");
    const phone = "+18455550177";
    for (let i = 0; i < 5; i++) for (let t = 0; t < 2; t++) await db.insert(schema.phonepayAttempts).values({ callSid: `CAcall${i}`, amountCents: 15000, callerPhone: phone });
    expect(await cardCallsLast24h(phone, "CAnow")).toBe(5);
    expect(await cardCallsLast24h(phone, "CAcall4")).toBe(4);
    expect(await blockIfTooManyCalls(phone, "CAcall4", 5, "order #1042")).toBe(false);
    h.emails.length = 0;
    expect(await blockIfTooManyCalls(phone, "CAnow", 5, "order #1042")).toBe(true);
    expect(h.emails[0]).toBe("Hup Up Attractions: card payment by phone blocked for (845) 555-0177");
  });
});


describe("Sola hang-up helper (Abraham, Nov 18, 2026, option a)", () => {
  const declinedAt = (cmd: string) => (cmd === "Report:Declined" ? [{ xRefNum: "H1", xAmount: "150.00", xEnteredDate: "2026-11-18 10:00:20", xInvoice: "8455550100" }] : []);
  const declinedFetcher = (async (_u: string, init: { body: string }) => new Response(JSON.stringify({ xResult: "S", xReportData: declinedAt(JSON.parse(init.body).xCommand) }))) as unknown as typeof fetch;
  const emptyFetcher = (async () => new Response(JSON.stringify({ xResult: "S", xReportData: [] }))) as unknown as typeof fetch;
  const clock = () => {
    let t = start.getTime() + 10_000;
    return { now: () => new Date(t), sleep: async (ms: number) => void (t += ms) };
  };

  it("the helper is told the result and hangs up itself; the watcher does not cut Sola off", async () => {
    const { helperHangup } = await import("@/lib/phonepay-watch");
    const [att] = await db.insert(schema.phonepayAttempts).values({ callSid: "CAh1", amountCents: 15000, startedAt: start, payLegSid: "CAlegh1" }).returning();
    const ended: string[] = [];
    const end = async (x: { payLegSid: string | null }) => void ended.push(x.payLegSid ?? "");
    const told: number[] = [];
    const helper = async (id: number) => {
      told.push(id);
      await helperHangup(id, end); // the helper's call back to us once Sola stops talking
      return true;
    };
    expect(await runWatchChunk(att.id, 30_000, { fetcher: declinedFetcher, helperOn: true, helper, declineWaitMs: 6000, end, ...clock() })).toBe(false);
    expect(told).toEqual([att.id]);
    expect(ended).toEqual(["CAlegh1"]); // hung up once, by the helper
    const [after] = await db.select().from(schema.phonepayAttempts).where(eq(schema.phonepayAttempts.id, att.id));
    expect(after.helperEndedAt).not.toBeNull();
  });

  it("helper not listening: option c (wait the set seconds after a decline, then hang up)", async () => {
    const [att] = await db.insert(schema.phonepayAttempts).values({ callSid: "CAh2", amountCents: 15000, startedAt: start, payLegSid: "CAlegh2" }).returning();
    const ended: string[] = [];
    const waits: number[] = [];
    const c = clock();
    await runWatchChunk(att.id, 30_000, { fetcher: declinedFetcher, helperOn: true, helper: async () => false, declineWaitMs: 6000, end: async (x) => void ended.push(x.payLegSid ?? ""), now: c.now, sleep: async (ms) => (waits.push(ms), c.sleep(ms)) });
    expect(ended).toEqual(["CAlegh2"]);
    expect(waits.at(-1)).toBe(6000);
  });

  it("helper listening but never hangs up: after 15 seconds we hang up a decline; an approval is never cut off", async () => {
    const [att] = await db.insert(schema.phonepayAttempts).values({ callSid: "CAh3", amountCents: 15000, startedAt: start, payLegSid: "CAlegh3" }).returning();
    const ended: string[] = [];
    await runWatchChunk(att.id, 30_000, { fetcher: declinedFetcher, helperOn: true, helper: async () => true, declineWaitMs: 6000, end: async (x) => void ended.push(x.payLegSid ?? ""), ...clock() });
    expect(ended).toEqual(["CAlegh3"]);
    const [ok] = await db.insert(schema.phonepayAttempts).values({ callSid: "CAh4", amountCents: 15000, startedAt: start, payLegSid: "CAlegh4" }).returning();
    const approvedFetcher = (async (_u: string, init: { body: string }) =>
      new Response(JSON.stringify({ xResult: "S", xReportData: JSON.parse(init.body).xCommand === "Report:Approved" ? [{ xRefNum: "OK9", xAmount: "150.00", xEnteredDate: "2026-11-18 10:00:20", xInvoice: "8455550100" }] : [] }))) as unknown as typeof fetch;
    const ended2: string[] = [];
    await runWatchChunk(ok.id, 30_000, { fetcher: approvedFetcher, helperOn: true, helper: async () => true, end: async (x) => void ended2.push(x.payLegSid ?? ""), ...clock() });
    expect(ended2).toEqual([]);
  });

  it("the helper can only hang up once Sola's record shows a result", async () => {
    const { helperHangup } = await import("@/lib/phonepay-watch");
    const [att] = await db.insert(schema.phonepayAttempts).values({ callSid: "CAh5", amountCents: 15000, startedAt: start, payLegSid: "CAlegh5" }).returning();
    const ended: string[] = [];
    const end = async (x: { payLegSid: string | null }) => void ended.push(x.payLegSid ?? "");
    expect(await helperHangup(att.id, end)).toEqual({ hungUp: false });
    await db.update(schema.phonepayAttempts).set({ solaSeen: "approved" }).where(eq(schema.phonepayAttempts.id, att.id));
    expect(await helperHangup(att.id, end)).toEqual({ hungUp: true });
    expect(await helperHangup(att.id, end)).toEqual({ hungUp: false }); // once
    expect(ended).toEqual(["CAlegh5"]);
  });

  it("silence check: Sola checked once more; a result is used, otherwise hang up and mark it for box 147", async () => {
    const { helperSilence } = await import("@/lib/phonepay-watch");
    process.env.SOLA_API_KEY = "test";
    const now = new Date(start.getTime() + 40_000);
    const [found] = await db.insert(schema.phonepayAttempts).values({ callSid: "CAs1", amountCents: 15000, startedAt: start, payLegSid: "CAlegs1" }).returning();
    const ended: string[] = [];
    const end = async (x: { payLegSid: string | null }) => void ended.push(x.payLegSid ?? "");
    expect(await helperSilence(found.id, { fetcher: declinedFetcher, end, now })).toEqual({ result: "declined" });
    expect(ended).toEqual([]); // the helper hangs up at the end of Sola's sentence, as usual
    const [none] = await db.insert(schema.phonepayAttempts).values({ callSid: "CAs2", amountCents: 15000, startedAt: start, payLegSid: "CAlegs2" }).returning();
    expect(await helperSilence(none.id, { fetcher: emptyFetcher, end, now })).toEqual({ result: null });
    expect(ended).toEqual(["CAlegs2"]);
    const [after] = await db.select().from(schema.phonepayAttempts).where(eq(schema.phonepayAttempts.id, none.id));
    expect(after.solaSeen).toBe("silence");
    const f = readFileSync("src/lib/ivr/flow.ts", "utf8");
    expect(f).toContain('if (attempt?.solaSeen === "silence") return back(vr, "phonepay-retry", { o, n, u: 1 });');
  });

  it("the helper's addresses are signed; silence seconds are an Admin setting (20 to start)", async () => {
    const { helperUrl, verifyHelper, silenceSeconds } = await import("@/lib/phonepay-watch");
    const h = new URL(helperUrl(9, "hangup"));
    expect(verifyHelper(9, "hangup", h.searchParams.get("s"))).toBe(true);
    expect(verifyHelper(9, "silence", h.searchParams.get("s"))).toBe(false);
    expect(verifyHelper(10, "hangup", h.searchParams.get("s"))).toBe(false);
    expect(silenceSeconds({})).toBe(20);
    expect(silenceSeconds({ phonePaySilenceSeconds: "30" })).toBe(30);
    expect(silenceSeconds({ phonePaySilenceSeconds: "2" })).toBe(20);
    const { SETTING_DEFAULTS: DEFAULT_SETTINGS } = await import("@/lib/settings");
    expect(DEFAULT_SETTINGS.solaListenOn).toBe(false); // off until the real test call
    expect(DEFAULT_SETTINGS.phonePaySilenceSeconds).toBe("20");
  });

  it("TwiML: the call to Sola's sound goes to the helper (both directions, which one is Sola's), never recorded", async () => {
    const { startSolaListen } = await import("@/lib/phonepay-watch");
    const twilio = (await import("twilio")).default;
    const vr = new twilio.twiml.VoiceResponse();
    startSolaListen(vr as never, 12, "outbound", { phonePaySilenceSeconds: "25" });
    const x = vr.toString();
    // No SOLA_LISTEN_KEY in tests: a key the Worker refuses (the call goes on; the watcher's own timing is used)
    expect(x).toContain(`<Stream url="wss://hupup-sola-listen.hupup-attractions.workers.dev/stream/12/${"0".repeat(32)}" track="both_tracks" name="sola-12">`);
    expect(x).toContain('<Parameter name="solaTrack" value="outbound"/>');
    expect(x).toContain('<Parameter name="silenceSec" value="25"/>');
    expect(x).toContain('<Parameter name="pauseMs" value="500"/>');
    expect(x).not.toContain("record");
    const f = readFileSync("src/lib/ivr/flow.ts", "utf8");
    expect(f).toContain('if (s.solaListenOn) startSolaListen(vr, attempt.id, "outbound", s);');
    expect(f).toContain('if (s.solaListenOn) startSolaListen(vr, a, "inbound", s);');
  });
});

describe("the helper itself (cloudflare/sola-listen-worker.js)", () => {
  const tone = (n = 160) => {
    // a loud mu-law frame (alternating large samples) and a silent one
    return btoa(String.fromCharCode(...Array.from({ length: n }, (_, i) => (i % 2 ? 0x10 : 0x90))));
  };
  const quiet = (n = 160) => btoa(String.fromCharCode(...Array.from({ length: n }, () => 0xff)));

  it("measures loudness: Sola talking vs silence", async () => {
    const { frameRms } = await import("../cloudflare/sola-listen-worker.js");
    expect(frameRms(tone())).toBeGreaterThan(700);
    expect(frameRms(quiet())).toBeLessThan(50);
  });

  it("after the result: hangs up once Sola has been quiet for half a second, not while Sola talks", async () => {
    const { SolaListen } = await import("../cloudflare/sola-listen-worker.js");
    const calls: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (u: string) => (calls.push(String(u)), new Response("{}"))) as typeof fetch;
    const realNow = Date.now;
    let t = 1_000_000;
    Date.now = () => t;
    try {
      const d = new SolaListen({});
      d.onMessage(JSON.stringify({ event: "start", start: { customParameters: { hangup: "https://x/hangup", silence: "https://x/silence", solaTrack: "inbound", pauseMs: "500", silenceSec: "20" } } }));
      d.onMessage(JSON.stringify({ event: "media", media: { track: "inbound", payload: tone() } }));
      d.resultAt = t; // our site: Sola's record shows the result
      for (let i = 0; i < 3; i++) {
        t += 100;
        d.onMessage(JSON.stringify({ event: "media", media: { track: "inbound", payload: tone() } })); // Sola still talking
        d.tick();
      }
      expect(calls).toEqual([]);
      for (let i = 0; i < 6; i++) {
        t += 100;
        d.onMessage(JSON.stringify({ event: "media", media: { track: "inbound", payload: quiet() } }));
        d.tick();
      }
      expect(calls).toEqual(["https://x/hangup"]);
    } finally {
      globalThis.fetch = realFetch;
      Date.now = realNow;
    }
  });

  it("silence check: 20 seconds with no Sola voice, no keys and no result asks our site; caller keys reset it", async () => {
    const { SolaListen } = await import("../cloudflare/sola-listen-worker.js");
    const calls: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (u: string) => (calls.push(String(u)), new Response(JSON.stringify({ result: null })))) as typeof fetch;
    const realNow = Date.now;
    let t = 2_000_000;
    Date.now = () => t;
    try {
      const d = new SolaListen({});
      d.onMessage(JSON.stringify({ event: "start", start: { customParameters: { hangup: "https://x/hangup", silence: "https://x/silence", solaTrack: "inbound", silenceSec: "20" } } }));
      t += 15_000;
      d.onMessage(JSON.stringify({ event: "media", media: { track: "outbound", payload: tone() } })); // the caller's key tones
      t += 15_000;
      d.tick();
      expect(calls).toEqual([]);
      t += 5_001;
      d.tick();
      expect(calls).toEqual(["https://x/silence"]);
    } finally {
      globalThis.fetch = realFetch;
      Date.now = realNow;
    }
  });
});

describe("deep check Nov 27, item 18: the helper needs its key", () => {
  const SECRET = "test-listen-key-0123456789abcdef";
  const env = { LISTEN_KEY: SECRET, LISTEN: { idFromName: (n: string) => n, get: () => ({ fetch: async () => Response.json({ listening: true }) }) } };

  it("our site and the Worker make the same key for a try; different tries get different keys", async () => {
    const { listenKey } = await import("@/lib/phonepay-watch");
    const { tryKey } = await import("../cloudflare/sola-listen-worker.js");
    const k = listenKey(7, { SOLA_LISTEN_KEY: SECRET });
    expect(k).toMatch(/^[0-9a-f]{32}$/);
    expect(await tryKey(SECRET, "7")).toBe(k);
    expect(listenKey(8, { SOLA_LISTEN_KEY: SECRET })).not.toBe(k);
    expect(listenKey(7, {})).toBeNull();
    expect(listenKey(7, { SOLA_LISTEN_KEY: "short" })).toBeNull();
  });

  it("the Worker refuses /result and /stream without the right key, or when its secret is not set", async () => {
    const worker = (await import("../cloudflare/sola-listen-worker.js")).default;
    const { listenKey } = await import("@/lib/phonepay-watch");
    const good = listenKey(7, { SOLA_LISTEN_KEY: SECRET })!;
    const post = (path: string, e: unknown = env) => worker.fetch(new Request(`https://h${path}`, { method: "POST" }), e);
    expect((await post(`/result/7/${good}`)).status).toBe(200);
    expect((await post(`/result/7/${"a".repeat(32)}`)).status).toBe(403);
    expect((await post(`/result/8/${good}`)).status).toBe(403); // a key for another try
    expect((await post(`/stream/7/${"0".repeat(32)}`)).status).toBe(403);
    expect((await post(`/result/7/${good}`, { ...env, LISTEN_KEY: undefined })).status).toBe(403); // no secret: closed
    expect((await post(`/result/7`)).status).toBe(200); // the old keyless address is not a stream or result at all
    expect(await (await post(`/result/7`)).text()).toBe("Hup Up Attractions");
  });

  it("tellHelper sends the key, and without SOLA_LISTEN_KEY never calls the helper (the watcher's own timing is used)", async () => {
    const { tellHelper, listenKey } = await import("@/lib/phonepay-watch");
    const urls: string[] = [];
    const fetcher = (async (u: string) => (urls.push(String(u)), Response.json({ listening: true }))) as unknown as typeof fetch;
    expect(await tellHelper(7, fetcher, {})).toBe(false);
    expect(urls).toEqual([]);
    expect(await tellHelper(7, fetcher, { SOLA_LISTEN_KEY: SECRET })).toBe(true);
    expect(urls).toEqual([`https://hupup-sola-listen.hupup-attractions.workers.dev/result/7/${listenKey(7, { SOLA_LISTEN_KEY: SECRET })}`]);
  });
});
