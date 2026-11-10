"use client";

import { useState, useTransition } from "react";
import { ImagePlus, Link2, X } from "lucide-react";
import { PROMO_MAX_CHARS, PROMO_MAX_PICTURES, dollars, offerWithLink, promoCostEstimate, promoTextV2, segments } from "@/lib/promo-text";
import { kb, shrinkToPhoneJpg } from "@/lib/picture-shrink";
import { saveCampaignDraftAction, uploadOriginalChunkAction, uploadPromoPictureAction } from "./picture-actions";

type Product = { id: number; name: string };
type Slot = { id: number; url: string; preview: string; jpgBytes: number; width: number; height: number; label: string; original: "catalog" | "saving" | "saved" | "failed"; originalBytes?: number } | null;

const CHUNK = 3 * 1024 * 1024;
const OK_TYPES = ["image/jpeg", "image/jpg", "image/png"];

/** Owner: write a promo text with up to two pictures and an optional Rentals page link (Abraham, section 7). */
export default function CampaignComposer({ products, eligibleCount, baseUrl, fromNumber }: { products: Product[]; eligibleCount: number; baseUrl: string; fromNumber: string }) {
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [link, setLink] = useState(false);
  const [slots, setSlots] = useState<Slot[]>([null, null]);
  const [busy, setBusy] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, start] = useTransition();

  const finalText = promoTextV2(offerWithLink(body || " ", link, baseUrl));
  const chars = finalText.length;
  const over = chars > PROMO_MAX_CHARS;
  const pictures = slots.filter(Boolean) as NonNullable<Slot>[];
  const cost = promoCostEstimate(finalText, pictures.length, eligibleCount);
  const seg = segments(finalText);

  const setSlot = (i: number, v: Slot) => setSlots((s) => s.map((x, j) => (j === i ? v : x)));

  async function addPicture(i: number, source: "upload" | "catalog", blob: Blob, meta: { fileName?: string; productId?: number; label: string }) {
    setBusy(i);
    setMsg(null);
    try {
      if (source === "upload" && !OK_TYPES.includes(blob.type.toLowerCase())) throw new Error("Use a JPG, JPEG or PNG picture.");
      const shrunk = await shrinkToPhoneJpg(blob);
      const fd = new FormData();
      fd.append("jpg", shrunk.blob, "promo.jpg");
      fd.append("width", String(shrunk.width));
      fd.append("height", String(shrunk.height));
      fd.append("source", source);
      if (meta.productId) fd.append("productId", String(meta.productId));
      if (meta.fileName) fd.append("fileName", meta.fileName);
      if (source === "upload") {
        fd.append("originalType", blob.type.toLowerCase());
        fd.append("originalBytes", String(blob.size));
      }
      const r = await uploadPromoPictureAction(fd);
      if (!r.ok) throw new Error(r.message);
      const preview = URL.createObjectURL(shrunk.blob);
      setSlot(i, { id: r.id, url: r.url, preview, jpgBytes: r.jpgBytes, width: shrunk.width, height: shrunk.height, label: meta.label, original: source === "catalog" ? "catalog" : "saving", originalBytes: blob.size });
      if (source === "upload") {
        // Keep the full-size original too, in 3 MB pieces (Vercel takes at most 4.5 MB per request).
        let ok = true;
        const parts = Math.max(1, Math.ceil(blob.size / CHUNK));
        for (let k = 0; k < parts && ok; k++) {
          const p = new FormData();
          p.append("id", String(r.id));
          p.append("idx", String(k));
          p.append("last", k === parts - 1 ? "1" : "0");
          p.append("data", blob.slice(k * CHUNK, (k + 1) * CHUNK));
          const c = await uploadOriginalChunkAction(p);
          ok = c.ok && (k < parts - 1 || Boolean(c.complete));
        }
        setSlots((s) => s.map((x, j) => (j === i && x ? { ...x, original: ok ? "saved" : "failed" } : x)));
      }
    } catch (e) {
      setMsg({ ok: false, message: (e as Error).message || "That picture couldn't be added." });
    } finally {
      setBusy(null);
    }
  }

  async function pickCatalog(i: number, productId: number) {
    const p = products.find((x) => x.id === productId);
    if (!p) return;
    setBusy(i);
    try {
      const r = await fetch(`/api/admin/catalog-photo/${productId}`);
      if (!r.ok) throw new Error("That catalog photo couldn't be loaded.");
      await addPicture(i, "catalog", await r.blob(), { productId, label: `Catalog: ${p.name}` });
    } catch (e) {
      setMsg({ ok: false, message: (e as Error).message });
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-4" data-campaign-composer>
      <label className="block" htmlFor="campaign-name">
        <span className="label">Name (only staff see this)</span>
        <input id="campaign-name" value={name} onChange={(e) => setName(e.target.value)} className="input" placeholder="Summer 2027" />
      </label>
      <label className="block" htmlFor="campaign-body">
        <span className="label">Offer</span>
        <textarea id="campaign-body" value={body} onChange={(e) => setBody(e.target.value)} rows={4} className="input" placeholder="Summer special! 15% off paddle boat rentals booked by June 30. Call (845) 415-7585." />
      </label>
      <p data-char-counter className={`-mt-2 text-sm font-semibold ${over ? "text-[#C83A2F]" : "text-muted"}`}>
        {chars.toLocaleString("en-US")} of {PROMO_MAX_CHARS.toLocaleString("en-US")} characters, counting the required start &ldquo;Hup Up Attractions:&rdquo; and ending &ldquo;Reply NOPROMO to stop promos, STOP to stop all texts.&rdquo;
        {over && <span className="block">Too long: shorten the offer by {(chars - PROMO_MAX_CHARS).toLocaleString("en-US")} characters before saving.</span>}
      </p>
      <button type="button" onClick={() => setLink(!link)} aria-pressed={link} data-rentals-link className={`inline-flex w-fit items-center gap-2 rounded-full px-4 py-2 text-sm font-bold ${link ? "bg-[#123D73] text-white" : "bg-bg"}`}>
        <Link2 className="h-4 w-4" aria-hidden /> {link ? "Rentals page link added" : "Link to Rentals page"}
      </button>

      <div>
        <span className="label">Pictures (up to {PROMO_MAX_PICTURES})</span>
        <div className="grid gap-3 sm:grid-cols-2">
          {slots.map((s, i) => (
            <div key={i} className="rounded-xl border border-line p-3" data-picture-slot={i + 1}>
              <div className="mb-2 text-sm font-bold">Picture {i + 1}</div>
              {s ? (
                <div>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={s.preview} alt={s.label} className="mb-2 max-h-48 w-full rounded-lg object-contain bg-bg" />
                  <p className="text-xs" data-picture-size>
                    <b>{kb(s.jpgBytes)}</b> JPG, {s.width} x {s.height} px. {s.label}
                  </p>
                  <p className="text-xs text-muted">
                    {s.original === "catalog" ? "Original: the catalog photo (kept)." : s.original === "saving" ? "Saving the full-size original..." : s.original === "saved" ? `Full-size original saved (${kb(s.originalBytes ?? 0)}).` : "The full-size original didn't save; the phone picture is fine."}
                  </p>
                  <button type="button" className="btn-ghost mt-2 inline-flex items-center gap-1 text-sm" onClick={() => setSlot(i, null)}>
                    <X className="h-4 w-4" aria-hidden /> Remove
                  </button>
                </div>
              ) : busy === i ? (
                <p className="text-sm text-muted">Making the picture phone-ready...</p>
              ) : (
                <div className="grid gap-2">
                  <select className="input text-sm" defaultValue="" onChange={(e) => e.target.value && pickCatalog(i, Number(e.target.value))} aria-label={`Picture ${i + 1}: catalog photo`}>
                    <option value="">Pick a catalog photo</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <label className="btn-ghost inline-flex cursor-pointer items-center justify-center gap-2 text-sm">
                    <ImagePlus className="h-4 w-4" aria-hidden /> Upload JPG or PNG
                    <input type="file" accept="image/jpeg,image/png" className="sr-only" aria-label={`Picture ${i + 1}: upload`} onChange={(e) => { const f = e.target.files?.[0]; if (f) addPicture(i, "upload", f, { fileName: f.name, label: f.name }); e.target.value = ""; }} />
                  </label>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div data-promo-preview>
        <span className="label">Preview: exactly what customers get</span>
        <div className="mx-auto max-w-sm rounded-[1.5rem] border border-line bg-bg p-3">
          <div className="mb-1 text-center text-xs text-muted">From {fromNumber}</div>
          <div className="rounded-2xl bg-white p-2 shadow-sm">
            {pictures.map((p) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={p.id} src={p.preview} alt={p.label} className="mb-2 w-full rounded-xl" />
            ))}
            <p className="whitespace-pre-wrap break-words px-1 text-sm" data-final-text>{finalText}</p>
          </div>
          {pictures.length > 0 && <div className="mt-1 text-center text-xs text-muted">Pictures: {pictures.map((p) => kb(p.jpgBytes)).join(" + ")} = {kb(pictures.reduce((n, p) => n + p.jpgBytes, 0))}</div>}
        </div>
      </div>

      <p data-cost className="rounded-xl bg-bg p-3 text-sm">
        Sends as <b>{cost.kind}</b>{cost.kind === "SMS" ? ` (${seg.segments} segment${seg.segments === 1 ? "" : "s"})` : ""} from {fromNumber}. Estimated cost: <b>{dollars(cost.perCustomer)}</b> per customer, about <b>{dollars(cost.total)}</b> for the {eligibleCount} customer{eligibleCount === 1 ? "" : "s"} who can get it now. This is an estimate from Twilio&rsquo;s list prices; the Twilio bill is exact.
      </p>

      <button
        type="button"
        className="btn-dark w-fit"
        disabled={pending || over || busy !== null || !name.trim() || body.trim().length < 10}
        onClick={() => start(async () => {
          const r = await saveCampaignDraftAction({ name, body, pictureIds: pictures.map((p) => p.id), rentalsLink: link });
          setMsg(r);
          if (r.ok) { setName(""); setBody(""); setLink(false); setSlots([null, null]); }
        })}
      >
        {pending ? "Saving..." : "Save draft"}
      </button>
      {msg && <p role="status" className={`text-sm font-semibold ${msg.ok ? "text-[#13895C]" : "text-[#C83A2F]"}`}>{msg.message}</p>}
    </div>
  );
}
