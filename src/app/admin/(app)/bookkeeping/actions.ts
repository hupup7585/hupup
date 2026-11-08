"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { todayISO } from "@/lib/dates";
import { saveSetting } from "@/lib/settings";
import { getSettings } from "@/lib/settings";
import {
  BooksError,
  METHODS,
  addEntry,
  assertNoCardNumber,
  autoMatch,
  bookAudit,
  isoDate,
  nextRecurring,
  parseMoney,
  parseStatementCsv,
  requireBooks,
  reverseEntry,
  type EntryKind,
} from "@/lib/books";

/** Bookkeeping actions (Abraham T): Owner only (or a user given the bookkeeping permission). Every change is audited. */

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const n = (f: FormData, k: string) => (s(f, k) ? Number(s(f, k)) : null);
const back = (tab: string, msg: string, err = false): never => redirect(`/admin/bookkeeping?tab=${tab}&${err ? "err" : "msg"}=${encodeURIComponent(msg)}`);

async function run(tab: string, fn: (userId: number | null) => Promise<string>) {
  const staff = await requireBooks();
  let msg: string;
  try {
    msg = await fn(staff.userId);
  } catch (e) {
    if (e instanceof BooksError) return back(tab, e.message, true);
    const m = e instanceof Error ? e.message : String(e);
    if (/locked|never deleted|never edited/i.test(m)) return back(tab, m.replace(/^.*?: /, ""), true);
    console.error("bookkeeping action failed", e);
    return back(tab, "Something went wrong. Nothing was saved.", true);
  }
  revalidatePath("/admin/bookkeeping");
  return back(tab, msg);
}

const FILE_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
const MAX_FILE = 4 * 1024 * 1024;

/** Receipt or certificate upload (optional). Stored privately in the database. */
async function saveFile(f: FormData, key: string, userId: number | null): Promise<number | null> {
  const file = f.get(key);
  if (!(file instanceof File) || file.size === 0) return null;
  if (!FILE_TYPES.includes(file.type)) throw new BooksError("Receipts must be a PDF or a photo (JPEG, PNG, WebP or HEIC).");
  if (file.size > MAX_FILE) throw new BooksError("That file is over 4 MB. Please use a smaller photo or PDF.");
  const [row] = await db
    .insert(schema.bookFiles)
    .values({ name: file.name.slice(0, 200) || "receipt", contentType: file.type, sizeBytes: file.size, data: Buffer.from(await file.arrayBuffer()), createdBy: userId })
    .returning({ id: schema.bookFiles.id });
  await bookAudit(userId, "file_uploaded", "book_file", row.id, { name: file.name, size: file.size, type: file.type });
  return row.id;
}

function money(f: FormData, k: string, label = "amount") {
  const c = parseMoney(s(f, k));
  if (c === null || c <= 0) throw new BooksError(`Enter the ${label}, for example 125.00.`);
  return c;
}
const optMoney = (f: FormData, k: string) => (s(f, k) ? (parseMoney(s(f, k)) ?? (() => { throw new BooksError(`Check the ${k} amount.`); })()) : 0);
const date = (f: FormData, k: string, label = "date") => isoDate(s(f, k)) ?? (() => { throw new BooksError(`Enter the ${label}.`); })();

/** Any ledger entry: income (cash, check, Zelle, other), deposit, refund, cancellation fee, expense, processor fee, staff/contractor payment. */
export async function addEntryAction(f: FormData) {
  const tab = s(f, "tab") || "income";
  return run(tab, async (userId) => {
    const kind = s(f, "kind") as EntryKind;
    const amountCents = money(f, "amount");
    const taxCents = optMoney(f, "tax");
    const tipCents = optMoney(f, "tip");
    const deliveryCents = optMoney(f, "delivery");
    if (taxCents + tipCents + deliveryCents > amountCents) throw new BooksError("Tax, tip and delivery can't add up to more than the amount.");
    const fileId = await saveFile(f, "file", userId);
    const row = await addEntry(
      {
        entryDate: date(f, "date"),
        kind,
        category: s(f, "category") || null,
        amountCents,
        taxCents,
        tipCents,
        deliveryCents,
        rentalCents: kind === "income" && n(f, "orderId") ? amountCents - taxCents - tipCents - deliveryCents : 0,
        method: s(f, "method") || null,
        checkNo: s(f, "checkNo") || null,
        party: s(f, "party") || null,
        personName: s(f, "personName") || null,
        orderId: n(f, "orderId"),
        invoiceId: n(f, "invoiceId"),
        billId: n(f, "billId"),
        productId: n(f, "productId"),
        projectId: n(f, "projectId"),
        county: s(f, "county") || null,
        taxExempt: s(f, "taxExempt") === "on",
        notes: s(f, "notes") || null,
        fileId,
      },
      userId,
    );
    return `Saved entry #${row.id}.`;
  });
}

export async function reverseEntryAction(f: FormData) {
  return run(s(f, "tab") || "ledger", async (userId) => {
    const r = await reverseEntry(Number(s(f, "id")), s(f, "reason"), userId);
    return `Correction #${r.id} added. The original entry is kept.`;
  });
}

/* ---- invoices ---- */

export async function addInvoiceAction(f: FormData) {
  return run("invoices", async (userId) => {
    const customerName = s(f, "customerName");
    if (!customerName) throw new BooksError("Enter who the invoice is for.");
    assertNoCardNumber(customerName, s(f, "notes"), s(f, "exemptCertNo"));
    const taxExempt = s(f, "taxExempt") === "on";
    const exemptFileId = await saveFile(f, "file", userId);
    if (taxExempt && !s(f, "exemptCertNo") && !exemptFileId) throw new BooksError("For a tax-exempt customer, enter the certificate number or attach the certificate.");
    const [inv] = await db
      .insert(schema.bookInvoices)
      .values({
        customerName,
        orderId: n(f, "orderId"),
        issueDate: date(f, "issueDate", "invoice date"),
        dueDate: date(f, "dueDate", "due date"),
        amountCents: money(f, "amount"),
        taxExempt,
        exemptCertNo: s(f, "exemptCertNo") || null,
        exemptFileId,
        notes: s(f, "notes") || null,
        createdBy: userId,
      })
      .returning();
    await bookAudit(userId, "invoice_added", "book_invoice", inv.id, { ...inv });
    return `Invoice #${inv.id} saved.`;
  });
}

export async function payInvoiceAction(f: FormData) {
  return run("invoices", async (userId) => {
    const [inv] = await db.select().from(schema.bookInvoices).where(eq(schema.bookInvoices.id, Number(s(f, "invoiceId"))));
    if (!inv) throw new BooksError("Invoice not found.");
    const row = await addEntry(
      {
        entryDate: date(f, "date"),
        kind: "income",
        category: "Invoices",
        amountCents: money(f, "amount"),
        taxCents: optMoney(f, "tax"),
        method: s(f, "method") || "check",
        checkNo: s(f, "checkNo") || null,
        party: inv.customerName,
        invoiceId: inv.id,
        orderId: inv.orderId,
        taxExempt: inv.taxExempt,
        notes: s(f, "notes") || null,
      },
      userId,
    );
    return `Payment #${row.id} recorded on invoice #${inv.id}.`;
  });
}

export async function voidInvoiceAction(f: FormData) {
  return run("invoices", async (userId) => {
    const id = Number(s(f, "id"));
    if (!s(f, "reason")) throw new BooksError("Say why the invoice is being voided.");
    await db.update(schema.bookInvoices).set({ status: "void", notes: `VOID: ${s(f, "reason")}` }).where(eq(schema.bookInvoices.id, id));
    await bookAudit(userId, "invoice_voided", "book_invoice", id, { reason: s(f, "reason") });
    return `Invoice #${id} voided (kept on record).`;
  });
}

/* ---- bills and recurring ---- */

export async function addBillAction(f: FormData) {
  return run("bills", async (userId) => {
    const vendor = s(f, "vendor");
    if (!vendor) throw new BooksError("Enter the vendor.");
    assertNoCardNumber(vendor, s(f, "notes"));
    const fileId = await saveFile(f, "file", userId);
    const [b] = await db
      .insert(schema.bookBills)
      .values({ vendor, category: s(f, "category") || null, billDate: date(f, "billDate", "bill date"), dueDate: date(f, "dueDate", "due date"), amountCents: money(f, "amount"), notes: s(f, "notes") || null, fileId, createdBy: userId })
      .returning();
    await bookAudit(userId, "bill_added", "book_bill", b.id, { ...b });
    return `Bill #${b.id} saved.`;
  });
}

export async function payBillAction(f: FormData) {
  return run("bills", async (userId) => {
    const [b] = await db.select().from(schema.bookBills).where(eq(schema.bookBills.id, Number(s(f, "billId"))));
    if (!b) throw new BooksError("Bill not found.");
    const row = await addEntry(
      { entryDate: date(f, "date"), kind: "expense", category: b.category, amountCents: money(f, "amount"), method: s(f, "method") || null, checkNo: s(f, "checkNo") || null, party: b.vendor, billId: b.id, notes: s(f, "notes") || null },
      userId,
    );
    return `Payment #${row.id} recorded on bill #${b.id}.`;
  });
}

export async function voidBillAction(f: FormData) {
  return run("bills", async (userId) => {
    const id = Number(s(f, "id"));
    if (!s(f, "reason")) throw new BooksError("Say why the bill is being voided.");
    await db.update(schema.bookBills).set({ status: "void", notes: `VOID: ${s(f, "reason")}` }).where(eq(schema.bookBills.id, id));
    await bookAudit(userId, "bill_voided", "book_bill", id, { reason: s(f, "reason") });
    return `Bill #${id} voided (kept on record).`;
  });
}

export async function addRecurringAction(f: FormData) {
  return run("expenses", async (userId) => {
    const vendor = s(f, "vendor");
    if (!vendor) throw new BooksError("Enter the vendor or subscription.");
    const freq = s(f, "frequency");
    if (!["weekly", "monthly", "quarterly", "yearly"].includes(freq)) throw new BooksError("Choose how often.");
    const [r] = await db
      .insert(schema.bookRecurring)
      .values({ vendor, category: s(f, "category") || null, amountCents: money(f, "amount"), method: s(f, "method") || null, frequency: freq, nextDate: date(f, "nextDate", "next date"), notes: s(f, "notes") || null })
      .returning();
    await bookAudit(userId, "recurring_added", "book_recurring", r.id, { ...r });
    return `Recurring expense "${vendor}" saved.`;
  });
}

/** Record this period's recurring expense: paid now (expense entry) or owed (a bill), then move to the next date. */
export async function recordRecurringAction(f: FormData) {
  return run("expenses", async (userId) => {
    const [r] = await db.select().from(schema.bookRecurring).where(eq(schema.bookRecurring.id, Number(s(f, "id"))));
    if (!r) throw new BooksError("Not found.");
    if (s(f, "as") === "bill") {
      const [b] = await db.insert(schema.bookBills).values({ vendor: r.vendor, category: r.category, billDate: r.nextDate, dueDate: r.nextDate, amountCents: r.amountCents, recurringId: r.id, createdBy: userId }).returning();
      await bookAudit(userId, "bill_added", "book_bill", b.id, { fromRecurring: r.id });
    } else {
      await addEntry({ entryDate: r.nextDate <= todayISO() ? r.nextDate : todayISO(), kind: "expense", category: r.category, amountCents: r.amountCents, method: r.method, party: r.vendor, notes: `Recurring (${r.frequency})` }, userId);
    }
    const next = nextRecurring(r.nextDate, r.frequency);
    await db.update(schema.bookRecurring).set({ nextDate: next }).where(eq(schema.bookRecurring.id, r.id));
    await bookAudit(userId, "recurring_recorded", "book_recurring", r.id, { next });
    return `Recorded ${r.vendor}. Next one: ${next}.`;
  });
}

export async function stopRecurringAction(f: FormData) {
  return run("expenses", async (userId) => {
    const id = Number(s(f, "id"));
    await db.update(schema.bookRecurring).set({ active: false }).where(eq(schema.bookRecurring.id, id));
    await bookAudit(userId, "recurring_stopped", "book_recurring", id, {});
    return "Stopped (kept on record).";
  });
}

/* ---- categories, settings, locks ---- */

export async function addCategoryAction(f: FormData) {
  return run("settings", async (userId) => {
    const name = s(f, "name");
    if (!name || name.length > 60) throw new BooksError("Enter a category name.");
    const [c] = await db.insert(schema.bookCategories).values({ name, kind: "expense", sortOrder: 100 }).onConflictDoUpdate({ target: schema.bookCategories.name, set: { active: true } }).returning();
    await bookAudit(userId, "category_added", "book_category", c.id, { name });
    return `Category "${name}" added.`;
  });
}

export async function toggleCategoryAction(f: FormData) {
  return run("settings", async (userId) => {
    const id = Number(s(f, "id"));
    const [c] = await db.select().from(schema.bookCategories).where(eq(schema.bookCategories.id, id));
    if (!c) throw new BooksError("Not found.");
    const name = s(f, "rename") || c.name;
    await db.update(schema.bookCategories).set({ active: s(f, "active") === "on", name }).where(eq(schema.bookCategories.id, id));
    await bookAudit(userId, "category_changed", "book_category", id, { before: c, active: s(f, "active") === "on", name });
    return "Category updated.";
  });
}

export async function saveBookSettingsAction(f: FormData) {
  return run("settings", async (userId) => {
    const pct = s(f, "solaFeePercent");
    const fixed = parseMoney(s(f, "solaFeeFixed") || "0");
    const days = Number(s(f, "bookReminderDays"));
    if (!/^\d{1,2}(\.\d{1,3})?$/.test(pct)) throw new BooksError("Enter the Sola rate as a percent, for example 2.9.");
    if (fixed === null || fixed < 0) throw new BooksError("Enter the per-payment fee, for example 0.30.");
    if (!(days >= 1 && days <= 60)) throw new BooksError("Reminder days must be 1 to 60.");
    await saveSetting("solaFeePercent", pct, userId);
    await saveSetting("solaFeeCents", String(fixed), userId);
    await saveSetting("bookReminderDays", String(days), userId);
    const opening = parseMoney(s(f, "openingCash") || "0");
    if (opening === null) throw new BooksError("Enter the opening cash balance, for example 2500.00.");
    const openingDate = isoDate(s(f, "openingDate")) ?? "";
    await saveSetting("bookOpeningCashCents", String(opening), userId);
    await saveSetting("bookOpeningDate", openingDate, userId);
    await bookAudit(userId, "settings_saved", "settings", null, { pct, fixed, days, openingCash: s(f, "openingCash"), openingDate: s(f, "openingDate") });
    return "Settings saved.";
  });
}

export async function lockMonthAction(f: FormData) {
  return run("settings", async (userId) => {
    const month = s(f, "month");
    if (!/^\d{4}-\d{2}$/.test(month)) throw new BooksError("Choose a month.");
    if (month >= todayISO().slice(0, 7)) throw new BooksError("Only months that have ended can be locked.");
    await db.insert(schema.bookLocks).values({ month, lockedBy: userId }).onConflictDoNothing();
    await bookAudit(userId, "month_locked", "book_lock", month, {});
    return `${month} is locked. Nothing dated in it can be added.`;
  });
}

/* ---- bank and card reconciliation ---- */

export async function importStatementAction(f: FormData) {
  return run("bank", async (userId) => {
    const file = f.get("file");
    if (!(file instanceof File) || !file.size) throw new BooksError("Choose a CSV file.");
    if (file.size > MAX_FILE) throw new BooksError("That file is too large.");
    const lines = parseStatementCsv(await file.text());
    if (!lines.length) throw new BooksError("No transactions found in that file.");
    const account = s(f, "account") === "card" ? "card" : "bank";
    // Skip lines already imported (same date, description and amount)
    const existing = await db.select().from(schema.bookBankLines);
    const key = (l: { lineDate: string; description: string; amountCents: number }) => `${account}|${l.lineDate}|${l.description}|${l.amountCents}`;
    const seen = new Set(existing.map((l) => `${l.account}|${l.lineDate}|${l.description}|${l.amountCents}`));
    const fresh = lines.filter((l) => !seen.has(key(l)));
    if (fresh.length) await db.insert(schema.bookBankLines).values(fresh.map((l) => ({ ...l, account, importName: file.name.slice(0, 200) })));
    await bookAudit(userId, "statement_imported", "book_bank_lines", null, { file: file.name, lines: lines.length, added: fresh.length, account });
    const st = await getSettings();
    const matched = await autoMatch(st.solaFeePercent, st.solaFeeCents);
    return `Imported ${fresh.length} new line${fresh.length === 1 ? "" : "s"} (${lines.length - fresh.length} already there). ${matched} matched automatically.`;
  });
}

export async function autoMatchAction() {
  return run("bank", async (userId) => {
    const st = await getSettings();
    const matched = await autoMatch(st.solaFeePercent, st.solaFeeCents);
    await bookAudit(userId, "auto_match", "book_bank_lines", null, { matched });
    return `${matched} line${matched === 1 ? "" : "s"} matched.`;
  });
}

export async function matchLineAction(f: FormData) {
  return run("bank", async (userId) => {
    const id = Number(s(f, "id"));
    const ids = s(f, "entryIds").split(/[\s,#]+/).filter(Boolean).map(Number).filter((x) => Number.isInteger(x) && x > 0);
    const ignore = s(f, "ignore") === "1";
    if (!ignore && !ids.length) throw new BooksError("Enter the entry number(s) this line matches.");
    await db
      .update(schema.bookBankLines)
      .set(ignore ? { status: "ignored", matchNote: s(f, "note") || "Ignored (e.g. transfer between accounts)" } : { status: "matched", matchedEntryIds: ids, matchNote: `Matched by hand to #${ids.join(", #")}` })
      .where(eq(schema.bookBankLines.id, id));
    await bookAudit(userId, ignore ? "line_ignored" : "line_matched", "book_bank_line", id, { ids });
    return ignore ? "Line marked as ignored." : "Line matched.";
  });
}

/* ---- equipment and mileage ---- */

export async function addEquipmentAction(f: FormData) {
  return run("equipment", async (userId) => {
    const productId = n(f, "productId");
    let name = s(f, "name");
    if (productId && !name) name = (await db.select({ name: schema.products.name }).from(schema.products).where(eq(schema.products.id, productId)))[0]?.name ?? "";
    if (!name) throw new BooksError("Choose the rental item or enter a name.");
    const qty = Number(s(f, "qty") || 1);
    const life = Number(s(f, "lifeYears") || 5);
    if (!(qty >= 1 && qty <= 999) || !(life >= 1 && life <= 40)) throw new BooksError("Check the quantity and years.");
    const [q] = await db.insert(schema.bookEquipment).values({ productId, name, purchaseDate: date(f, "purchaseDate", "purchase date"), costCents: money(f, "cost", "cost per unit"), qty, lifeYears: life, notes: s(f, "notes") || null }).returning();
    await bookAudit(userId, "equipment_added", "book_equipment", q.id, { ...q });
    return `${name} added to equipment.`;
  });
}

export async function addMileageAction(f: FormData) {
  return run("mileage", async (userId) => {
    const miles = Number(s(f, "miles"));
    if (!(miles > 0 && miles < 2000)) throw new BooksError("Enter the miles driven.");
    const tripDate = date(f, "tripDate", "trip date");
    const [t] = await db
      .insert(schema.bookMileage)
      .values({ tripDate, vehicle: s(f, "vehicle") || null, driver: s(f, "driver") || null, milesTenths: Math.round(miles * 10), purpose: s(f, "purpose") || "Delivery", orderId: n(f, "orderId"), notes: s(f, "notes") || null, createdBy: userId })
      .returning();
    await bookAudit(userId, "mileage_added", "book_mileage", t.id, { ...t });
    return `Trip saved (${miles} miles).`;
  });
}

export async function reverseMileageAction(f: FormData) {
  return run("mileage", async (userId) => {
    const [t] = await db.select().from(schema.bookMileage).where(eq(schema.bookMileage.id, Number(s(f, "id"))));
    if (!t) throw new BooksError("Not found.");
    if (!s(f, "reason")) throw new BooksError("Say why it's being corrected.");
    const [c] = await db
      .insert(schema.bookMileage)
      .values({ tripDate: todayISO(), vehicle: t.vehicle, driver: t.driver, milesTenths: -t.milesTenths, purpose: t.purpose, orderId: t.orderId, notes: `Correction of trip #${t.id}: ${s(f, "reason")}`, correctsId: t.id, createdBy: userId })
      .returning();
    await bookAudit(userId, "mileage_corrected", "book_mileage", c.id, { corrects: t.id, reason: s(f, "reason") });
    return "Correction added.";
  });
}

export async function methodsList() {
  return METHODS;
}

/** Abraham EE: categorize a real statement line straight into the books (expense or income), then mark it matched. */
export async function categorizeLineAction(f: FormData) {
  return run("bank", async (userId) => {
    const id = Number(s(f, "id"));
    const [l] = await db.select().from(schema.bookBankLines).where(eq(schema.bookBankLines.id, id));
    if (!l) throw new BooksError("Line not found.");
    if (l.status !== "unmatched") throw new BooksError("This line is already matched.");
    const category = s(f, "category");
    if (!category) throw new BooksError("Choose a category.");
    const out = l.amountCents < 0;
    const row = await addEntry(
      {
        entryDate: l.lineDate,
        kind: out ? "expense" : "income",
        category,
        amountCents: Math.abs(l.amountCents),
        method: l.account === "card" ? "card" : "bank",
        party: l.description.slice(0, 120),
        notes: `From ${l.account} statement${l.importName ? ` (${l.importName})` : ""}`,
      },
      userId,
    );
    await db.update(schema.bookBankLines).set({ status: "matched", matchedEntryIds: [row.id], matchNote: `Added to the books as #${row.id} (${category})` }).where(eq(schema.bookBankLines.id, id));
    await bookAudit(userId, "line_categorized", "book_bank_line", id, { entry: row.id, category });
    return `Added to the books as entry #${row.id}.`;
  });
}
