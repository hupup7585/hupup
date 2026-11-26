import { beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

/* Custom-amount services on any order (Abraham, Nov 26, 2026, 13:54 ET): staff add one or more services (name,
 * amount, optional note) to any order in Admin. Each is its own line, counts in the total and sales tax (taxable by
 * default), never touches stock, and shows by name and amount on the receipt, order page, payment link and bookkeeping. */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getOrderWithItems, getPaymentGroup, markPaid, orderNumber, refreshOrderTotals } from "@/lib/orders";
import { taxOn } from "@/lib/pricing";
import { paymentLink } from "@/lib/sola";
import { prefillFor } from "@/lib/pay-prefill";
import { businessOrderEmail } from "@/lib/order-email";
import { docFromBooking, docDetail } from "@/lib/invoices";
import {
  addService,
  customerServiceText,
  listServices,
  parseService,
  removeService,
  SERVICE_FIELD_EXPLANATIONS,
  ServiceError,
  updateService,
  withServices,
} from "@/lib/order-services";

let productId = 0;
let customerId = 0;
const SUB = 15000; // one castle
const FEE = 1000;
const PCT = "8.125";
const baseTax = taxOn(SUB + FEE, PCT); // $13.00
const baseTotal = SUB + FEE + baseTax;

async function pricedOrder(extra: Partial<typeof schema.orders.$inferInsert> = {}) {
  const [o] = await db
    .insert(schema.orders)
    .values({ status: "PENDING_PAYMENT", channel: "POS", customerId, eventDate: "2026-12-07", pickupDate: "2026-12-08", deliveryAddress: "12 Forest Road, Monroe, NY 10950", subtotalCents: SUB, deliveryFeeCents: FEE, deliveryZone: "area", taxPercent: PCT, taxCents: baseTax, totalCents: baseTotal, holdExpiresAt: new Date(Date.now() + 3600_000), ...extra })
    .returning();
  await db.insert(schema.orderItems).values({ orderId: o.id, productId, qty: 1, unitPriceCents: SUB });
  return o.id;
}
const order = async (id: number) => (await db.select().from(schema.orders).where(eq(schema.orders.id, id)))[0];

beforeAll(async () => {
  process.env.PUBLIC_BASE_URL = "https://hupup.example";
  process.env.SOLA_PAYMENTSITE_NAME = "hupupattractions";
  const [c] = await db.insert(schema.customers).values({ name: "Klein, Sara", phone: "+18454157585", email: "sara@example.com" }).returning();
  customerId = c.id;
  const [cat] = await db.insert(schema.categories).values({ name: "Jumping balloons" }).returning();
  const [p] = await db.insert(schema.products).values({ categoryId: cat.id, name: "Castle", priceCents: SUB, quantity: 2 }).returning();
  productId = p.id;
});

describe("what staff type is checked", () => {
  it("name and a positive amount in dollars and cents are required", () => {
    expect(parseService({ name: "", amount: "25" })).toMatchObject({ ok: false });
    expect(parseService({ name: "Extra setup", amount: "" })).toMatchObject({ ok: false });
    expect(parseService({ name: "Extra setup", amount: "0" })).toMatchObject({ ok: false });
    expect(parseService({ name: "Extra setup", amount: "-5" })).toMatchObject({ ok: false, message: expect.stringContaining("Refund") });
    expect(parseService({ name: "Extra setup", amount: "12.345" })).toMatchObject({ ok: false });
    expect(parseService({ name: "Extra setup", amount: "abc" })).toMatchObject({ ok: false });
    expect(parseService({ name: "Extra setup", amount: "2000000" })).toMatchObject({ ok: false });
    expect(parseService({ name: "  Extra   setup ", amount: "$1,025.5" })).toEqual({ ok: true, value: { name: "Extra setup", amountCents: 102550, note: null, showNoteOnReceipt: false, taxable: true } });
  });
  it("taxable by default; the note shows on the receipt only when ticked and there is a note", () => {
    const v = (x: Parameters<typeof parseService>[0]) => (parseService(x) as { ok: true; value: { taxable: boolean; showNoteOnReceipt: boolean } }).value;
    expect(v({ name: "A", amount: "1" }).taxable).toBe(true);
    expect(v({ name: "A", amount: "1", taxable: false }).taxable).toBe(false);
    expect(v({ name: "A", amount: "1", showNoteOnReceipt: true }).showNoteOnReceipt).toBe(false);
    expect(v({ name: "A", amount: "1", note: "On the lawn", showNoteOnReceipt: true }).showNoteOnReceipt).toBe(true);
  });
});

describe("one sales tax on rentals, delivery and the taxable services", () => {
  it("adds the services to the total, and tax only on the taxable ones", () => {
    const t = { subtotalCents: SUB, deliveryFeeCents: FEE, taxPercent: PCT, taxCents: baseTax, totalCents: baseTotal };
    const w = withServices(t, { cents: 4000, taxableCents: 2500 });
    expect(w.taxCents).toBe(taxOn(SUB + FEE + 2500, PCT));
    expect(w.servicesTaxCents).toBe(taxOn(SUB + FEE + 2500, PCT) - baseTax);
    expect(w.totalCents).toBe(SUB + FEE + 4000 + taxOn(SUB + FEE + 2500, PCT));
    expect(withServices(t, { cents: 0, taxableCents: 0 })).toMatchObject({ taxCents: baseTax, totalCents: baseTotal, servicesCents: 0, servicesTaxCents: 0 });
  });
});

describe("add 1 service, then 3, edit and remove", () => {
  let id = 0;
  it("1 service: its own line, in the total and the tax; stock untouched", async () => {
    id = await pricedOrder();
    const itemsBefore = await db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, id));
    await addService(id, { name: "Extra setup", amount: "25.00", note: "Setup on the back lawn" }, 1);
    const o = await order(id);
    expect(o.servicesCents).toBe(2500);
    expect(o.taxCents).toBe(taxOn(SUB + FEE + 2500, PCT));
    expect(o.totalCents).toBe(SUB + FEE + 2500 + taxOn(SUB + FEE + 2500, PCT));
    expect(o.subtotalCents).toBe(SUB); // rentals stay rentals
    expect(await db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, id))).toEqual(itemsBefore);
    const [p] = await db.select().from(schema.products).where(eq(schema.products.id, productId));
    expect(p.quantity).toBe(2);
  });
  it("3 services: numbered in the order added, all counted (one not taxed)", async () => {
    await addService(id, { name: "Late pickup fee", amount: "40", taxable: false }, 1);
    await addService(id, { name: "Generator", amount: "60.50" }, 1);
    const list = await listServices(id);
    expect(list.map((s) => s.name)).toEqual(["Extra setup", "Late pickup fee", "Generator"]);
    const o = await order(id);
    expect(o.servicesCents).toBe(2500 + 4000 + 6050);
    expect(o.taxCents).toBe(taxOn(SUB + FEE + 2500 + 6050, PCT));
    expect(o.totalCents).toBe(SUB + FEE + 12550 + taxOn(SUB + FEE + 8550, PCT));
  });
  it("edit: the new amount and taxable choice change the total and tax", async () => {
    const [first] = await listServices(id);
    await updateService(id, first.id, { name: "Extra setup (2 hours)", amount: "35", note: "Setup on the back lawn", showNoteOnReceipt: true }, 1);
    const o = await order(id);
    expect(o.servicesCents).toBe(3500 + 4000 + 6050);
    expect(o.totalCents).toBe(SUB + FEE + 13550 + taxOn(SUB + FEE + 3500 + 6050, PCT));
    expect((await listServices(id))[0]).toMatchObject({ name: "Extra setup (2 hours)", showNoteOnReceipt: true });
  });
  it("remove: the line goes and the total and tax come back down", async () => {
    const list = await listServices(id);
    await removeService(id, list[1].id, 1);
    const o = await order(id);
    expect((await listServices(id)).map((s) => s.name)).toEqual(["Extra setup (2 hours)", "Generator"]);
    expect(o.servicesCents).toBe(3500 + 6050);
    expect(o.totalCents).toBe(SUB + FEE + 9550 + taxOn(SUB + FEE + 9550, PCT));
    for (const s of await listServices(id)) await removeService(id, s.id, 1);
    expect(await order(id)).toMatchObject({ servicesCents: 0, servicesTaxCents: 0, taxCents: baseTax, totalCents: baseTotal });
  });
  it("every change is in the activity log", async () => {
    const rows = await db.select().from(schema.auditLog).where(eq(schema.auditLog.entityId, String(id)));
    const actions = rows.map((r) => r.action);
    expect(actions.filter((a) => a === "order.service_added")).toHaveLength(3);
    expect(actions).toContain("order.service_changed");
    expect(actions.filter((a) => a === "order.service_removed")).toHaveLength(3);
  });
  it("a cancelled order takes no services", async () => {
    const c = await pricedOrder({ status: "CANCELLED" });
    await expect(addService(c, { name: "Extra setup", amount: "25" }, 1)).rejects.toBeInstanceOf(ServiceError);
  });
});

describe("the rentals total is worked out again: the services stay in", () => {
  it("refreshing the order keeps the services in the total and tax", async () => {
    const id = await pricedOrder();
    await addService(id, { name: "Extra setup", amount: "25" }, 1);
    const before = await order(id);
    await refreshOrderTotals(id);
    const after = await order(id);
    expect(after.servicesCents).toBe(2500);
    expect(after.totalCents).toBe(after.subtotalCents + FEE + 2500 + taxOn(after.subtotalCents + FEE + 2500, PCT));
    if (after.subtotalCents === before.subtotalCents) expect(after.totalCents).toBe(before.totalCents);
  });
  it("an order not priced yet: the services wait and are added when it is priced", async () => {
    const id = await pricedOrder({ totalCents: null, taxCents: 0, deliveryFeeCents: 0, taxPercent: null });
    await addService(id, { name: "Extra setup", amount: "25" }, 1);
    expect(await order(id)).toMatchObject({ totalCents: null, servicesCents: 2500, servicesTaxCents: 0 });
  });
});

describe("receipt, order page, payment link and bookkeeping show the services by name and amount", () => {
  let id = 0;
  beforeAll(async () => {
    id = await pricedOrder();
    await addService(id, { name: "Extra setup", amount: "25", note: "Back lawn", showNoteOnReceipt: true }, 1);
    await addService(id, { name: "Late pickup fee", amount: "40", note: "Staff only note", taxable: false }, 1);
    await addService(id, { name: "Generator", amount: "60.50" }, 1);
  });
  it("the receipt (invoice) has one line per service, by name and amount; the note only when ticked", async () => {
    const doc = await docFromBooking(id, "invoice", 1);
    const d = (await docDetail(doc.id))!;
    const lines = d.lines.map((l) => [l.description, l.unitCents]);
    expect(lines).toContainEqual(["Extra setup (Back lawn)", 2500]);
    expect(lines).toContainEqual(["Late pickup fee", 4000]);
    expect(lines).toContainEqual(["Generator", 6050]);
    expect(lines.map((l) => l[0]).join(" ")).not.toContain("Staff only note");
    expect(d.doc.amountCents).toBe((await order(id)).totalCents);
  });
  it("customer lines: name and amount, no new words", async () => {
    const [a, b] = await listServices(id);
    expect(customerServiceText(a)).toBe("Extra setup $25.00 (Back lawn)");
    expect(customerServiceText(b)).toBe("Late pickup fee $40.00");
  });
  it("the payment link charges exactly the order total, and the card page lists the services", async () => {
    const o = await order(id);
    const group = (await getPaymentGroup(id))!;
    expect(group.due).toBe(o.totalCents);
    expect(group.primary.services.map((s) => s.name)).toEqual(["Extra setup", "Late pickup fee", "Generator"]);
    const link = new URL(paymentLink({ orderId: id, amountCents: group.due, prefill: prefillFor(group.primary, group.orders, `#${orderNumber(id)}`) })!);
    expect(link.searchParams.get("xAmount")).toBe((o.totalCents! / 100).toFixed(2));
    expect(link.searchParams.get("xDescription")).toContain("1 x Castle, Extra setup $25.00, Late pickup fee $40.00, Generator $60.50");
  });
  it("the business order email numbers them Service 1, 2, 3 with the note", async () => {
    const full = (await getOrderWithItems(id))!;
    const t = businessOrderEmail(full, full.order.totalCents!).text;
    expect(t).toContain("Service 1: Extra setup $25.00. Note: Back lawn");
    expect(t).toContain("Service 2: Late pickup fee $40.00 (not taxed). Note: Staff only note");
    expect(t).toContain("Service 3: Generator $60.50");
  });
  it("bookkeeping: the payment is split into rentals, delivery, services and tax, matching the order", async () => {
    const o = await order(id);
    await markPaid(id, o.totalCents!, "cash");
    const [e] = await db.select().from(schema.bookEntries).where(eq(schema.bookEntries.orderId, id));
    expect(e.amountCents).toBe(o.totalCents);
    expect(e.servicesCents).toBe(12550);
    expect(e.deliveryCents).toBe(FEE);
    expect(e.taxCents).toBe(o.taxCents);
    expect(e.rentalCents).toBe(SUB);
    expect(e.rentalCents + e.deliveryCents + e.servicesCents + e.taxCents).toBe(e.amountCents);
    const { pnl } = await import("@/lib/books-reports");
    const [row] = pnl([e], "month");
    expect(row.services).toBe(12550);
    expect(row.rental).toBe(SUB);
    expect(row.otherIncome).toBe(0);
  });
  it("after payment the paid services are locked; a new one makes a balance due and can still change", async () => {
    const [paid] = await listServices(id);
    expect(paid.lockedAt).not.toBeNull();
    await expect(updateService(id, paid.id, { name: "Cheaper", amount: "1" }, 1)).rejects.toThrow(/already paid for/);
    await expect(removeService(id, paid.id, 1)).rejects.toThrow(/Refund/);
    const before = await order(id);
    const late = await addService(id, { name: "Late pickup fee", amount: "30" }, 1);
    const after = await order(id);
    expect(after.totalCents! - after.paidCents).toBe(3000 + (after.taxCents - before.taxCents));
    await updateService(id, late.id, { name: "Late pickup fee", amount: "20" }, 1);
    await removeService(id, late.id, 1);
    expect((await order(id)).totalCents).toBe(before.totalCents);
  });
});

describe("Admin", () => {
  it("only Owner and Secretary (requireAdmin keeps Delivery out) on every action", () => {
    const src = readFileSync("src/app/admin/(app)/orders/[id]/services-actions.ts", "utf8");
    expect(src.match(/export async function \w+/g)).toHaveLength(3);
    expect(src.match(/await requireAdmin\(\)/g)).toHaveLength(3);
  });
  it("the order page shows the Services box with the help text for every field", () => {
    const page = readFileSync("src/app/admin/(app)/orders/[id]/page.tsx", "utf8");
    expect(page).toContain("<ServicesPanel");
    expect(page).toContain("SERVICE_FIELD_EXPLANATIONS");
    const panel = readFileSync("src/app/admin/(app)/orders/[id]/ServicesPanel.tsx", "utf8");
    for (const f of ["name", "amount", "note", "showNoteOnReceipt", "taxable", "box"]) expect(panel).toContain(`help.${f}`);
    for (const f of ['name="name"', 'name="amount"', 'name="note"', 'name="showNoteOnReceipt"', 'name="taxable"']) expect(panel).toContain(f);
  });
  it("every field is explained in plain English, and the tax one says to ask the accountant", () => {
    const ABBREV = /\b(SMS|MMS|JSON|URL|API|GL|IVR|TTS|ACH|EIN|CPA|PIN|ID|PDF|POS|AR|AP|e\.g|i\.e|etc)\b/;
    const CODE = /(\{\{|=>|\bnull\b|\bundefined\b|\btrue\b|\bfalse\b|[a-z][A-Z][a-z]+[A-Z])/;
    for (const [k, e] of Object.entries(SERVICE_FIELD_EXPLANATIONS)) {
      for (const part of [e.what, e.where, e.ifChanged]) {
        expect(part.trim().length, k).toBeGreaterThan(30);
        expect(part, k).not.toMatch(ABBREV);
        expect(part, k).not.toMatch(CODE);
      }
      if (/\btax\b|accountant/i.test(`${e.what} ${e.ifChanged}`) && k === "taxable") expect(e.askAccountant).toBe(true);
    }
  });
  it("the review and pay page lists each service by name and amount", () => {
    const pay = readFileSync("src/app/pay/[orderId]/page.tsx", "utf8");
    expect(pay).toContain("data-pay-service");
    expect(pay).toMatch(/s\.showNoteOnReceipt && s\.note/);
  });
});
