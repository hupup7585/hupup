import { beforeAll, describe, expect, it, vi } from "vitest";

/* Refunds from Admin (Abraham, Nov 13, 2026): Stripe phone and Sola website payments. Sandbox simulated. */
const h = vi.hoisted(() => ({ emails: [] as { to: string; subject: string; text: string }[] }));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/notify", async (orig) => ({
  ...(await orig<typeof import("@/lib/notify")>()),
  sendEmail: async (to: string, subject: string, text: string) => (h.emails.push({ to, subject, text }), { sent: true }),
  sendSms: async () => ({ sent: false }),
}));

import { eq } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { db, schema } from "@/lib/db";
import { LIVE_REFUNDS_APPROVED, plainReason, refundOrder, refundQuestion, refundStatus, refundsFor } from "@/lib/refunds";

const sola = (reply: Record<string, string>) => {
  const sent: Record<string, string>[] = [];
  const f = (async (_u: string, init: RequestInit) => (sent.push(JSON.parse(String(init.body))), new Response(JSON.stringify(reply)))) as unknown as typeof fetch;
  return { f, sent };
};
let solaOrder = 0;
const order = async (id: number) => (await db.select().from(schema.orders).where(eq(schema.orders.id, id)))[0];

beforeAll(async () => {
  process.env.ADMIN_EMAIL = "hupupattractions@gmail.com";
  process.env.SOLA_API_KEY = "sola_sandbox_key";
  process.env.SOLA_REFUND_MODE = "sandbox";
  const [o] = await db
    .insert(schema.orders)
    .values({ status: "CONFIRMED", channel: "POS", eventDate: "2026-12-20", pickupDate: "2026-12-21", subtotalCents: 12000, totalCents: 14056, paidCents: 14056, paymentMethod: "sola", solaRefNum: "1234567890", cardLast4: "1111", paymentResult: "approved", paymentResultAt: new Date() })
    .returning();
  solaOrder = o.id;
});

describe("Sola refunds (website payments)", () => {
  it("cc:refund by the saved transaction ref, with the Sola key; a new dated entry; original payment untouched", async () => {
    const { f, sent } = sola({ xResult: "A", xStatus: "Approved", xRefNum: "999001" });
    const r = await refundOrder(solaOrder, 4000, 3, f);
    expect(sent[0]).toMatchObject({ xKey: "sola_sandbox_key", xCommand: "cc:refund", xRefNum: "1234567890", xAmount: "40.00" });
    expect(r).toMatchObject({ amountCents: 4000, provider: "sola", stripeRefundId: "sola:999001", userId: 3, status: "succeeded" });
    const o = await order(solaOrder);
    expect([o.paidCents, o.solaRefNum, o.refundedCents]).toEqual([14056, "1234567890", 4000]); // payment never edited
    expect(refundStatus(o)).toBe("Partly refunded");
    const books = await db.select().from(schema.bookEntries).where(eq(schema.bookEntries.kind, "refund"));
    expect(books.map((b) => [b.amountCents, b.method])).toEqual([[4000, "sola"]]);
  });
  it("a declined refund: reason in plain words, kept on the order, Abraham emailed; nothing refunded", async () => {
    const { f } = sola({ xResult: "D", xStatus: "Declined", xError: "Original transaction not found" });
    await expect(refundOrder(solaOrder, 1000, 3, f)).rejects.toThrow("The payment couldn't be found at the card company.");
    expect((await refundsFor(solaOrder))[0]).toMatchObject({ status: "failed", provider: "sola" });
    expect((await order(solaOrder)).refundedCents).toBe(4000);
    expect(h.emails.at(-1)!.subject).toBe(`Refund failed on order #${1000 + solaOrder}`);
  });
  it("full refund of the rest: Refunded", async () => {
    await refundOrder(solaOrder, "full", 3, sola({ xResult: "A", xRefNum: "999002" }).f);
    expect(refundStatus(await order(solaOrder))).toBe("Refunded");
    await expect(refundOrder(solaOrder, 100, 3, sola({ xResult: "A", xRefNum: "x" }).f)).rejects.toThrow(/Enter an amount|At most/);
  });
});

describe("sandbox only until Abraham approves live refunds", () => {
  it("live keys are refused", async () => {
    expect(LIVE_REFUNDS_APPROVED).toBe(false);
    const [o] = await db.insert(schema.orders).values({ status: "CONFIRMED", channel: "PHONE", eventDate: "2026-12-22", pickupDate: "2026-12-23", subtotalCents: 100, paidCents: 100, paymentMethod: "stripe", stripePaymentId: "ch_live" }).returning();
    process.env.STRIPE_REFUNDS_KEY = "rk_live_real";
    await expect(refundOrder(o.id, "full", 3)).rejects.toThrow("Live refunds are off until Abraham approves them.");
    delete process.env.STRIPE_REFUNDS_KEY;
    await expect(refundOrder(o.id, "full", 3)).rejects.toThrow("STRIPE_REFUNDS_KEY isn't in Vercel");
    process.env.SOLA_REFUND_MODE = "";
    await expect(refundOrder(solaOrder, 1, 3)).rejects.toThrow();
    process.env.SOLA_REFUND_MODE = "sandbox";
  });
});

describe("Admin", () => {
  it("Abraham's confirm question", () => {
    expect(refundQuestion(2500, "1234")).toBe("Refund $25.00 to card ending 1234? This cannot be undone.");
  });
  it("Owner only: the Refund box is shown only to the Owner; refunds need the Owner on the server too", () => {
    expect(readFileSync("src/app/admin/(app)/orders/[id]/page.tsx", "utf8")).toContain('staff.role === "owner" && (o.paymentMethod === "stripe" || o.paymentMethod === "sola")');
    expect(readFileSync("src/app/admin/(app)/orders/[id]/stripe-actions.ts", "utf8")).toMatch(/export async function refundAction[\s\S]*?await requireOwner\(\)/);
    expect(readFileSync("src/app/admin/(app)/orders/[id]/RefundPanel.tsx", "utf8")).toContain("? This cannot be undone.");
  });
  it("plain words for common reasons", () => {
    expect(plainReason("charge_already_refunded")).toBe("This payment was already refunded.");
    expect(plainReason("Invalid API Key provided")).toBe("The refund key isn't set up correctly. Nothing was refunded.");
  });
});
