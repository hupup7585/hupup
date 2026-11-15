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
  it("each try dials the payment line with star to come back; the amount comes from the order", async () => {
    const x = await call("phonepay-go", {}, `o=${orderId}`);
    expect(x).toContain('hangupOnStar="true"');
    expect(x).toContain("X-Hup-Cents=80000");
    expect(said(x)).toContain("Thank you. Please hold for a moment while we connect you to our secure payment line.");
    const [a] = await db.select().from(schema.phonepayAttempts);
    expect(a).toMatchObject({ orderId, tryNumber: 1, amountCents: 80000 });
  });

  it("no charge: the try-again menu on our line; a wrong amount is voided and the Owner is emailed", async () => {
    const tries = await db.select().from(schema.phonepayAttempts);
    let x = await call("phonepay-done", {}, `o=${orderId}&a=${tries[0].id}`);
    expect(redirect(x)).toBe(`phonepay-retry?o=${orderId}&n=1`);
    x = await call("phonepay-retry", {}, `o=${orderId}&n=1`);
    expect(said(x)).toContain("Your card did not go through. To try again, press 1.");
    expect(redirect(await call("phonepay-retry-answer", { Digits: "1" }, `o=${orderId}&n=1`))).toBe(`phonepay-go?o=${orderId}`);
    await call("phonepay-go", {}, `o=${orderId}`);
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

  it("try 5 warns and emails; try 6 ends the call and emails; no payment link anywhere", async () => {
    h.emails = [];
    let x = await call("phonepay-retry", {}, `o=${orderId}&n=5`);
    expect(said(x)).toContain("Your card did not go through. You have one more chance to try. To try again, press 1.");
    expect(h.emails.some((e) => e.includes("failed 5 times"))).toBe(true);
    x = await call("phonepay-retry", {}, `o=${orderId}&n=6`);
    expect(said(x)).toEqual(["Sorry, your card did not go through. Please call us back to try again. Goodbye."]);
    expect(x).toContain("<Hangup/>");
    expect(h.emails.some((e) => e.includes("failed 6 times"))).toBe(true);
    expect(x).not.toMatch(/payment link/i);
  });

  it("the order total found in Sola: paid, and the thank-you plays", async () => {
    h.sola = [{ xRefNum: "GOOD1", xAmount: "800.00", xEnteredDate: nowEastern() }];
    await call("phonepay-go", {}, `o=${orderId}`);
    const all = await db.select().from(schema.phonepayAttempts).orderBy(schema.phonepayAttempts.id);
    const x = await call("phonepay-done", {}, `o=${orderId}&a=${all.at(-1)!.id}`);
    expect(said(x)).toContain("Your payment was received. You are all set!");
    const [o] = await db.select().from(schema.orders).where((await import("drizzle-orm")).eq(schema.orders.id, orderId));
    expect(o.paidCents).toBe(80000);
    expect(all.at(-1)!.tryNumber).toBe(3);
  });
});
