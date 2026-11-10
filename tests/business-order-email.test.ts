import { beforeAll, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";

/* Abraham's checklist: "email the business the order details" when an order is paid. Nothing is sent for real. */
const h = vi.hoisted(() => ({ emails: [] as { to: string; subject: string; text: string }[], sms: [] as { to: string; body: string }[] }));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/notify", () => ({
  sendEmail: async (to: string, subject: string, text: string) => (h.emails.push({ to, subject, text }), { sent: true }),
  sendSms: async (to: string, body: string) => (h.sms.push({ to, body }), { sent: true }),
}));

import { db, schema } from "@/lib/db";
import { POST } from "@/app/api/sola/webhook/route";
import { invoiceFor } from "@/lib/sola";

const PIN = "test-pin";
function signed(fields: Record<string, string>) {
  const lowered = Object.entries(fields).map(([k, v]) => [k.toLowerCase(), v] as const).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const sig = crypto.createHash("md5").update(lowered.map(([, v]) => v).join("") + PIN, "utf8").digest("hex");
  return new Request("https://hupup.example/api/sola/webhook", { method: "POST", body: new URLSearchParams(fields).toString(), headers: { "ck-signature": sig, "content-type": "application/x-www-form-urlencoded" } });
}

let orderId = 0;
beforeAll(async () => {
  process.env.SOLA_WEBHOOK_PIN = PIN;
  process.env.ADMIN_EMAIL = "owner@example.com";
  process.env.PUBLIC_BASE_URL = "https://hupup.example";
  const [cat] = await db.insert(schema.categories).values({ name: "Paddle Boats", sortOrder: 1, active: true }).returning();
  const [p] = await db.insert(schema.products).values({ categoryId: cat.id, name: "Paddle Boat", priceCents: 4500, quantity: 8, active: true, sortOrder: 1 }).returning();
  const [c] = await db.insert(schema.customers).values({ name: "Sample Customer", phone: "+18455550123", email: null }).returning();
  const [o] = await db
    .insert(schema.orders)
    .values({ status: "PENDING_PAYMENT", channel: "PHONE", customerId: c.id, eventDate: "2026-11-15", pickupDate: "2026-11-16", deliveryAddress: "5 Sample Rd, Monroe, NY", subtotalCents: 9000, deliveryFeeCents: 1000, taxCents: 813, totalCents: 10813 })
    .returning();
  await db.insert(schema.orderItems).values({ orderId: o.id, productId: p.id, qty: 2, unitPriceCents: 4500 });
  orderId = o.id;
});

describe("business gets the order details by email when an order is paid", () => {
  it("one email to the business address with items, dates, customer, address and totals", async () => {
    const res = await POST(signed({ xResult: "A", xInvoice: invoiceFor(orderId), xAuthAmount: "108.13", xRefNum: "REF1" }));
    expect(res.status).toBe(200);
    const mail = h.emails.filter((e) => e.to === "owner@example.com");
    expect(mail).toHaveLength(1);
    expect(mail[0].subject).toMatch(/^Hup Up Attractions: new paid order #\d+ for Sun, Nov 15, 2026 \/ /);
    for (const part of ["booked by phone", "Delivery: Sunday, Nov 15, 2026 / ", "Pickup: Monday, Nov 16, 2026 / ", "Address: 5 Sample Rd, Monroe, NY", "Customer: Sample Customer", "Phone: (845) 555-0123", "2 x Paddle Boat at $45.00", "Rentals: $90.00", "Delivery: $10.00", "Sales tax: $8.13", "Total: $108.13", "Paid now: $108.13", `https://hupup.example/admin/orders/${orderId}`]) {
      expect(mail[0].text).toContain(part);
    }
    // the customer had no email, so the only email is the business copy
    expect(h.emails).toHaveLength(1);
  });
  it("the same payment sent twice by Sola does not email again", async () => {
    await POST(signed({ xResult: "A", xInvoice: invoiceFor(orderId), xAuthAmount: "108.13", xRefNum: "REF1" }));
    expect(h.emails).toHaveLength(1);
  });
});
