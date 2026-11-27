"use client";

import { useRef, useState, useTransition } from "react";
import { catalogPdfChunkAction, startCatalogPdfAction } from "./pdf-actions";

const CHUNK = 3 * 1024 * 1024;

type PdfRow = { id: number; fileName: string; sizeMb: string; uploaded: string };

export default function CatalogPdf(props: { current: PdfRow | null; history?: PdfRow[] }) {
  const ref = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; message: string } | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  async function upload(file: File) {
    setMsg(null);
    const opened = await startCatalogPdfAction(file.name, file.size);
    if (!opened.ok || !opened.id) return setMsg(opened);
    const parts = Math.ceil(file.size / CHUNK);
    for (let i = 0; i < parts; i++) {
      setProgress(`Uploading ${Math.round((i / parts) * 100)}%`);
      const fd = new FormData();
      fd.set("id", String(opened.id));
      fd.set("idx", String(i));
      fd.set("last", i === parts - 1 ? "1" : "0");
      fd.set("data", file.slice(i * CHUNK, (i + 1) * CHUNK));
      const r = await catalogPdfChunkAction(fd);
      if (!r.ok || i === parts - 1) {
        setProgress(null);
        return setMsg(r);
      }
    }
  }

  return (
    <section className="card mb-5 p-5" data-catalog-pdf>
      <h2 className="text-lg font-bold">Catalog PDF</h2>
      <p className="mt-1 text-sm text-muted">Sent with every catalog email (phone key 8). PDF under 10 MB. Replacing it keeps the old file. Every catalog link in past emails and texts opens the current PDF right away.</p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        {props.current ? (
          <a className="font-semibold underline" href={`/api/admin/catalog-pdf/${props.current.id}`}>
            {props.current.fileName}
          </a>
        ) : (
          <span className="font-semibold text-coral-dark">No catalog uploaded yet</span>
        )}
        {props.current && (
          <span className="text-xs text-muted">
            {props.current.sizeMb} MB, uploaded {props.current.uploaded}
          </span>
        )}
        <input
          ref={ref}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) start(() => upload(f));
          }}
        />
        <button className="btn-dark !py-1.5 text-sm" disabled={pending} onClick={() => ref.current?.click()}>
          {props.current ? "Replace PDF" : "Upload PDF"}
        </button>
        {progress && <span className="text-xs font-semibold">{progress}</span>}
      </div>
      {!!props.history?.length && (
        <details className="mt-4" data-catalog-history>
          <summary className="cursor-pointer text-sm font-bold">Old catalogs ({props.history.length}), for you only</summary>
          <p className="mt-1 text-xs text-muted">Kept for your records. Customers never see these: old links open the current catalog.</p>
          <ul className="mt-2 space-y-1 text-sm">
            {props.history.map((h) => (
              <li key={h.id} data-catalog-old={h.id}>
                <a className="underline" href={`/api/admin/catalog-pdf/${h.id}`}>
                  {h.fileName}
                </a>{" "}
                <span className="text-xs text-muted">
                  {h.sizeMb} MB, uploaded {h.uploaded}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {msg?.message && <p className={`mt-2 text-sm font-semibold ${msg.ok ? "text-[#13895C]" : "text-coral-dark"}`}>{msg.message}</p>}
    </section>
  );
}
