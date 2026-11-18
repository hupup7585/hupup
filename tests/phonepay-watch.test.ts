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
import { blockIfTooManyDeclines, isPhonePayBlocked, phonePayLimits, runWatchChunk, unlockNumber, verifyWatch, watchDecision, watchUrl, WATCH_LIMIT_MS } from "@/lib/phonepay-watch";

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
  it("other amounts, our order numbers, older charges and used refs are ignored; 4 minutes = hang up", () => {
    const now = new Date(start.getTime() + 40_000);
    expect(watchDecision(a, [txn({ amountCents: 999 }), txn({ invoice: "1042" }), txn({ at: new Date(start.getTime() - 5 * 60_000) })], now)).toBe("wait");
    expect(watchDecision(a, [txn({})], now, new Set(["R1"]))).toBe("wait");
    expect(watchDecision(a, [], new Date(start.getTime() + WATCH_LIMIT_MS))).toBe("timeout");
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
    const more = await runWatchChunk(att.id, 30_000, { fetcher, declineWaitMs: 6000, now: () => new Date(t), sleep: async (ms) => void (waits.push(ms), (t += ms)), end: async (x) => void ended.push(x.payLegSid ?? "") });
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
    expect(await runWatchChunk(att.id, 30_000, { fetcher, declineWaitMs: 6000, now: () => new Date(t), sleep: async (ms) => void (t += ms), end: async (x) => void ended.push(x.payLegSid ?? "") })).toBe(false);
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
    expect(f).toContain('if (await isPhonePayBlocked(callerPhoneOf(ctx))) return back(vr, "paylink", { o });');
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
    expect(f).toContain('if (r.result === "unclear") return back(vr, "phonepay-retry", { o, n, u: 1 });');
    expect(f).toContain('unclear ? "phonepay_unclear"');
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

