"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { BooksError, parseMoney, requireBooks } from "@/lib/books";
import { createDoc, docFromBooking, issueDoc, quoteToInvoice, setManualStatus, MANUAL_STATUSES, type DocKind, type LineInput } from "@/lib/invoices";
import { todayISO } from "@/lib/dates";

/** Customer billing actions (Bookkeeping spec 3). Every change is in the audit log. */

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const go = (msg: string, err = false, to = "/admin/bookkeeping?tab=invoices"): never => redirect(`${to}${to.includes("?") ? "&" : "?"}${err ? "err" : "msg"}=${encodeURIComponent(msg)}`);

async function run(fn: (userId: number | null) => Promise<string | { msg: string; to: string }>) {
  const staff = await requireBooks();
  let out: string | { msg: string; to: string };
  try {
    out = await fn(staff.userId);
  } catch (e) {
    if (e instanceof BooksError) return go(e.message, true);
    console.error("invoice action failed", e);
    return go("Something went wrong. Nothing was saved.", true);
  }
  revalidatePath("/admin/bookkeeping");
  return typeof out === "string" ? go(out) : go(out.msg, false, out.to);
}

function money(f: FormData, k: string) {
  const v = s(f, k);
  if (!v) return 0;
  const c = parseMoney(v);
  if (c === null || c < 0) throw new BooksError(`Check the ${k} amount.`);
  return c;
}

export async function createDocAction(f: FormData) {
  return run(async (userId) => {
    const kind = (["invoice", "quote", "credit_note"].includes(s(f, "kind")) ? s(f, "kind") : "invoice") as DocKind;
    const lines: LineInput[] = [];
    for (let i = 0; i < 8; i++) {
      const description = s(f, `desc${i}`);
      const price = s(f, `price${i}`);
      if (!description && !price) continue;
      const unit = parseMoney(price || "0");
      if (unit === null) throw new BooksError(`Check the price on line ${i + 1}.`);
      lines.push({ description, qty: Number(s(f, `qty${i}`) || 1), unitCents: unit });
    }
    const doc = await createDoc(
      {
        kind,
        customerName: s(f, "customerName"),
        customerEmail: s(f, "customerEmail") || null,
        customerPhone: s(f, "customerPhone") || null,
        billingAddress: s(f, "billingAddress") || null,
        orderId: s(f, "orderId") ? Number(s(f, "orderId")) : null,
        issueDate: s(f, "issueDate") || todayISO(),
        termsDays: s(f, "termsDays") ? Number(s(f, "termsDays")) : 0,
        lines,
        discountCents: money(f, "discount"),
        taxCents: money(f, "tax"),
        depositRequiredCents: money(f, "deposit"),
        taxExempt: s(f, "taxExempt") === "on",
        exemptCertNo: s(f, "exemptCertNo") || null,
        notes: s(f, "notes") || null,
        relatedInvoiceId: s(f, "relatedInvoiceId") ? Number(s(f, "relatedInvoiceId")) : null,
        issue: s(f, "issue") === "on",
      },
      userId,
    );
    return { msg: `${doc.number} saved${doc.status === "open" ? " and issued" : " as a draft"}.`, to: `/admin/bookkeeping/invoice/${doc.id}` };
  });
}

export async function fromBookingAction(f: FormData) {
  return run(async (userId) => {
    const kind = s(f, "kind") === "quote" ? "quote" : "invoice";
    const doc = await docFromBooking(Number(s(f, "orderId")), kind, userId, Number(s(f, "termsDays") || 0));
    return { msg: `${doc.number} drafted from booking #${s(f, "orderId")}. Check it, then issue it.`, to: `/admin/bookkeeping/invoice/${doc.id}` };
  });
}

export async function issueDocAction(f: FormData) {
  return run(async (userId) => {
    await issueDoc(Number(s(f, "id")), userId);
    return { msg: "Issued.", to: `/admin/bookkeeping/invoice/${s(f, "id")}` };
  });
}

export async function manualStatusAction(f: FormData) {
  return run(async (userId) => {
    const st = s(f, "status");
    await setManualStatus(Number(s(f, "id")), (MANUAL_STATUSES as readonly string[]).includes(st) ? (st as (typeof MANUAL_STATUSES)[number]) : null, s(f, "reason"), userId);
    return { msg: "Status saved.", to: `/admin/bookkeeping/invoice/${s(f, "id")}` };
  });
}

export async function quoteToInvoiceAction(f: FormData) {
  return run(async (userId) => {
    const inv = await quoteToInvoice(Number(s(f, "id")), userId);
    return { msg: `${inv.number} drafted from the quote.`, to: `/admin/bookkeeping/invoice/${inv.id}` };
  });
}
