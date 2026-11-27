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
