"use client";

import { cellMatches } from "@/lib/phone-search";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { deleteRowAction, insertRowAction, saveCellsAction, sheetRowsAction, undoDeleteAction } from "./actions";
import type { SheetKey, SheetRow } from "@/lib/directory-sheet";

/**
 * The Directory list as a sheet (Abraham, Nov 23, 2026). Owner only. Click to pick a cell, type or double-click to
 * edit, Enter saves. Every change saves right away; a failed save puts the old value back.
 */
type Col = { key: SheetKey; label: string; rtl?: boolean; w: number };
const COLS: Col[] = [
  { key: "yiddishLastName", label: "Yiddish last name", rtl: true, w: 40 },
  { key: "yiddishFirstName", label: "Yiddish first name", rtl: true, w: 40 },
  { key: "lastName", label: "Last name", w: 40 },
  { key: "firstName", label: "First name", w: 40 },
  { key: "house", label: "House number", w: 36 },
  { key: "street", label: "Street name", w: 40 },
  { key: "unit", label: "Unit", w: 32 },
  { key: "place", label: "Town, state and zip", w: 40 },
  { key: "phone", label: "Phone number", w: 40 },
  { key: "areaPrinted", label: "Area as printed", w: 40 },
];
const LETTERS = "ABCDEFGHIJ";
/** The Download menu closes once a file is chosen. */
const closeMenu = (e: React.MouseEvent<HTMLElement>) => {
  const d = e.currentTarget.closest("details");
  if (d) window.setTimeout(() => d.removeAttribute("open"), 0);
};
const ROW_H = 38;
const CELL_PAD = 12; // a small even trim on both sides of the words (Abraham, Nov 24, 2026)
const MAX_W = 300;

/**
 * Each column exactly as wide as its longest text (Abraham, Nov 24, 2026); a title that does not fit goes small on two
 * lines. Measured with the page's own font.
 */
function measureWidths(rows: SheetRow[], font: string): Record<SheetKey, number> {
  const out = {} as Record<SheetKey, number>;
  const ctx = typeof document !== "undefined" ? document.createElement("canvas").getContext("2d") : null;
  for (const c of COLS) {
    let w = c.w;
    if (ctx) {
      // the longest title word in small bold, then the widest values (the 30 longest by letters are measured)
      ctx.font = `700 11px ${font}`;
      for (const word of c.label.split(" ")) w = Math.max(w, ctx.measureText(word).width * 1.02 + CELL_PAD + 3);
      ctx.font = `${c.rtl ? 600 : 400} 13.5px ${font}`;
      const longest = rows.map((r) => r[c.key]).filter(Boolean).sort((a, b) => b.length - a.length).slice(0, 30);
      for (const v of longest) w = Math.max(w, ctx.measureText(v).width * 1.02 + CELL_PAD + 2);
    }
    out[c.key] = Math.ceil(Math.min(MAX_W, w));
  }
  return out;
}
const NAVY = "#123D73";

type Pos = { r: number; c: number };
type Status = { kind: "saving" | "saved" | "failed"; text: string } | null;
type Undo = { kind: "delete"; token: string; label: string } | { kind: "edit"; id: number; cells: Partial<Record<SheetKey, string>>; label: string };

export default function DirectorySheet({ streets }: { streets: string[] }) {
  const [rows, setRows] = useState<SheetRow[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Partial<Record<SheetKey, string>>>({});
  const [showFilters, setShowFilters] = useState(false);
  const [sort, setSort] = useState<{ key: SheetKey; dir: 1 | -1 } | null>(null);
  const [anchor, setAnchor] = useState<Pos | null>(null);
  const [focus, setFocus] = useState<Pos | null>(null);
  const [edit, setEdit] = useState<{ r: number; c: number; value: string } | null>(null);
  const [status, setStatus] = useState<Status>(null);
  const [undo, setUndo] = useState<Undo[]>([]);
  const [menu, setMenu] = useState<number | null>(null); // row id with its menu open
  const [fresh, setFresh] = useState<Set<number>>(new Set()); // rows added here: always shown
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(560);
  const [boxW, setBoxW] = useState(0);
  const [full, setFull] = useState(false); // full screen: the sheet covers the whole page
  const box = useRef<HTMLDivElement>(null);
  const editRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const load = () =>
      sheetRowsAction()
        .then((r) => {
          setRows(r);
          setFresh(new Set());
          setUndo([]); // undo steps belong to the old list
          setAnchor(null);
          setFocus(null);
        })
        .catch(() => setLoadError(true));
    void load();
    // "Load this list" replaced the whole directory: read it again (Nov 23, 2026)
    window.addEventListener("directory-reloaded", load);
    return () => window.removeEventListener("directory-reloaded", load);
  }, []);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    setHeight(el.clientHeight);
    setBoxW(el.clientWidth);
    setScrollTop(0);
    const ro = new ResizeObserver(() => (setHeight(el.clientHeight), setBoxW(el.clientWidth)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [rows === null, full]); // full screen draws the grid again in a new place
  useEffect(() => {
    if (edit) editRef.current?.focus();
  }, [edit?.r, edit?.c]);

  // What is shown: search, then the column filters, then the sort; rows added here always stay in view
  const view = useMemo(() => {
    if (!rows) return [] as SheetRow[];
    const q = search.trim().toLowerCase();
    const fs = Object.entries(filters).filter(([, v]) => v?.trim()) as [SheetKey, string][];
    // Phone numbers match by their digits however they are typed (Abraham, Nov 24, 2026): 8457, (845) 7, 845-7, +1 845 7
    let out = rows.filter((r) => fresh.has(r.id) || ((!q || COLS.some((c) => cellMatches(r[c.key], q))) && fs.every(([k, v]) => cellMatches(r[k], v))));
    if (sort) {
      const keep = out.filter((r) => fresh.has(r.id));
      out = out.filter((r) => !fresh.has(r.id)).sort((a, b) => sort.dir * a[sort.key].localeCompare(b[sort.key], undefined, { numeric: true, sensitivity: "base" }));
      out = [...out, ...keep];
    }
    return out;
  }, [rows, search, filters, sort, fresh]);

  // Measured only in the browser, after the first draw: the titles and the cells then always get the same widths
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const W0 = useMemo(() => (mounted ? measureWidths(rows ?? [], getComputedStyle(document.body).fontFamily || "Inter, Arial, sans-serif") : (Object.fromEntries(COLS.map((c) => [c.key, c.w])) as Record<SheetKey, number>)), [rows, mounted]);
  // The row-number column: just wide enough for the biggest row number (the three dots show over it when pointed at)
  // Row numbers: room for the biggest number and the three dots side by side
  const NUM_W = 34 + 7 * String(Math.max(rows?.length ?? 0, 99)).length;
  // Each column fits its words; whatever room is left in the box is shared evenly by the ten columns (Nov 24, 2026)
  const natural = NUM_W + COLS.reduce((n, c) => n + W0[c.key], 0);
  const spare = Math.max(0, Math.floor(boxW - natural));
  const extra = Math.floor(spare / COLS.length);
  const rest = spare - extra * COLS.length; // the last few pixels: one more each for the first columns, so the sheet ends at the edge
  const W = useMemo(() => Object.fromEntries(COLS.map((c, i) => [c.key, W0[c.key] + extra + (i < rest ? 1 : 0)])) as Record<SheetKey, number>, [W0, extra, rest]);
  const TOTAL_W = NUM_W + COLS.reduce((n, c) => n + W[c.key], 0);
  useEffect(() => {
    if (!full) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const esc = (e: KeyboardEvent) => e.key === "Escape" && !editRef.current && setFull(false);
    window.addEventListener("keydown", esc);
    return () => ((document.body.style.overflow = prev), window.removeEventListener("keydown", esc));
  }, [full]);

  const sel = anchor && focus ? { r0: Math.min(anchor.r, focus.r), r1: Math.max(anchor.r, focus.r), c0: Math.min(anchor.c, focus.c), c1: Math.max(anchor.c, focus.c) } : null;
  const inSel = (r: number, c: number) => !!sel && r >= sel.r0 && r <= sel.r1 && c >= sel.c0 && c <= sel.c1;

  const say = (s: Status) => {
    setStatus(s);
    if (s?.kind === "saved") window.setTimeout(() => setStatus((x) => (x === s ? null : x)), 2500);
  };
  const putRow = (row: SheetRow) => setRows((rs) => rs?.map((r) => (r.id === row.id ? row : r)) ?? rs);

  /** Save cells of one row: optimistic, the old values come back on failure. Asks first for a shared phone. */
  const saveRow = useCallback(async (id: number, cells: Partial<Record<SheetKey, string>>, opts: { recordUndo?: boolean } = {}) => {
    const before = rows?.find((r) => r.id === id);
    if (!before) return false;
    const changed = Object.fromEntries(Object.entries(cells).filter(([k, v]) => before[k as SheetKey] !== v)) as Partial<Record<SheetKey, string>>;
    if (!Object.keys(changed).length) return true;
    const old = Object.fromEntries(Object.keys(changed).map((k) => [k, before[k as SheetKey]])) as Partial<Record<SheetKey, string>>;
    putRow({ ...before, ...changed });
    say({ kind: "saving", text: "Saving..." });
    let r = await saveCellsAction(id, changed).catch(() => ({ ok: false as const }));
    if (!r.ok && "sharedWith" in r && r.sharedWith?.length) {
      const yes = window.confirm(`This phone number is already in the directory:\n\n${r.sharedWith.join("\n")}\n\nIf you save, it becomes a shared number, and every order from it alerts you the same way as the other shared numbers. Save anyway?`);
      r = yes ? await saveCellsAction(id, changed, true).catch(() => ({ ok: false as const })) : { ok: false as const };
      if (!yes) {
        putRow(before);
        say({ kind: "failed", text: "Not saved. The phone number was left as it was." });
        return false;
      }
    }
    if (r.ok && "row" in r && r.row) {
      putRow(r.row);
      if (opts.recordUndo !== false) setUndo((u) => [...u.slice(-49), { kind: "edit", id, cells: old, label: "the last change" }]);
      say({ kind: "saved", text: "Saved" });
      return true;
    }
    putRow(before);
    say({ kind: "failed", text: "error" in r && r.error ? `Not saved. ${r.error}` : "Not saved. Please try again." });
    return false;
  }, [rows]);

  const commitEdit = async (move: Pos | null) => {
    if (!edit) return;
    const row = view[edit.r];
    const col = COLS[edit.c];
    setEdit(null);
    if (move) {
      setAnchor(move);
      setFocus(move);
    }
    box.current?.focus();
    if (row) await saveRow(row.id, { [col.key]: edit.value });
  };

  const startEdit = (p: Pos, initial?: string) => {
    const row = view[p.r];
    if (!row) return;
    setMenu(null);
    setEdit({ r: p.r, c: p.c, value: initial ?? row[COLS[p.c].key] });
  };

  const scrollTo = (r: number) => {
    const el = box.current;
    if (!el) return;
    const head = ROW_H * (showFilters ? 2 : 1) + 22; // the frozen header
    const top = head + r * ROW_H;
    if (top < el.scrollTop + head) el.scrollTop = r * ROW_H;
    else if (top + ROW_H > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW_H - el.clientHeight;
  };
  const move = (dr: number, dc: number, extend: boolean) => {
    const f = focus ?? { r: 0, c: 0 };
    const p = { r: Math.max(0, Math.min(view.length - 1, f.r + dr)), c: Math.max(0, Math.min(COLS.length - 1, f.c + dc)) };
    setFocus(p);
    if (!extend) setAnchor(p);
    scrollTo(p.r);
  };

  const addRow = async (where: { at: "end" } | { at: "above" | "below"; id: number }) => {
    setMenu(null);
    if (where.at !== "end" && sort) return say({ kind: "failed", text: "Not saved. Turn off the sort first, to insert a row in its place." });
    say({ kind: "saving", text: "Saving..." });
    const r = await insertRowAction(where).catch(() => ({ ok: false as const }));
    if (!r.ok || !("row" in r) || !r.row) return say({ kind: "failed", text: "Not saved. Please try again." });
    const row = r.row;
    setFresh((s) => new Set(s).add(row.id));
    setRows((rs) => {
      if (!rs) return rs;
      if (where.at === "end") return [...rs, row];
      const i = rs.findIndex((x) => x.id === where.id);
      const at = where.at === "above" ? i : i + 1;
      return [...rs.slice(0, at), row, ...rs.slice(at)];
    });
    say({ kind: "saved", text: "Saved" });
    setPendingSelect(row.id); // then the new row's Last name cell is picked, ready to type
  };
  const [pendingSelect, setPendingSelect] = useState<number | null>(null);
  useEffect(() => {
    if (pendingSelect === null) return;
    const r = view.findIndex((x) => x.id === pendingSelect);
    if (r >= 0) {
      setAnchor({ r, c: 2 });
      setFocus({ r, c: 2 });
      scrollTo(r);
      box.current?.focus();
    }
    setPendingSelect(null);
  }, [pendingSelect, view]);

  const removeRow = async (id: number) => {
    setMenu(null);
    const row = rows?.find((r) => r.id === id);
    if (!row) return;
    const at = rows!.findIndex((r) => r.id === id);
    setRows((rs) => rs?.filter((r) => r.id !== id) ?? rs);
    say({ kind: "saving", text: "Saving..." });
    const r = await deleteRowAction(id).catch(() => ({ ok: false as const }));
    if (!r.ok || !("undo" in r) || !r.undo) {
      setRows((rs) => (rs ? [...rs.slice(0, at), row, ...rs.slice(at)] : rs));
      return say({ kind: "failed", text: "Not saved. Please try again." });
    }
    setUndo((u) => [...u.slice(-49), { kind: "delete", token: r.undo!, label: `the deleted row (${row.lastName || row.yiddishLastName || "empty row"})` }]);
    say({ kind: "saved", text: "Saved. Row deleted. To bring it back, press Undo." });
  };

  const doUndo = async () => {
    const last = undo[undo.length - 1];
    if (!last) return;
    setUndo((u) => u.slice(0, -1));
    if (last.kind === "edit") {
      await saveRow(last.id, last.cells, { recordUndo: false });
      return;
    }
    say({ kind: "saving", text: "Saving..." });
    const r = await undoDeleteAction(last.token).catch(() => ({ ok: false as const }));
    if (!r.ok || !("row" in r) || !r.row) {
      setUndo((u) => [...u, last]);
      return say({ kind: "failed", text: "Not saved. Please try again." });
    }
    // Put it back in its place (by the saved row order)
    const fresh = await sheetRowsAction().catch(() => null);
    if (fresh) setRows(fresh);
    say({ kind: "saved", text: "Saved. The row is back." });
  };

  // Copy: the picked cells as tab-separated text (pastes into Excel or Google Sheets, and back here)
  const onCopy = (e: React.ClipboardEvent) => {
    if (edit || !sel) return;
    const lines: string[] = [];
    for (let r = sel.r0; r <= sel.r1; r++) {
      const row = view[r];
      if (row) lines.push(COLS.slice(sel.c0, sel.c1 + 1).map((c) => row[c.key].replace(/[\t\n]/g, " ")).join("\t"));
    }
    e.clipboardData.setData("text/plain", lines.join("\n"));
    e.preventDefault();
    say({ kind: "saved", text: `Copied ${lines.length === 1 ? "1 row" : `${lines.length} rows`}` });
  };
  // Paste: from the picked cell, right and down; rows past the end are added at the end
  const onPaste = async (e: React.ClipboardEvent) => {
    if (edit || !sel) return;
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain").replace(/\r/g, "").replace(/\n$/, "");
    if (!text) return;
    const grid = text.split("\n").map((l) => l.split("\t"));
    const single = grid.length === 1 && grid[0].length === 1;
    // One value into a bigger selection fills every picked cell
    const targetRows = single ? sel.r1 - sel.r0 + 1 : grid.length;
    let ok = true;
    for (let i = 0; i < targetRows; i++) {
      let row = view[sel.r0 + i];
      if (!row) {
        const r = await insertRowAction({ at: "end" }).catch(() => ({ ok: false as const }));
        if (!r.ok || !("row" in r) || !r.row) return say({ kind: "failed", text: "Not saved. Please try again." });
        row = r.row;
        setFresh((s) => new Set(s).add(row!.id));
        setRows((rs) => (rs ? [...rs, row!] : rs));
      }
      const vals = single ? Array(sel.c1 - sel.c0 + 1).fill(grid[0][0]) : grid[i];
      const cells: Partial<Record<SheetKey, string>> = {};
      vals.forEach((v, j) => {
        const c = COLS[sel.c0 + j];
        if (c) cells[c.key] = v;
      });
      ok = (await saveRowFresh(row, cells)) && ok;
    }
    if (ok) say({ kind: "saved", text: "Saved" });
  };
  // saveRow reads `rows` from its closure; a row added during a paste is passed in directly
  const saveRowFresh = async (row: SheetRow, cells: Partial<Record<SheetKey, string>>) => {
    say({ kind: "saving", text: "Saving..." });
    const old = Object.fromEntries(Object.keys(cells).map((k) => [k, row[k as SheetKey]])) as Partial<Record<SheetKey, string>>;
    putRow({ ...row, ...cells });
    let r = await saveCellsAction(row.id, cells).catch(() => ({ ok: false as const }));
    if (!r.ok && "sharedWith" in r && r.sharedWith?.length) {
      const yes = window.confirm(`This phone number is already in the directory:\n\n${r.sharedWith.join("\n")}\n\nIf you save, it becomes a shared number. Save anyway?`);
      r = yes ? await saveCellsAction(row.id, cells, true).catch(() => ({ ok: false as const })) : { ok: false as const };
    }
    if (r.ok && "row" in r && r.row) {
      putRow(r.row);
      setUndo((u) => [...u.slice(-49), { kind: "edit", id: row.id, cells: old, label: "the paste" }]);
      return true;
    }
    putRow(row);
    say({ kind: "failed", text: "error" in r && r.error ? `Not saved. ${r.error}` : "Not saved. Please try again." });
    return false;
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (edit) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === "z") {
      e.preventDefault();
      void doUndo();
      return;
    }
    if (!focus) return;
    const k = e.key;
    if (k === "ArrowDown") return e.preventDefault(), move(1, 0, e.shiftKey);
    if (k === "ArrowUp") return e.preventDefault(), move(-1, 0, e.shiftKey);
    if (k === "ArrowRight") return e.preventDefault(), move(0, COLS[focus.c].rtl ? -1 : 1, e.shiftKey);
    if (k === "ArrowLeft") return e.preventDefault(), move(0, COLS[focus.c].rtl ? 1 : -1, e.shiftKey);
    if (k === "Tab") return e.preventDefault(), move(0, e.shiftKey ? -1 : 1, false);
    if (k === "Enter" || k === "F2") return e.preventDefault(), startEdit(focus);
    if ((k === "Delete" || k === "Backspace") && sel) {
      e.preventDefault();
      for (let r = sel.r0; r <= sel.r1; r++) {
        const row = view[r];
        if (row) void saveRow(row.id, Object.fromEntries(COLS.slice(sel.c0, sel.c1 + 1).map((c) => [c.key, ""])));
      }
      return;
    }
    if (k.length === 1 && !mod && !e.altKey) {
      e.preventDefault();
      startEdit(focus, k);
    }
  };

  if (loadError) return <p className="rounded-xl bg-[#ffe6e4] p-4 text-sm font-bold text-[#b3261e]">The list did not open. Please reload the page.</p>;

  const headH = ROW_H + (showFilters ? ROW_H : 0) + 22;
  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - 12);
  const last = Math.min(view.length, Math.ceil((scrollTop + height) / ROW_H) + 12);
  const filtered = search.trim() || Object.values(filters).some((v) => v?.trim());
  const lastUndo = undo[undo.length - 1];

  const sheet = (
    <section className={full ? "fixed inset-0 z-[1000] flex flex-col bg-white" : "overflow-hidden rounded-2xl border border-[#D9E3F0] bg-white shadow-[0_6px_24px_rgba(18,61,115,0.08)]"} data-directory-sheet data-full={full ? "1" : undefined}>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[#E6EDF6] bg-gradient-to-r from-[#F6F9FD] to-white px-4 py-3">
        <div className="relative min-w-[220px] flex-1">
          <svg aria-hidden viewBox="0 0 24 24" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6B7C93]" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search every column" aria-label="Search" className="w-full rounded-xl border border-[#D9E3F0] bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-[#2585D8] focus:ring-2 focus:ring-[#2585D8]/20" data-sheet-search />
        </div>
        <button type="button" onClick={() => setShowFilters((v) => !v)} className={`rounded-xl border px-3 py-2 text-sm font-bold ${showFilters ? "border-[#123D73] bg-[#123D73] text-white" : "border-[#D9E3F0] bg-white text-[#123D73]"}`} data-sheet-filters>
          Filter
        </button>
        {(filtered || sort) && (
          <button type="button" onClick={() => (setSearch(""), setFilters({}), setSort(null))} className="rounded-xl border border-[#D9E3F0] bg-white px-3 py-2 text-sm font-bold text-[#123D73]">
            Clear search, filter and sort
          </button>
        )}
        <button type="button" onClick={() => addRow({ at: "end" })} className="rounded-xl bg-[#123D73] px-3 py-2 text-sm font-bold text-white hover:bg-[#0E3160]" data-sheet-add>
          + Add a row at the end
        </button>
        <button type="button" onClick={() => void doUndo()} disabled={!lastUndo} title={lastUndo ? `Undo ${lastUndo.label}` : "Nothing to undo"} className="rounded-xl border border-[#D9E3F0] bg-white px-3 py-2 text-sm font-bold text-[#123D73] disabled:opacity-40" data-sheet-undo>
          Undo
        </button>
        <button
          type="button"
          onClick={() => setFull((f) => !f)}
          title={full ? "Back to the page (Esc)" : "Open the sheet on the full screen"}
          className="flex items-center gap-1.5 rounded-xl border border-[#123D73] bg-white px-3 py-2 text-sm font-bold text-[#123D73] hover:bg-[#F2F6FB]"
          data-sheet-full
        >
          <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            {full ? <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" /> : <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />}
          </svg>
          {full ? "Exit full screen" : "Full screen"}
        </button>
        <details className="relative">
          <summary className="cursor-pointer list-none rounded-xl border border-[#D9E3F0] bg-white px-3 py-2 text-sm font-bold text-[#123D73]" data-sheet-download>
            Download
          </summary>
          <div className="absolute right-0 z-40 mt-2 w-56 overflow-hidden rounded-xl border border-[#D9E3F0] bg-white shadow-lg">
            <a href="/api/admin/directory/export?format=xlsx" onClick={closeMenu} className="block px-4 py-3 text-sm font-bold text-[#123D73] hover:bg-[#F2F6FB]" data-download-xlsx>Excel file (.xlsx)</a>
            <a href="/api/admin/directory/export?format=csv" onClick={closeMenu} className="block border-t border-[#EEF2F7] px-4 py-3 text-sm font-bold text-[#123D73] hover:bg-[#F2F6FB]" data-download-csv>CSV file (.csv)</a>
          </div>
        </details>
      </div>

      {/* Count and save status */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-xs text-[#5A6B82]">
        <span data-sheet-count>
          {rows ? (
            <>
              <b className="text-[#123D73]">{rows.length.toLocaleString()}</b> rows{filtered ? <> · showing <b className="text-[#123D73]">{view.length.toLocaleString()}</b></> : null}
              {sort ? <> · sorted by {COLS.find((c) => c.key === sort.key)?.label} {sort.dir === 1 ? "A to Z" : "Z to A"}</> : null}
            </>
          ) : (
            "Opening the list..."
          )}
        </span>
        <span aria-live="polite" className="min-h-[26px]">
          {status && (
            <span role="status" data-save-result={status.kind === "failed" ? "failed" : status.kind === "saved" ? "saved" : "saving"} className={`inline-block rounded-full px-3 py-1 text-xs font-bold ${status.kind === "failed" ? "bg-[#ffe6e4] text-[#b3261e]" : status.kind === "saved" ? "bg-[#E3F8EF] text-[#13895C]" : "bg-[#EEF4FB] text-[#123D73]"}`}>
              {status.text}
            </span>
          )}
        </span>
      </div>

      {/* The grid */}
      <div
        ref={box}
        tabIndex={0}
        role="grid"
        aria-rowcount={view.length}
        aria-colcount={COLS.length}
        onScroll={(e) => setScrollTop(Math.max(0, e.currentTarget.scrollTop - headH))}
        onKeyDown={onKeyDown}
        onCopy={onCopy}
        onPaste={onPaste}
        className={`relative overflow-auto border-t border-[#E6EDF6] outline-none ${full ? "min-h-0 flex-1" : "h-[68vh] min-h-[420px]"}`}
        data-sheet-grid
      >
        <div style={{ width: TOTAL_W }} className="relative">
          {/* Frozen header: column letters, names (click to sort), filters */}
          <div className="sticky top-0 z-30" style={{ width: TOTAL_W }}>
            <div className="flex bg-[#0E3160] text-[10px] font-bold tracking-widest text-[#9FB6D6]" style={{ height: 22 }}>
              <div className="sticky left-0 z-10 shrink-0 bg-[#0E3160]" style={{ width: NUM_W }} />
              {COLS.map((c, i) => (
                <div key={c.key} style={{ width: W[c.key] }} className="flex shrink-0 items-center justify-center border-l border-white/10">{LETTERS[i]}</div>
              ))}
            </div>
            <div className="flex" style={{ height: ROW_H, background: NAVY }} role="row">
              <div className="sticky left-0 z-10 flex shrink-0 items-center justify-center text-[11px] font-bold text-[#9FB6D6]" style={{ width: NUM_W, background: NAVY }}>
                #
              </div>
              {COLS.map((c) => {
                const on = sort?.key === c.key;
                return (
                  <button
                    key={c.key}
                    type="button"
                    role="columnheader"
                    aria-sort={on ? (sort!.dir === 1 ? "ascending" : "descending") : "none"}
                    title="Click to sort"
                    onClick={() => setSort((s) => (s?.key !== c.key ? { key: c.key, dir: 1 } : s.dir === 1 ? { key: c.key, dir: -1 } : null))}
                    style={{ width: W[c.key] }}
                    className={`relative flex shrink-0 items-center overflow-hidden border-l border-white/10 px-[6px] text-left text-[11px] font-bold leading-[1.15] text-white hover:bg-white/10 ${c.rtl ? "justify-end text-right" : ""}`}
                    data-sort={c.key}
                  >
                    <span className="line-clamp-2 break-words">{c.label}</span>
                    {on && <span className="absolute right-[2px] top-[1px] text-[9px] leading-none text-[#FFD84D]">{sort!.dir === -1 ? "▼" : "▲"}</span>}
                  </button>
                );
              })}
            </div>
            {showFilters && (
              <div className="flex border-b border-[#D9E3F0] bg-[#F2F6FB]" style={{ height: ROW_H }}>
                <div className="sticky left-0 z-10 flex shrink-0 items-center justify-center bg-[#F2F6FB] text-[10px] font-bold uppercase text-[#6B7C93]" style={{ width: NUM_W }}>
                  Filter
                </div>
                {COLS.map((c) => (
                  <div key={c.key} style={{ width: W[c.key] }} className="shrink-0 border-l border-[#E1E8F2] p-1">
                    <input
                      dir={c.rtl ? "rtl" : "ltr"}
                      value={filters[c.key] ?? ""}
                      onChange={(e) => setFilters((f) => ({ ...f, [c.key]: e.target.value }))}
                      placeholder="contains..."
                      aria-label={`Filter ${c.label}`}
                      className="h-full w-full rounded-md border border-[#D9E3F0] bg-white px-2 text-xs outline-none focus:border-[#2585D8]"
                      data-filter={c.key}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Rows (only the ones on screen are drawn) */}
          <div style={{ height: view.length * ROW_H }} className="relative">
            {view.slice(first, last).map((row, k) => {
              const r = first + k;
              const rowSel = !!sel && r >= sel.r0 && r <= sel.r1;
              return (
                <div key={row.id} role="row" className={`group absolute left-0 flex ${r % 2 ? "bg-[#FAFCFE]" : "bg-white"} hover:bg-[#F2F7FD]`} style={{ top: r * ROW_H, height: ROW_H, width: TOTAL_W }} data-row-id={row.id}>
                  <div
                    className={`sticky left-0 z-20 flex shrink-0 items-center border-b border-r border-[#E6EDF6] pl-[7px] text-[11px] tabular-nums ${rowSel ? "bg-[#DCEAFB] font-bold text-[#123D73]" : "bg-[#F6F9FD] text-[#8395AD]"}`}
                    style={{ width: NUM_W }}
                  >
                    <button
                      type="button"
                      title="Pick the whole row"
                      onClick={(e) => {
                        const p = { r, c: 0 };
                        if (e.shiftKey && anchor) setFocus({ r, c: COLS.length - 1 });
                        else (setAnchor(p), setFocus({ r, c: COLS.length - 1 }));
                        box.current?.focus();
                      }}
                      className="h-full flex-1 text-left"
                      data-row-pick={row.id}
                    >
                      {r + 1}
                    </button>
                    <button type="button" aria-label="Row options" title="Row options" onClick={() => setMenu((m) => (m === row.id ? null : row.id))} className="absolute right-[3px] top-1/2 -translate-y-1/2 rounded-md bg-white px-[4px] py-[2px] text-base leading-none text-[#123D73] opacity-0 shadow-sm ring-1 ring-[#D9E3F0] group-hover:opacity-100 focus:opacity-100" data-row-menu={row.id}>
                      ⋮
                    </button>
                    {menu === row.id && (
                      <div className="absolute left-full top-1 z-50 ml-1 w-48 overflow-hidden rounded-xl border border-[#D9E3F0] bg-white text-[13px] shadow-xl" role="menu">
                        <button type="button" role="menuitem" onClick={() => addRow({ at: "above", id: row.id })} className="block w-full px-3 py-2 text-left font-bold text-[#123D73] hover:bg-[#F2F6FB]" data-insert-above>Insert a row above</button>
                        <button type="button" role="menuitem" onClick={() => addRow({ at: "below", id: row.id })} className="block w-full border-t border-[#EEF2F7] px-3 py-2 text-left font-bold text-[#123D73] hover:bg-[#F2F6FB]" data-insert-below>Insert a row below</button>
                        <button type="button" role="menuitem" onClick={() => removeRow(row.id)} className="block w-full border-t border-[#EEF2F7] px-3 py-2 text-left font-bold text-[#b3261e] hover:bg-[#fff2f1]" data-delete-row>Delete this row</button>
                      </div>
                    )}
                  </div>
                  {COLS.map((c, ci) => {
                    const editing = edit && edit.r === r && edit.c === ci;
                    const picked = inSel(r, ci);
                    const isFocus = focus?.r === r && focus?.c === ci;
                    return (
                      <div
                        key={c.key}
                        role="gridcell"
                        dir={c.rtl ? "rtl" : "ltr"}
                        onMouseDown={(e) => {
                          if (editing) return;
                          e.preventDefault();
                          box.current?.focus();
                          setMenu(null);
                          if (edit) void commitEdit(null);
                          const p = { r, c: ci };
                          if (e.shiftKey && anchor) setFocus(p);
                          else if (isFocus && !e.shiftKey && sel && sel.r0 === sel.r1 && sel.c0 === sel.c1) startEdit(p);
                          else (setAnchor(p), setFocus(p));
                        }}
                        onDoubleClick={() => startEdit({ r, c: ci })}
                        style={{ width: W[c.key] }}
                        className={`relative flex shrink-0 items-center overflow-hidden border-b border-r border-[#EDF1F7] px-[6px] text-[13.5px] ${c.rtl ? "text-right font-[600]" : ""} ${picked ? "bg-[#E8F1FC]" : ""} ${isFocus && !editing ? "z-10 outline outline-2 -outline-offset-1 outline-[#2585D8]" : ""} text-[#1B2B41]`}
                        data-cell={`${row.id}:${c.key}`}
                      >
                        {editing ? (
                          <input
                            ref={editRef}
                            dir={c.rtl ? "rtl" : "ltr"}
                            value={edit.value}
                            list={c.key === "street" ? "sheet-streets" : undefined}
                            onChange={(e) => setEdit({ ...edit, value: e.target.value })}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") (e.preventDefault(), void commitEdit({ r: Math.min(view.length - 1, r + 1), c: ci }));
                              else if (e.key === "Tab") (e.preventDefault(), void commitEdit({ r, c: Math.min(COLS.length - 1, ci + (e.shiftKey ? -1 : 1)) }));
                              else if (e.key === "Escape") (e.preventDefault(), setEdit(null), box.current?.focus());
                            }}
                            onBlur={() => void commitEdit(null)}
                            className="absolute inset-0 z-20 w-full min-w-[160px] rounded-[3px] border-2 border-[#2585D8] bg-white px-[7px] text-[13.5px] shadow-[0_4px_14px_rgba(37,133,216,0.25)] outline-none"
                            data-cell-editor
                          />
                        ) : (
                          <span className="truncate">{row[c.key]}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
            {rows && !view.length && <p className="sticky left-0 p-6 text-sm text-[#5A6B82]">No rows match. Clear the search or the filter to see the whole list.</p>}
          </div>
        </div>
        <datalist id="sheet-streets">{streets.map((s) => <option key={s} value={s} />)}</datalist>
      </div>
    </section>
  );
  // Full screen: drawn on the page itself, above the side menu and everything else
  return full && typeof document !== "undefined" ? createPortal(sheet, document.body) : sheet;
}
