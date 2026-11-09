import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { todayISO, addDays } from "@/lib/dates";
import { BooksError, assertNoCardNumber, bookAudit, creditsFor, isoDate } from "@/lib/books";

/**
 * Customer billing (Bookkeeping spec 3): invoices, quotes and credit notes with line items, numbering, statuses,
 * invoices made from bookings, statements and receivables. Tax is entered or copied from the booking, never guessed.
 * Nothing is deleted: an issued document is voided (with a reason) or corrected with a credit note.
 */

export type DocKind = "invoice" | "quote" | "credit_note";
export const KIND_PREFIX: Record<DocKind, string> = { invoice: "INV", quote: "Q", credit_note: "CN" };
export const KIND_NAME: Record<DocKind, string> = { invoice: "Invoice", quote: "Quote", credit_note: "Credit note" };
export const MANUAL_STATUSES = ["disputed", "written_off", "refunded"] as const;
export type DisplayStatus = "Draft" | "Sent" | "Partially paid" | "Paid" | "Overdue" | "Void" | "Refunded" | "Disputed" | "Written off" | "Accepted" | "Issued";

export type LineInput = { description: string; qty: number; unitCents: number; productId?: number | null };
export type Invoice = typeof schema.bookInvoices.$inferSelect;

export async function nextNumber(kind: DocKind) {
  const prefix = KIND_PREFIX[kind];
  const [{ n }] = (await db.execute(sql`SELECT coalesce(max(substring(number from ${`^${prefix}-(\\d+)$`})::int), 1000)::int AS n FROM book_invoices WHERE number ~ ${`^${prefix}-\\d+$`}`)).rows as { n: number }[];
  return `${prefix}-${Number(n) + 1}`;
}

export function totals(lines: LineInput[], discountCents: number, taxCents: number) {
  const subtotal = lines.reduce((s, l) => s + l.qty * l.unitCents, 0);
  return { subtotalCents: subtotal, totalCents: subtotal - discountCents + taxCents };
}

export type NewDoc = {
  kind: DocKind;
  customerName: string;
  customerId?: number | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
  billingAddress?: string | null;
  orderId?: number | null;
  issueDate: string;
  termsDays?: number | null;
  dueDate?: string | null;
  lines: LineInput[];
  discountCents?: number;
  taxCents?: number;
  depositRequiredCents?: number;
  taxExempt?: boolean;
  exemptCertNo?: string | null;
  exemptFileId?: number | null;
  notes?: string | null;
  relatedInvoiceId?: number | null;
  issue?: boolean;
};

export async function createDoc(d: NewDoc, userId: number | null) {
  if (!d.customerName.trim()) throw new BooksError("Enter who it's for.");
  if (!isoDate(d.issueDate)) throw new BooksError("Enter the date.");
  const lines = d.lines.filter((l) => l.description.trim() || l.unitCents);
  if (!lines.length) throw new BooksError("Add at least one line.");
  for (const l of lines) {
    if (!l.description.trim()) throw new BooksError("Every line needs a description.");
    if (!Number.isInteger(l.qty) || l.qty < 1 || l.qty > 999) throw new BooksError("Quantity must be 1 to 999.");
    if (!Number.isInteger(l.unitCents) || l.unitCents < 0) throw new BooksError("Check the line prices.");
    assertNoCardNumber(l.description);
  }
  assertNoCardNumber(d.notes, d.customerName, d.billingAddress);
  const discount = d.discountCents ?? 0;
  const tax = d.taxExempt ? 0 : (d.taxCents ?? 0);
  if (discount < 0 || tax < 0) throw new BooksError("Discount and tax can't be negative.");
  const t = totals(lines, discount, tax);
  if (t.totalCents < 0) throw new BooksError("The discount can't be more than the subtotal.");
  if (d.kind === "credit_note") {
    if (!d.relatedInvoiceId) throw new BooksError("A credit note needs the invoice it applies to.");
    const [inv] = await db.select().from(schema.bookInvoices).where(eq(schema.bookInvoices.id, d.relatedInvoiceId));
    if (!inv || inv.kind !== "invoice" || inv.status !== "open") throw new BooksError("Credit notes apply to an issued invoice.");
    const credited = (await creditsFor([inv.id])).get(inv.id) ?? 0;
    if (t.totalCents + credited > inv.amountCents) throw new BooksError("The credit is more than the invoice total.");
  }
  const due = d.dueDate && isoDate(d.dueDate) ? d.dueDate : addDays(d.issueDate, d.termsDays ?? 0);
  const [doc] = await db
    .insert(schema.bookInvoices)
    .values({
      kind: d.kind,
      number: await nextNumber(d.kind),
      customerName: d.customerName.trim(),
      customerId: d.customerId ?? null,
      customerEmail: d.customerEmail?.trim() || null,
      customerPhone: d.customerPhone?.trim() || null,
      billingAddress: d.billingAddress?.trim() || null,
      orderId: d.orderId ?? null,
      issueDate: d.issueDate,
      dueDate: due,
      termsDays: d.termsDays ?? null,
      subtotalCents: t.subtotalCents,
      discountCents: discount,
      taxCents: tax,
      amountCents: t.totalCents,
      depositRequiredCents: d.depositRequiredCents ?? 0,
      taxExempt: d.taxExempt ?? false,
      exemptCertNo: d.exemptCertNo ?? null,
      exemptFileId: d.exemptFileId ?? null,
      notes: d.notes?.trim() || null,
      relatedInvoiceId: d.relatedInvoiceId ?? null,
      status: d.issue ? "open" : "draft",
      sentAt: d.issue ? new Date() : null,
      createdBy: userId,
    })
    .returning();
  await db.insert(schema.bookInvoiceLines).values(lines.map((l, i) => ({ invoiceId: doc.id, description: l.description.trim(), qty: l.qty, unitCents: l.unitCents, lineCents: l.qty * l.unitCents, productId: l.productId ?? null, sortOrder: i })));
  await bookAudit(userId, `${d.kind}_created`, "book_invoice", doc.id, { number: doc.number, total: t.totalCents, lines, issued: Boolean(d.issue) });
  return doc;
}

/** Draft from a booking: its items and delivery fee as lines, its sales tax copied as charged. */
export async function docFromBooking(orderId: number, kind: DocKind, userId: number | null, termsDays = 0) {
  const [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId));
  if (!o) throw new BooksError("Booking not found.");
  const items = await db
    .select({ qty: schema.orderItems.qty, unit: schema.orderItems.unitPriceCents, name: schema.products.name, productId: schema.products.id })
    .from(schema.orderItems)
    .innerJoin(schema.products, eq(schema.products.id, schema.orderItems.productId))
    .where(eq(schema.orderItems.orderId, orderId));
  const [c] = o.customerId ? await db.select().from(schema.customers).where(eq(schema.customers.id, o.customerId)) : [];
  const lines: LineInput[] = [
    ...items.map((i) => ({ description: `${i.name} (rental ${o.eventDate})`, qty: i.qty, unitCents: i.unit, productId: i.productId })),
    ...(o.deliveryFeeCents ? [{ description: "Delivery", qty: 1, unitCents: o.deliveryFeeCents }] : []),
  ];
  return createDoc(
    {
      kind,
      customerName: c?.name || "Customer",
      customerId: c?.id ?? null,
      customerEmail: c?.email ?? null,
      customerPhone: c?.phone ?? null,
      billingAddress: o.deliveryAddress,
      orderId,
      issueDate: todayISO(),
      termsDays,
      lines,
      taxCents: o.taxCents,
      taxExempt: o.taxCents === 0 && o.subtotalCents > 0,
    },
    userId,
  );
}

export async function docDetail(id: number) {
  const [doc] = await db.select().from(schema.bookInvoices).where(eq(schema.bookInvoices.id, id));
  if (!doc) return null;
  const lines = await db.select().from(schema.bookInvoiceLines).where(eq(schema.bookInvoiceLines.invoiceId, id)).orderBy(asc(schema.bookInvoiceLines.sortOrder));
  const payments = await db.select().from(schema.bookEntries).where(eq(schema.bookEntries.invoiceId, id)).orderBy(asc(schema.bookEntries.entryDate));
  const credits = doc.kind === "invoice" ? await db.select().from(schema.bookInvoices).where(and(eq(schema.bookInvoices.kind, "credit_note"), eq(schema.bookInvoices.relatedInvoiceId, id), eq(schema.bookInvoices.status, "open"))) : [];
  const paidCents = payments.reduce((s, p) => s + (p.kind === "refund" ? -p.amountCents : p.amountCents), 0);
  const creditCents = credits.reduce((s, c) => s + c.amountCents, 0);
  const balanceCents = doc.kind === "invoice" ? doc.amountCents - paidCents - creditCents : 0;
  return { doc, lines, payments, credits, paidCents, creditCents, balanceCents, status: displayStatus(doc, paidCents, creditCents) };
}

export function displayStatus(doc: Invoice, paidCents: number, creditCents: number, today = todayISO()): DisplayStatus {
  if (doc.status === "void") return "Void";
  if (doc.status === "draft") return "Draft";
  if (doc.manualStatus === "disputed") return "Disputed";
  if (doc.manualStatus === "written_off") return "Written off";
  if (doc.manualStatus === "refunded") return "Refunded";
  if (doc.kind === "quote") return doc.relatedInvoiceId ? "Accepted" : "Sent";
  if (doc.kind === "credit_note") return "Issued";
  const balance = doc.amountCents - paidCents - creditCents;
  if (balance <= 0) return "Paid";
  if (paidCents + creditCents > 0) return doc.dueDate < today ? "Overdue" : "Partially paid";
  return doc.dueDate < today ? "Overdue" : "Sent";
}

export async function listDocs(kind?: DocKind) {
  const docs = await db.select().from(schema.bookInvoices).orderBy(desc(schema.bookInvoices.id)).limit(200);
  const list = kind ? docs.filter((d) => d.kind === kind) : docs;
  const ids = list.map((d) => d.id);
  const paid = new Map<number, number>();
  if (ids.length) {
    const rows = (await db.execute(sql`SELECT invoice_id AS id, sum(CASE WHEN kind = 'refund' THEN -amount_cents ELSE amount_cents END)::int AS cents FROM book_entries WHERE invoice_id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)}) GROUP BY 1`)).rows as { id: number; cents: number }[];
    for (const r of rows) paid.set(Number(r.id), Number(r.cents));
  }
  const credits = await creditsFor(ids);
  return list.map((d) => {
    const p = paid.get(d.id) ?? 0;
    const c = credits.get(d.id) ?? 0;
    return { ...d, paidCents: p, creditCents: c, balanceCents: d.kind === "invoice" && d.status === "open" ? d.amountCents - p - c : 0, display: displayStatus(d, p, c) };
  });
}

export async function issueDoc(id: number, userId: number | null) {
  const [d] = await db.select().from(schema.bookInvoices).where(eq(schema.bookInvoices.id, id));
  if (!d || d.status !== "draft") throw new BooksError("Only a draft can be issued.");
  await db.update(schema.bookInvoices).set({ status: "open", sentAt: new Date() }).where(eq(schema.bookInvoices.id, id));
  await bookAudit(userId, "invoice_issued", "book_invoice", id, { number: d.number });
}

export async function setManualStatus(id: number, status: (typeof MANUAL_STATUSES)[number] | null, reason: string, userId: number | null) {
  const [d] = await db.select().from(schema.bookInvoices).where(eq(schema.bookInvoices.id, id));
  if (!d || d.status !== "open" || d.kind !== "invoice") throw new BooksError("Only an issued invoice can be marked this way.");
  if (status && !reason.trim()) throw new BooksError("Say why.");
  await db.update(schema.bookInvoices).set({ manualStatus: status }).where(eq(schema.bookInvoices.id, id));
  await bookAudit(userId, "invoice_status_set", "book_invoice", id, { before: d.manualStatus, after: status, reason });
}

/** Turn a sent quote into a draft invoice (same lines and amounts); the quote shows Accepted. */
export async function quoteToInvoice(id: number, userId: number | null) {
  const q = await docDetail(id);
  if (!q || q.doc.kind !== "quote" || q.doc.status !== "open") throw new BooksError("Only a sent quote can become an invoice.");
  if (q.doc.relatedInvoiceId) throw new BooksError("This quote already became an invoice.");
  const inv = await createDoc(
    {
      kind: "invoice",
      customerName: q.doc.customerName,
      customerId: q.doc.customerId,
      customerEmail: q.doc.customerEmail,
      customerPhone: q.doc.customerPhone,
      billingAddress: q.doc.billingAddress,
      orderId: q.doc.orderId,
      issueDate: todayISO(),
      termsDays: q.doc.termsDays,
      lines: q.lines.map((l) => ({ description: l.description, qty: l.qty, unitCents: l.unitCents, productId: l.productId })),
      discountCents: q.doc.discountCents,
      taxCents: q.doc.taxCents,
      taxExempt: q.doc.taxExempt,
      depositRequiredCents: q.doc.depositRequiredCents,
      notes: q.doc.notes,
    },
    userId,
  );
  await db.update(schema.bookInvoices).set({ relatedInvoiceId: inv.id }).where(eq(schema.bookInvoices.id, id));
  await bookAudit(userId, "quote_accepted", "book_invoice", id, { invoice: inv.id });
  return inv;
}

/** Customer statement: every issued invoice, credit and payment for this customer, with a running balance. */
export async function statement(customerName: string) {
  const docs = (await db.select().from(schema.bookInvoices).where(eq(schema.bookInvoices.customerName, customerName))).filter((d) => d.status === "open" && d.kind !== "quote");
  const invIds = docs.filter((d) => d.kind === "invoice").map((d) => d.id);
  const pays = invIds.length ? await db.select().from(schema.bookEntries).where(inArray(schema.bookEntries.invoiceId, invIds)) : [];
  const rows = [
    ...docs.map((d) => ({ date: d.issueDate, ref: d.number ?? `#${d.id}`, what: d.kind === "invoice" ? "Invoice" : "Credit note", cents: d.kind === "invoice" ? d.amountCents : -d.amountCents })),
    ...pays.map((p) => ({ date: p.entryDate, ref: `Payment #${p.id}`, what: `${p.kind === "refund" ? "Refund" : "Payment"}${p.method ? ` (${p.method}${p.checkNo ? ` #${p.checkNo}` : ""})` : ""}`, cents: p.kind === "refund" ? p.amountCents : -p.amountCents })),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.ref.localeCompare(b.ref));
  let bal = 0;
  return rows.map((r) => ((bal += r.cents), { ...r, balanceCents: bal }));
}
