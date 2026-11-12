"use client";

import { useRef, useState, useTransition } from "react";
import { catalogPdfChunkAction, startCatalogPdfAction } from "./pdf-actions";

const CHUNK = 3 * 1024 * 1024;

export default function CatalogPdf(props: { current: { id: number; fileName: string; sizeMb: string; uploaded: string } | null }) {
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
      <p className="mt-1 text-sm text-muted">Sent with every catalog email (phone key 8). PDF under 10 MB. Replacing it keeps the old file.</p>
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
      {msg?.message && <p className={`mt-2 text-sm font-semibold ${msg.ok ? "text-[#13895C]" : "text-coral-dark"}`}>{msg.message}</p>}
    </section>
  );
}
