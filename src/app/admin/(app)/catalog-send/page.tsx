import { requireOwner } from "@/lib/auth";
import { currentCatalog } from "@/lib/catalog-pdf";
import { getSettings } from "@/lib/settings";
import CatalogPdf from "../catalog/CatalogPdf";
import PhotoUpload from "../catalog/PhotoUpload";

/**
 * What callers get when they ask for the catalog (Abraham, Nov 17, 2026): the PDF for email and the two pictures for
 * text, on their own page in the side menu so Catalog holds only categories and items.
 */
export default async function CatalogSendPage() {
  await requireOwner();
  const pdf = await currentCatalog();
  const settings = await getSettings();
  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-black sm:text-3xl">Catalog email &amp; text</h1>
      <p className="mb-5 mt-1 text-muted">What a caller gets after asking for the catalog (phone key 8, or texting CATALOG): the PDF by email, the pictures by text.</p>
      <CatalogPdf
        current={
          pdf
            ? {
                id: pdf.id,
                fileName: pdf.fileName,
                sizeMb: (pdf.sizeBytes / 1024 / 1024).toFixed(1),
                uploaded: pdf.createdAt.toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }),
              }
            : null
        }
      />
      <section className="card mb-5 p-5" data-catalog-text-pictures>
        <h2 className="text-xl font-black">Catalog by text: two pictures</h2>
        <p className="mb-3 mt-1 text-sm text-muted">A caller who asks for the catalog by text gets two messages: first picture 1 with the catalog words, then picture 2 alone. Without pictures, only the words are sent. JPG or PNG.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div><div className="label">Picture 1 (with the words)</div><PhotoUpload kind="text" id={1} current={settings.catalogTextPicture1 || null} /></div>
          <div><div className="label">Picture 2 (alone)</div><PhotoUpload kind="text" id={2} current={settings.catalogTextPicture2 || null} /></div>
        </div>
      </section>
    </div>
  );
}
