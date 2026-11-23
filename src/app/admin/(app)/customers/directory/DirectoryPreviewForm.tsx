"use client";

import { useState, useTransition } from "react";
import { previewDirectoryAction, type DirectoryPreview } from "./actions";

export default function DirectoryPreviewForm() {
  const [r, setR] = useState<DirectoryPreview | null>(null);
  const [pending, start] = useTransition();
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
        <input type="file" name="file" accept=".csv,text/csv" className="text-sm" data-directory-file />
        <button className="btn-dark" disabled={pending}>{pending ? "Checking…" : "Check the file"}</button>
      </form>
      {r && !r.ok && <p role="alert" className="rounded-lg bg-[#ffe6e4] p-3 text-sm font-semibold text-[#b3261e]">{r.message}</p>}
      {r?.ok && (
        <div className="card space-y-3 p-4 text-sm" data-directory-preview>
          <p>
            <b>{r.rows}</b> rows ready{r.issueCount ? <>, <b>{r.issueCount}</b> rows with a problem (not counted)</> : null}. Printed as Blooming Grove: <b>{r.bloomingGrove}</b>.
          </p>
          <p className="rounded-lg bg-[#FFF8E1] p-2 text-[#5C4600]">
            <b>Not loaded.</b> Nothing was saved. Loading waits for Abraham&rsquo;s OK.
          </p>
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
