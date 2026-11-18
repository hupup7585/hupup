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
    const more = await runWatchChunk(att.id, 30_000, { fetcher, now: () => new Date(t), sleep: async (ms) => void (t += ms), end: async (x) => void ended.push(x.payLegSid ?? "") });
    expect(more).toBe(false);
    expect(ended).toEqual(["CAleg"]);
    const [after] = await db.select().from(schema.phonepayAttempts).where(eq(schema.phonepayAttempts.id, att.id));
    expect(after.solaSeen).toBe("declined");
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
    expect(phonePayLimits({})).toEqual({ triesPerCall: 3, declinesPerDay: 5 });
    expect(phonePayLimits({ phonePayTriesPerCall: "4", phonePayDeclinesPerDay: "2" })).toEqual({ triesPerCall: 4, declinesPerDay: 2 });
    expect(phonePayLimits({ phonePayTriesPerCall: "0", phonePayDeclinesPerDay: "x" })).toEqual({ triesPerCall: 3, declinesPerDay: 5 });
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
    expect(f).toContain("blockIfTooManyDeclines(callerPhoneOf(ctx)");
    expect(readFileSync("src/app/admin/(app)/phone/card-blocks/page.tsx", "utf8")).toContain("await requireAdmin()");
    expect(readFileSync("src/components/Sidebar.tsx", "utf8")).toContain('"/admin/phone/card-blocks", CreditCard, "Card blocks", OS]');
  });
});
