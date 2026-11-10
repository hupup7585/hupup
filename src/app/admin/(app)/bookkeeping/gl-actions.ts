"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { requireOwner } from "@/lib/auth";
import { todayISO } from "@/lib/dates";
import { saveSetting } from "@/lib/settings";
import { BooksError, bookAudit, parseMoney, requireBooks } from "@/lib/books";
import { ACCOUNT_TYPES, createJournal, postJournal, reverseJournal, type JournalLineInput } from "@/lib/gl";

/** General ledger actions (Bookkeeping spec step 1). Every change is in the audit log. */

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const back = (msg: string, err = false): never => redirect(`/admin/bookkeeping?tab=gl&${err ? "err" : "msg"}=${encodeURIComponent(msg)}`);

async function run(fn: (userId: number | null) => Promise<string>, ownerOnly = false) {
  const staff = ownerOnly ? await requireOwner() : await requireBooks();
  let msg: string;
  try {
    msg = await fn(staff.userId);
  } catch (e) {
    const m = e instanceof BooksError ? e.message : e instanceof Error && /locked|never|unique|duplicate/i.test(e.message) ? e.message.replace(/^.*?: /, "") : null;
    if (!m) console.error("gl action failed", e);
    return back(m ?? "Something went wrong. Nothing was saved.", true);
  }
  revalidatePath("/admin/bookkeeping");
  return back(msg);
}

export async function saveAccountAction(f: FormData) {
  return run(async (userId) => {
    const code = s(f, "code");
    const name = s(f, "name");
    const type = s(f, "type");
    if (!/^[A-Za-z0-9.\-]{1,20}$/.test(code)) throw new BooksError("Enter the account code the accountant gave (letters, numbers, dots or dashes).");
    if (!name) throw new BooksError("Enter the account name.");
    if (!(ACCOUNT_TYPES as readonly string[]).includes(type)) throw new BooksError("Choose the account type.");
    const parentId = s(f, "parentId") ? Number(s(f, "parentId")) : null;
    const id = s(f, "id") ? Number(s(f, "id")) : null;
    if (id) {
      const [before] = await db.select().from(schema.glAccounts).where(eq(schema.glAccounts.id, id));
      await db.update(schema.glAccounts).set({ code, name, type, parentId, active: s(f, "active") !== "off" }).where(eq(schema.glAccounts.id, id));
      await bookAudit(userId, "account_changed", "gl_account", id, { before, code, name, type, parentId, active: s(f, "active") !== "off" });
      return `Account ${code} saved.`;
    }
    const [a] = await db.insert(schema.glAccounts).values({ code, name, type, parentId, createdBy: userId }).returning();
    await bookAudit(userId, "account_added", "gl_account", a.id, { code, name, type, parentId });
    return `Account ${code} added.`;
  });
}

/** Owner only: record the accountant's approval of the chart and the fiscal settings. */
export async function saveGlSetupAction(f: FormData) {
  return run(async (userId) => {
    const month = s(f, "fiscalStart");
    const method = s(f, "method");
    const approvedBy = s(f, "approvedBy");
    const threshold = s(f, "threshold");
    if (month && !/^(1[0-2]|[1-9])$/.test(month)) throw new BooksError("Choose the month the fiscal year starts.");
    if (method && !["cash", "accrual"].includes(method)) throw new BooksError("Choose cash or accrual.");
    const cents = threshold ? parseMoney(threshold) : null;
    if (threshold && (cents === null || cents < 0)) throw new BooksError("Enter the approval amount, for example 500.00.");
    await saveSetting("glFiscalYearStartMonth", month, userId);
    await saveSetting("glAccountingMethod", method, userId);
    await saveSetting("glApprovalThresholdCents", cents === null ? "" : String(cents), userId);
    if (s(f, "approve") === "on") {
      if (!approvedBy) throw new BooksError("Enter the accountant's name to record the approval.");
      await saveSetting("glChartApprovedBy", approvedBy, userId);
      await saveSetting("glChartApprovedOn", todayISO(), userId);
    } else if (s(f, "unapprove") === "on") {
      await saveSetting("glChartApprovedBy", "", userId);
      await saveSetting("glChartApprovedOn", "", userId);
    }
    await bookAudit(userId, "gl_setup_saved", "settings", null, { month, method, threshold: cents, approvedBy: s(f, "approve") === "on" ? approvedBy : undefined, unapproved: s(f, "unapprove") === "on" });
    return "Ledger setup saved.";
  }, true);
}

function linesFrom(f: FormData): JournalLineInput[] {
  const out: JournalLineInput[] = [];
  for (let i = 0; i < 8; i++) {
    const acct = Number(s(f, `acct${i}`));
    const dr = s(f, `dr${i}`) ? parseMoney(s(f, `dr${i}`)) : 0;
    const cr = s(f, `cr${i}`) ? parseMoney(s(f, `cr${i}`)) : 0;
    if (dr === null || cr === null) throw new BooksError(`Check the amount on line ${i + 1}.`);
    if (!acct && !dr && !cr) continue;
    out.push({ accountId: acct, debitCents: dr, creditCents: cr, memo: s(f, `memo${i}`) || null });
  }
  return out;
}

export async function createJournalAction(f: FormData) {
  return run(async (userId) => {
    const e = await createJournal({ entryDate: s(f, "date"), memo: s(f, "memo"), lines: linesFrom(f), preparedBy: userId });
    if (s(f, "post") === "on") {
      try {
        await postJournal(e.id, userId);
        return `Journal entry number ${e.id} posted.`;
      } catch (err) {
        if (err instanceof BooksError) return `Journal entry number ${e.id} saved as a draft. ${err.message}`;
        throw err;
      }
    }
    return `Journal entry number ${e.id} saved as a draft.`;
  });
}

export async function postJournalAction(f: FormData) {
  return run(async (userId) => {
    await postJournal(Number(s(f, "id")), userId);
    return `Journal entry number ${s(f, "id")} posted.`;
  });
}

export async function reverseJournalAction(f: FormData) {
  return run(async (userId) => {
    const r = await reverseJournal(Number(s(f, "id")), s(f, "reason"), userId, todayISO());
    return r.status === "posted" ? `Reversed: entry number ${r.id} posted.` : `Reversal number ${r.id} saved; it posts once approved.`;
  });
}

/** Owner only: reopen a locked month (with a reason) or lock it again. */
export async function reopenMonthAction(f: FormData) {
  return run(async (userId) => {
    const month = s(f, "month");
    const reason = s(f, "reason");
    const [l] = await db.select().from(schema.bookLocks).where(eq(schema.bookLocks.month, month));
    if (!l) throw new BooksError("That month isn't locked.");
    if (s(f, "relock") === "1") {
      await db.update(schema.bookLocks).set({ status: "locked", lockedBy: userId, lockedAt: new Date() }).where(eq(schema.bookLocks.month, month));
      await bookAudit(userId, "month_relocked", "book_lock", month, {});
      return `${month} is locked again.`;
    }
    if (!reason) throw new BooksError("Say why the month is being reopened.");
    await db.update(schema.bookLocks).set({ status: "reopened", reopenedBy: userId, reopenedAt: new Date(), reopenReason: reason }).where(eq(schema.bookLocks.month, month));
    await bookAudit(userId, "month_reopened", "book_lock", month, { reason });
    return `${month} is reopened. Lock it again when the fix is done.`;
  }, true);
}
