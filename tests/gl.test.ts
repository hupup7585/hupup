import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

/* General ledger (Bookkeeping spec step 1). In-memory database with the real migrations and safeguards. */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { saveSetting } from "@/lib/settings";
import { addEntry } from "@/lib/books";
import { accountDetail, createJournal, glSetup, postJournal, reverseJournal, trialBalance } from "@/lib/gl";

const acct = async (code: string, name: string, type: string) => (await db.insert(schema.glAccounts).values({ code, name, type }).returning())[0];

describe("general ledger", () => {
  it("nothing is pre-filled; until the accountant setup is done it shows what's missing and won't post", async () => {
    expect(await db.select().from(schema.glAccounts)).toEqual([]);
    const s = await glSetup();
    expect(s.ready).toBe(false);
    expect(s.missing).toEqual(["chart of accounts (no accounts entered)", "the accountant's approval of the chart of accounts", "fiscal year start", "accounting method (cash or accrual)"]);
    const cash = await acct("1000", "Checking", "asset");
    const income = await acct("4000", "Rental income", "income");
    const draft = await createJournal({ entryDate: "2026-11-02", memo: "Cash sale", lines: [{ accountId: cash.id, debitCents: 10000, creditCents: 0 }, { accountId: income.id, debitCents: 0, creditCents: 10000 }], preparedBy: 2 });
    expect(draft.status).toBe("draft");
    await expect(postJournal(draft.id, 1)).rejects.toThrow(/Not active yet: needs accountant setup/);
  });

  it("debits must equal credits; every line needs a real active account; no card numbers", async () => {
    const [cash, income] = await db.select().from(schema.glAccounts);
    await expect(createJournal({ entryDate: "2026-11-02", memo: "x", lines: [{ accountId: cash.id, debitCents: 100, creditCents: 0 }, { accountId: income.id, debitCents: 0, creditCents: 90 }], preparedBy: 1 })).rejects.toThrow(/must be equal/);
    await expect(createJournal({ entryDate: "2026-11-02", memo: "x", lines: [{ accountId: cash.id, debitCents: 100, creditCents: 0 }], preparedBy: 1 })).rejects.toThrow(/at least two lines/);
    await expect(createJournal({ entryDate: "2026-11-02", memo: "x", lines: [{ accountId: cash.id, debitCents: 100, creditCents: 0 }, { accountId: 9999, debitCents: 0, creditCents: 100 }], preparedBy: 1 })).rejects.toThrow(/active account/);
    await expect(createJournal({ entryDate: "2026-11-02", memo: "card 4111 1111 1111 1111", lines: [{ accountId: cash.id, debitCents: 100, creditCents: 0 }, { accountId: income.id, debitCents: 0, creditCents: 100 }], preparedBy: 1 })).rejects.toThrow(/card number/);
  });

  it("after setup: posts; a second person must approve at or above the Owner's amount; trial balance balances; account detail runs", async () => {
    await saveSetting("glFiscalYearStartMonth", "1");
    await saveSetting("glAccountingMethod", "cash");
    await saveSetting("glChartApprovedBy", "R. Accountant CPA");
    await saveSetting("glChartApprovedOn", "2026-11-08");
    await saveSetting("glApprovalThresholdCents", "50000");
    expect((await glSetup()).ready).toBe(true);
    const [draft] = await db.select().from(schema.journalEntries);
    await postJournal(draft.id, 1); // $100, under the $500 approval amount
    const [cash, income] = await db.select().from(schema.glAccounts);
    const big = await createJournal({ entryDate: "2026-11-03", memo: "Big sale", lines: [{ accountId: cash.id, debitCents: 60000, creditCents: 0 }, { accountId: income.id, debitCents: 0, creditCents: 60000 }], preparedBy: 2 });
    await expect(postJournal(big.id, 2)).rejects.toThrow(/second person/);
    expect((await db.select().from(schema.journalEntries).where(eq(schema.journalEntries.id, big.id)))[0].status).toBe("pending");
    await postJournal(big.id, 1);
    const tb = await trialBalance("2026-11-30");
    expect(tb.debitCents).toBe(70000);
    expect(tb.creditCents).toBe(70000);
    const d = (await accountDetail(income.id, "2026-11-01", "2026-11-30"))!;
    expect(d.closingCents).toBe(70000);
    expect(d.rows).toHaveLength(2);
  });

  it("posted entries are never edited or deleted; a reversal is a new entry and the books net out", async () => {
    const [first] = await db.select().from(schema.journalEntries).where(eq(schema.journalEntries.status, "posted"));
    const [line] = await db.select().from(schema.journalLines).where(eq(schema.journalLines.entryId, first.id));
    await expect(db.update(schema.journalLines).set({ debitCents: 1 }).where(eq(schema.journalLines.id, line.id))).rejects.toThrow();
    await expect(db.delete(schema.journalEntries).where(eq(schema.journalEntries.id, first.id))).rejects.toThrow();
    const r = await reverseJournal(first.id, "entered twice", 1, "2026-11-04");
    expect(r).toMatchObject({ status: "posted", reversesId: first.id });
    expect((await db.select().from(schema.journalEntries).where(eq(schema.journalEntries.id, first.id)))[0].status).toBe("reversed");
    const tb = await trialBalance("2026-11-30");
    expect(tb.debitCents).toBe(60000);
  });

  it("locked months: no posting; the Owner can reopen with a reason (then books entries work), and lock it again", async () => {
    await db.insert(schema.bookLocks).values({ month: "2026-10" });
    const [cash, income] = await db.select().from(schema.glAccounts);
    const e = await createJournal({ entryDate: "2026-10-15", memo: "Late", lines: [{ accountId: cash.id, debitCents: 500, creditCents: 0 }, { accountId: income.id, debitCents: 0, creditCents: 500 }], preparedBy: 1 });
    await expect(postJournal(e.id, 1)).rejects.toThrow(/locked/);
    await expect(addEntry({ entryDate: "2026-10-15", kind: "income", amountCents: 500, method: "cash" }, 1)).rejects.toThrow(/locked/);
    await db.update(schema.bookLocks).set({ status: "reopened", reopenReason: "accountant fix" }).where(eq(schema.bookLocks.month, "2026-10"));
    await postJournal(e.id, 1);
    await addEntry({ entryDate: "2026-10-15", kind: "income", amountCents: 500, method: "cash" }, 1);
    await db.update(schema.bookLocks).set({ status: "locked" }).where(eq(schema.bookLocks.month, "2026-10"));
    await expect(addEntry({ entryDate: "2026-10-16", kind: "income", amountCents: 500, method: "cash" }, 1)).rejects.toThrow(/locked/);
    const actions = readFileSync("src/app/admin/(app)/bookkeeping/gl-actions.ts", "utf8");
    expect(actions).toMatch(/export async function reopenMonthAction[\s\S]*\}, true\);/); // Owner only
    expect(actions).toContain('if (!reason) throw new BooksError("Say why the month is being reopened.")');
  });

  it("the screen shows 'Not active yet: needs accountant setup' until it's done", () => {
    expect(readFileSync("src/app/admin/(app)/bookkeeping/Ledger.tsx", "utf8")).toContain("Not active yet: needs accountant setup.");
    expect(readFileSync("src/lib/bookkeeping-tabs.ts", "utf8")).toContain('["gl", "General ledger"]');
  });
});
