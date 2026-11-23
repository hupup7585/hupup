"use client";

import { useState, useTransition } from "react";
import { loadDirectoryAction, previewDirectoryAction, type DirectoryPreview } from "./actions";

export default function DirectoryPreviewForm() {
  const [r, setR] = useState<DirectoryPreview | null>(null);
  const [pending, start] = useTransition();
  const [file, setFile] = useState<File | null>(null);
  const [load, setLoad] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className="space-y-4">
      <form
        className="card flex flex-wrap items-center gap-3 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          start(async () => setR(await previewDirectoryAction(fd)));
        }}
      >
        <input type="file" name="file" accept=".csv,text/csv" className="text-sm" data-directory-file onChange={(e) => (setFile(e.target.files?.[0] ?? null), setLoad(null))} />
        <button className="btn-dark" disabled={pending}>{pending ? "Checking…" : "Check the file"}</button>
      </form>
      {r && !r.ok && <p role="alert" className="rounded-lg bg-[#ffe6e4] p-3 text-sm font-semibold text-[#b3261e]">{r.message}</p>}
      {r?.ok && (
        <div className="card space-y-3 p-4 text-sm" data-directory-preview>
          <p>
            <b>{r.rows}</b> rows ready{r.issueCount ? <>, <b>{r.issueCount}</b> rows with a problem (not counted)</> : null}. Printed as Blooming Grove: <b>{r.bloomingGrove}</b>.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="btn-dark"
              disabled={pending || !file}
              data-directory-load
              onClick={() => {
                if (!file || !window.confirm(`Load these ${r.rows} rows? This replaces the whole directory.`)) return;
                const fd = new FormData();
                fd.set("file", file);
                setLoad({ ok: true, text: "Saving..." });
                start(async () => {
                  const x = await loadDirectoryAction(fd).catch(() => ({ ok: false, message: "" }));
                  setLoad(x.ok ? { ok: true, text: x.message } : { ok: false, text: x.message ? `Not saved. ${x.message}` : "Not saved. Please try again." });
                });
              }}
            >
              Load this list
            </button>
            {load && (
              <span role="status" data-save-result={load.ok ? "saved" : "failed"} className={`rounded-lg px-2 py-1 text-sm font-bold ${load.ok ? "bg-[#E3F8EF] text-[#13895C]" : "bg-[#ffe6e4] text-[#b3261e]"}`}>
                {load.text}
              </span>
            )}
          </div>
          <div>
            <b>Towns:</b> {r.towns?.map((t) => `${t.town} (${t.count})`).join(", ")}
          </div>
          <div>
            <b>First rows:</b>
            <ul className="ml-5 list-disc">{r.sample?.map((s) => <li key={s}>{s}</li>)}</ul>
          </div>
          {!!r.shared?.length && (
            <div>
              <b>Numbers shared by more than one entry ({r.shared.length}):</b>
              <ul className="ml-5 list-disc">{r.shared.slice(0, 50).map((s) => <li key={s.phone}>{s.phone}: {s.names.join(" / ")}</li>)}</ul>
            </div>
          )}
          {!!r.issues?.length && (
            <div>
              <b>Rows with a problem:</b>
              <ul className="ml-5 list-disc">{r.issues.map((i) => <li key={i.line}>Line {i.line}: {i.reason} ({i.text})</li>)}</ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
