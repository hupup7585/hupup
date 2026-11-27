import crypto from "node:crypto";
import { describe, expect, it, vi } from "vitest";

/* Deep check Nov 27, 9:00 AM, P2: "Check availability again" on an expired payment link took items off; the customer then
   paid the old amount on a card page still open. Every item taken: the empty day was confirmed, the customer was texted
   "paid" and Books took it all as a tip. Now it is a late payment whose items were taken (Needs attention, no paid text,
   Books "Overpayment (refund due)"). Some items taken: confirmed for what is left, and the Owner is emailed to refund the
   difference. Through the real Sola notice. */
const h = vi.hoisted(() => ({ texts: [] as string[], emails: [] as string[] }));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/notify", () => ({
  sendEmail: async (_to: string, subject: string) => (h.emails.push(subject), { sent: true }),
  sendSms: async (_to: string, body: string) => (h.texts.push(body), { sent: true }),
}));

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { invoiceFor } from "@/lib/sola";
import { holdAgain } from "@/lib/late-payment";
import { POST as solaWebhook } from "@/app/api/sola/webhook/route";

process.env.SOLA_WEBHOOK_PIN = "pin";
process.env.ADMIN_EMAIL = "owner@example.com";
const post = (fields: Record<string, string>) => {
  const lowered = Object.entries(fields).map(([k, v]) => [k.toLowerCase(), v] as const).sort(([a], [b]) => (a < b ? -1 : 1));
  const sig = crypto.createHash("md5").update(lowered.map(([, v]) => v).join("") + "pin").digest("hex");
  return solaWebhook(new Request("https://hupup.example/api/sola/webhook", { method: "POST", body: new URLSearchParams(fields).toString(), headers: { "ck-signature": sig } }));
};
const get = async (id: number) => (await db.select().from(schema.orders).where(eq(schema.orders.id, id)))[0];
const day = (n: number) => new Date(Date.now() + n * 86400_000).toISOString().slice(0, 10);

async function setup(tag: string, withSlide: boolean) {
  const [c] = await db.insert(schema.categories).values({ name: `Bounce ${tag}`, sortOrder: 1 }).returning();
  const [castle] = await db.insert(schema.products).values({ categoryId: c.id, name: `Castle ${tag}`, priceCents: 20000, quantity: 1 }).returning();
  const [slide] = await db.insert(schema.products).values({ categoryId: c.id, name: `Slide ${tag}`, priceCents: 10000, quantity: 1 }).returning();
  const [cu] = await db.insert(schema.customers).values({ name: "Rivky", phone: `+1845555${tag.padStart(4, "0")}`, email: `r${tag}@example.com` }).returning();
  const d = day(withSlide ? 30 : 25);
  const total = withSlide ? 32000 : 21000;
  const [mine] = await db
    .insert(schema.orders)
    .values({ status: "PENDING_PAYMENT", channel: "POS", customerId: cu.id, eventDate: d, pickupDate: day(withSlide ? 31 : 26), deliveryAddress: "1 Main St, Kiryas Joel, NY", subtotalCents: withSlide ? 30000 : 20000, totalCents: total, holdExpiresAt: new Date(Date.now() - 60_000), linkHoldKind: "admin" })
    .returning();
  await db.insert(schema.orderItems).values({ orderId: mine.id, productId: castle.id, qty: 1, unitPriceCents: 20000 });
  if (withSlide) await db.insert(schema.orderItems).values({ orderId: mine.id, productId: slide.id, qty: 1, unitPriceCents: 10000 });
  // someone else booked the only castle after the link expired
  const [other] = await db.insert(schema.orders).values({ status: "CONFIRMED", channel: "POS", eventDate: d, pickupDate: day(withSlide ? 31 : 26) }).returning();
  await db.insert(schema.orderItems).values({ orderId: other.id, productId: castle.id, qty: 1, unitPriceCents: 20000 });
  return { mine, total };
}

describe("deep check 09:00 P2", () => {
  it("every item taken by 'Check again', then the old card page is paid: Needs attention, no paid text, refund due in Books", async () => {
    const { mine, total } = await setup("2001", false);
    expect((await holdAgain([mine.id], mine.id)).removed).toBe(1);
    expect((await get(mine.id)).status).toBe("CANCELLED");
    h.texts.length = 0;
    h.emails.length = 0;
    expect((await post({ xResult: "A", xInvoice: invoiceFor(mine.id), xAuthAmount: (total / 100).toFixed(2), xRefNum: "P2A", xMaskedCardNumber: "4xxxxxxxxxxx1111" })).status).toBe(200);
    const after = await get(mine.id);
    expect(after.status).toBe("NEEDS_ATTENTION");
    expect(after.paidCents).toBe(total);
    expect(h.texts.some((t) => /paid|confirmed/i.test(t))).toBe(false); // the customer is not told "confirmed"
    expect(h.emails.some((s) => /needs staff attention/i.test(s))).toBe(true); // the Owner is told
    const books = await db.select().from(schema.bookEntries).where(eq(schema.bookEntries.orderId, mine.id));
    expect(books.map((b) => [b.category, b.amountCents, b.tipCents])).toEqual([["Overpayment (refund due)", total, 0]]);
  });

  it("some items taken, the old larger amount paid: confirmed for what is left, the Owner is emailed to refund the difference", async () => {
    const { mine, total } = await setup("2002", true);
    expect((await holdAgain([mine.id], mine.id)).removed).toBe(1);
    const shrunk = await get(mine.id);
    expect(shrunk.status).toBe("PENDING_PAYMENT");
    const owed = shrunk.totalCents ?? shrunk.subtotalCents;
    expect(owed).toBeLessThan(total);
    h.emails.length = 0;
    expect((await post({ xResult: "A", xInvoice: invoiceFor(mine.id), xAuthAmount: (total / 100).toFixed(2), xRefNum: "P2B", xMaskedCardNumber: "4xxxxxxxxxxx1111" })).status).toBe(200);
    const after = await get(mine.id);
    expect(after.status).toBe("CONFIRMED");
    expect(after.notes).toContain("refund the difference");
    expect(h.emails.some((s) => s.includes("too much"))).toBe(true);
  });

  it("a normal on-time payment of the full total gets no refund note", async () => {
    const [o] = await db.insert(schema.orders).values({ status: "PENDING_PAYMENT", channel: "PHONE", eventDate: day(40), pickupDate: day(41), subtotalCents: 9000, totalCents: 9000, holdExpiresAt: new Date(Date.now() + 600_000) }).returning();
    h.emails.length = 0;
    await post({ xResult: "A", xInvoice: invoiceFor(o.id), xAuthAmount: "90.00", xRefNum: "P2C" });
    const after = await get(o.id);
    expect(after.status).toBe("CONFIRMED");
    expect(after.notes ?? "").not.toContain("refund");
    expect(h.emails.some((s) => s.includes("too much"))).toBe(false);
  });
});
