"use client";

import { useState } from "react";
import Link from "next/link";
import { Search, X } from "lucide-react";

/**
 * The conversation list's title with a search icon (Abraham, Nov 24, 2026): tapping it opens the search bar; it stays
 * open while a search is shown, with a way to clear it.
 */
export default function ListHeader({ title, view, q }: { title: string; view: string; q?: string }) {
  const [open, setOpen] = useState(Boolean(q));
  const base = `/admin/messages${view === "conversations" ? "" : `?v=${view}`}`;
  return (
    <div className="mb-2 px-1">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-black text-navy" data-list-title>{title}</h2>
        <button type="button" className="grid h-9 w-9 place-items-center rounded-full text-navy hover:bg-bg" aria-label={open ? "Close search" : "Search texts"} aria-expanded={open} onClick={() => setOpen(!open)} data-search-toggle>
          {open ? <X className="h-5 w-5" aria-hidden /> : <Search className="h-5 w-5" aria-hidden />}
        </button>
      </div>
      {open && (
        <form className="mt-2 flex gap-2" action="/admin/messages" data-search>
          {view !== "conversations" && <input type="hidden" name="v" value={view} />}
          <input name="q" defaultValue={q} autoFocus placeholder="Search name, number or text" aria-label="Search texts" className="input" />
          <button className="btn-ghost">Search</button>
        </form>
      )}
      {q && (
        <p className="mt-2 flex items-center justify-between gap-2 text-xs text-muted">
          <span>Results for &ldquo;{q}&rdquo;</span>
          <Link href={base} className="font-semibold text-navy underline" data-clear-search>Clear search</Link>
        </p>
      )}
    </div>
  );
}
