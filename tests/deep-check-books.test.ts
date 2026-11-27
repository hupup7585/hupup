import { beforeAll, describe, expect, it, vi } from "vitest";

/* Deep check Nov 27, 2026 (Bookkeeping): A5 Payments report balance, A6 refunds on an invoice, A8 a ledger entry is
   corrected once, A9 a trip is corrected once, A10 a recurring expense is recorded once and never after it stopped,
   A11 payments only on an issued invoice or a bill that isn't void, A17 locking a reopened month locks it. */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Error(`REDIRECT ${decodeURIComponent(u)}`); } }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/auth", async (orig) => ({ ...(await orig<typeof import("@/lib/auth")>()), currentStaff: async () => ({ userId: null, role: "owner" }) }));

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import * as B from "@/lib/books";
import * as A from "@/app/admin/(app)/bookkeeping/actions";

const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
/** Runs a Bookkeeping action and returns the message it redirected with. */
const act = async (p: Promise<unknown>) => {
  try {
    await p;
    return "";
  } catch (e) {
    return String((e as Error).message);
  }
};

describe("A5: Payments report balance", () => {
  it("total (with delivery and tax) less paid and kept; a paid order shows 0, not negative", async () => {
    const [o] = await db.insert(schema.orders).values({ status: "CONFIRMED", channel: "POS", eventDate: "2026-06-10", pickupDate: "2026-06-11", subtotalCents: 10000, deliveryFeeCents: 1000, taxCents: 894, totalCents: 11894, paidCents: 11894, refundedCents: 0 }).returning();
    const { REPORTS } = await import("@/lib/reports");
    const [sheet] = await REPORTS.payments.build({});
    const i = sheet.header.indexOf("Balance ($)");
    const row = sheet.rows.find((r) => String(r[0]).endsWith(String(o.id)) || r[0] === String(1000 + o.id))!;
    expect(Number(row[i])).toBe(0);
    expect(Number(row[sheet.header.indexOf("Total ($)")])).toBe(118.94);
  });
});

describe("A6, A11: invoices", () => {
  let inv = 0;
  beforeAll(async () => {
    const [d] = await db.insert(schema.bookInvoices).values({ customerName: "Klein", issueDate: "2026-06-01", dueDate: "2026-06-30", amountCents: 10000, status: "open", kind: "invoice" }).returning();
    inv = d.id;
  });
  it("A6: a refund on an invoice lowers what was received (balance goes back up)", async () => {
    await B.addEntry({ entryDate: "2026-06-05", kind: "income", category: "Invoices", amountCents: 10000, method: "cash", invoiceId: inv }, null);
    await B.addEntry({ entryDate: "2026-06-06", kind: "refund", category: "Refunds", amountCents: 3000, method: "cash", invoiceId: inv }, null);
    const open = await B.openInvoices();
    const mine = open.find((x) => x.id === inv)!;
    expect(mine.paidCents).toBe(7000);
    expect(mine.balanceCents).toBe(3000);
  });
  it("A11: no payment on a void invoice, a quote or a credit note, or a void bill", async () => {
    const [v] = await db.insert(schema.bookInvoices).values({ customerName: "Void Co", issueDate: "2026-06-01", dueDate: "2026-06-30", amountCents: 5000, status: "void", kind: "invoice" }).returning();
    const [q] = await db.insert(schema.bookInvoices).values({ customerName: "Quote Co", issueDate: "2026-06-01", dueDate: "2026-06-30", amountCents: 5000, status: "open", kind: "quote" }).returning();
    const pay = (id: number) => act(A.payInvoiceAction(form({ invoiceId: String(id), date: "2026-06-07", amount: "10.00", method: "cash" })));
    expect(await pay(v.id)).toMatch(/voided/);
    expect(await pay(q.id)).toMatch(/quote/);
    const before = (await db.select().from(schema.bookEntries)).length;
    const [b] = await db.insert(schema.bookBills).values({ vendor: "Gas Co", billDate: "2026-06-01", dueDate: "2026-06-30", amountCents: 5000, status: "void" }).returning();
    expect(await act(A.payBillAction(form({ billId: String(b.id), date: "2026-06-07", amount: "10.00", method: "cash" })))).toMatch(/voided/);
    expect((await db.select().from(schema.bookEntries)).length).toBe(before);
  });
});

describe("A8: a ledger entry is corrected once, even on two clicks at once", () => {
  it("one correction; a correction is never corrected again", async () => {
    const e = await B.addEntry({ entryDate: "2026-06-08", kind: "expense", category: "Fuel", amountCents: 4000, method: "cash" }, null);
    const r = await Promise.allSettled([B.reverseEntry(e.id, "typed twice", null), B.reverseEntry(e.id, "typed twice", null)]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    const corr = (await db.select().from(schema.bookEntries).where(eq(schema.bookEntries.correctsId, e.id)));
    expect(corr).toHaveLength(1);
    await expect(B.reverseEntry(corr[0].id, "undo", null)).rejects.toThrow(/itself a correction/);
  });
});

describe("A9: a trip is corrected once", () => {
  it("second correction refused; a correction can't be corrected", async () => {
    const [t] = await db.insert(schema.bookMileage).values({ tripDate: "2026-06-08", milesTenths: 120, purpose: "Delivery" }).returning();
    await act(A.reverseMileageAction(form({ id: String(t.id), reason: "wrong day" })));
    expect(await act(A.reverseMileageAction(form({ id: String(t.id), reason: "again" })))).toMatch(/already corrected/);
    const [c] = await db.select().from(schema.bookMileage).where(eq(schema.bookMileage.correctsId, t.id));
    expect(await act(A.reverseMileageAction(form({ id: String(c.id), reason: "undo" })))).toMatch(/itself a correction/);
    expect((await db.select().from(schema.bookMileage).where(eq(schema.bookMileage.correctsId, t.id)))).toHaveLength(1);
  });
});

describe("A10: recurring expense", () => {
  it("a double click records it once; after Stop nothing is recorded", async () => {
    const [r] = await db.insert(schema.bookRecurring).values({ vendor: "Phone plan", category: "Phone", amountCents: 5000, frequency: "monthly", nextDate: "2026-06-01" }).returning();
    const expenses = async () => (await db.select().from(schema.bookEntries)).filter((e) => e.party === "Phone plan").length;
    await Promise.all([act(A.recordRecurringAction(form({ id: String(r.id) }))), act(A.recordRecurringAction(form({ id: String(r.id) })))]);
    expect(await expenses()).toBe(1);
    await act(A.stopRecurringAction(form({ id: String(r.id) })));
    expect(await act(A.recordRecurringAction(form({ id: String(r.id) })))).toMatch(/stopped/);
    expect(await expenses()).toBe(1);
  });
});

describe("A17: locking a reopened month", () => {
  it("locks it again", async () => {
    await db.insert(schema.bookLocks).values({ month: "2026-03", status: "reopened" });
    await act(A.lockMonthAction(form({ month: "2026-03" })));
    expect(await B.isLocked("2026-03-15")).toBe(true);
  });
});

describe("A13: a second charge on a paid order", () => {
  it("is an overpayment to refund (no tip, not a sale); after a refund the money is owed again", async () => {
    const [o] = await db.insert(schema.orders).values({ status: "PENDING_PAYMENT", channel: "PHONE", eventDate: "2026-09-10", pickupDate: "2026-09-11", subtotalCents: 10000, deliveryFeeCents: 1000, taxCents: 894, totalCents: 11894, deliveryAddress: "12 Forest Rd, Monroe, NY 10950" }).returning();
    await B.recordBookingPayment(o.id, 11894, "sola", "P1", "2026-09-01");
    await B.recordBookingPayment(o.id, 11894, "sola", "P2", "2026-09-01");
    const rows = (await db.select().from(schema.bookEntries).where(eq(schema.bookEntries.orderId, o.id))).sort((a, b) => a.id - b.id);
    expect(rows[1]).toMatchObject({ category: "Overpayment (refund due)", tipCents: 0, taxCents: 0 });
    const R = await import("@/lib/books-reports");
    const tax = await R.salesTaxSummary("2026-09-01", "2026-09-30");
    expect(tax.taxableCents).toBe(11000);
    // the overpayment refunded: no tax given back
    const { refundTaxShare } = await import("@/lib/refunds");
    expect(await refundTaxShare(o.id, 11894)).toBe(0);
    await B.addEntry({ entryDate: "2026-09-02", kind: "refund", category: "Refunds", amountCents: 11894, method: "sola", orderId: o.id }, null);
    await B.addEntry({ entryDate: "2026-09-02", kind: "refund", category: "Refunds", amountCents: 11894, taxCents: 894, method: "sola", orderId: o.id }, null);
    // everything refunded, then paid again: a normal booking payment, not an overpayment
    await B.recordBookingPayment(o.id, 11894, "sola", "P3", "2026-09-03");
    const last = (await db.select().from(schema.bookEntries).where(eq(schema.bookEntries.orderId, o.id))).sort((a, b) => b.id - a.id)[0];
    expect(last).toMatchObject({ category: "Bookings", taxCents: 894, tipCents: 0 });
  });
});

describe("A20: income by item", () => {
  it("an order paid in two periods counts once (first payment's period); a fully refunded order doesn't count", async () => {
    const [cat] = await db.insert(schema.categories).values({ name: "Slides", sortOrder: 9, active: true }).returning();
    const [p] = await db.insert(schema.products).values({ categoryId: cat.id, name: "Wave Slide A20", priceCents: 20000, quantity: 1, active: true }).returning();
    const mk = async (paid: number, refunded: number) => {
      const [o] = await db.insert(schema.orders).values({ status: "CONFIRMED", channel: "POS", eventDate: "2026-10-20", pickupDate: "2026-10-21", subtotalCents: 20000, totalCents: 20000, paidCents: paid, refundedCents: refunded }).returning();
      await db.insert(schema.orderItems).values({ orderId: o.id, productId: p.id, qty: 1, unitPriceCents: 20000 });
      return o.id;
    };
    const split = await mk(20000, 0);
    await B.addEntry({ entryDate: "2026-10-05", kind: "income", category: "Bookings", amountCents: 10000, method: "cash", orderId: split, source: "auto" }, null);
    await B.addEntry({ entryDate: "2026-11-05", kind: "income", category: "Bookings", amountCents: 10000, method: "cash", orderId: split, source: "auto" }, null);
    const gone = await mk(20000, 20000);
    await B.addEntry({ entryDate: "2026-10-06", kind: "income", category: "Bookings", amountCents: 20000, method: "cash", orderId: gone, source: "auto" }, null);
    const R = await import("@/lib/books-reports");
    const of = async (from: string, to: string) => (await R.incomeByItem(await R.entriesBetween(from, to))).find((r) => r.name === "Wave Slide A20");
    expect(await of("2026-10-01", "2026-10-31")).toMatchObject({ rentals: 1, incomeCents: 20000 });
    expect(await of("2026-11-01", "2026-11-30")).toBeUndefined();
  });
});

describe("deep check 0600 M29 + M30: recurring expenses", () => {
  it("M29: monthly keeps its day, or the month's last day (Jan 31, Feb 28, Mar 31)", () => {
    expect(B.nextRecurring("2027-01-31", "monthly", 31)).toBe("2027-02-28");
    expect(B.nextRecurring("2027-02-28", "monthly", 31)).toBe("2027-03-31");
    expect(B.nextRecurring("2028-01-30", "monthly", 30)).toBe("2028-02-29");
    expect(B.nextRecurring("2027-11-30", "quarterly", 30)).toBe("2028-02-29");
    expect(B.nextRecurring("2027-02-28", "monthly")).toBe("2027-03-28");
    expect(B.nextRecurring("2027-12-15", "monthly")).toBe("2028-01-15");
    expect(B.nextRecurring("2027-01-01", "weekly")).toBe("2027-01-08");
  });
  it("M30: when the expense can't be saved (locked month), the date stays and nothing is skipped", async () => {
    await act(A.addRecurringAction(form({ vendor: "Storage unit", category: "Rent", amount: "100.00", frequency: "monthly", nextDate: "2026-04-30" })));
    const [r] = (await db.select().from(schema.bookRecurring)).filter((x) => x.vendor === "Storage unit");
    await db.insert(schema.bookLocks).values({ month: "2026-04", status: "locked" });
    expect(await act(A.recordRecurringAction(form({ id: String(r.id) })))).toMatch(/locked/);
    expect((await db.select().from(schema.bookRecurring).where(eq(schema.bookRecurring.id, r.id)))[0].nextDate).toBe("2026-04-30");
    await db.update(schema.bookLocks).set({ status: "reopened" }).where(eq(schema.bookLocks.month, "2026-04"));
    await act(A.recordRecurringAction(form({ id: String(r.id) })));
    expect((await db.select().from(schema.bookRecurring).where(eq(schema.bookRecurring.id, r.id)))[0].nextDate).toBe("2026-05-30");
    await act(A.recordRecurringAction(form({ id: String(r.id) })));
    expect((await db.select().from(schema.bookRecurring).where(eq(schema.bookRecurring.id, r.id)))[0].nextDate).toBe("2026-06-30");
  });
});

describe("deep check 0600 M31 + M35", () => {
  it("M35: with two months locked, an automatic entry goes to the first open month (never dropped)", async () => {
    await db.insert(schema.bookLocks).values([{ month: "2024-01", status: "locked" }, { month: "2024-02", status: "locked" }]);
    expect(await B.firstOpenDate("2024-01-15")).toBe("2024-03-01");
    await B.recordAutoMoneyOut({ kind: "processor_fee", amountCents: 87, category: "Card fees", method: "card", ref: "fee-M35", date: "2024-01-15" });
    const [e] = (await db.select().from(schema.bookEntries)).filter((x) => x.ref === "fee-M35");
    expect(e?.entryDate).toBe("2024-03-01");
  });
  it("M31: a double click adds a bank line to the books once", async () => {
    const [l] = await db.insert(schema.bookBankLines).values({ account: "bank", lineDate: "2026-09-10", description: "HOME DEPOT", amountCents: -4599, status: "unmatched" }).returning();
    await Promise.all([act(A.categorizeLineAction(form({ id: String(l.id), category: "Supplies" }))), act(A.categorizeLineAction(form({ id: String(l.id), category: "Supplies" })))]);
    expect((await db.select().from(schema.bookEntries)).filter((x) => x.party === "HOME DEPOT")).toHaveLength(1);
    expect((await db.select().from(schema.bookBankLines).where(eq(schema.bookBankLines.id, l.id)))[0].matchedEntryIds).toHaveLength(1);
  });
});
