import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { todayISO } from "@/lib/dates";
import { KIND_LABEL, agingBucket, countyFor, openBills, openInvoices, salesTaxPeriods, solaFee, type EntryKind } from "@/lib/books";
import type { Sheet } from "@/lib/xlsx";

/** Bookkeeping reports (Abraham T). All amounts in cents; cash basis (money counted on the day it moves). */

type Entry = typeof schema.bookEntries.$inferSelect;

export async function entriesBetween(from: string, to: string): Promise<Entry[]> {
  return db
    .select()
    .from(schema.bookEntries)
    .where(and(gte(schema.bookEntries.entryDate, from), lte(schema.bookEntries.entryDate, to)))
    .orderBy(asc(schema.bookEntries.entryDate), asc(schema.bookEntries.id));
}

/** Revenue part of a money-in row: the amount less the sales tax collected in it (tax is owed to the state). */
const revenue = (e: Entry) => e.amountCents - e.taxCents;

export function periodKey(date: string, group: "month" | "quarter" | "year") {
  if (group === "year") return date.slice(0, 4);
  if (group === "quarter") return `${date.slice(0, 4)} Q${Math.floor((Number(date.slice(5, 7)) - 1) / 3) + 1}`;
  return date.slice(0, 7);
}

export type PnlRow = {
  period: string;
  rental: number;
  delivery: number;
  tips: number;
  otherIncome: number;
  deposits: number;
  cancellationFees: number;
  refunds: number;
  totalIncome: number;
  expenses: Record<string, number>;
  processorFees: number;
  contractors: number;
  totalExpenses: number;
  net: number;
  taxCollected: number;
};

export function pnl(entries: Entry[], group: "month" | "quarter" | "year"): PnlRow[] {
  const by = new Map<string, PnlRow>();
  for (const e of entries) {
    const k = periodKey(e.entryDate, group);
    const r =
      by.get(k) ??
      ({ period: k, rental: 0, delivery: 0, tips: 0, otherIncome: 0, deposits: 0, cancellationFees: 0, refunds: 0, totalIncome: 0, expenses: {}, processorFees: 0, contractors: 0, totalExpenses: 0, net: 0, taxCollected: 0 } as PnlRow);
    by.set(k, r);
    switch (e.kind) {
      case "income":
        if (e.rentalCents || e.deliveryCents || e.tipCents) {
          r.rental += e.rentalCents;
          r.delivery += e.deliveryCents;
          r.tips += e.tipCents;
          r.otherIncome += revenue(e) - e.rentalCents - e.deliveryCents - e.tipCents;
        } else r.otherIncome += revenue(e);
        r.taxCollected += e.taxCents;
        break;
      case "deposit":
        r.deposits += revenue(e);
        r.taxCollected += e.taxCents;
        break;
      case "cancellation_fee":
        r.cancellationFees += revenue(e);
        r.taxCollected += e.taxCents;
        break;
      case "refund":
        r.refunds += e.amountCents - e.taxCents;
        r.taxCollected -= e.taxCents;
        break;
      case "expense":
        r.expenses[e.category || "Uncategorized"] = (r.expenses[e.category || "Uncategorized"] ?? 0) + e.amountCents;
        break;
      case "processor_fee":
        r.processorFees += e.amountCents;
        break;
      case "contractor":
        r.contractors += e.amountCents;
        break;
    }
  }
  const rows = [...by.values()].sort((a, b) => a.period.localeCompare(b.period));
  for (const r of rows) {
    r.totalIncome = r.rental + r.delivery + r.tips + r.otherIncome + r.deposits + r.cancellationFees - r.refunds;
    r.totalExpenses = Object.values(r.expenses).reduce((s, v) => s + v, 0) + r.processorFees + r.contractors;
    r.net = r.totalIncome - r.totalExpenses;
  }
  return rows;
}

export function cashFlow(entries: Entry[]) {
  const by = new Map<string, { month: string; moneyIn: number; moneyOut: number }>();
  for (const e of entries) {
    const k = e.entryDate.slice(0, 7);
    const r = by.get(k) ?? { month: k, moneyIn: 0, moneyOut: 0 };
    if (["income", "deposit", "cancellation_fee"].includes(e.kind)) r.moneyIn += e.amountCents;
    else r.moneyOut += e.amountCents;
    by.set(k, r);
  }
  let running = 0;
  return [...by.values()]
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((r) => ((running += r.moneyIn - r.moneyOut), { ...r, net: r.moneyIn - r.moneyOut, running }));
}

export function expensesByCategory(entries: Entry[]) {
  const m = new Map<string, number>();
  for (const e of entries) {
    if (e.kind === "expense") m.set(e.category || "Uncategorized", (m.get(e.category || "Uncategorized") ?? 0) + e.amountCents);
    if (e.kind === "processor_fee") m.set("Payment processor fees", (m.get("Payment processor fees") ?? 0) + e.amountCents);
    if (e.kind === "contractor") m.set("Staff and contractors", (m.get("Staff and contractors") ?? 0) + e.amountCents);
  }
  return [...m.entries()].map(([category, cents]) => ({ category, cents })).sort((a, b) => b.cents - a.cents);
}

/** Income by channel: bookings by how they were made (phone line or staff New booking), plus manual income. */
export async function incomeByChannel(entries: Entry[]) {
  const ids = [...new Set(entries.filter((e) => e.orderId).map((e) => e.orderId!))];
  const orders = ids.length ? await db.select({ id: schema.orders.id, channel: schema.orders.channel }).from(schema.orders).where(inArray(schema.orders.id, ids)) : [];
  const ch = new Map(orders.map((o) => [o.id, o.channel]));
  const label: Record<string, string> = { PHONE: "Phone line", POS: "Staff New booking (POS)", WEB: "Website" };
  const m = new Map<string, number>();
  for (const e of entries) {
    if (!["income", "deposit", "cancellation_fee", "refund"].includes(e.kind)) continue;
    const k = e.orderId ? label[ch.get(e.orderId) ?? ""] ?? "Booking" : "Manual entries (cash, check, Zelle, other)";
    m.set(k, (m.get(k) ?? 0) + (e.kind === "refund" ? -revenue(e) : revenue(e)));
  }
  return [...m.entries()].map(([channel, cents]) => ({ channel, cents })).sort((a, b) => b.cents - a.cents);
}

/**
 * Income by rental item: each paid booking's items (price x quantity) in the range, with that item's repairs and
 * purchase cost, for profit per item.
 */
export async function incomeByItem(entries: Entry[]) {
  const orderIds = [...new Set(entries.filter((e) => e.kind === "income" && e.source === "auto" && e.orderId && e.amountCents > 0).map((e) => e.orderId!))];
  const items = orderIds.length
    ? await db
        .select({ productId: schema.orderItems.productId, qty: schema.orderItems.qty, unit: schema.orderItems.unitPriceCents, name: schema.products.name })
        .from(schema.orderItems)
        .innerJoin(schema.products, eq(schema.products.id, schema.orderItems.productId))
        .where(inArray(schema.orderItems.orderId, orderIds))
    : [];
  const equipment = await db.select().from(schema.bookEquipment);
  const m = new Map<number, { productId: number; name: string; rentals: number; incomeCents: number; repairsCents: number; costCents: number }>();
  const row = (id: number, name: string) => m.get(id) ?? (m.set(id, { productId: id, name, rentals: 0, incomeCents: 0, repairsCents: 0, costCents: 0 }), m.get(id)!);
  for (const i of items) {
    const r = row(i.productId, i.name);
    r.rentals += i.qty;
    r.incomeCents += i.qty * i.unit;
  }
  for (const e of entries) if (e.kind === "expense" && e.productId) row(e.productId, e.party || `Item ${e.productId}`).repairsCents += e.amountCents;
  for (const q of equipment) if (q.productId) row(q.productId, q.name).costCents += q.costCents * q.qty;
  return [...m.values()].map((r) => ({ ...r, profitCents: r.incomeCents - r.repairsCents - r.costCents })).sort((a, b) => b.incomeCents - a.incomeCents);
}

export async function receivablesAging(today = todayISO()) {
  return (await openInvoices()).filter((i) => i.balanceCents > 0).map((i) => ({ ...i, bucket: agingBucket(i.dueDate, today) }));
}

export async function payablesAging(today = todayISO()) {
  return (await openBills()).filter((b) => b.balanceCents > 0).map((b) => ({ ...b, bucket: agingBucket(b.dueDate, today) }));
}

/** Sales tax for a period: taxable and tax-exempt sales, tax collected by county. */
export async function salesTaxSummary(from: string, to: string) {
  const entries = (await entriesBetween(from, to)).filter((e) => ["income", "deposit", "cancellation_fee", "refund"].includes(e.kind));
  const ids = [...new Set(entries.filter((e) => e.orderId && !e.county).map((e) => e.orderId!))];
  const addr = ids.length ? new Map((await db.select({ id: schema.orders.id, a: schema.orders.deliveryAddress }).from(schema.orders).where(inArray(schema.orders.id, ids))).map((o) => [o.id, o.a])) : new Map();
  const by = new Map<string, { county: string; taxableCents: number; taxCents: number; exemptCents: number }>();
  for (const e of entries) {
    const county = e.county || (e.orderId ? countyFor(addr.get(e.orderId)) : "Orange (check)");
    const r = by.get(county) ?? { county, taxableCents: 0, taxCents: 0, exemptCents: 0 };
    const sign = e.kind === "refund" ? -1 : 1;
    const sale = (e.amountCents - e.taxCents - e.tipCents) * sign;
    if (e.taxExempt || (e.taxCents === 0 && e.source === "manual")) r.exemptCents += sale;
    else r.taxableCents += sale;
    r.taxCents += e.taxCents * sign;
    by.set(county, r);
  }
  const rows = [...by.values()].sort((a, b) => a.county.localeCompare(b.county));
  return {
    rows,
    taxableCents: rows.reduce((s, r) => s + r.taxableCents, 0),
    exemptCents: rows.reduce((s, r) => s + r.exemptCents, 0),
    taxCents: rows.reduce((s, r) => s + r.taxCents, 0),
  };
}

export async function salesTaxYear(year: number) {
  return Promise.all(salesTaxPeriods(year).map(async (p) => ({ ...p, ...(await salesTaxSummary(p.from, p.to)) })));
}

/** Straight-line depreciation list for the accountant (the accountant chooses the real tax method, e.g. Section 179). */
export async function depreciation(year: number) {
  const items = await db.select().from(schema.bookEquipment).orderBy(asc(schema.bookEquipment.purchaseDate));
  return items.map((q) => {
    const cost = q.costCents * q.qty;
    const perYear = Math.round(cost / Math.max(1, q.lifeYears));
    const start = Number(q.purchaseDate.slice(0, 4));
    const monthsFirst = 12 - Number(q.purchaseDate.slice(5, 7)) + 1;
    const portion = (y: number) => (y < start ? 0 : y === start ? Math.round((perYear * monthsFirst) / 12) : perYear);
    const through = (last: number) => {
      let acc = 0;
      for (let y = start; y <= last; y++) acc = Math.min(cost, acc + portion(y));
      return acc;
    };
    const accumulated = through(year);
    const thisYear = accumulated - through(year - 1);
    return { ...q, totalCostCents: cost, thisYearCents: thisYear, accumulatedCents: accumulated, bookValueCents: cost - accumulated };
  });
}

/** 1099 reporting threshold for nonemployee pay: $600 through 2025 payments, $2,000 from 2026 (confirm with the accountant). */
export const threshold1099 = (year: number) => (year >= 2026 ? 200_000 : 60_000);

export async function people1099(year: number) {
  const entries = (await entriesBetween(`${year}-01-01`, `${year}-12-31`)).filter((e) => e.kind === "contractor");
  const m = new Map<string, { name: string; cents: number; payments: number }>();
  for (const e of entries) {
    const k = e.personName || e.party || "Unnamed";
    const r = m.get(k) ?? { name: k, cents: 0, payments: 0 };
    r.cents += e.amountCents;
    r.payments += e.amountCents > 0 ? 1 : 0;
    m.set(k, r);
  }
  return [...m.values()].map((r) => ({ ...r, needs1099: r.cents >= threshold1099(year) })).sort((a, b) => b.cents - a.cents);
}

export async function mileageSummary(from: string, to: string) {
  const trips = await db.select().from(schema.bookMileage).where(and(gte(schema.bookMileage.tripDate, from), lte(schema.bookMileage.tripDate, to))).orderBy(asc(schema.bookMileage.tripDate));
  const byVehicle = new Map<string, number>();
  for (const t of trips) byVehicle.set(t.vehicle || "Unnamed vehicle", (byVehicle.get(t.vehicle || "Unnamed vehicle") ?? 0) + t.milesTenths);
  return { trips, totalTenths: trips.reduce((s, t) => s + t.milesTenths, 0), byVehicle: [...byVehicle.entries()].map(([vehicle, tenths]) => ({ vehicle, tenths })) };
}

/** Sola payments with the estimated fee and net deposit (actual fees can be entered as Processor fee entries). */
export function processorView(entries: Entry[], percent: string, fixed: string) {
  const sola = entries.filter((e) => e.kind === "income" && e.method === "sola");
  const rows = sola.map((e) => ({ id: e.id, date: e.entryDate, orderId: e.orderId, ref: e.ref, grossCents: e.amountCents, feeCents: e.amountCents > 0 ? solaFee(e.amountCents, percent, fixed) : -solaFee(-e.amountCents, percent, fixed) }));
  const actualFees = entries.filter((e) => e.kind === "processor_fee").reduce((s, e) => s + e.amountCents, 0);
  return {
    rows: rows.map((r) => ({ ...r, netCents: r.grossCents - r.feeCents })),
    grossCents: rows.reduce((s, r) => s + r.grossCents, 0),
    estFeesCents: rows.reduce((s, r) => s + r.feeCents, 0),
    actualFeesCents: actualFees,
  };
}

/* ---------------- exports ---------------- */

const $ = (c: number) => Math.round(c) / 100;

export const BOOK_REPORTS = ["ledger", "pnl", "cashflow", "by-item", "by-channel", "expenses", "aging", "sales-tax", "equipment", "1099", "mileage"] as const;
export type BookReport = (typeof BOOK_REPORTS)[number];
export const BOOK_REPORT_LABEL: Record<BookReport, string> = {
  ledger: "All entries (ledger)",
  pnl: "Profit and loss",
  cashflow: "Cash flow",
  "by-item": "Income and profit by item",
  "by-channel": "Income by channel",
  expenses: "Expenses by category",
  aging: "Receivables and payables aging",
  "sales-tax": "Sales tax summary",
  equipment: "Equipment depreciation list",
  "1099": "Staff and contractor totals (1099)",
  mileage: "Mileage log",
};

export async function buildBookReport(report: BookReport, from: string, to: string, group: "month" | "quarter" | "year" = "month"): Promise<Sheet[]> {
  const entries = await entriesBetween(from, to);
  switch (report) {
    case "ledger":
      return [
        {
          name: "Ledger",
          header: ["#", "Date", "Type", "Category", "Party", "Method", "Check #", "Amount", "Rental", "Delivery", "Sales tax", "Tip", "Booking", "Invoice", "Bill", "Person", "County", "Tax exempt", "Ref", "Notes", "Source", "Corrects #"],
          rows: entries.map((e) => [e.id, e.entryDate, KIND_LABEL[e.kind as EntryKind] ?? e.kind, e.category, e.party, e.method, e.checkNo, $(e.amountCents), $(e.rentalCents), $(e.deliveryCents), $(e.taxCents), $(e.tipCents), e.orderId, e.invoiceId, e.billId, e.personName, e.county, e.taxExempt ? "yes" : "", e.ref, e.notes, e.source, e.correctsId]),
        },
      ];
    case "pnl": {
      const rows = pnl(entries, group);
      const cats = [...new Set(rows.flatMap((r) => Object.keys(r.expenses)))].sort();
      return [
        {
          name: "Profit and loss",
          header: ["Period", "Rental", "Delivery", "Tips", "Other income", "Deposits", "Cancellation fees", "Refunds", "Total income", ...cats, "Processor fees", "Staff and contractors", "Total expenses", "Net profit", "Sales tax collected (not income)"],
          rows: rows.map((r) => [r.period, $(r.rental), $(r.delivery), $(r.tips), $(r.otherIncome), $(r.deposits), $(r.cancellationFees), $(-r.refunds), $(r.totalIncome), ...cats.map((c) => $(r.expenses[c] ?? 0)), $(r.processorFees), $(r.contractors), $(r.totalExpenses), $(r.net), $(r.taxCollected)]),
        },
      ];
    }
    case "cashflow":
      return [{ name: "Cash flow", header: ["Month", "Money in", "Money out", "Net", "Running total"], rows: cashFlow(entries).map((r) => [r.month, $(r.moneyIn), $(r.moneyOut), $(r.net), $(r.running)]) }];
    case "by-item":
      return [{ name: "By item", header: ["Item", "Rentals", "Income", "Repairs", "Purchase cost", "Profit"], rows: (await incomeByItem(entries)).map((r) => [r.name, r.rentals, $(r.incomeCents), $(r.repairsCents), $(r.costCents), $(r.profitCents)]) }];
    case "by-channel":
      return [{ name: "By channel", header: ["Channel", "Income (before sales tax)"], rows: (await incomeByChannel(entries)).map((r) => [r.channel, $(r.cents)]) }];
    case "expenses":
      return [{ name: "Expenses", header: ["Category", "Amount"], rows: expensesByCategory(entries).map((r) => [r.category, $(r.cents)]) }];
    case "aging": {
      const ar = await receivablesAging(to);
      const ap = await payablesAging(to);
      return [
        { name: "Receivables", header: ["Invoice", "Customer", "Issued", "Due", "Amount", "Paid", "Balance", "Aging"], rows: ar.map((i) => [i.id, i.customerName, i.issueDate, i.dueDate, $(i.amountCents), $(i.paidCents), $(i.balanceCents), i.bucket]) },
        { name: "Payables", header: ["Bill", "Vendor", "Bill date", "Due", "Amount", "Paid", "Balance", "Aging"], rows: ap.map((b) => [b.id, b.vendor, b.billDate, b.dueDate, $(b.amountCents), $(b.paidCents), $(b.balanceCents), b.bucket]) },
      ];
    }
    case "sales-tax": {
      const s = await salesTaxSummary(from, to);
      return [
        {
          name: "Sales tax",
          header: ["County", "Taxable sales", "Tax-exempt sales", "Sales tax collected"],
          rows: [...s.rows.map((r) => [r.county, $(r.taxableCents), $(r.exemptCents), $(r.taxCents)]), ["Total", $(s.taxableCents), $(s.exemptCents), $(s.taxCents)]],
        },
      ];
    }
    case "equipment": {
      const year = Number(to.slice(0, 4));
      return [
        {
          name: `Depreciation ${year}`,
          header: ["Item", "Purchased", "Qty", "Cost", "Life (years)", `Depreciation ${year}`, "Accumulated", "Book value", "Notes"],
          rows: (await depreciation(year)).map((q) => [q.name, q.purchaseDate, q.qty, $(q.totalCostCents), q.lifeYears, $(q.thisYearCents), $(q.accumulatedCents), $(q.bookValueCents), q.notes]),
        },
      ];
    }
    case "1099": {
      const year = Number(to.slice(0, 4));
      return [{ name: `1099 ${year}`, header: ["Person", "Payments", "Total paid", `1099 needed (over $${threshold1099(year) / 100})`], rows: (await people1099(year)).map((p) => [p.name, p.payments, $(p.cents), p.needs1099 ? "yes" : "no"]) }];
    }
    case "mileage": {
      const m = await mileageSummary(from, to);
      return [{ name: "Mileage", header: ["Date", "Vehicle", "Driver", "Miles", "Purpose", "Booking", "Notes"], rows: m.trips.map((t) => [t.tripDate, t.vehicle, t.driver, t.milesTenths / 10, t.purpose, t.orderId, t.notes]) }];
    }
  }
}

/** QuickBooks Online bank-transaction import (3 columns: Date, Description, Amount; money out negative). */
export function quickbooksCsv(entries: Entry[]) {
  const sign = (e: Entry) => (["income", "deposit", "cancellation_fee"].includes(e.kind) ? e.amountCents : -e.amountCents);
  const fmt = (d: string) => `${d.slice(5, 7)}/${d.slice(8, 10)}/${d.slice(0, 4)}`;
  const desc = (e: Entry) => [KIND_LABEL[e.kind as EntryKind] ?? e.kind, e.category, e.party || e.personName, e.orderId ? `booking ${e.orderId}` : null, e.checkNo ? `check ${e.checkNo}` : null].filter(Boolean).join(" - ");
  return [["Date", "Description", "Amount"], ...entries.map((e) => [fmt(e.entryDate), desc(e), (sign(e) / 100).toFixed(2)])];
}

/** QuickBooks Desktop IIF general journal: each entry as a two-line transaction (bank account vs income/expense account). */
export function quickbooksIif(entries: Entry[]) {
  const lines = ["!TRNS\tTRNSTYPE\tDATE\tACCNT\tNAME\tAMOUNT\tMEMO", "!SPL\tTRNSTYPE\tDATE\tACCNT\tNAME\tAMOUNT\tMEMO", "!ENDTRNS"];
  const clean = (s: string | null | undefined) => (s ?? "").replace(/[\t\r\n]/g, " ");
  for (const e of entries) {
    const d = `${e.entryDate.slice(5, 7)}/${e.entryDate.slice(8, 10)}/${e.entryDate.slice(0, 4)}`;
    const inflow = ["income", "deposit", "cancellation_fee"].includes(e.kind);
    const amt = (inflow ? e.amountCents : -e.amountCents) / 100;
    const acct = e.kind === "income" ? "Rental Income" : e.kind === "expense" ? clean(e.category) || "Uncategorized Expense" : KIND_LABEL[e.kind as EntryKind] ?? e.kind;
    const memo = clean(e.notes || `${KIND_LABEL[e.kind as EntryKind] ?? e.kind}${e.orderId ? ` booking ${e.orderId}` : ""}`);
    lines.push(`TRNS\tGENERAL JOURNAL\t${d}\tChecking\t${clean(e.party || e.personName)}\t${amt.toFixed(2)}\t${memo}`);
    lines.push(`SPL\tGENERAL JOURNAL\t${d}\t${acct}\t${clean(e.party || e.personName)}\t${(-amt).toFixed(2)}\t${memo}`);
    lines.push("ENDTRNS");
  }
  return lines.join("\r\n") + "\r\n";
}
