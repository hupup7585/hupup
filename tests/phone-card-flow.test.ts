import { beforeAll, describe, expect, it, vi } from "vitest";

/*
 * Card payment on the phone line, the approved plan (Abraham, Nov 15, 2026). Simulated calls on an in-memory database;
 * Sola and Twilio are stand-ins: nothing is dialed or charged.
 */
const h = vi.hoisted(() => ({
  session: { callSid: "CApay", fromNumber: "+18457990925", orderId: null, data: {} as Record<string, unknown>, status: "in_progress", outcome: "browsing" },
  sola: [] as { xRefNum: string; xAmount: string; xEnteredDate: string; xInvoice?: string }[],
  voided: [] as string[],
  emails: [] as string[],
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
vi.mock("@/lib/ivr/prompts", async (orig) => ({ ...(await orig<typeof import("@/lib/ivr/prompts")>()), loadPromptOverrides: async () => ({}) }));
vi.mock("@/lib/notify", () => ({ sendSms: async () => ({ sent: true }), sendEmail: async (_to: string, subject: string) => (h.emails.push(subject), { sent: true }) }));
vi.mock("@/lib/sola-phonepay", async (orig) => {
  const real = await orig<typeof import("@/lib/sola-phonepay")>();
  const fake = (async (url: string, init?: RequestInit) => {
    if (url.includes("gatewayjson")) {
      h.voided.push(JSON.parse(String(init?.body)).xRefNum);
      return new Response(JSON.stringify({ xResult: "A" }));
    }
    return new Response(JSON.stringify({ xResult: "S", xReportData: h.sola }));
  }) as unknown as typeof fetch;
  return {
    ...real,
    endPayLeg: async () => undefined,
    endMainPayLeg: async () => undefined,
    checkPhonePayTry: (o: number, a: number, due: number) => real.checkPhonePayTry(o, a, due, { fetcher: fake, waitMs: 0 }),
  };
});

import { db, schema } from "@/lib/db";
import { handleVoice } from "@/lib/ivr/flow";

const call = (action: string, body: Record<string, string> = {}, q = "") =>
  handleVoice({ action, query: new URLSearchParams(q), body: { CallSid: "CApay", ...body }, callSid: "CApay", from: "+18457990925" });
const said = (xml: string) => [...xml.matchAll(/<Say [^>]*>([^<]+)<\/Say>/g)].map((m) => m[1].replace(/&apos;/g, "'"));
const redirect = (xml: string) => xml.match(/<Redirect method="POST">([^<]+)<\/Redirect>/)?.[1].replace(/^.*\/api\/voice\//, "").replace(/&amp;/g, "&");
const nowEastern = () => new Date().toLocaleString("sv-SE", { timeZone: "America/New_York" });
let orderId = 0;

beforeAll(async () => {
  process.env.PUBLIC_BASE_URL = "https://hupup.example";
  process.env.SOLA_API_KEY = "k";
  process.env.ADMIN_EMAIL = "owner@example.com";
  Object.assign(process.env, { SOLA_PHONEPAY_PIN: "4321", TWILIO_PAY_SIP_DOMAIN: "pay.sip.twilio.com", TWILIO_PAY_SIP_USERNAME: "u", TWILIO_PAY_SIP_PASSWORD: "p", AUTH_SECRET: "test-secret-card-plan-0123456789" });
  const [o] = await db.insert(schema.orders).values({ status: "PENDING_PAYMENT", channel: "PHONE", eventDate: "2026-11-20", pickupDate: "2026-11-20", subtotalCents: 80000, totalCents: 80000 }).returning();
  orderId = o.id;
});

describe("card payment on the phone line", () => {
  it("before the first try: card is the default; 0 gets a payment link by text instead (approved, live)", async () => {
    const ask = await call("phonepay-go", {}, `o=${orderId}`);
    expect(said(ask)).toEqual(["If you would like to pay by credit or debit card, please stay on the line. To receive a payment link instead, press 0."]);
    expect(redirect(ask)).toBe(`phonepay-go?o=${orderId}&c=1`); // no key: on to the card
    expect(ask).not.toContain("<Dial");
    // approved: it plays on the live line too
    process.env.VERCEL_ENV = "production";
    const live = await call("phonepay-go", {}, `o=${orderId}`);
    delete process.env.VERCEL_ENV;
    expect(said(live)).toEqual(["If you would like to pay by credit or debit card, please stay on the line. To receive a payment link instead, press 0."]);
    expect(redirect(await call("phonepay-option", { Digits: "2" }, `o=${orderId}`))).toBe(`phonepay-go?o=${orderId}`); // 2 is not a choice here
    await db.delete(schema.phonepayAttempts);
    expect(redirect(await call("phonepay-option", { Digits: "5" }, `o=${orderId}`))).toBe(`phonepay-go?o=${orderId}`);
    expect(redirect(await call("phonepay-option", { Digits: "0" }, `o=${orderId}`))).toBe(`paylink?o=${orderId}`); // 0: the payment link, text or email (box 141)
  });

  it("each try dials Sola PhonePay straight from the hotline (no SIP), with the PIN, the order amount and star to come back", async () => {
    const x = await call("phonepay-go", {}, `o=${orderId}&c=1`);
    expect(x).toContain('hangupOnStar="true"');
    expect(x).not.toContain("<Sip");
    expect(x).toMatch(/<Number sendDigits="w+4321#w+80000#w+1">\+18334343354<\/Number>/);
    expect(x).toContain('record="do-not-record"');
    expect(said(x)).toEqual(["We will now connect you to our secure payment line. All card information is processed securely and directly by our provider, to ensure your card details remain private and protected. This may take a few moments. Please stay on the line while we connect you. Once your payment has been processed, please remain on the line to receive your booking confirmation."]); // after box 140 (no key): the hold line, then the payment line
    const [a] = await db.select().from(schema.phonepayAttempts);
    expect(a).toMatchObject({ orderId, tryNumber: 1, amountCents: 80000 });
  });

  it("box 140 (Abraham, Nov 24, 2026): no key -> the hold line and the payment line; 0 -> box 141, no hold line; wrong key -> not valid and box 140 again", async () => {
    const { eq } = await import("drizzle-orm");
    const [o2] = await db.insert(schema.orders).values({ status: "PENDING_PAYMENT", channel: "PHONE", eventDate: "2026-12-01", pickupDate: "2026-12-02", subtotalCents: 10000, totalCents: 10000 }).returning();
    const first = await call("phonepay-go", {}, `o=${o2.id}`);
    expect(said(first)).toEqual(["If you would like to pay by credit or debit card, please stay on the line. To receive a payment link instead, press 0."]);
    expect(first).toContain('timeout="5"');
    expect(first).not.toContain("<Dial");
    expect(redirect(first)).toBe(`phonepay-go?o=${o2.id}&c=1`); // no key
    const zero = await call("phonepay-option", { Digits: "0" }, `o=${o2.id}`);
    expect(redirect(zero)).toBe(`paylink?o=${o2.id}`);
    expect(said(zero).join(" ")).not.toContain("All card information");
    const bad = await call("phonepay-option", { Digits: "5" }, `o=${o2.id}`);
    expect(said(bad)).toEqual(["Sorry, that is not a valid selection."]);
    expect(redirect(bad)).toBe(`phonepay-go?o=${o2.id}`);
    const go = await call("phonepay-go", {}, `o=${o2.id}&c=1`);
    expect(said(go)).toEqual(["We will now connect you to our secure payment line. All card information is processed securely and directly by our provider, to ensure your card details remain private and protected. This may take a few moments. Please stay on the line while we connect you. Once your payment has been processed, please remain on the line to receive your booking confirmation."]);
    expect(go).toContain("<Dial");
    // a retry: the hold line, no box 140
    const retry = await call("phonepay-go", {}, `o=${o2.id}`);
    expect(said(retry)).toEqual(["We will now connect you to our secure payment line. All card information is processed securely and directly by our provider, to ensure your card details remain private and protected. This may take a few moments. Please stay on the line while we connect you. Once your payment has been processed, please remain on the line to receive your booking confirmation."]);
    expect(retry).toContain("<Dial");
    await db.delete(schema.phonepayAttempts).where(eq(schema.phonepayAttempts.orderId, o2.id));
  });

  it("phone pass 2 #4: the payment line and the backup both did not answer: no decline, no 'did not go through', the payment link menu", async () => {
    const { eq } = await import("drizzle-orm");
    const [o3] = await db.insert(schema.orders).values({ status: "PENDING_PAYMENT", channel: "PHONE", eventDate: "2026-11-23", pickupDate: "2026-11-23", subtotalCents: 50000, totalCents: 50000, holdExpiresAt: new Date(Date.now() + 600_000) }).returning();
    const [t] = await db.insert(schema.phonepayAttempts).values({ orderId: o3.id, callSid: "CApp", tryNumber: 1, amountCents: 50000 }).returning();
    for (const st of ["no-answer", "busy", "failed"]) {
      await db.update(schema.phonepayAttempts).set({ endedAt: null }).where(eq(schema.phonepayAttempts.id, t.id));
      const x = await call("phonepay-done", { DialCallStatus: st }, `o=${o3.id}&a=${t.id}&b=1`);
      expect(redirect(x), st).toBe(`paylink?o=${o3.id}`);
      expect(said(x).join(" ")).not.toMatch(/did not go through/);
    }
    const [after] = await db.select().from(schema.orders).where(eq(schema.orders.id, o3.id));
    expect(after.paymentResult).not.toBe("declined");
    // the backup line answered (completed): the usual check, as before
    const done = await call("phonepay-done", { DialCallStatus: "completed" }, `o=${o3.id}&a=${t.id}&b=1`);
    expect(redirect(done)).toMatch(/^phonepay-retry/);
    await db.delete(schema.phonepayAttempts).where(eq(schema.phonepayAttempts.orderId, o3.id));
  });

  it("no charge: the try-again menu on our line; a wrong amount is voided and the Owner is emailed", async () => {
    const tries = await db.select().from(schema.phonepayAttempts);
    // PhonePay did not answer: the backup number on the same try, no retry menu
    const backup = await call("phonepay-done", { DialCallStatus: "failed" }, `o=${orderId}&a=${tries[0].id}`);
    expect(backup).toContain(">+18444227356</Number>");
    expect(backup).toContain(`phonepay-done?o=${orderId}&amp;a=${tries[0].id}&amp;b=1`);
    let x = await call("phonepay-done", { DialCallStatus: "completed", DialCallSid: "CAleg1" }, `o=${orderId}&a=${tries[0].id}&b=1`);
    expect(redirect(x)).toBe(`phonepay-retry?o=${orderId}&n=1`);
    const [t1] = await db.select().from(schema.phonepayAttempts).where((await import("drizzle-orm")).eq(schema.phonepayAttempts.id, tries[0].id));
    expect(t1.payLegSid).toBe("CAleg1");
    x = await call("phonepay-retry", {}, `o=${orderId}&n=1`);
    expect(said(x)).toContain("We are sorry, your card did not go through. To try again, press 1.");
    expect(redirect(await call("phonepay-retry-answer", { Digits: "1" }, `o=${orderId}&n=1`))).toBe(`phonepay-go?o=${orderId}`);
    await call("phonepay-go", {}, `o=${orderId}`); // a later try: straight to the card (the link question is only before the first)
    const [, second] = await db.select().from(schema.phonepayAttempts).orderBy(schema.phonepayAttempts.id);
    expect(second.tryNumber).toBe(2);
    h.sola = [{ xRefNum: "WRONG1", xAmount: "1.00", xEnteredDate: nowEastern() }];
    x = await call("phonepay-done", {}, `o=${orderId}&a=${second.id}`);
    expect(h.voided).toEqual(["WRONG1"]);
    expect(h.emails.some((e) => e.includes("wrong phone payment amount"))).toBe(true);
    const [o] = await db.select().from(schema.orders).where((await import("drizzle-orm")).eq(schema.orders.id, orderId));
    expect(o.paidCents).toBe(0);
    expect(redirect(x)).toBe(`phonepay-retry?o=${orderId}&n=2`);
  });

  it("tries per call from Admin (3 to start, Abraham, Nov 17, 2026): try 2 warns and emails; try 3 ends the call and emails; no payment link anywhere", async () => {
    h.emails = [];
    let x = await call("phonepay-retry", {}, `o=${orderId}&n=2`);
    expect(said(x)).toContain("We are sorry, your card did not go through. You have one more chance. To try again, press 1.");
    expect(h.emails.some((e) => e.includes("failed 2 times"))).toBe(true);
    x = await call("phonepay-retry", {}, `o=${orderId}&n=3`);
    expect(said(x)).toEqual(["We are sorry, we were not able to process your card at this time. Please call us back later to complete your order, or you can contact customer service at extension 3 from the main menu. Thank you for calling Hup Up Attractions. Goodbye."]);
    expect(x).toContain("<Hangup/>");
    expect(h.emails.some((e) => e.includes("failed 3 times"))).toBe(true);
    expect(x).not.toMatch(/payment link/i);
  });

  it("09:00 P13: when the last try could not be confirmed, the caller hears the same line but the Owner email says a charge may have gone through", async () => {
    h.emails = [];
    const x = await call("phonepay-retry", {}, `o=${orderId}&n=3&u=1`);
    expect(said(x)).toEqual(["We are sorry, we were not able to process your card at this time. Please call us back later to complete your order, or you can contact customer service at extension 3 from the main menu. Thank you for calling Hup Up Attractions. Goodbye."]);
    expect(h.emails.some((e) => e.includes("could not be confirmed 3 times"))).toBe(true);
    expect(h.emails.some((e) => e.includes("failed 3 times"))).toBe(false);
  });

  it("the order total found in Sola: paid, and the thank-you plays", async () => {
    h.sola = [{ xRefNum: "GOOD1", xAmount: "800.00", xEnteredDate: nowEastern() }];
    await call("phonepay-go", {}, `o=${orderId}`);
    const all = await db.select().from(schema.phonepayAttempts).orderBy(schema.phonepayAttempts.id);
    const x = await call("phonepay-done", {}, `o=${orderId}&a=${all.at(-1)!.id}`);
    // Box 148 only after Sola approves (Abraham, Nov 18, 2026)
    expect(redirect(x)).toBe(`pay-approved?o=${orderId}`);
    const [o] = await db.select().from(schema.orders).where((await import("drizzle-orm")).eq(schema.orders.id, orderId));
    expect(o.paidCents).toBe(80000);
    expect(all.at(-1)!.tryNumber).toBe(3);
  });

  it("box 147 (Abraham, Nov 18, 2026): not certain = no guess; a later try with the caller's phone in Invoice pays, and the unclear charge is voided and emailed", async () => {
    const [o2] = await db.insert(schema.orders).values({ status: "PENDING_PAYMENT", channel: "PHONE", eventDate: "2026-11-22", pickupDate: "2026-11-22", subtotalCents: 80000, totalCents: 80000 }).returning();
    // another caller paying the same amount at the same time
    await db.insert(schema.phonepayAttempts).values({ callSid: "CAother", amountCents: 80000 });
    h.sola = [{ xRefNum: "UNC1", xAmount: "800.00", xEnteredDate: nowEastern(), xInvoice: "8454157585" }];
    await call("phonepay-go", {}, `o=${o2.id}&c=1`);
    let all = await db.select().from(schema.phonepayAttempts).orderBy(schema.phonepayAttempts.id);
    let x = await call("phonepay-done", {}, `o=${o2.id}&a=${all.at(-1)!.id}`);
    expect(redirect(x)).toContain("phonepay-retry");
    expect(redirect(x)).toContain("u=1");
    x = await call("phonepay-retry", {}, redirect(x)!.split("?")[1]);
    expect(said(x)).toContain("Sorry, we could not confirm your payment. To try again, press 1.");
    all = await db.select().from(schema.phonepayAttempts).orderBy(schema.phonepayAttempts.id);
    expect(all.at(-1)!.unclearRefs).toBe("UNC1");
    // try again: this time Sola shows the caller's own phone in Invoice
    h.sola = [{ xRefNum: "UNC1", xAmount: "800.00", xEnteredDate: nowEastern(), xInvoice: "8454157585" }, { xRefNum: "MINE2", xAmount: "800.00", xEnteredDate: nowEastern(), xInvoice: "8457990925" }];
    h.voided = [];
    h.emails = [];
    await call("phonepay-go", {}, `o=${o2.id}`);
    all = await db.select().from(schema.phonepayAttempts).orderBy(schema.phonepayAttempts.id);
    x = await call("phonepay-done", {}, `o=${o2.id}&a=${all.at(-1)!.id}`);
    // Box 148 only after Sola approves (Abraham, Nov 18, 2026)
    expect(redirect(x)).toBe(`pay-approved?o=${o2.id}`);
    expect(h.voided).toEqual(["UNC1"]);
    expect(h.emails.some((e) => e.includes("unclear phone payment checked"))).toBe(true);
  });
  it("decline bug (Abraham's test call, Nov 24, 2026): the declined line plays once, then the caller is sent back to PhonePay; a second decline does the same", async () => {
    const { eq } = await import("drizzle-orm");
    const [o3] = await db.insert(schema.orders).values({ status: "PENDING_PAYMENT", channel: "PHONE", eventDate: "2026-11-27", pickupDate: "2026-11-27", subtotalCents: 45000, totalCents: 45000 }).returning();
    h.sola = []; // Sola shows no approved charge: declined
    const tryOnce = async (n: number, line: string) => {
      const go = await call("phonepay-go", {}, `o=${o3.id}${n === 1 ? "&c=1" : ""}`);
      expect(go).toMatch(/<Number sendDigits="w+4321#w+45000#w+1">\+18334343354<\/Number>/); // same order, same amount
      const tries = await db.select().from(schema.phonepayAttempts).where(eq(schema.phonepayAttempts.orderId, o3.id)).orderBy(schema.phonepayAttempts.id);
      expect(tries).toHaveLength(n);
      expect(tries.at(-1)).toMatchObject({ tryNumber: n, amountCents: 45000 });
      const done = await call("phonepay-done", { DialCallStatus: "completed" }, `o=${o3.id}&a=${tries.at(-1)!.id}`);
      expect(redirect(done)).toBe(`phonepay-retry?o=${o3.id}&n=${n}`);
      const retry = await call("phonepay-retry", {}, `o=${o3.id}&n=${n}`);
      expect(said(retry).filter((s) => s === line)).toHaveLength(1); // the declined line once
      expect(said(retry)).toEqual([line]);
      expect(redirect(retry)).toBe(`phonepay-go?o=${o3.id}`); // then straight back to PhonePay, never the line again
      // a key during the line also goes back to PhonePay (no repeat, no wrong-key line)
      for (const Digits of ["1", "5", ""]) {
        const x = await call("phonepay-retry-answer", { Digits }, `o=${o3.id}&n=${n}&d=1`);
        expect(said(x)).toEqual([]);
        expect(redirect(x)).toBe(`phonepay-go?o=${o3.id}`);
      }
    };
    await tryOnce(1, "We are sorry, your card did not go through. To try again, press 1.");
    await tryOnce(2, "We are sorry, your card did not go through. You have one more chance. To try again, press 1.");
    // the next try is really placed with PhonePay again
    expect(await call("phonepay-go", {}, `o=${o3.id}`)).toContain("+18334343354</Number>");
  });
  it("nothing before payment sounds finished: the order number is not read at checkout", async () => {
    const { readFileSync } = await import("node:fs");
    const f = readFileSync("src/lib/ivr/flow.ts", "utf8");
    expect(f).not.toContain('sp(vr, ctx, "thanks_order"');
  });
});

