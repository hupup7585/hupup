"use client";

import { useState } from "react";
import { saveCatalogTextItemsAction, uploadCatalogTextPhotoAction } from "./actions";

type Item = { photo: string; text: string };

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
    const fd = new FormData();
    fd.set("photo", file);
    const r = await uploadCatalogTextPhotoAction(fd);
    setBusy(false);
    if (!r.ok || !r.url) return setMsg({ ok: false, text: r.message });
    if (at === undefined) setItems((list) => [...list, { photo: r.url!, text: "" }]);
    else update(at, { photo: r.url });
    setMsg(null);
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
            <label className="btn-ghost cursor-pointer px-2 py-1 text-center text-sm">
              Replace
              <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => e.target.files?.[0] && addPhoto(e.target.files[0], i)} />
            </label>
            <button type="button" className="btn-ghost px-2 py-1 text-sm text-coral" onClick={() => setItems((list) => list.filter((_, j) => j !== i))}>Remove</button>
          </div>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-3">
        {items.length < 10 && (
          <label className="btn-ghost cursor-pointer">
            {busy ? "Working..." : "Add a photo"}
            <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" disabled={busy} onChange={(e) => e.target.files?.[0] && addPhoto(e.target.files[0])} />
          </label>
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
