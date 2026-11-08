import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

/* Abraham DD (Bookkeeping part): balance sheet, date presets on every report, CSV and PDF for every report. */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Error(`REDIRECT ${u}`); } }));

import { db, schema } from "@/lib/db";
import { saveSetting } from "@/lib/settings";
import { addEntry } from "@/lib/books";
import { BOOK_REPORTS, balanceSheet, buildBookReport, datePresets } from "@/lib/books-reports";

describe("date presets", () => {
  it("this month, last month, this quarter, year to date, last year", () => {
    expect(datePresets("2026-11-08").map((p) => [p.key, p.from, p.to])).toEqual([
      ["this-month", "2026-11-01", "2026-11-30"],
      ["last-month", "2026-10-01", "2026-10-31"],
      ["quarter", "2026-10-01", "2026-12-31"],
      ["ytd", "2026-01-01", "2026-11-08"],
      ["last-year", "2025-01-01", "2025-12-31"],
    ]);
    expect(datePresets("2027-01-15")[1]).toMatchObject({ from: "2026-12-01", to: "2026-12-31" });
    expect(datePresets("2028-02-10")[0].to).toBe("2028-02-29");
  });
  it("every report screen with dates shows the presets; any start and end date still works", () => {
    const page = readFileSync("src/app/admin/(app)/bookkeeping/page.tsx", "utf8");
    expect(page).toContain("data-date-presets");
    expect(page.match(/<RangeForm/g)!.length).toBeGreaterThanOrEqual(4);
    expect(page).toContain('type="date" name="from"');
  });
});

describe("balance sheet", () => {
  it("cash from the opening balance plus the books; receivables, equipment, bills, sales tax owed; it balances", async () => {
    await saveSetting("bookOpeningCashCents", "500000");
    await saveSetting("bookOpeningDate", "2026-01-01");
    await addEntry({ entryDate: "2026-03-01", kind: "income", amountCents: 108125, taxCents: 8125, method: "cash" }, null); // $1,081.25 incl. $81.25 tax
    await addEntry({ entryDate: "2026-03-05", kind: "expense", amountCents: 20000, method: "card", category: "Fuel and vehicle" }, null);
    await addEntry({ entryDate: "2026-06-20", kind: "expense", amountCents: 5000, method: "bank", category: "Sales tax payment" }, null);
    await db.insert(schema.bookInvoices).values({ customerName: "School", issueDate: "2026-04-01", dueDate: "2026-05-01", amountCents: 30000 });
    await db.insert(schema.bookBills).values({ vendor: "Insurance", billDate: "2026-04-01", dueDate: "2026-07-01", amountCents: 12000 });
    await db.insert(schema.bookEquipment).values({ name: "Trailer", purchaseDate: "2026-01-01", costCents: 120000, lifeYears: 5 });
    const b = await balanceSheet("2026-12-31");
    expect(b.cash).toBe(500000 + 108125 - 20000 - 5000);
    expect(b.ar).toBe(30000);
    expect(b.equipment).toBe(120000 - 24000);
    expect(b.ap).toBe(12000);
    expect(b.taxPayable).toBe(8125 - 5000);
    expect(b.assets).toBe(b.cash + b.ar + b.equipment);
    expect(b.liabilities + b.equity).toBe(b.assets);
  });
  it("every report (balance sheet included) exports to CSV and Excel and has a printable PDF page", async () => {
    expect(BOOK_REPORTS).toContain("balance-sheet");
    const [sheet] = await buildBookReport("balance-sheet", "2026-01-01", "2026-12-31");
    expect(sheet.rows.find((r) => r[0] === "Total assets")).toBeTruthy();
    const route = readFileSync("src/app/api/admin/books/export/route.ts", "utf8");
    expect(route).toContain('format === "csv"');
    expect(readFileSync("src/app/admin/(app)/bookkeeping/page.tsx", "utf8")).toContain("BOOK_REPORTS.map((r) =>");
    expect(readFileSync("src/app/admin/(app)/bookkeeping/print/page.tsx", "utf8")).toContain("buildBookReport(report, from, to, group)");
  });
});
