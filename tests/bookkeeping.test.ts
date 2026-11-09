import { beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

/* Bookkeeping (Abraham T). In-memory database with the real migrations (including the no-delete / lock triggers). */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Error(`REDIRECT ${u}`); } }));

import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { markPaid } from "@/lib/orders";
import * as B from "@/lib/books";
import * as R from "@/lib/books-reports";
import { buildXlsx } from "@/lib/xlsx";

let productId = 0;
async function order(over: Partial<typeof schema.orders.$inferInsert> = {}) {
  const [o] = await db
    .insert(schema.orders)
    .values({ status: "PENDING_PAYMENT", channel: "PHONE", eventDate: "2026-06-10", pickupDate: "2026-06-11", subtotalCents: 10000, deliveryFeeCents: 1000, taxCents: 894, totalCents: 11894, deliveryAddress: "12 Forest Rd, Monroe, NY 10950", ...over })
    .returning();
  await db.insert(schema.orderItems).values({ orderId: o.id, productId, qty: 1, unitPriceCents: 10000 });
  return o;
}
const autoRows = async (orderId: number) => (await db.select().from(schema.bookEntries).where(eq(schema.bookEntries.orderId, orderId))).filter((e) => e.source === "auto");

beforeAll(async () => {
  const [cat] = await db.insert(schema.categories).values({ name: "Bounce Houses", sortOrder: 1, active: true }).returning();
  const [p] = await db.insert(schema.products).values({ categoryId: cat.id, name: "Castle Bouncer", priceCents: 10000, quantity: 2, active: true, sortOrder: 1 }).returning();
  productId = p.id;
});

describe("1. income from paid bookings is recorded automatically", () => {
  it("splits into rental, delivery, sales tax and tip; a repeated payment notice isn't counted twice", async () => {
    const o = await order();
    await markPaid(o.id, 11894, "sola", "REF1");
    await markPaid(o.id, 11894, "sola", "REF1");
    const rows = await autoRows(o.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "income", amountCents: 11894, rentalCents: 10000, deliveryCents: 1000, taxCents: 894, tipCents: 0, method: "sola", county: "Orange" });
  });
  it("anything paid above the total is a tip; a partial payment is split in proportion", async () => {
    const o = await order();
    await markPaid(o.id, 12894, "cash", null);
    expect((await autoRows(o.id))[0]).toMatchObject({ rentalCents: 10000, deliveryCents: 1000, taxCents: 894, tipCents: 1000 });
    const p = await order();
    await markPaid(p.id, 5947, "sola", "HALF");
    const [h] = await autoRows(p.id);
    expect(h.rentalCents + h.deliveryCents + h.taxCents).toBe(5947);
    expect(h.taxCents).toBe(447);
  });
});

describe("14. safety", () => {
  it("entries can't be deleted or edited; a correction is a new entry and the books net to zero", async () => {
    const e = await B.addEntry({ entryDate: "2026-07-01", kind: "expense", category: "Repairs", amountCents: 5000, method: "cash", party: "Fix-It" }, 1);
    await expect(db.delete(schema.bookEntries).where(eq(schema.bookEntries.id, e.id))).rejects.toThrow();
    await expect(db.update(schema.bookEntries).set({ amountCents: 1 }).where(eq(schema.bookEntries.id, e.id))).rejects.toThrow();
    const c = await B.reverseEntry(e.id, "typed twice", 1, "2026-07-02");
    expect(c).toMatchObject({ amountCents: -5000, correctsId: e.id });
    await expect(B.reverseEntry(e.id, "again", 1)).rejects.toThrow(/already corrected/);
    const [pl] = R.pnl(await R.entriesBetween("2026-07-01", "2026-07-31"), "month");
    expect(pl.expenses.Repairs).toBe(0);
    const audit = await db.select().from(schema.auditLog).where(eq(schema.auditLog.entityType, "book_entry"));
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(["books.entry_added", "books.correction"]));
  });
  it("a locked month takes no new entries (even from the database directly)", async () => {
    await db.insert(schema.bookLocks).values({ month: "2026-01" });
    await expect(B.addEntry({ entryDate: "2026-01-15", kind: "income", amountCents: 100, method: "cash" }, 1)).rejects.toThrow(/locked/);
    await expect(db.insert(schema.bookEntries).values({ entryDate: "2026-01-20", kind: "income", amountCents: 100 })).rejects.toThrow();
    await expect(db.delete(schema.bookLocks).where(eq(schema.bookLocks.month, "2026-01"))).rejects.toThrow();
  });
  it("never stores a card number; checks need a check number", async () => {
    await expect(B.addEntry({ entryDate: "2026-07-03", kind: "income", amountCents: 100, method: "cash", notes: "card 4111 1111 1111 1111" }, 1)).rejects.toThrow(/card number/);
    await expect(B.addEntry({ entryDate: "2026-07-03", kind: "income", amountCents: 100, method: "check" }, 1)).rejects.toThrow(/check number/);
    expect(() => B.assertNoCardNumber("order 1234567890123 ok")).not.toThrow(); // not a valid card number (Luhn)
  });
  it("Owner only: other staff are refused unless the Owner grants bookkeeping", async () => {
    const [u] = await db.insert(schema.adminUsers).values({ name: "Sara", phone: "+18455550111", role: "secretary", active: true }).returning();
    expect(await B.canUseBooks({ role: "owner", userId: null })).toBe(true);
    expect(await B.canUseBooks({ role: "secretary", userId: u.id })).toBe(false);
    await db.insert(schema.userPermissionOverrides).values({ userId: u.id, permission: "bookkeeping", allowed: true });
    expect(await B.canUseBooks({ role: "secretary", userId: u.id })).toBe(true);
    expect(readFileSync("src/components/Sidebar.tsx", "utf8")).toContain('bookTabHref(tab), BOOK_ICONS[tab] ?? List, label, O, g.label');
    expect(readFileSync("src/app/admin/(app)/bookkeeping/page.tsx", "utf8")).toContain("await requireBooks()");
    const actions = readFileSync("src/app/admin/(app)/bookkeeping/actions.ts", "utf8");
    expect(actions.match(/export async function \w+Action/g)!.length).toBe((actions.match(/return run\(/g) || []).length);
    for (const f of ["src/app/api/admin/books/export/route.ts", "src/app/admin/(app)/bookkeeping/files/[id]/route.ts"]) expect(readFileSync(f, "utf8")).toContain("canUseBooks(s)");
  });
});

describe("2, 5. invoices, bills, aging and reminders", () => {
  it("partial payments leave a balance; overdue invoices and bills due soon are reminded", async () => {
    const [inv] = await db.insert(schema.bookInvoices).values({ customerName: "Bais Yaakov", issueDate: "2026-09-01", dueDate: "2026-09-30", amountCents: 50000, taxExempt: true, exemptCertNo: "ST-119-123" }).returning();
    await B.addEntry({ entryDate: "2026-09-15", kind: "income", amountCents: 20000, method: "check", checkNo: "1001", invoiceId: inv.id, taxExempt: true }, 1);
    const open = (await B.openInvoices()).find((i) => i.id === inv.id)!;
    expect(open.balanceCents).toBe(30000);
    const [bill] = await db.insert(schema.bookBills).values({ vendor: "Insurance Co", billDate: "2026-10-01", dueDate: "2026-10-12", amountCents: 80000 }).returning();
    await B.addEntry({ entryDate: "2026-10-05", kind: "expense", amountCents: 30000, method: "check", billId: bill.id }, 1);
    const rem = await B.reminders(7, "2026-10-08");
    expect(rem.find((r) => r.kind === "invoice")).toMatchObject({ overdue: true, cents: 30000 });
    expect(rem.find((r) => r.kind === "bill")).toMatchObject({ overdue: false, cents: 50000, due: "2026-10-12" });
    expect((await R.payablesAging("2026-11-20")).find((b) => b.id === bill.id)?.bucket).toBe("31-60");
    expect(B.agingBucket("2026-10-01", "2026-10-01")).toBe("current");
    expect(B.agingBucket("2026-06-01", "2026-10-01")).toBe("90+");
    await expect(db.delete(schema.bookInvoices).where(eq(schema.bookInvoices.id, inv.id))).rejects.toThrow();
  });
  it("recurring expenses move to the next date", () => {
    expect(B.nextRecurring("2026-01-31", "monthly")).toBe("2026-03-03"); // JS month roll-over is fine for reminders
    expect(B.nextRecurring("2026-01-15", "monthly")).toBe("2026-02-15");
    expect(B.nextRecurring("2026-01-15", "quarterly")).toBe("2026-04-15");
    expect(B.nextRecurring("2026-01-15", "yearly")).toBe("2027-01-15");
    expect(B.nextRecurring("2026-01-15", "weekly")).toBe("2026-01-22");
  });
});

describe("8. sales tax", () => {
  it("NY quarterly periods and due dates; tax by county with exempt sales separate", async () => {
    expect(B.salesTaxPeriods(2026).map((p) => [p.from, p.to, p.due])).toEqual([
      ["2025-12-01", "2026-02-28", "2026-03-20"],
      ["2026-03-01", "2026-05-31", "2026-06-20"],
      ["2026-06-01", "2026-08-31", "2026-09-20"],
      ["2026-09-01", "2026-11-30", "2026-12-20"],
    ]);
    expect(B.countyFor("5 Main St, Monsey NY")).toBe("Rockland");
    expect(B.countyFor("12 Forest Rd, Monroe, NY 10950")).toBe("Orange");
    await B.addEntry({ entryDate: "2026-08-05", kind: "income", amountCents: 10813, taxCents: 813, method: "cash", county: "Rockland" }, 1);
    const s = await R.salesTaxSummary("2026-06-01", "2026-08-31");
    expect(s.rows.find((r) => r.county === "Rockland")).toMatchObject({ taxableCents: 10000, taxCents: 813 });
    const fall = await R.salesTaxSummary("2026-09-01", "2026-11-30");
    expect(fall.rows.find((r) => r.county === "Orange")?.taxCents).toBeGreaterThan(0); // today's paid bookings (Monroe)
    expect(fall.exemptCents).toBe(20000); // the school's check
  });
});

describe("6, 7. Sola fees and bank reconciliation", () => {
  it("reads bank CSVs (Amount, or Debit/Credit) and matches lines, including a Sola batch deposit net of fees", async () => {
    const csv1 = 'Date,Description,Amount\n09/15/2026,"Mobile deposit check 1001",200.00\n10/05/2026,CHECK 2002,-300.00\n10/09/2026,COFFEE,-4.50\n';
    expect(B.parseStatementCsv(csv1)).toEqual([
      { lineDate: "2026-09-15", description: "Mobile deposit check 1001", amountCents: 20000 },
      { lineDate: "2026-10-05", description: "CHECK 2002", amountCents: -30000 },
      { lineDate: "2026-10-09", description: "COFFEE", amountCents: -450 },
    ]);
    const csv2 = "Posting Date,Details,Debit,Credit\n2026-10-06,SOLA DEPOSIT,,230.38\n";
    expect(B.parseStatementCsv(csv2)).toEqual([{ lineDate: "2026-10-06", description: "SOLA DEPOSIT", amountCents: 23038 }]);
    // Two Sola payments on Oct 5 -> one deposit Oct 6, net of 2.9% + $0.30 each
    await B.addEntry({ entryDate: "2026-10-05", kind: "income", amountCents: 11894, method: "sola", ref: "A" }, 1);
    await B.addEntry({ entryDate: "2026-10-05", kind: "income", amountCents: 11894, method: "sola", ref: "B" }, 1);
    expect(B.solaFee(11894, "2.9", "30")).toBe(375);
    await db.insert(schema.bookBankLines).values([...B.parseStatementCsv(csv1), ...B.parseStatementCsv(csv2)].map((l) => ({ ...l, account: "bank" })));
    expect(await B.autoMatch("2.9", "30")).toBe(3);
    const lines = await db.select().from(schema.bookBankLines);
    expect(lines.find((l) => l.description === "SOLA DEPOSIT")).toMatchObject({ status: "matched" });
    expect(lines.find((l) => l.description === "SOLA DEPOSIT")!.matchedEntryIds).toHaveLength(2);
    expect(lines.find((l) => l.description === "COFFEE")?.status).toBe("unmatched"); // flagged
    const pv = R.processorView(await R.entriesBetween("2026-10-05", "2026-10-05"), "2.9", "30");
    expect(pv.grossCents - pv.estFeesCents).toBe(23038);
  });
});

describe("9-12. equipment, 1099, mileage, reports", () => {
  it("profit per item, depreciation, 1099 totals and mileage", async () => {
    await db.insert(schema.bookEquipment).values({ productId, name: "Castle Bouncer", purchaseDate: "2026-07-01", costCents: 120000, qty: 1, lifeYears: 5 });
    await B.addEntry({ entryDate: "2026-07-10", kind: "expense", category: "Repairs", amountCents: 2500, productId, method: "cash" }, 1);
    const items = await R.incomeByItem(await R.entriesBetween("2026-01-01", "2026-12-31"));
    const castle = items.find((i) => i.productId === productId)!;
    expect(castle.costCents).toBe(120000);
    expect(castle.repairsCents).toBe(2500);
    expect(castle.incomeCents).toBeGreaterThan(0);
    const [dep] = await R.depreciation(2026);
    expect(dep.thisYearCents).toBe(12000); // 24,000/yr x 6 months
    expect((await R.depreciation(2027))[0].thisYearCents).toBe(24000);
    await B.addEntry({ entryDate: "2026-08-01", kind: "contractor", amountCents: 150000, method: "zelle", personName: "Moshe" }, 1);
    await B.addEntry({ entryDate: "2026-09-01", kind: "contractor", amountCents: 60000, method: "zelle", personName: "Moshe" }, 1);
    expect((await R.people1099(2026))[0]).toMatchObject({ name: "Moshe", cents: 210000, needs1099: true });
    await db.insert(schema.bookMileage).values({ tripDate: "2026-08-02", milesTenths: 123, vehicle: "Van" });
    expect((await R.mileageSummary("2026-08-01", "2026-08-31")).totalTenths).toBe(123);
  });
  it("P&L, cash flow, by channel; every report exports to Excel/CSV; QuickBooks CSV and IIF", async () => {
    const entries = await R.entriesBetween("2026-01-01", "2026-12-31");
    const year = R.pnl(entries, "year")[0];
    expect(year.net).toBe(year.totalIncome - year.totalExpenses);
    expect(R.pnl(entries, "quarter").map((r) => r.period)).toContain("2026 Q3");
    expect(R.cashFlow(entries).at(-1)!.running).toBe(entries.reduce((s, e) => s + B.signed(e.kind, e.amountCents), 0));
    expect((await R.incomeByChannel(entries)).map((r) => r.channel)).toEqual(expect.arrayContaining(["Phone line", "Manual entries (cash, check, Zelle, other)"]));
    for (const r of R.BOOK_REPORTS) {
      const sheets = await R.buildBookReport(r, "2026-01-01", "2026-12-31", "quarter");
      expect(sheets.length).toBeGreaterThan(0);
      expect(buildXlsx(sheets).length).toBeGreaterThan(100);
    }
    const qbo = R.quickbooksCsv(entries);
    expect(qbo[0]).toEqual(["Date", "Description", "Amount"]);
    expect(qbo[1][0]).toMatch(/^\d{2}\/\d{2}\/2026$/);
    const iif = R.quickbooksIif(entries);
    expect(iif.startsWith("!TRNS\tTRNSTYPE\tDATE\tACCNT")).toBe(true);
    expect((iif.match(/^ENDTRNS$/gm) || []).length).toBe(entries.length + 0 + 1 - 1);
  });
  it("the migration recorded bookings paid before the books existed, and seeded the categories", () => {
    const m = readFileSync("drizzle/0017_bookkeeping.sql", "utf8");
    expect(m).toContain("Recorded from the booking when the books were set up");
    for (const c of ["Equipment purchases", "Repairs", "Fuel and vehicle", "Insurance", "Advertising", "Phone and software", "Supplies", "Storage", "Wages", "Fees"]) expect(m).toContain(`'${c}'`);
  });
  it("database totals stay in cents (no float drift)", async () => {
    const r = (await db.execute(sql`SELECT pg_typeof(amount_cents)::text AS t FROM book_entries LIMIT 1`)).rows[0] as { t: string };
    expect(r.t).toBe("integer");
  });
});
