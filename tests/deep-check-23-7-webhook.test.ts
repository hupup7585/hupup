import crypto from "node:crypto";
import { readFileSync } from "node:fs";
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
  it("#7: a payment saved halfway is confirmed by Sola's repeat notice, with one paid text", async () => {
    const [cu] = await db.insert(schema.customers).values({ name: "Sara", phone: "+18455550777" }).returning();
    const [o] = await db
      .insert(schema.orders)
      .values({ status: "PENDING_PAYMENT", channel: "PHONE", customerId: cu.id, eventDate: "2027-10-20", pickupDate: "2027-10-21", subtotalCents: 6000, totalCents: 6000, paidCents: 6000, solaRefNum: "HALF9", updatedAt: new Date(Date.now() - 5 * 60_000), holdExpiresAt: new Date(Date.now() + 600_000) })
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
  it("#17: two copies of the same approval at the same moment: counted once, one paid text", async () => {
    const [cu] = await db.insert(schema.customers).values({ name: "Leah", phone: "+18455550778" }).returning();
    const [o] = await db.insert(schema.orders).values({ status: "PENDING_PAYMENT", channel: "PHONE", customerId: cu.id, eventDate: "2027-10-27", pickupDate: "2027-10-28", subtotalCents: 5000, totalCents: 5000, holdExpiresAt: new Date(Date.now() + 600_000) }).returning();
    h.texts.length = 0;
    const f = { xResult: "A", xInvoice: invoiceFor(o.id), xAuthAmount: "50.00", xRefNum: "TWIN1" };
    await Promise.all([post(f), post(f)]);
    const after = await get(o.id);
    expect([after.status, after.paidCents]).toEqual(["CONFIRMED", 5000]);
    expect(h.texts.filter((t) => /#\d+/.test(t)).length).toBe(1);
  });
  it("#17: the second count of the same reference comes back marked duplicate, so the webhook sends no notice for it", async () => {
    const { markGroupPaid } = await import("@/lib/orders");
    const [o] = await db.insert(schema.orders).values({ status: "PENDING_PAYMENT", channel: "PHONE", eventDate: "2027-11-03", pickupDate: "2027-11-04", subtotalCents: 4000, totalCents: 4000, holdExpiresAt: new Date(Date.now() + 600_000) }).returning();
    const first = await markGroupPaid(o.id, 4000, "sola", "TWIN2");
    expect(first.every((u) => !("duplicate" in u))).toBe(true);
    // the copy that raced the first: the amount and reference are saved (seconds ago), the status is not finished yet
    await db.update(schema.orders).set({ status: "PENDING_PAYMENT", updatedAt: new Date() }).where(eq(schema.orders.id, o.id));
    const second = await markGroupPaid(o.id, 4000, "sola", "TWIN2");
    expect(second.length).toBeGreaterThan(0);
    expect(second.every((u) => "duplicate" in u && u.duplicate)).toBe(true);
    expect((await get(o.id)).paidCents).toBe(4000);
    expect(readFileSync("src/app/api/sola/webhook/route.ts", "utf8")).toContain("fresh && counted.some((u) => u.status === \"CONFIRMED\")");
  });
});
