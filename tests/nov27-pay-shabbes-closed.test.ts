import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Abraham, Nov 27, 2026 (item 2): payment links do not work on Shabbes and Yom Tov. From the phone's cut-off (15
 * minutes before candle lighting) until the phone reopens, the pay page shows a closed notice (no card form) and the
 * server rejects a direct payment request. Right after Shabbes ends the same link works again.
 */
const h = vi.hoisted(() => ({ redirected: "", order: null as unknown }));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "1.2.3.4", "user-agent": "UA" }) }));
vi.mock("next/navigation", () => ({ redirect: (u: string) => ((h.redirected = u), undefined), notFound: () => { throw new Error("not found"); } }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => undefined }));
vi.mock("@/lib/order-pricing", () => ({ ensurePriced: async () => true, ensureGroupPriced: async () => true }));
vi.mock("@/lib/orders", async (orig) => ({
  ...(await orig<typeof import("@/lib/orders")>()),
  getPaymentGroup: async () => (h.order ? ((o: any) => ({ primary: o, orders: [o], due: o.order.totalCents - o.order.paidCents }))(h.order) : null),
}));
vi.mock("@/lib/rental-terms", async (orig) => ({ ...(await orig<typeof import("@/lib/rental-terms")>()), recordTermsAcceptance: async () => 1 }));

process.env.AUTH_SECRET = "test-secret-at-least-24-characters-long";
process.env.SOLA_PAYMENTSITE_NAME = "hupuptest";
const { agreeAndPayAction } = await import("@/app/pay/[orderId]/actions");
const { default: PayPage } = await import("@/app/pay/[orderId]/page");
const { payToken } = await import("@/lib/rental-terms");
const { PAYMENTS_CLOSED_PLACEHOLDER, paymentsClosedLine } = await import("@/lib/payments-closed");
const { bookingLock, erevCandleLighting, calendarDefaults } = await import("@/lib/jewish-calendar");

const pinned = process.env.HUP_CALENDAR_NOW;
const setNow = (d: Date) => (process.env.HUP_CALENDAR_NOW = d.toISOString());
const S = calendarDefaults();
const candles = erevCandleLighting("2026-11-20", S)!; // Friday, Parshas Vayeitzei
const tenBefore = new Date(candles.getTime() - 10 * 60_000);
const shabbesEnds = bookingLock(new Date("2026-11-21T17:00:00Z"), S).opensAt!; // the phone's reopen time

beforeEach(() => {
  h.redirected = "";
  h.order = { order: { id: 7, status: "PENDING_PAYMENT", subtotalCents: 25000, totalCents: 28113, paidCents: 0, eventDate: "2026-11-23", pickupDate: "2026-11-24", deliveryFeeCents: 0, taxCents: 0, taxPercent: "8.125", offerDiscountCents: 0, offerNote: null }, items: [], services: [], customer: { id: 3, phone: "+18455550100", name: "Y F", email: null } };
});
afterEach(() => {
  process.env.HUP_CALENDAR_NOW = pinned;
});
const page = async () => JSON.stringify(await PayPage({ params: Promise.resolve({ orderId: "7" }), searchParams: Promise.resolve({ t: payToken(7) }) }));

describe("payment links on Shabbes and Yom Tov", () => {
  it("the window is the phone's: 15 minutes before candle lighting until the phone reopens (no extra hour)", async () => {
    expect(await paymentsClosedLine(new Date(candles.getTime() - 16 * 60_000))).toBeNull();
    expect(await paymentsClosedLine(new Date(candles.getTime() - 15 * 60_000))).toBe(PAYMENTS_CLOSED_PLACEHOLDER);
    expect(await paymentsClosedLine(new Date("2026-11-21T17:00:00Z"))).toBe(PAYMENTS_CLOSED_PLACEHOLDER); // Shabbes noon
    expect(await paymentsClosedLine(new Date(shabbesEnds.getTime() - 60_000))).toBe(PAYMENTS_CLOSED_PLACEHOLDER);
    expect(await paymentsClosedLine(shabbesEnds)).toBeNull();
    // Yom Tov too (first day of Pesach 2027, Thursday April 22)
    expect(await paymentsClosedLine(new Date("2027-04-22T16:00:00Z"))).toBe(PAYMENTS_CLOSED_PLACEHOLDER);
  });

  it("link opened 10 minutes before candle lighting: closed notice, no card form; a direct payment request is rejected", async () => {
    setNow(tenBefore);
    const html = await page();
    expect(html).toContain("data-payments-closed");
    expect(html).toContain(PAYMENTS_CLOSED_PLACEHOLDER);
    expect(html).not.toContain("data-rental-window");
    expect(html).not.toMatch(/PayForm|xAmount/);
    const r = await agreeAndPayAction(7, payToken(7), true);
    expect(r).toEqual({ error: PAYMENTS_CLOSED_PLACEHOLDER });
    expect(h.redirected).toBe(""); // never sent to the card page
  });

  it("deep check 06:00 M39: an expired link (every day released, nothing due) is closed too: no Check availability again button", async () => {
    setNow(tenBefore);
    h.order = { order: { id: 7, status: "CANCELLED", subtotalCents: 25000, totalCents: 0, paidCents: 0, eventDate: "2026-11-23", pickupDate: "2026-11-24", holdExpiresAt: new Date(tenBefore.getTime() - 3600_000), deliveryFeeCents: 0, taxCents: 0, taxPercent: "8.125", offerDiscountCents: 0, offerNote: null }, items: [{ qty: 1 }], services: [], customer: { id: 3, phone: "+18455550100", name: "Y F", email: null } };
    const html = await page();
    expect(html).toContain("data-payments-closed");
    expect(html).not.toContain("data-check-again");
  });

  it("right after Shabbes ends the same link works again automatically", async () => {
    setNow(new Date(shabbesEnds.getTime() + 60_000));
    expect(await page()).not.toContain("data-payments-closed");
    h.redirected = "";
    await agreeAndPayAction(7, payToken(7), true);
    expect(h.redirected).toContain("xAmount=281.13");
  });

  it("the placeholder is short and neutral, and on the Open decisions list for Abraham", async () => {
    expect(PAYMENTS_CLOSED_PLACEHOLDER).toBe("Payments are closed at this time.");
    const doc = (await import("node:fs")).readFileSync("docs/open-decisions-for-abraham.md", "utf8");
    expect(doc).toContain(PAYMENTS_CLOSED_PLACEHOLDER);
    expect(doc).toMatch(/hold/i);
    expect(doc).toMatch(/website checkout/i);
  });
});
