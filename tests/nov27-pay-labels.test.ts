import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Abraham, Nov 27, 2026 (item 4): the pay page lines add up to "Total due", grouped under "Discount", "Already paid"
 * (not counted) and "Partial payment" ("Paid so far"), each heading only when it has lines; a Saturday-night pickup
 * (Friday rentals on Chanukah and Chol Hamoed) gets the Mutze Shabbes sentence. Same grouping on the receipt and the
 * payment link email.
 */
const h = vi.hoisted(() => ({ orders: [] as any[] }));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({ redirect: () => undefined, notFound: () => { throw new Error("not found"); } }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => undefined }));
vi.mock("@/lib/order-pricing", () => ({ ensurePriced: async () => true, ensureGroupPriced: async () => true }));
vi.mock("@/lib/orders", async (orig) => ({
  ...(await orig<typeof import("@/lib/orders")>()),
  getPaymentGroup: async () => ({ primary: h.orders[0], orders: h.orders, due: h.orders.filter((d) => d.order.status === "PENDING_PAYMENT").reduce((n, d) => n + Math.max(0, d.order.totalCents - d.order.paidCents), 0), paid: false }),
}));

process.env.AUTH_SECRET = "test-secret-at-least-24-characters-long";
process.env.SOLA_PAYMENTSITE_NAME = "hupuptest";
process.env.TERMS_ACTIVE = "1";
const { default: PayPage } = await import("@/app/pay/[orderId]/page");
const { payToken } = await import("@/lib/rental-terms");
const { payBreakdown, payBreakdownText, pickupSentence, mutzePickupTime, PICKUP_9AM_SENTENCE } = await import("@/lib/pay-breakdown");
const { phoneReceipt } = await import("@/lib/phone-receipt");
const { getSettings } = await import("@/lib/settings");
const { renderToStaticMarkup } = await import("react-dom/server");

const day = (id: number, o: Record<string, unknown>, items: { qty: number; name: string; unitPriceCents: number }[]) => ({
  order: { id, status: "PENDING_PAYMENT", subtotalCents: 0, totalCents: 0, paidCents: 0, deliveryFeeCents: 0, taxCents: 0, taxPercent: "8.125", offerDiscountCents: 0, offerNote: null, holdExpiresAt: null, linkHoldKind: null, ...o },
  items: items.map((i, n) => ({ id: id * 10 + n, ...i })),
  services: [],
  customer: { id: 1, phone: "+18455550100", name: "Y F", email: null },
});
// Sundays Dec 13 and Dec 20 (one Castle each); Dec 20 is the 4th Sunday (free); Dec 13 is already paid
function mixed() {
  return [
    // the 4th Sunday: $150 rental free, delivery $20, tax 8.125% of $20 = $1.63 -> total $21.63; $10.00 paid so far
    day(7, { eventDate: "2026-12-20", pickupDate: "2026-12-21", subtotalCents: 0, offerDiscountCents: 15000, offerNote: "4th Sunday free", deliveryFeeCents: 2000, taxCents: 163, totalCents: 2163, paidCents: 1000 }, [{ qty: 1, name: "Castle", unitPriceCents: 15000 }]),
    // already paid day
    day(8, { status: "CONFIRMED", eventDate: "2026-12-13", pickupDate: "2026-12-14", subtotalCents: 15000, deliveryFeeCents: 1000, taxCents: 1300, totalCents: 17300, paidCents: 17300 }, [{ qty: 1, name: "Castle", unitPriceCents: 15000 }]),
    // another day still to pay, with two items
    day(9, { eventDate: "2026-12-27", pickupDate: "2026-12-28", subtotalCents: 20000, deliveryFeeCents: 0, taxCents: 1625, totalCents: 21625 }, [{ qty: 1, name: "Castle", unitPriceCents: 15000 }, { qty: 1, name: "Slide", unitPriceCents: 5000 }]),
  ];
}
const page = async () => renderToStaticMarkup(await PayPage({ params: Promise.resolve({ orderId: "7" }), searchParams: Promise.resolve({ t: payToken(7) }) }));
const cents = (s: string) => Math.round(Number(s.replace(/[$,]/g, "")) * 100);

beforeEach(() => {
  h.orders = mixed();
});

describe("pay page labels", () => {
  it("4th-Sunday offer + one day already paid + a partial payment: all three headings, and the lines add up to Total due", async () => {
    const html = await page();
    expect(html).toContain(">Discount</h2>");
    expect(html).toContain(">Already paid</h2>");
    expect(html).toContain(">Partial payment</h2>");
    expect(html).toContain("Offer: 4th Sunday free, minus $150.00");
    expect(html).toContain("Paid so far: $10.00");
    expect(html).toMatch(/data-pay-already-paid[^>]*><span>Sunday, December 13: 1 × Castle<\/span><span[^>]*>Already paid<\/span>/);
    // add up: every charge line, minus the discount and the partial payment = Total due (the paid day is not counted)
    const charges = [...html.matchAll(/data-pay-line[^>]*><span>.*?<\/span><span>(\$[\d.,]+)<\/span>/g)].map((m) => cents(m[1]));
    const total = cents(html.match(/<span>Total due<\/span><span>(\$[\d.,]+)<\/span>/)![1]);
    expect(charges.reduce((a, b) => a + b, 0) - 15000 - 1000).toBe(total);
    expect(total).toBe(2163 - 1000 + 21625);
    expect(html).not.toMatch(/data-pay-day[^]*December 13[^]*data-pay-group="discount"/); // the paid day has no charge lines
    const b = payBreakdown(h.orders);
    expect(b.totalDueCents).toBe(total);
  });

  it("headings only when they have lines; the usual 9:00 AM sentence on a regular rental", async () => {
    h.orders = [mixed()[2]];
    const html = await page();
    expect(html).not.toContain(">Discount</h2>");
    expect(html).not.toContain(">Already paid</h2>");
    expect(html).not.toContain(">Partial payment</h2>");
    expect(html).toContain("Total due</span><span>$216.25");
    expect(html).toContain(PICKUP_9AM_SENTENCE);
  });

  it("a Chanukah Friday rental (picked up Saturday night) gets exactly the Mutze Shabbes sentence, time from the Admin setting", async () => {
    const s = await getSettings();
    const time = mutzePickupTime("2026-12-12", s as never)!;
    expect(time).toMatch(/^\d{1,2}:\d{2} PM$/);
    h.orders = [day(7, { eventDate: "2026-12-11", pickupDate: "2026-12-12", subtotalCents: 15000, totalCents: 15000 }, [{ qty: 1, name: "Castle", unitPriceCents: 15000 }])];
    const html = await page();
    expect(html).toContain(`Please have the rental outside your door on Mutze Shabbes ${time}.`);
    expect(html).not.toContain("by 9:00 AM.");
    // the time follows the Admin setting (Offers: Friday pickup minutes after Shabbes ends)
    const later = mutzePickupTime("2026-12-12", { ...(s as object), holidayPickupAfterShabbesMin: "90" } as never)!;
    const toMin = (t: string) => { const [, hh, mm] = /^(\d+):(\d+)/.exec(t)!; return Number(hh) * 60 + Number(mm); };
    expect(toMin(later) - toMin(time)).toBe(30);
    expect(pickupSentence([{ pickupDate: "2026-12-14" }], s as never)).toBe(PICKUP_9AM_SENTENCE);
  });

  it("the receipt and the payment link email carry the same grouping", async () => {
    const text = payBreakdownText(payBreakdown(h.orders), PICKUP_9AM_SENTENCE);
    for (const s of ["\nDiscount\n  Offer: 4th Sunday free, minus $150.00", "\nAlready paid\n  Sunday, December 13: 1 × Castle: $173.00, Already paid", "\nPartial payment\n  Paid so far: $10.00", "\nTotal due: $227.88"]) expect(text).toContain(s);
    const r = phoneReceipt({ orderId: 7, paidAt: new Date("2026-12-01T15:00:00Z"), amountCents: 22788, last4: "4242", grouped: text });
    expect(r.text).toContain("Thank you for your payment!");
    expect(r.text).toContain("Paid so far: $10.00");
    // receipt mode: what was paid before this payment shows as Paid so far; Total due = the amount just paid
    const receipt = payBreakdown(h.orders.map((d) => ({ ...d, order: { ...d.order, status: d.order.id === 8 ? "CONFIRMED" : "CONFIRMED", paidCents: d.order.id === 7 ? 2163 : d.order.id === 9 ? 21625 : d.order.paidCents } })), { paidNowCents: 22788 });
    expect(receipt.totalDueCents).toBe(22788);
    const fs = await import("node:fs");
    const flow = fs.readFileSync("src/lib/ivr/flow.ts", "utf8");
    expect(flow).toContain('sendEmail(via.email, promptText(ctx.prompts, "msg_payment_link_subject", { number: num }), `${details}\\n\\n${grouped}`)');
    expect(fs.readFileSync("src/lib/phone-receipt.ts", "utf8")).toContain("receiptGrouping(input.orderId, input.amountCents)");
  });
});
