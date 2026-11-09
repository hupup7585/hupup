import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

/* Customer billing (Bookkeeping spec step 2). In-memory database with the real migrations. */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { addEntry, openInvoices } from "@/lib/books";
import { createDoc, displayStatus, docDetail, docFromBooking, issueDoc, quoteToInvoice, setManualStatus, statement } from "@/lib/invoices";

describe("invoices, quotes and credit notes", () => {
  it("numbers each type in order; totals = lines - discount + tax; drafts aren't owed until issued", async () => {
    const a = await createDoc({ kind: "invoice", customerName: "Bais Yaakov", issueDate: "2026-11-01", termsDays: 30, lines: [{ description: "Castle bouncer", qty: 2, unitCents: 23000 }, { description: "Delivery", qty: 1, unitCents: 1500 }], discountCents: 1500, taxCents: 3738 }, 1);
    expect(a).toMatchObject({ number: "INV-1001", status: "draft", subtotalCents: 47500, amountCents: 47500 - 1500 + 3738, dueDate: "2026-12-01" });
    expect(await openInvoices()).toEqual([]);
    await issueDoc(a.id, 1);
    const b = await createDoc({ kind: "invoice", customerName: "Cheder", issueDate: "2026-11-02", lines: [{ description: "Laser tag", qty: 1, unitCents: 30000 }], issue: true }, 1);
    expect(b.number).toBe("INV-1002");
    const q = await createDoc({ kind: "quote", customerName: "Camp", issueDate: "2026-11-02", lines: [{ description: "Paddle boats", qty: 4, unitCents: 4500 }], issue: true }, 1);
    expect(q.number).toBe("Q-1001");
    expect((await openInvoices()).map((i) => i.number)).toEqual(["INV-1001", "INV-1002"]); // quotes aren't owed
  });

  it("statuses: sent -> partially paid -> paid; overdue; disputed / written off / refunded need a reason", async () => {
    const [inv] = await db.select().from(schema.bookInvoices).where(eq(schema.bookInvoices.number, "INV-1001"));
    expect((await docDetail(inv.id))!.status).toBe("Sent");
    await addEntry({ entryDate: "2026-11-05", kind: "income", amountCents: 20000, method: "check", checkNo: "301", invoiceId: inv.id }, 1);
    const d1 = (await docDetail(inv.id))!;
    expect(d1.status).toBe("Partially paid");
    expect(d1.balanceCents).toBe(inv.amountCents - 20000);
    expect(displayStatus(inv, 20000, 0, "2026-12-15")).toBe("Overdue");
    await addEntry({ entryDate: "2026-11-06", kind: "income", amountCents: inv.amountCents - 20000, method: "zelle", invoiceId: inv.id }, 1);
    expect((await docDetail(inv.id))!.status).toBe("Paid");
    const [b] = await db.select().from(schema.bookInvoices).where(eq(schema.bookInvoices.number, "INV-1002"));
    await expect(setManualStatus(b.id, "disputed", "", 1)).rejects.toThrow(/Say why/);
    await setManualStatus(b.id, "disputed", "customer says one unit was late", 1);
    expect((await docDetail(b.id))!.status).toBe("Disputed");
    await setManualStatus(b.id, "written_off", "school closed", 1);
    expect((await openInvoices()).map((i) => i.number)).not.toContain("INV-1002"); // written off leaves receivables
    await setManualStatus(b.id, null, "", 1);
  });

  it("credit notes reduce the balance, can't exceed the invoice, and appear on the statement", async () => {
    const [b] = await db.select().from(schema.bookInvoices).where(eq(schema.bookInvoices.number, "INV-1002"));
    await expect(createDoc({ kind: "credit_note", customerName: "Cheder", issueDate: "2026-11-07", lines: [{ description: "Too much", qty: 1, unitCents: 40000 }], relatedInvoiceId: b.id, issue: true }, 1)).rejects.toThrow(/more than the invoice/);
    const cn = await createDoc({ kind: "credit_note", customerName: "Cheder", issueDate: "2026-11-07", lines: [{ description: "Rain delay credit", qty: 1, unitCents: 5000 }], relatedInvoiceId: b.id, issue: true }, 1);
    expect(cn.number).toBe("CN-1001");
    expect((await docDetail(b.id))!.balanceCents).toBe(25000);
    expect((await openInvoices()).find((i) => i.id === b.id)!.balanceCents).toBe(25000);
    const st = await statement("Cheder");
    expect(st.map((r) => r.what)).toEqual(["Invoice", "Credit note"]);
    expect(st.at(-1)!.balanceCents).toBe(25000);
  });

  it("a quote becomes an invoice with the same lines; the quote shows Accepted", async () => {
    const [q] = await db.select().from(schema.bookInvoices).where(eq(schema.bookInvoices.number, "Q-1001"));
    const inv = await quoteToInvoice(q.id, 1);
    expect(inv).toMatchObject({ kind: "invoice", amountCents: 18000, customerName: "Camp", status: "draft" });
    expect((await docDetail(q.id))!.status).toBe("Accepted");
    await expect(quoteToInvoice(q.id, 1)).rejects.toThrow(/already/);
  });

  it("from a booking: items and delivery as lines, sales tax copied exactly as charged", async () => {
    const [cat] = await db.insert(schema.categories).values({ name: "Bounce", sortOrder: 1, active: true }).returning();
    const [p] = await db.insert(schema.products).values({ categoryId: cat.id, name: "Royal Castle", priceCents: 23000, quantity: 2, active: true, sortOrder: 1 }).returning();
    const [c] = await db.insert(schema.customers).values({ phone: "+18457770300", name: "Mrs. Klein", email: "klein@example.org" }).returning();
    const [o] = await db.insert(schema.orders).values({ status: "CONFIRMED", channel: "PHONE", customerId: c.id, eventDate: "2026-12-06", pickupDate: "2026-12-07", subtotalCents: 23000, deliveryFeeCents: 1000, taxCents: 1950, totalCents: 25950, deliveryAddress: "5 Main St, Monroe" }).returning();
    await db.insert(schema.orderItems).values({ orderId: o.id, productId: p.id, qty: 1, unitPriceCents: 23000 });
    const inv = await docFromBooking(o.id, "invoice", 1);
    const d = (await docDetail(inv.id))!;
    expect(d.lines.map((l) => [l.description, l.lineCents])).toEqual([["Royal Castle (rental 2026-12-06)", 23000], ["Delivery", 1000]]);
    expect(d.doc).toMatchObject({ amountCents: 25950, taxCents: 1950, customerName: "Mrs. Klein", orderId: o.id, billingAddress: "5 Main St, Monroe" });
  });

  it("nothing is deleted; card numbers are refused; screens and 'Not active yet' note are in place", async () => {
    const [l] = await db.select().from(schema.bookInvoiceLines);
    await expect(db.delete(schema.bookInvoiceLines).where(eq(schema.bookInvoiceLines.id, l.id))).rejects.toThrow();
    await expect(createDoc({ kind: "invoice", customerName: "X", issueDate: "2026-11-01", lines: [{ description: "card 4111 1111 1111 1111", qty: 1, unitCents: 100 }] }, 1)).rejects.toThrow(/card number/);
    const page = readFileSync("src/app/admin/(app)/bookkeeping/page.tsx", "utf8");
    expect(page).toContain('data-not-active="invoice-email"');
    expect(readFileSync("src/app/admin/(app)/bookkeeping/invoice/[id]/page.tsx", "utf8")).toContain("await requireBooks()");
    expect(readFileSync("src/app/admin/(app)/bookkeeping/statement/page.tsx", "utf8")).toContain("await requireBooks()");
  });
});
