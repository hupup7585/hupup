import { notFound } from "next/navigation";
import { docDetail } from "@/lib/invoices";
import { verifyInvoiceLink } from "@/lib/signed-link";
import InvoiceDocument from "@/components/InvoiceDocument";
import PrintButton from "@/app/admin/(app)/bookkeeping/print/PrintButton";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your invoice · Hup Up Attractions", robots: { index: false, follow: false } };

/** The customer's own invoice (Abraham, Nov 15, 2026): opened from the signed link we send; view and print only. */
export default async function CustomerInvoicePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ t?: string }> }) {
  const id = Number((await params).id);
  const { t } = await searchParams;
  if (!verifyInvoiceLink(id, t)) notFound();
  const d = await docDetail(id);
  if (!d || d.doc.status === "draft" || d.doc.status === "void") notFound();
  return (
    <main className="min-h-screen bg-bg px-4 py-8 print:bg-white print:p-0">
      <div className="mx-auto max-w-4xl">
        <div className="mb-4 flex justify-end print:hidden">
          <PrintButton />
        </div>
        <InvoiceDocument d={d} h1 />
      </div>
    </main>
  );
}
