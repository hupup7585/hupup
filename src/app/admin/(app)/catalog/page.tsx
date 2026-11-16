import { requireOwner } from "@/lib/auth";
import { asc } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { Category, Product } from "@/lib/db/schema";
import { formatMoney } from "@/lib/money";
import { saveCategoryAction, saveOffersAction, saveProductAction, trashProductAction } from "./actions";
import PhotoUpload from "./PhotoUpload";
import ConfirmSubmit from "@/components/ConfirmSubmit";
import { currentCatalog } from "@/lib/catalog-pdf";
import CatalogPdf from "./CatalogPdf";
import { getSettings } from "@/lib/settings";

function CategoryForm({ c }: { c?: Category }) {
  return (
    <form action={saveCategoryAction} className="grid gap-3 sm:grid-cols-6">
      {c && <input type="hidden" name="id" value={c.id} />}
      <div className="sm:col-span-3"><label className="label">Name *</label><input name="name" defaultValue={c?.name} className="input" required /></div>
      <div><label className="label">Phone key</label><input name="ivrDigit" type="number" min={1} max={8} defaultValue={c?.ivrDigit ?? ""} className="input" placeholder="1-8" /></div>
      <div><label className="label">Sort</label><input name="sortOrder" type="number" defaultValue={c?.sortOrder ?? 0} className="input" /></div>
      <div className="sm:col-span-3"><label className="label">Spoken on phone as</label><input name="spokenName" defaultValue={c?.spokenName} className="input" placeholder="e.g. Laser Tag and Inflatable Mazes" /></div>
      <div className="sm:col-span-6"><label className="label">Description (landing page)</label><input name="description" defaultValue={c?.description} className="input" /></div>
      <label className="flex items-center gap-2 font-semibold sm:col-span-4"><input type="checkbox" name="active" defaultChecked={c?.active ?? true} /> Active (shown on website & phone)</label>
      <button className="btn-dark sm:col-span-2">{c ? "Save category" : "Add category"}</button>
    </form>
  );
}

function ProductForm({ p, categories, categoryId }: { p?: Product; categories: Category[]; categoryId?: number }) {
  return (
    <form action={saveProductAction} className="grid gap-3 sm:grid-cols-6">
      {p && <input type="hidden" name="id" value={p.id} />}
      <div className="sm:col-span-3"><label className="label">Item name *</label><input name="name" defaultValue={p?.name} className="input" required /></div>
      <div className="sm:col-span-3">
        <label className="label">Category *</label>
        <select name="categoryId" defaultValue={p?.categoryId ?? categoryId} className="input">
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <div className="sm:col-span-2"><label className="label">Price per rental ($) *</label><input name="price" defaultValue={p ? (p.priceCents / 100).toFixed(2) : ""} className="input" inputMode="decimal" required /></div>
      <div className="sm:col-span-2"><label className="label">Units owned *</label><input name="quantity" type="number" min={0} defaultValue={p?.quantity ?? 1} className="input" required /></div>
      <div className="sm:col-span-2"><label className="label">Phone menu order</label><input name="sortOrder" type="number" defaultValue={p?.sortOrder ?? 0} className="input" /></div>
      <div className="sm:col-span-2" data-size-order>
        <label className="label" htmlFor={`size-${p?.id ?? "new"}`}>Size order (1 = smallest)</label>
        <input id={`size-${p?.id ?? "new"}`} name="sizeOrder" type="number" min={1} max={99} defaultValue={p?.sizeOrder ?? ""} className="input" placeholder="Leave empty if not a size" />
        <span className="mt-1 block text-xs text-muted">When this item is booked, the phone line offers the next size up or down in the same category.</span>
      </div>
      <div className="sm:col-span-6"><label className="label">Description</label><input name="description" defaultValue={p?.description} className="input" /></div>
      <div className="sm:col-span-6"><label className="label">What the phone voice says for “hear description”</label><textarea name="spokenDescription" defaultValue={p?.spokenDescription} rows={2} className="input" /></div>
      <div className="sm:col-span-4 text-sm text-muted">{p ? "Photo: use Upload photo above this form." : "Add the item first, then upload its photo."}</div>
      <label className="flex items-end gap-2 pb-2 font-semibold sm:col-span-2"><input type="checkbox" name="active" defaultChecked={p?.active ?? true} /> Active</label>
      <button className="btn-dark sm:col-span-6">{p ? "Save item" : "Add item"}</button>
    </form>
  );
}

export default async function CatalogPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  await requireOwner(); // Owner only (finances, catalog, hotline prompts)
  const sp = await searchParams;
  const [cats, prods] = await Promise.all([
    db.select().from(schema.categories).orderBy(asc(schema.categories.sortOrder), asc(schema.categories.id)),
    db.select().from(schema.products).orderBy(asc(schema.products.sortOrder), asc(schema.products.id)),
  ]);
  const pdf = await currentCatalog();
  const settings = await getSettings();
  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-black sm:text-3xl">Catalog</h1>
      <p className="mb-5 mt-1 text-muted">
        Categories with a phone key appear in the hotline menu automatically (“For Bounce Houses, press 1”). Items are read in phone-menu order (10 or more: item 10 is press 10).
      </p>
      {sp.ok && <p className="mb-4 rounded-xl bg-mint/15 p-3 font-semibold text-[#13895C]">{sp.ok}</p>}
      {sp.error && <p className="mb-4 rounded-xl bg-coral/10 p-3 font-semibold text-coral-dark">{sp.error}</p>}
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

      <section className="card mb-5 p-5" data-offers>
        <h2 className="text-xl font-black">Offers</h2>
        <p className="mb-3 mt-1 text-sm text-muted">Each offer is off until you switch it on. They never combine: a booking gets the one that saves the customer the most. They cover jumping balloons, laser tag and paddle boats.</p>
        <form action={saveOffersAction} className="grid gap-2">
          <label className="flex items-start gap-2"><input type="checkbox" name="offerLaserThirdPackOn" defaultChecked={Boolean(settings.offerLaserThirdPackOn)} className="mt-1" /> <span><b>Laser tag: third pack 50% off.</b> Every gun pack counts, the guns with a maze included. Only the 3rd pack.</span></label>
          <label className="flex items-start gap-2"><input type="checkbox" name="offerThuSunOn" defaultChecked={Boolean(settings.offerThuSunOn)} className="mt-1" /> <span><b>Thursday to Sunday: 1.5 times the rental.</b> One booking, delivered Thursday, picked up Monday (New booking shows the choice on a Thursday).</span></label>
          <label className="flex items-start gap-2"><input type="checkbox" name="offerFourthSundayOn" defaultChecked={Boolean(settings.offerFourthSundayOn)} className="mt-1" /> <span><b>4th Sunday free.</b> After 3 Sundays in a row, the 4th Sunday&rsquo;s rental is free (the cheapest item). Delivery: $20 Kiryas Joel, $30 nearby towns, $40 anywhere else. Thursday to Sunday bookings don&rsquo;t count as Sundays.</span></label>
          <button className="btn-dark mt-1 w-fit">Save offers</button>
        </form>
      </section>

      <section className="card mb-5 p-5" data-catalog-text-pictures>
        <h2 className="text-xl font-black">Catalog by text: two pictures</h2>
        <p className="mb-3 mt-1 text-sm text-muted">A caller who asks for the catalog by text (key 8, or texting CATALOG) gets two messages: first picture 1 with the catalog words, then picture 2 alone. Without pictures, only the words are sent.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div><div className="label">Picture 1 (with the words)</div><PhotoUpload kind="text" id={1} current={settings.catalogTextPicture1 || null} /></div>
          <div><div className="label">Picture 2 (alone)</div><PhotoUpload kind="text" id={2} current={settings.catalogTextPicture2 || null} /></div>
        </div>
      </section>

      {cats.map((c) => {
        const items = prods.filter((p) => p.categoryId === c.id && !p.trashedAt);
        return (
          <section key={c.id} className={`card mb-5 p-5 ${c.active ? "" : "opacity-60"}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-xl font-black">
                {c.name}{" "}
                <span className="ml-2 rounded-full bg-bg px-2.5 py-1 text-xs font-bold text-muted">
                  {c.ivrDigit ? `Phone key ${c.ivrDigit}` : "Not on phone menu"}
                </span>
                {!c.active && <span className="ml-2 text-xs font-bold text-coral">Inactive</span>}
              </h2>
            </div>
            <details className="mt-2">
              <summary className="cursor-pointer text-sm font-bold text-navy underline-offset-2 hover:underline">Edit category</summary>
              <div className="mt-3 grid gap-3"><PhotoUpload kind="category" id={c.id} current={c.imageUrl} /><CategoryForm c={c} /></div>
            </details>
            <div className="mt-4 divide-y divide-line">
              {items.map((p) => (
                <div key={p.id} className="flex items-start gap-2 py-3" data-item-row>
                <details className="min-w-0 flex-1">
                  <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3">
                    <span className="grid h-7 w-7 place-items-center rounded-lg bg-navy text-sm font-black text-white" title="Phone key in this category">{p.active ? items.filter((x) => x.active).indexOf(p) + 1 : "–"}</span>
                    <span className={`flex-1 font-bold ${p.active ? "" : "text-muted line-through"}`}>{p.name}</span>
                    <span className="text-sm text-muted">{p.quantity} owned</span>
                    <span className="font-bold">{formatMoney(p.priceCents)}</span>
                    <span className="text-sm font-bold text-navy underline-offset-2 hover:underline">Edit</span>
                  </summary>
                  <div className="mt-3 grid gap-3 rounded-xl bg-bg p-4">
                    <PhotoUpload kind="product" id={p.id} current={p.imageUrl} />
                    <ProductForm p={p} categories={cats} />
                  </div>
                </details>
                {/* Every item, on its own row (Abraham, Nov 17, 2026): Put in Garbage without opening Edit */}
                <form action={trashProductAction} data-trash-item>
                  <input type="hidden" name="id" value={p.id} />
                  <ConfirmSubmit message={`Put "${p.name}" in Garbage? It comes off the catalog list, the website and the phone menu. You can restore it from Garbage.`} className="btn-ghost px-3 py-1 text-sm text-coral">Put in Garbage</ConfirmSubmit>
                </form>
                </div>
              ))}
              {items.length === 0 && <p className="py-3 text-muted">No items yet.</p>}
            </div>
            <details className="mt-3">
              <summary className="cursor-pointer text-sm font-bold text-coral">+ Add item to {c.name}</summary>
              <div className="mt-3 rounded-xl bg-bg p-4"><ProductForm categories={cats} categoryId={c.id} /></div>
            </details>
          </section>
        );
      })}

      {prods.some((p) => p.trashedAt) && (
        <section className="card mb-5 p-5" data-garbage>
          <h2 className="mb-1 text-xl font-black">Garbage</h2>
          <p className="mb-3 text-sm text-muted">Items here are off the catalog list, the website and the phone menu. Orders that already have them are not changed.</p>
          <ul className="divide-y divide-line">
            {prods.filter((p) => p.trashedAt).map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span><b>{p.name}</b> <span className="text-sm text-muted">({cats.find((c) => c.id === p.categoryId)?.name ?? "No category"}, {formatMoney(p.priceCents)})</span></span>
                <form action={trashProductAction}>
                  <input type="hidden" name="id" value={p.id} />
                  <input type="hidden" name="restore" value="1" />
                  <button className="btn-ghost">Restore</button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card p-5">
        <h2 className="mb-3 text-xl font-black">+ Add a new category</h2>
        <CategoryForm />
      </section>
    </div>
  );
}
