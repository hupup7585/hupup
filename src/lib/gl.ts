import { and, asc, eq, inArray, lte, gte, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getSettings, type Settings } from "@/lib/settings";
import { BooksError, assertNoCardNumber, bookAudit, isLocked, isoDate } from "@/lib/books";

/**
 * General ledger (Bookkeeping spec, step 1): double-entry journal entries on an accountant-approved chart of accounts.
 * Nothing is pre-filled or guessed: until the accountant's chart is entered and the Owner marks it approved, posting is
 * blocked and Admin shows "Not active yet: needs accountant setup". Entries are never deleted; a posted entry is
 * changed only by a reversal; a locked month takes no postings.
 */

export const ACCOUNT_TYPES = ["asset", "liability", "equity", "income", "cogs", "expense", "other_income", "other_expense"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];
export const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  asset: "Asset",
  liability: "Liability",
  equity: "Equity",
  income: "Income",
  cogs: "Cost of goods sold",
  expense: "Expense",
  other_income: "Other income",
  other_expense: "Other expense",
};
/** Normal balance side: debit for assets, COGS and expenses; credit for the rest. */
export const debitNormal = (t: string) => ["asset", "cogs", "expense", "other_expense"].includes(t);

export type GlSetup = { ready: boolean; missing: string[] };

/** What the accountant still needs to set up before the ledger can post. */
export async function glSetup(s?: Settings): Promise<GlSetup> {
  const st = s ?? (await getSettings());
  const missing: string[] = [];
  const [{ n }] = (await db.execute(sql`SELECT count(*)::int AS n FROM gl_accounts WHERE active`)).rows as { n: number }[];
  if (!Number(n)) missing.push("chart of accounts (no accounts entered)");
  if (!(st.glChartApprovedBy && st.glChartApprovedOn)) missing.push("the accountant's approval of the chart of accounts");
  if (!st.glFiscalYearStartMonth) missing.push("fiscal year start");
  if (!st.glAccountingMethod) missing.push("accounting method (cash or accrual)");
  return { ready: missing.length === 0, missing };
}

export type JournalLineInput = { accountId: number; debitCents: number; creditCents: number; memo?: string | null; projectId?: number | null };

function checkLines(lines: JournalLineInput[]) {
  const used = lines.filter((l) => l.debitCents || l.creditCents);
  if (used.length < 2) throw new BooksError("A journal entry needs at least two lines.");
  for (const l of used) {
    if (!Number.isInteger(l.debitCents) || !Number.isInteger(l.creditCents) || l.debitCents < 0 || l.creditCents < 0) throw new BooksError("Amounts must be zero or more.");
    if (l.debitCents && l.creditCents) throw new BooksError("Each line is either a debit or a credit, not both.");
    if (!l.accountId) throw new BooksError("Choose an account on every line.");
    assertNoCardNumber(l.memo);
  }
  const dr = used.reduce((s, l) => s + l.debitCents, 0);
  const cr = used.reduce((s, l) => s + l.creditCents, 0);
  if (dr !== cr) throw new BooksError(`Debits (${(dr / 100).toFixed(2)}) and credits (${(cr / 100).toFixed(2)}) must be equal.`);
  return { used, total: dr };
}

/** Save a journal entry as a draft (balanced, real accounts). Posting is a separate, approved step. */
export async function createJournal(input: { entryDate: string; memo: string; lines: JournalLineInput[]; preparedBy: number | null; fileId?: number | null; source?: string; sourceRef?: string | null }) {
  if (!isoDate(input.entryDate)) throw new BooksError("Enter the date.");
  if (!input.memo.trim()) throw new BooksError("Explain the entry (memo).");
  assertNoCardNumber(input.memo);
  const { used, total } = checkLines(input.lines);
  const ids = [...new Set(used.map((l) => l.accountId))];
  const accts = await db.select().from(schema.glAccounts).where(inArray(schema.glAccounts.id, ids));
  if (accts.length !== ids.length || accts.some((a) => !a.active)) throw new BooksError("Every line needs an active account from the chart.");
  const [e] = await db
    .insert(schema.journalEntries)
    .values({ entryDate: input.entryDate, memo: input.memo.trim(), source: input.source ?? "manual", sourceRef: input.sourceRef ?? null, status: "draft", totalCents: total, preparedBy: input.preparedBy, fileId: input.fileId ?? null })
    .returning();
  await db.insert(schema.journalLines).values(used.map((l) => ({ entryId: e.id, accountId: l.accountId, debitCents: l.debitCents, creditCents: l.creditCents, memo: l.memo?.trim() || null, projectId: l.projectId ?? null })));
  await bookAudit(input.preparedBy, "journal_created", "journal_entry", e.id, { entryDate: e.entryDate, memo: e.memo, total, lines: used });
  return e;
}

/**
 * Post (approve) a journal entry. Needs the accountant setup. At or above the Owner's approval amount, the person who
 * prepared it can't approve it (separation of duties).
 */
export async function postJournal(id: number, approver: number | null) {
  const s = await getSettings();
  const setup = await glSetup(s);
  if (!setup.ready) throw new BooksError(`Not active yet: needs accountant setup (${setup.missing.join(", ")}).`);
  const [e] = await db.select().from(schema.journalEntries).where(eq(schema.journalEntries.id, id));
  if (!e) throw new BooksError("Entry not found.");
  if (e.status !== "draft" && e.status !== "pending") throw new BooksError("This entry is already posted.");
  if (await isLocked(e.entryDate)) throw new BooksError(`${e.entryDate.slice(0, 7)} is locked. Reopen it (Owner, with a reason) or date the entry in an open month.`);
  const threshold = s.glApprovalThresholdCents === "" ? null : Number(s.glApprovalThresholdCents);
  if (threshold !== null && e.totalCents >= threshold && e.preparedBy === approver) {
    await db.update(schema.journalEntries).set({ status: "pending" }).where(eq(schema.journalEntries.id, id));
    throw new BooksError(`Entries of $${(threshold / 100).toFixed(2)} or more need a second person to approve. It's waiting for approval.`);
  }
  await db.update(schema.journalEntries).set({ status: "posted", approvedBy: approver, approvedAt: new Date() }).where(eq(schema.journalEntries.id, id));
  await bookAudit(approver, "journal_posted", "journal_entry", id, { total: e.totalCents, preparedBy: e.preparedBy });
}

/** Reverse a posted entry: a new posted entry with debits and credits swapped. The original stays, marked reversed. */
export async function reverseJournal(id: number, reason: string, userId: number | null, date: string) {
  if (!reason.trim()) throw new BooksError("Say why it's being reversed.");
  const [e] = await db.select().from(schema.journalEntries).where(eq(schema.journalEntries.id, id));
  if (!e || e.status !== "posted") throw new BooksError("Only a posted entry can be reversed.");
  const lines = await db.select().from(schema.journalLines).where(eq(schema.journalLines.entryId, id));
  const r = await createJournal({
    entryDate: date,
    memo: `Reversal of entry #${id}: ${reason.trim()}`,
    lines: lines.map((l) => ({ accountId: l.accountId, debitCents: l.creditCents, creditCents: l.debitCents, memo: l.memo, projectId: l.projectId })),
    preparedBy: userId,
    source: "reversal",
  });
  await db.update(schema.journalEntries).set({ reversesId: id }).where(eq(schema.journalEntries.id, r.id));
  await postJournal(r.id, userId).catch(async (err) => {
    // a reversal is approved with the original; if the period is locked the reversal waits as a draft
    if (!(err instanceof BooksError)) throw err;
  });
  const [after] = await db.select().from(schema.journalEntries).where(eq(schema.journalEntries.id, r.id));
  if (after.status === "posted") await db.update(schema.journalEntries).set({ status: "reversed" }).where(eq(schema.journalEntries.id, id));
  await bookAudit(userId, "journal_reversed", "journal_entry", id, { reversal: r.id, reason });
  return after;
}

/** Trial balance as of a date: posted lines summed per account. Debits always equal credits. */
export async function trialBalance(asOf: string) {
  const rows = (
    await db.execute(sql`
      SELECT a.id, a.code, a.name, a.type, coalesce(sum(l.debit_cents), 0)::int AS dr, coalesce(sum(l.credit_cents), 0)::int AS cr
      FROM gl_accounts a
      LEFT JOIN journal_lines l ON l.account_id = a.id
      LEFT JOIN journal_entries e ON e.id = l.entry_id
      WHERE e.id IS NULL OR (e.status IN ('posted', 'reversed') AND e.entry_date <= ${asOf}::date)
      GROUP BY a.id ORDER BY a.code`)
  ).rows as { id: number; code: string; name: string; type: string; dr: number; cr: number }[];
  const lines = rows
    .map((r) => {
      const net = Number(r.dr) - Number(r.cr);
      return { ...r, debitCents: net > 0 ? net : 0, creditCents: net < 0 ? -net : 0 };
    })
    .filter((r) => r.debitCents || r.creditCents);
  return { lines, debitCents: lines.reduce((s, l) => s + l.debitCents, 0), creditCents: lines.reduce((s, l) => s + l.creditCents, 0) };
}

/** General ledger detail for one account in a period, with a running balance (in the account's normal direction). */
export async function accountDetail(accountId: number, from: string, to: string) {
  const [a] = await db.select().from(schema.glAccounts).where(eq(schema.glAccounts.id, accountId));
  if (!a) return null;
  const sign = debitNormal(a.type) ? 1 : -1;
  const [{ opening }] = (
    await db.execute(sql`SELECT coalesce(sum(l.debit_cents - l.credit_cents), 0)::int AS opening FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id WHERE l.account_id = ${accountId} AND e.status IN ('posted', 'reversed') AND e.entry_date < ${from}::date`)
  ).rows as { opening: number }[];
  const rows = await db
    .select({ line: schema.journalLines, entry: schema.journalEntries })
    .from(schema.journalLines)
    .innerJoin(schema.journalEntries, eq(schema.journalEntries.id, schema.journalLines.entryId))
    .where(and(eq(schema.journalLines.accountId, accountId), inArray(schema.journalEntries.status, ["posted", "reversed"]), gte(schema.journalEntries.entryDate, from), lte(schema.journalEntries.entryDate, to)))
    .orderBy(asc(schema.journalEntries.entryDate), asc(schema.journalEntries.id));
  let bal = sign * Number(opening);
  return {
    account: a,
    openingCents: bal,
    rows: rows.map((r) => {
      bal += sign * (r.line.debitCents - r.line.creditCents);
      return { ...r, balanceCents: bal };
    }),
    closingCents: bal,
  };
}

export { isLocked };
