import ConfirmSubmit from "@/components/ConfirmSubmit";
import { notFound } from "next/navigation";
import { requireBooks } from "@/lib/books";
import { docDetail } from "@/lib/invoices";
import { formatMoney } from "@/lib/money";
import PrintButton from "../../print/PrintButton";
import InvoiceDocument from "@/components/InvoiceDocument";
import CopyLink from "@/components/CopyLink";
import { invoiceCustomerLink } from "@/lib/signed-link";
import { INVOICE_EMAIL_APPROVED, INVOICE_EMAIL_DRAFT } from "@/lib/invoice-share";
import * as I from "../../invoice-actions";
import * as A from "../../actions";

export const dynamic = "force-dynamic";

const m = (c: number) => (c < 0 ? `-${formatMoney(-c)}` : formatMoney(c));

/** A branded invoice, quote or credit note (Bookkeeping spec 3.1). Print, or save as PDF from the browser. */
export default async function InvoicePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string; err?: string }> }) {
  await requireBooks();
  const d = await docDetail(Number((await params).id));
  if (!d) notFound();
  const sp = await searchParams;
  const { doc } = d;
  return (
    <div className="mx-auto max-w-4xl">
      {sp.msg && <p className="no-print mb-4 rounded-xl bg-[#E3F8EF] px-4 py-3 text-sm font-semibold text-[#13895C]" role="status">{sp.msg}</p>}
      {sp.err && <p className="no-print mb-4 rounded-xl bg-[#FFE6E4] px-4 py-3 text-sm font-semibold text-[#C83A2F]" role="alert">{sp.err}</p>}
      <div className="no-print mb-4 flex flex-wrap items-center gap-2" data-invoice-actions>
        <a href="/admin/bookkeeping?tab=invoices" className="btn-ghost">← Invoices</a>
        <PrintButton />
        {doc.status !== "draft" && doc.status !== "void" && (
          <span className="flex flex-wrap items-center gap-2" data-invoice-share>
            <CopyLink url={invoiceCustomerLink(doc.id)} label="Copy customer link" />
            {doc.customerEmail && (
              <form action={I.emailDocAction}>
                <input type="hidden" name="id" value={doc.id} />
                <button className="btn-ghost" disabled={!INVOICE_EMAIL_APPROVED} title={INVOICE_EMAIL_APPROVED ? "" : "Waiting for Abraham's OK on the email wording"}>Email to customer</button>
              </form>
            )}
          </span>
        )}
        {doc.status === "draft" && <form action={I.issueDocAction}><input type="hidden" name="id" value={doc.id} /><button className="btn-dark">Issue</button></form>}
        {doc.kind === "quote" && doc.status === "open" && !doc.relatedInvoiceId && <form action={I.quoteToInvoiceAction}><input type="hidden" name="id" value={doc.id} /><button className="btn-dark">Turn into an invoice</button></form>}
        {doc.kind === "invoice" && doc.status === "open" && (
          <form action={I.manualStatusAction} className="flex flex-wrap items-center gap-1">
            <input type="hidden" name="id" value={doc.id} />
            <select name="status" defaultValue={doc.manualStatus ?? ""} className="input w-36 py-1 text-sm"><option value="">Normal</option><option value="disputed">Disputed</option><option value="written_off">Written off</option><option value="refunded">Refunded</option></select>
            <input name="reason" placeholder="Reason for the status" aria-label="Reason for the status" className="input w-48 py-1 text-sm" />
            <button className="text-sm font-bold text-navy">Set status</button>
          </form>
        )}
        {doc.status !== "void" && (
          <form action={A.voidInvoiceAction} className="flex items-center gap-1"><input type="hidden" name="id" value={doc.id} /><input name="reason" placeholder="Reason to void" aria-label="Reason to void" className="input w-40 py-1 text-sm" /><ConfirmSubmit message="Void this invoice? It stays on record as voided." className="text-sm font-bold text-[#C83A2F]">Void</ConfirmSubmit></form>
        )}
      </div>

      <InvoiceDocument d={d} />

      {!INVOICE_EMAIL_APPROVED && doc.customerEmail && doc.status !== "draft" && (
        <p className="no-print mt-3 text-xs text-muted" data-invoice-email-draft>
          Email to customer waits for Abraham&rsquo;s OK on this wording. Subject: &ldquo;{INVOICE_EMAIL_DRAFT.subject("INV-1001")}&rdquo;. Message: &ldquo;{INVOICE_EMAIL_DRAFT.body("INV-1001", "(link)")}&rdquo;
        </p>
      )}
      {doc.kind === "invoice" && d.payments.length > 0 && (
        <section className="no-print card mt-5 p-5">
          <h2 className="mb-2 text-lg font-bold">Payments</h2>
          <ul className="text-sm">{d.payments.map((p) => <li key={p.id}>{p.entryDate} · {p.kind === "refund" ? "Refund" : "Payment"} {m(p.amountCents)} {p.method ?? ""}{p.checkNo ? ` #${p.checkNo}` : ""}</li>)}</ul>
        </section>
      )}
    </div>
  );
}
