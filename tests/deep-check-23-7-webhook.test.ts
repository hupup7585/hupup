import crypto from "node:crypto";
import { describe, expect, it, vi } from "vitest";

/* Deep check Nov 27 #23 (a decline never overwrites "Paid") and #7 (a halfway payment's repeat notice finishes it and
   sends the paid text once). In-memory database. */
const h = vi.hoisted(() => ({ texts: [] as string[] }));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/notify", () => ({ sendEmail: async () => ({ sent: true }), sendSms: async (_to: string, body: string) => (h.texts.push(body), { sent: true }) }));

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { invoiceFor } from "@/lib/sola";
import { POST as solaWebhook } from "@/app/api/sola/webhook/route";

process.env.SOLA_WEBHOOK_PIN = "pin";
const post = (fields: Record<string, string>) => {
  const lowered = Object.entries(fields).map(([k, v]) => [k.toLowerCase(), v] as const).sort(([a], [b]) => (a < b ? -1 : 1));
  const sig = crypto.createHash("md5").update(lowered.map(([, v]) => v).join("") + "pin").digest("hex");
  return solaWebhook(new Request("https://hupup.example/api/sola/webhook", { method: "POST", body: new URLSearchParams(fields).toString(), headers: { "ck-signature": sig } }));
};
const get = async (id: number) => (await db.select().from(schema.orders).where(eq(schema.orders.id, id)))[0];

describe("Sola notices", () => {
  it("#23: a declined notice after the approval leaves the order Paid", async () => {
    const [o] = await db.insert(schema.orders).values({ status: "PENDING_PAYMENT", channel: "PHONE", eventDate: "2027-10-13", pickupDate: "2027-10-14", subtotalCents: 8000, totalCents: 8000, holdExpiresAt: new Date(Date.now() + 600_000) }).returning();
    expect((await post({ xResult: "A", xInvoice: invoiceFor(o.id), xAuthAmount: "80.00", xRefNum: "OK1", xMaskedCardNumber: "4xxxxxxxxxxx1111" })).status).toBe(200);
    expect((await get(o.id)).paymentResult).toBe("approved");
    await post({ xResult: "D", xInvoice: invoiceFor(o.id), xAuthAmount: "80.00", xRefNum: "NO1" });
    const after = await get(o.id);
    expect([after.paymentResult, after.status]).toEqual(["approved", "CONFIRMED"]);
  });
  it("deep check 06:00 M40: 'Paid, card ending' only on the days this payment booked, never a released day with nothing paid", async () => {
    const [a] = await db.insert(schema.orders).values({ status: "PENDING_PAYMENT", channel: "PHONE", eventDate: "2027-10-27", pickupDate: "2027-10-28", subtotalCents: 5000, totalCents: 5000, holdExpiresAt: new Date(Date.now() + 600_000) }).returning();
    await db.update(schema.orders).set({ paymentGroupId: a.id }).where(eq(schema.orders.id, a.id));
    const [b] = await db.insert(schema.orders).values({ status: "CANCELLED", channel: "PHONE", eventDate: "2027-10-28", pickupDate: "2027-10-29", subtotalCents: 5000, totalCents: 5000, paymentGroupId: a.id }).returning();
    await db.insert(schema.orderStatusHistory).values({ orderId: b.id, fromStatus: "PENDING_PAYMENT", toStatus: "CANCELLED", userId: 1, reason: "Cancelled by staff" });
    expect((await post({ xResult: "A", xInvoice: invoiceFor(a.id), xAuthAmount: "50.00", xRefNum: "M40", xMaskedCardNumber: "4xxxxxxxxxxx1111" })).status).toBe(200);
    expect((await get(a.id)).paymentResult).toBe("approved");
    expect((await get(b.id)).paymentResult).toBeNull();
  });
  it("#7: a payment saved halfway is confirmed by Sola's repeat notice, with one paid text", async () => {
    const [cu] = await db.insert(schema.customers).values({ name: "Sara", phone: "+18455550777" }).returning();
    const [o] = await db
      .insert(schema.orders)
      .values({ status: "PENDING_PAYMENT", channel: "PHONE", customerId: cu.id, eventDate: "2027-10-20", pickupDate: "2027-10-21", subtotalCents: 6000, totalCents: 6000, paidCents: 6000, solaRefNum: "HALF9", holdExpiresAt: new Date(Date.now() + 600_000), updatedAt: new Date(Date.now() - 60_000) })
      .returning();
    h.texts.length = 0;
    await post({ xResult: "A", xInvoice: invoiceFor(o.id), xAuthAmount: "60.00", xRefNum: "HALF9" });
    const after = await get(o.id);
    expect([after.status, after.paidCents]).toEqual(["CONFIRMED", 6000]);
    expect(h.texts.length).toBeGreaterThan(0);
    const n = h.texts.length;
    await post({ xResult: "A", xInvoice: invoiceFor(o.id), xAuthAmount: "60.00", xRefNum: "HALF9" });
    expect(h.texts.length).toBe(n); // the next repeat sends nothing
    expect((await get(o.id)).paidCents).toBe(6000);
  });
});
