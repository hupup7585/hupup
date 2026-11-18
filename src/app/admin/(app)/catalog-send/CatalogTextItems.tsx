"use client";

import { useState } from "react";
import { saveCatalogTextItemsAction, uploadCatalogTextPhotoAction } from "./actions";

type Item = { photo: string; text: string };

/**
 * Make a photo small enough to upload and to text: at most 1600 pixels on the long side, JPEG. Photos the browser
 * can't read (some HEIC) go as they are; the server then says if they can't be used.
 */
async function shrinkPhoto(file: File): Promise<File> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size <= 1_500_000 && /jpe?g|png|webp/i.test(file.type)) return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/jpeg", 0.85));
    return blob ? new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" }) : file;
  } catch {
    return file;
  }
}

/** The photo catalog for texts: each photo with its own text box, in order; Save replaces the old catalog. */
export default function CatalogTextItems({ initial }: { initial: Item[] }) {
  const [items, setItems] = useState<Item[]>(initial);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const update = (i: number, patch: Partial<Item>) => setItems((list) => list.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const move = (i: number, by: number) =>
    setItems((list) => {
      const j = i + by;
      if (j < 0 || j >= list.length) return list;
      const next = [...list];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  async function addPhoto(file: File, at?: number) {
    setBusy(true);
    setMsg({ ok: true, text: "Uploading the photo..." });
    let r: { ok: boolean; message: string; url?: string };
    try {
      // Phone photos are often over the 4.5 MB the site accepts in one upload: shrink it here first (Nov 18, 2026)
      const small = await shrinkPhoto(file);
      const fd = new FormData();
      fd.set("photo", small);
      r = await uploadCatalogTextPhotoAction(fd);
    } catch {
      r = { ok: false, message: "The photo didn't upload. Please try again, or choose a JPG or PNG photo." };
    }
    setBusy(false);
    if (!r.ok || !r.url) return setMsg({ ok: false, text: r.message });
    if (at === undefined) setItems((list) => [...list, { photo: r.url!, text: "" }]);
    else update(at, { photo: r.url });
    setMsg({ ok: true, text: "Photo added. Press Save to keep the catalog." });
  }
  async function save() {
    setBusy(true);
    const r = await saveCatalogTextItemsAction(items);
    setBusy(false);
    setMsg({ ok: r.ok, text: r.message });
  }
  return (
    <div className="grid gap-3" data-catalog-text-items>
      {items.map((it, i) => (
        <div key={`${it.photo}-${i}`} className="grid gap-3 rounded-xl border border-line p-3 sm:grid-cols-[auto_1fr_auto]">
          <div className="flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-navy text-sm font-black text-white">{i + 1}</span>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={it.photo} alt={`Catalog photo ${i + 1}`} className="h-20 w-20 rounded-lg object-cover" />
          </div>
          <label className="block">
            <span className="label">Text with this photo</span>
            <textarea value={it.text} onChange={(e) => update(i, { text: e.target.value })} rows={3} maxLength={1500} className="input" />
          </label>
          <div className="flex flex-row gap-1 sm:flex-col">
            <button type="button" className="btn-ghost px-2 py-1 text-sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">Up</button>
            <button type="button" className="btn-ghost px-2 py-1 text-sm" onClick={() => move(i, 1)} disabled={i === items.length - 1} aria-label="Move down">Down</button>
            {/* A real button; the file box is visually hidden but still there (Abraham, Nov 18, 2026: Hark's browser can use it) */}
            <button type="button" className="btn-ghost px-2 py-1 text-sm" disabled={busy} onClick={(e) => (e.currentTarget.nextElementSibling as HTMLInputElement | null)?.click()}>
              Replace
            </button>
            <input type="file" accept="image/*" className="sr-only" aria-label={`Replace photo ${i + 1}`} data-replace-photo={i} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void addPhoto(f, i); }} />
            <button type="button" className="btn-ghost px-2 py-1 text-sm text-coral" onClick={() => setItems((list) => list.filter((_, j) => j !== i))}>Remove</button>
          </div>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-3">
        {items.length < 10 && (
          <>
            <button type="button" className="btn-ghost" disabled={busy} onClick={(e) => (e.currentTarget.nextElementSibling as HTMLInputElement | null)?.click()} data-add-photo>
              {busy ? "Working..." : "Add photos"}
            </button>
            {/* Several photos at once, added one after another, in the order chosen */}
            <input
              type="file"
              accept="image/*"
              multiple
              className="sr-only"
              aria-label="Add photos"
              data-add-photo-input
              disabled={busy}
              onChange={async (e) => {
                const files = Array.from(e.target.files ?? []);
                e.target.value = "";
                for (const f of files.slice(0, 10 - items.length)) await addPhoto(f);
              }}
            />
          </>
        )}
        {items.length > 0 && (
          <button type="button" className="btn-ghost text-coral" onClick={() => window.confirm("Start a new catalog? The rows below are cleared; the old catalog keeps sending until you press Save.") && setItems([])}>
            Start a new catalog
          </button>
        )}
        <button type="button" className="btn-dark" disabled={busy} onClick={save}>Save</button>
        {msg && <span role="status" className={`text-sm font-semibold ${msg.ok ? "text-[#13895C]" : "text-[#C83A2F]"}`}>{msg.text}</span>}
      </div>
    </div>
  );
}
