import { requireOwner } from "@/lib/auth";
import { currentCatalog } from "@/lib/catalog-pdf";
import { getSettings } from "@/lib/settings";
import CatalogPdf from "../catalog/CatalogPdf";
import PhotoUpload from "../catalog/PhotoUpload";
import CatalogEmailForm from "./CatalogEmailForm";
import CatalogTextItems from "./CatalogTextItems";
import { parseCatalogTextItems } from "@/lib/catalog-send";

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
      <section className="card mb-5 p-5">
        <h2 className="text-xl font-black">Catalog email</h2>
        <CatalogEmailForm name={String(settings.catalogName ?? "")} auto={settings.catalogAutoAttach !== false} />
      </section>
      <section className="card mb-5 p-5" data-catalog-text-pictures>
        <h2 className="text-xl font-black">Catalog by text (photos)</h2>
        <p className="mb-3 mt-1 text-sm text-muted">A caller who asks for the catalog by text gets each photo in its own message, with its own text, in this order (up to 10). JPG, PNG or WebP, under 4 MB. No photos here: the catalog words are sent as before.</p>
        <CatalogTextItems initial={parseCatalogTextItems(settings.catalogTextItems)} />
      </section>
    </div>
  );
}
