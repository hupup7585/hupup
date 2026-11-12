import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { currentStaff } from "@/lib/auth";
import { redirect } from "next/navigation";
import { addDays, todayISO } from "@/lib/dates";

/**
 * Bookkeeping (Abraham T). Owner only; a user can be given access later with the "bookkeeping" permission override.
 * Rules: nothing is ever deleted (database triggers refuse it), ledger rows are never edited (a correction is a new
 * row with the opposite amounts), locked months take no new rows, every change is in the audit log, and no full card
 * number or security code is ever stored (text that looks like a card number is refused).
 */

export const MONEY_IN = ["income", "deposit", "cancellation_fee"] as const;
export const MONEY_OUT = ["expense", "refund", "processor_fee", "contractor"] as const;
export type EntryKind = (typeof MONEY_IN)[number] | (typeof MONEY_OUT)[number];
export const KIND_LABEL: Record<EntryKind, string> = {
  income: "Income",
  deposit: "Deposit",
  cancellation_fee: "Cancellation fee",
  expense: "Expense",
  refund: "Refund",
  processor_fee: "Processor fee",
  contractor: "Staff or contractor payment",
};
export const METHODS = ["cash", "check", "zelle", "card", "sola", "stripe", "bank", "other"] as const;
export const isMoneyIn = (k: string) => (MONEY_IN as readonly string[]).includes(k);
/** + for money in, - for money out */
export const signed = (kind: string, cents: number) => (isMoneyIn(kind) ? cents : -cents);

export class BooksError extends Error {}

/** Owner, or a user the Owner gave the "bookkeeping" permission. */
export async function requireBooks() {
  const s = await currentStaff();
  if (!s) redirect("/admin/login");
  if (await canUseBooks(s)) return s;
  redirect("/admin");
}

export async function canUseBooks(s: { role: string; userId: number | null }) {
  if (s.role === "owner") return true;
  if (!s.userId) return false;
  const [o] = await db
    .select()
    .from(schema.userPermissionOverrides)
    .where(and(eq(schema.userPermissionOverrides.userId, s.userId), eq(schema.userPermissionOverrides.permission, "bookkeeping")));
  return !!o?.allowed;
}

export async function bookAudit(userId: number | null, action: string, entityType: string, entityId: string | number | null, after: Record<string, unknown>) {
  await db.insert(schema.auditLog).values({ userId, action: `books.${action}`, entityType, entityId: entityId === null ? null : String(entityId), after });
}

/** "$1,234.56", "1234.5", "12" -> cents. Null when not a valid amount. */
export function parseMoney(v: unknown): number | null {
  const s = String(v ?? "").replace(/[$,\s]/g, "");
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}

function luhn(d: string) {
  let sum = 0;
  for (let i = 0; i < d.length; i++) {
    let n = Number(d[d.length - 1 - i]);
    if (i % 2 === 1) n = n * 2 > 9 ? n * 2 - 9 : n * 2;
    sum += n;
  }
  return sum % 10 === 0;
}

/** Refuse text that contains something that looks like a full card number (13-19 digits passing the Luhn check). */
export function assertNoCardNumber(...texts: (string | null | undefined)[]) {
  for (const t of texts) {
    for (const m of String(t ?? "").match(/\d[\d -]{11,}\d/g) ?? []) {
      const d = m.replace(/\D/g, "");
      if (d.length >= 13 && d.length <= 19 && luhn(d)) throw new BooksError("That looks like a card number. Never store card numbers; use the last 4 digits at most.");
    }
  }
}

export const isoDate = (v: unknown) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v ?? "")) ? String(v) : null);

export async function isLocked(dateIso: string) {
  const [l] = await db.select().from(schema.bookLocks).where(eq(schema.bookLocks.month, dateIso.slice(0, 7)));
  return l?.status === "locked";
}

export type NewEntry = {
  entryDate: string;
  kind: EntryKind;
  category?: string | null;
  amountCents: number;
  rentalCents?: number;
  deliveryCents?: number;
  taxCents?: number;
  tipCents?: number;
  method?: string | null;
  checkNo?: string | null;
  party?: string | null;
  orderId?: number | null;
  invoiceId?: number | null;
  billId?: number | null;
  productId?: number | null;
  projectId?: number | null;
  personName?: string | null;
  county?: string | null;
  taxExempt?: boolean;
  ref?: string | null;
  notes?: string | null;
  fileId?: number | null;
  source?: "auto" | "manual";
  correctsId?: number | null;
};

export async function addEntry(e: NewEntry, userId: number | null) {
  if (!isoDate(e.entryDate)) throw new BooksError("Enter a date.");
  if (![...MONEY_IN, ...MONEY_OUT].includes(e.kind)) throw new BooksError("Choose a type.");
  if (!Number.isInteger(e.amountCents) || (e.amountCents <= 0 && !e.correctsId)) throw new BooksError("Enter an amount greater than zero.");
  if (e.method && !(METHODS as readonly string[]).includes(e.method)) throw new BooksError("Choose a payment method.");
  if (e.method === "check" && e.kind !== "expense" && !e.checkNo && !e.correctsId) throw new BooksError("Enter the check number.");
  assertNoCardNumber(e.notes, e.party, e.checkNo, e.ref, e.personName, e.category);
  if (await isLocked(e.entryDate)) throw new BooksError(`${e.entryDate.slice(0, 7)} is locked. Date the entry in an open month.`);
  const [row] = await db
    .insert(schema.bookEntries)
    .values({
      ...e,
      category: e.category || null,
      method: e.method || null,
      checkNo: e.checkNo || null,
      party: e.party?.trim() || null,
      personName: e.personName?.trim() || null,
      notes: e.notes?.trim() || null,
      source: e.source ?? "manual",
      createdBy: userId,
    })
    .returning();
  await bookAudit(userId, e.correctsId ? "correction" : "entry_added", "book_entry", row.id, { ...e });
  return row;
}

/** A correction: a new row with the opposite amounts, dated today (or the given open-month date). The original stays. */
export async function reverseEntry(id: number, reason: string, userId: number | null, date = todayISO()) {
  const [o] = await db.select().from(schema.bookEntries).where(eq(schema.bookEntries.id, id));
  if (!o) throw new BooksError("Entry not found.");
  const [already] = await db.select({ id: schema.bookEntries.id }).from(schema.bookEntries).where(eq(schema.bookEntries.correctsId, id));
  if (already) throw new BooksError("This entry was already corrected.");
  if (!reason.trim()) throw new BooksError("Say why it's being corrected.");
  return addEntry(
    {
      entryDate: date,
      kind: o.kind as EntryKind,
      category: o.category,
      amountCents: -o.amountCents,
      rentalCents: -o.rentalCents,
      deliveryCents: -o.deliveryCents,
      taxCents: -o.taxCents,
      tipCents: -o.tipCents,
      method: o.method,
      checkNo: o.checkNo,
      party: o.party,
      orderId: o.orderId,
      invoiceId: o.invoiceId,
      billId: o.billId,
      productId: o.productId,
      projectId: o.projectId,
      personName: o.personName,
      county: o.county,
      taxExempt: o.taxExempt,
      ref: o.ref,
      notes: `Correction of entry #${o.id}: ${reason.trim()}`,
      source: "manual",
      correctsId: o.id,
    },
    userId,
  );
}

/**
 * A booking payment arrived (Sola webhook or staff "mark paid"): record it as income automatically, split into rental,
 * delivery, sales tax and anything paid above the total (tip). Never throws into the payment flow.
 */
export async function recordBookingPayment(orderId: number, cents: number, method: string, ref?: string | null, date = todayISO()) {
  try {
    if (cents <= 0) return;
    if (ref) {
      const [dupe] = await db.select({ id: schema.bookEntries.id }).from(schema.bookEntries).where(and(eq(schema.bookEntries.orderId, orderId), eq(schema.bookEntries.ref, ref), eq(schema.bookEntries.source, "auto")));
      if (dupe) return;
    }
    const [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId));
    if (!o) return;
    const total = o.totalCents ?? o.subtotalCents;
    const prior = Number(
      (
        await db.execute(sql`SELECT coalesce(sum(amount_cents), 0)::int AS n FROM book_entries WHERE order_id = ${orderId} AND kind = 'income' AND source = 'auto'`)
      ).rows[0]?.n ?? 0,
    );
    const owed = Math.max(0, total - prior);
    const toTotal = Math.min(cents, owed);
    const share = total > 0 ? toTotal / total : 0;
    const deliveryCents = Math.round(o.deliveryFeeCents * share);
    const taxCents = Math.round(o.taxCents * share);
    const rentalCents = toTotal - deliveryCents - taxCents;
    const tipCents = cents - toTotal;
    await addEntry(
      {
        entryDate: (await isLocked(date)) ? nextOpenDate(date) : date,
        kind: "income",
        category: "Bookings",
        amountCents: cents,
        rentalCents,
        deliveryCents,
        taxCents,
        tipCents,
        method: (METHODS as readonly string[]).includes(method) ? method : "other",
        orderId,
        ref: ref ?? null,
        county: countyFor(o.deliveryAddress),
        taxExempt: o.taxCents === 0 && o.subtotalCents > 0,
        source: "auto",
      },
      null,
    );
  } catch (e) {
    console.error("books: could not record booking payment", orderId, e);
  }
}
const nextOpenDate = (d: string) => `${addDays(`${d.slice(0, 7)}-28`, 5).slice(0, 7)}-01`;

/** Sales tax county from the delivery address (towns we serve). Unknown addresses are listed as "Orange (check)". */
const COUNTY_TOWNS: Record<string, string[]> = {
  Orange: ["kiryas joel", "palm tree", "monroe", "harriman", "chester", "woodbury", "central valley", "highland mills", "goshen", "middletown", "newburgh", "new windsor", "warwick", "washingtonville", "blooming grove", "florida", "port jervis", "walden", "montgomery", "cornwall", "tuxedo", "greenwood lake", "pine bush", "south blooming grove", "salisbury mills", "mountainville", "campbell hall", "otisville", "slate hill"],
  Rockland: ["monsey", "spring valley", "new city", "suffern", "airmont", "pomona", "nanuet", "haverstraw", "stony point", "pearl river", "new square", "kaser", "wesley hills", "chestnut ridge", "hillburn", "sloatsburg", "nyack", "valley cottage", "congers", "tappan", "orangeburg", "blauvelt", "west nyack", "garnerville", "thiells", "montebello", "new hempstead", "viola"],
  Sullivan: ["monticello", "woodridge", "south fallsburg", "fallsburg", "liberty", "loch sheldrake", "kiamesha lake", "bloomingburg", "wurtsboro", "rock hill", "mountaindale", "hurleyville", "swan lake"],
};
export function countyFor(address: string | null | undefined): string {
  const a = ` ${(address ?? "").toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ")} `;
  for (const [county, towns] of Object.entries(COUNTY_TOWNS)) if (towns.some((t) => a.includes(` ${t} `))) return county;
  return "Orange (check)";
}

/** NY quarterly sales tax periods (Mar-May, Jun-Aug, Sep-Nov, Dec-Feb), each due the 20th of the next month. */
export function salesTaxPeriods(year: number) {
  const febEnd = (y: number) => (new Date(Date.UTC(y, 2, 0)).getUTCDate() === 29 ? `${y}-02-29` : `${y}-02-28`);
  return [
    { label: `Dec ${year - 1} - Feb ${year}`, from: `${year - 1}-12-01`, to: febEnd(year), due: `${year}-03-20` },
    { label: `Mar - May ${year}`, from: `${year}-03-01`, to: `${year}-05-31`, due: `${year}-06-20` },
    { label: `Jun - Aug ${year}`, from: `${year}-06-01`, to: `${year}-08-31`, due: `${year}-09-20` },
    { label: `Sep - Nov ${year}`, from: `${year}-09-01`, to: `${year}-11-30`, due: `${year}-12-20` },
  ];
}

/** Federal and NY estimated income tax due dates for a tax year (the 15th of Apr, Jun, Sep, and Jan of the next year). */
export function estimatedTaxDates(year: number) {
  return [
    { label: `Q1 ${year}`, due: `${year}-04-15` },
    { label: `Q2 ${year}`, due: `${year}-06-15` },
    { label: `Q3 ${year}`, due: `${year}-09-15` },
    { label: `Q4 ${year}`, due: `${year + 1}-01-15` },
  ];
}

export type Reminder = { kind: "bill" | "sales_tax" | "estimated_tax" | "invoice" | "recurring"; due: string; label: string; overdue: boolean; cents?: number };

/** What's due soon (or overdue): bills, sales tax returns, estimated tax, overdue invoices, recurring expenses. */
export async function reminders(days: number, today = todayISO()): Promise<Reminder[]> {
  const until = addDays(today, days);
  const out: Reminder[] = [];
  for (const b of await openBills()) {
    if (b.dueDate <= until && b.balanceCents > 0) out.push({ kind: "bill", due: b.dueDate, label: `Bill from ${b.vendor}`, overdue: b.dueDate < today, cents: b.balanceCents });
  }
  for (const i of await openInvoices()) {
    if (i.dueDate < today && i.balanceCents > 0) out.push({ kind: "invoice", due: i.dueDate, label: `Invoice #${i.id} to ${i.customerName} is overdue`, overdue: true, cents: i.balanceCents });
  }
  const y = Number(today.slice(0, 4));
  for (const p of [...salesTaxPeriods(y), ...salesTaxPeriods(y + 1)]) {
    if (p.due >= today && p.due <= until) out.push({ kind: "sales_tax", due: p.due, label: `NY sales tax return for ${p.label}`, overdue: false });
  }
  for (const e of [...estimatedTaxDates(y - 1), ...estimatedTaxDates(y)]) {
    if (e.due >= today && e.due <= until) out.push({ kind: "estimated_tax", due: e.due, label: `Estimated tax payment ${e.label}`, overdue: false });
  }
  for (const r of await db.select().from(schema.bookRecurring).where(eq(schema.bookRecurring.active, true))) {
    if (r.nextDate <= until) out.push({ kind: "recurring", due: r.nextDate, label: `${r.vendor} (${r.frequency})`, overdue: r.nextDate < today, cents: r.amountCents });
  }
  return out.sort((a, b) => a.due.localeCompare(b.due));
}

/** Issued customer invoices (not quotes, drafts or credit notes), with payments and credit notes applied. */
export async function openInvoices() {
  const inv = (await db.select().from(schema.bookInvoices).where(eq(schema.bookInvoices.status, "open"))).filter((i) => i.kind === "invoice" && i.manualStatus !== "written_off");
  const paid = await paidBy("invoice_id", inv.map((i) => i.id));
  const credits = await creditsFor(inv.map((i) => i.id));
  return inv.map((i) => {
    const p = paid.get(i.id) ?? 0;
    const c = credits.get(i.id) ?? 0;
    return { ...i, paidCents: p, creditCents: c, balanceCents: i.amountCents - p - c };
  });
}

/** Credit notes issued against invoices (Bookkeeping spec 3.1). */
export async function creditsFor(ids: number[]) {
  const m = new Map<number, number>();
  if (!ids.length) return m;
  const rows = (
    await db.execute(sql`SELECT related_invoice_id AS id, sum(amount_cents)::int AS cents FROM book_invoices WHERE kind = 'credit_note' AND status = 'open' AND related_invoice_id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)}) GROUP BY 1`)
  ).rows as { id: number; cents: number }[];
  for (const r of rows) m.set(Number(r.id), Number(r.cents));
  return m;
}

export async function openBills() {
  const bills = await db.select().from(schema.bookBills).where(eq(schema.bookBills.status, "open"));
  const paid = await paidBy("bill_id", bills.map((b) => b.id));
  return bills.map((b) => ({ ...b, paidCents: paid.get(b.id) ?? 0, balanceCents: b.amountCents - (paid.get(b.id) ?? 0) }));
}

async function paidBy(col: "invoice_id" | "bill_id", ids: number[]) {
  const m = new Map<number, number>();
  if (!ids.length) return m;
  const rows = (
    await db.execute(sql`SELECT ${sql.raw(col)} AS id, sum(amount_cents)::int AS cents FROM book_entries WHERE ${sql.raw(col)} IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)}) GROUP BY 1`)
  ).rows as { id: number; cents: number }[];
  for (const r of rows) m.set(Number(r.id), Number(r.cents));
  return m;
}

/** Aging buckets by days past due: current, 1-30, 31-60, 61-90, 90+. */
export function agingBucket(due: string, today = todayISO()): "current" | "1-30" | "31-60" | "61-90" | "90+" {
  const days = Math.round((Date.parse(today) - Date.parse(due)) / 86_400_000);
  if (days <= 0) return "current";
  if (days <= 30) return "1-30";
  if (days <= 60) return "31-60";
  if (days <= 90) return "61-90";
  return "90+";
}

/** Next date of a recurring expense. */
export function nextRecurring(date: string, frequency: string) {
  const d = new Date(`${date}T12:00:00Z`);
  if (frequency === "weekly") d.setUTCDate(d.getUTCDate() + 7);
  else if (frequency === "quarterly") d.setUTCMonth(d.getUTCMonth() + 3);
  else if (frequency === "yearly") d.setUTCFullYear(d.getUTCFullYear() + 1);
  else d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Bank or card statement CSV -> lines. Finds the date, description and amount columns by their headers
 * (Amount, or Debit/Credit, or Withdrawal/Deposit). Dates as MM/DD/YYYY or YYYY-MM-DD.
 */
export function parseStatementCsv(text: string): { lineDate: string; description: string; amountCents: number }[] {
  const rows = parseCsv(text).filter((r) => r.some((c) => c.trim()));
  const hi = rows.findIndex((r) => r.some((c) => /date/i.test(c)) && r.some((c) => /amount|debit|credit|withdrawal|deposit/i.test(c)));
  if (hi < 0) throw new BooksError("Couldn't find the Date and Amount columns in that file.");
  const h = rows[hi].map((c) => c.trim().toLowerCase());
  const col = (re: RegExp) => h.findIndex((c) => re.test(c));
  const di = col(/date/);
  const desc = col(/description|memo|payee|details|name|transaction/);
  const amt = col(/^amount$|amount/);
  const debit = col(/debit|withdrawal/);
  const credit = col(/credit|deposit/);
  const out: { lineDate: string; description: string; amountCents: number }[] = [];
  for (const r of rows.slice(hi + 1)) {
    const date = toIso(r[di]);
    if (!date) continue;
    let cents: number | null = null;
    if (amt >= 0 && debit < 0 && credit < 0) cents = parseMoney(paren(r[amt]));
    else {
      const dr = debit >= 0 ? parseMoney(paren(r[debit] || "0")) ?? 0 : 0;
      const cr = credit >= 0 ? parseMoney(paren(r[credit] || "0")) ?? 0 : 0;
      cents = amt >= 0 && r[amt]?.trim() ? parseMoney(paren(r[amt])) : cr - Math.abs(dr);
    }
    if (cents === null || cents === 0) continue;
    const description = (desc >= 0 ? r[desc] : r.filter((_, i) => i !== di && i !== amt).join(" ")).trim().slice(0, 300);
    assertNoCardNumber(description);
    out.push({ lineDate: date, description, amountCents: cents });
  }
  return out;
}
const paren = (s: string | undefined) => {
  const t = (s ?? "").trim();
  return /^\(.*\)$/.test(t) ? `-${t.slice(1, -1)}` : t;
};
function toIso(s: string | undefined) {
  const t = (s ?? "").trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) return `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return null;
}
export function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') (cell += '"', i++);
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") (row.push(cell), (cell = ""));
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      out.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell || row.length) (row.push(cell), out.push(row));
  return out;
}

/** Estimated Sola fee for a card payment, from the Owner's rate in Settings. */
export function solaFee(cents: number, percent: string, fixedCents: string) {
  const p = Number(percent) || 0;
  const f = Number(fixedCents) || 0;
  return Math.round((cents * p) / 100) + f;
}

/**
 * Match unmatched statement lines to the books: a line matches entries with the same signed amount within 5 days,
 * or (money in) the net of the Sola payments made 0-4 days before it (one batch deposit).
 */
export async function autoMatch(feePercent: string, feeCents: string) {
  const lines = await db.select().from(schema.bookBankLines).where(eq(schema.bookBankLines.status, "unmatched"));
  if (!lines.length) return 0;
  const entries = await db.select().from(schema.bookEntries);
  const used = new Set<number>();
  for (const l of await db.select().from(schema.bookBankLines).where(inArray(schema.bookBankLines.status, ["matched"]))) for (const id of l.matchedEntryIds) used.add(id);
  let n = 0;
  for (const l of lines) {
    const near = (d: string, before: number, after: number) => {
      const diff = (Date.parse(l.lineDate) - Date.parse(d)) / 86_400_000;
      return diff >= -after && diff <= before;
    };
    const one = entries.find((e) => !used.has(e.id) && signed(e.kind, e.amountCents) === l.amountCents && near(e.entryDate, 5, 5));
    let ids: number[] = [];
    let note = "";
    if (one) {
      ids = [one.id];
      note = `${KIND_LABEL[one.kind as EntryKind] ?? one.kind} #${one.id}`;
    } else if (l.amountCents > 0) {
      const sola = entries.filter((e) => !used.has(e.id) && e.kind === "income" && e.method === "sola" && near(e.entryDate, 4, 0));
      const byDay = new Map<string, typeof sola>();
      for (const e of sola) byDay.set(e.entryDate, [...(byDay.get(e.entryDate) ?? []), e]);
      for (const [day, group] of byDay) {
        const net = group.reduce((s, e) => s + e.amountCents - solaFee(e.amountCents, feePercent, feeCents), 0);
        if (net === l.amountCents) {
          ids = group.map((e) => e.id);
          note = `Sola deposit for ${group.length} payment${group.length === 1 ? "" : "s"} on ${day}`;
          break;
        }
      }
    }
    if (ids.length) {
      ids.forEach((i) => used.add(i));
      await db.update(schema.bookBankLines).set({ status: "matched", matchedEntryIds: ids, matchNote: note }).where(eq(schema.bookBankLines.id, l.id));
      n++;
    }
  }
  return n;
}

/**
 * An automatic money-out line (Stripe refund or Stripe fee). Kept once per reference; a locked month moves it to the
 * next open month (as booking payments do). Never throws into the payment flow.
 */
export async function recordAutoMoneyOut(input: { kind: "refund" | "processor_fee"; amountCents: number; category: string; method: string; orderId?: number | null; ref: string; date?: string; notes?: string }) {
  try {
    if (input.amountCents <= 0) return;
    const [dupe] = await db.select({ id: schema.bookEntries.id }).from(schema.bookEntries).where(and(eq(schema.bookEntries.ref, input.ref), eq(schema.bookEntries.kind, input.kind), eq(schema.bookEntries.source, "auto")));
    if (dupe) return;
    const date = input.date ?? todayISO();
    await addEntry(
      { entryDate: (await isLocked(date)) ? nextOpenDate(date) : date, kind: input.kind, category: input.category, amountCents: input.amountCents, method: input.method, orderId: input.orderId ?? null, ref: input.ref, notes: input.notes ?? null, source: "auto" },
      null,
    );
  } catch (e) {
    console.error("books: could not record", input.kind, input.ref, e);
  }
}
