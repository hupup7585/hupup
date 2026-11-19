import Link from "next/link";
import { AlarmClock, Archive, BookOpen, Bookmark, ChevronDown, Menu, ChevronUp, Clock, File, Inbox, Mail, OctagonAlert, Pencil, Send, SlidersHorizontal, Star, Tag, Tags, Trash2 } from "lucide-react";
import { FOLDERS, LABEL_COLORS, WITHIN, folderCounts, listLabels, type Folder, type MailFilters } from "@/lib/inbox-folders";
import { createLabelAction, removeLabelAction } from "./actions";

const ICON: Record<Folder, typeof Inbox> = { catalog: BookOpen, inbox: Inbox, starred: Star, snoozed: AlarmClock, sent: Send, drafts: File, important: Bookmark, scheduled: Clock, all: Mail, archive: Archive, spam: OctagonAlert, trash: Trash2 };

/** Filter chips under the search bar, like Gmail (Abraham, Nov 19, 2026). Each chip is a link that keeps the others. */
function Chips({ base, f }: { base: Record<string, string>; f: MailFilters }) {
  const href = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...base, ...patch })) if (v) p.set(k, v);
    return `/admin/inbox?${p.toString()}`;
  };
  const chip = (on: boolean) => `inline-flex items-center gap-1 rounded-lg border px-3 py-1 text-sm ${on ? "border-navy bg-[#D3E7F8] font-semibold text-navy" : "border-line bg-white hover:bg-bg"}`;
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2" data-mail-chips>
      <details className="relative">
        <summary className={`${chip(Boolean(f.from))} cursor-pointer list-none`}>{f.from ? `From: ${f.from}` : "From"} <ChevronDown className="h-3.5 w-3.5" aria-hidden /></summary>
        <form action="/admin/inbox" className="absolute z-20 mt-1 flex w-72 gap-1 rounded-xl border border-line bg-white p-2 shadow-lg">
          {Object.entries(base).filter(([k]) => k !== "from").map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          <input name="from" defaultValue={f.from ?? ""} className="input !py-1 text-sm" placeholder="Name or email address" aria-label="From" />
          <button className="btn-dark !py-1 text-sm">Go</button>
        </form>
      </details>
      <details className="relative">
        <summary className={`${chip(Boolean(f.within))} cursor-pointer list-none`}>{WITHIN.find((w) => w.key === f.within)?.title ?? "Any time"} <ChevronDown className="h-3.5 w-3.5" aria-hidden /></summary>
        <div className="absolute z-20 mt-1 w-44 rounded-xl border border-line bg-white py-1 shadow-lg">
          <Link href={href({ within: undefined })} className="block px-3 py-1.5 text-sm hover:bg-bg">Any time</Link>
          {WITHIN.map((w) => <Link key={w.key} href={href({ within: w.key })} className="block px-3 py-1.5 text-sm hover:bg-bg">{w.title}</Link>)}
        </div>
      </details>
      <Link href={href({ attach: f.attach ? undefined : "1" })} className={chip(Boolean(f.attach))} data-chip="attach">Has attachment</Link>
      <details className="relative">
        <summary className={`${chip(Boolean(f.to))} cursor-pointer list-none`}>{f.to ? `To: ${f.to}` : "To"} <ChevronDown className="h-3.5 w-3.5" aria-hidden /></summary>
        <form action="/admin/inbox" className="absolute z-20 mt-1 flex w-72 gap-1 rounded-xl border border-line bg-white p-2 shadow-lg">
          {Object.entries(base).filter(([k]) => k !== "to").map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          <input name="to" defaultValue={f.to ?? ""} className="input !py-1 text-sm" placeholder="Email address" aria-label="To" />
          <button className="btn-dark !py-1 text-sm">Go</button>
        </form>
      </details>
      <Link href={href({ unread: f.unread ? undefined : "1" })} className={chip(Boolean(f.unread))} data-chip="unread">Is unread</Link>
      <details className="relative" data-advanced-search>
        <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-lg px-3 py-1 text-sm font-semibold text-navy hover:bg-[#D3E7F8]">Advanced search</summary>
        <AdvancedSearch base={base} f={f} />
      </details>
    </div>
  );
}

/** Gmail's search options panel: From, To, Subject, Has the words, Doesn't have, Date within, Has attachment. */
function AdvancedSearch({ base, f }: { base: Record<string, string>; f: MailFilters }) {
  const row = "grid grid-cols-[110px_1fr] items-center gap-2 text-sm";
  return (
    <form action="/admin/inbox" className="absolute z-20 mt-1 grid w-[min(92vw,30rem)] gap-2 rounded-xl border border-line bg-white p-4 shadow-xl">
      {base.f && <input type="hidden" name="f" value={base.f} />}
      {base.label && <input type="hidden" name="label" value={base.label} />}
      <label className={row}><span>From</span><input name="from" defaultValue={f.from ?? ""} className="input !py-1" /></label>
      <label className={row}><span>To</span><input name="to" defaultValue={f.to ?? ""} className="input !py-1" /></label>
      <label className={row}><span>Subject</span><input name="subject" defaultValue={f.subject ?? ""} className="input !py-1" /></label>
      <label className={row}><span>Has the words</span><input name="has" defaultValue={f.has ?? ""} className="input !py-1" /></label>
      <label className={row}><span>Doesn&rsquo;t have</span><input name="not" defaultValue={f.not ?? ""} className="input !py-1" /></label>
      <label className={row}>
        <span>Date within</span>
        <select name="within" defaultValue={f.within ?? ""} className="input !py-1">
          <option value="">Any time</option>
          {WITHIN.map((w) => <option key={w.key} value={w.key}>{w.title}</option>)}
        </select>
      </label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="attach" value="1" defaultChecked={f.attach} /> Has attachment</label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="unread" value="1" defaultChecked={f.unread} /> Is unread</label>
      <div className="flex justify-end gap-2">
        <Link href="/admin/inbox" className="btn-ghost !py-1 text-sm">Clear</Link>
        <button className="btn-dark !py-1 text-sm">Search</button>
      </div>
    </form>
  );
}

/** The Gmail-style frame, full width: search with chips, Compose, folders with counts (More / Less), labels. */
export default async function MailShell({ folder, label, q, filters, children }: { folder?: Folder; label?: string; q?: string; filters?: MailFilters; children: React.ReactNode }) {
  const [counts, labels] = await Promise.all([folderCounts(), listLabels()]);
  const f: MailFilters = { ...(filters ?? {}), q: filters?.q ?? q };
  const base: Record<string, string> = {};
  if (folder && folder !== "inbox") base.f = folder;
  if (label) base.label = label;
  for (const [k, v] of Object.entries({ q: f.q, from: f.from, to: f.to, subject: f.subject, has: f.has, not: f.not, within: f.within, attach: f.attach ? "1" : "", unread: f.unread ? "1" : "", sort: f.sort })) if (v) base[k] = String(v);
  const count: Partial<Record<Folder, number>> = { catalog: counts.catalog, inbox: counts.inbox, drafts: counts.drafts, scheduled: counts.scheduled, spam: counts.spam, snoozed: counts.snoozed };
  const moreOpen = FOLDERS.some((x) => "more" in x && x.key === folder);
  const link = (k: Folder) => (k === "inbox" ? "/admin/inbox" : `/admin/inbox?f=${k}`);
  const item = (x: (typeof FOLDERS)[number]) => {
    const Icon = ICON[x.key];
    const on = folder === x.key && !label;
    const n = count[x.key] ?? 0;
    return (
      <Link
        key={x.key}
        href={link(x.key)}
        className={`flex shrink-0 items-center gap-3 rounded-r-full px-4 py-1.5 text-sm ${on ? "bg-[#D3E7F8] font-bold text-navy" : "hover:bg-bg"} ${n && (x.key === "inbox" || x.key === "spam") ? "font-bold" : ""}`}
        data-folder={x.key}
        aria-current={on ? "page" : undefined}
      >
        <Icon className="h-4 w-4" aria-hidden />
        <span className="flex-1">{x.label}</span>
        {n > 0 && <span className="text-xs">{n}</span>}
      </Link>
    );
  };
  return (
    <div className="w-full" data-mail-shell>
      {/* Phone (like the Gmail app): a menu button opens the folders; Compose is a round button at the bottom */}
      <details className="relative mb-2 lg:hidden" data-mail-menu>
        <summary className="inline-flex cursor-pointer list-none items-center gap-2 rounded-full px-3 py-2 text-sm font-semibold hover:bg-bg" aria-label="Folders">
          <Menu className="h-5 w-5" aria-hidden /> {FOLDERS.find((x) => x.key === folder)?.label ?? label ?? "Inbox"}
        </summary>
        <nav className="absolute left-0 z-40 mt-1 w-72 rounded-2xl border border-line bg-white py-2 shadow-xl" aria-label="Mail folders">
          {FOLDERS.map(item)}
          <Link href="/admin/inbox/labels" className="flex items-center gap-3 rounded-r-full px-4 py-1.5 text-sm hover:bg-bg"><Tags className="h-4 w-4" aria-hidden /> Manage labels</Link>
          {labels.map((l) => (
            <Link key={l.id} href={`/admin/inbox?f=all&label=${encodeURIComponent(l.name)}`} className="flex items-center gap-3 rounded-r-full px-4 py-1.5 text-sm hover:bg-bg">
              <Tag className="h-4 w-4" style={{ color: l.color }} aria-hidden /> {l.name}
            </Link>
          ))}
        </nav>
      </details>
      <Link href="/admin/inbox/new" className="fixed bottom-5 right-5 z-40 inline-flex items-center gap-2 rounded-2xl bg-[#C2E7FF] px-5 py-4 font-bold text-navy shadow-lg lg:hidden" data-compose-phone>
        <Pencil className="h-5 w-5" aria-hidden /> Compose
      </Link>
      <form action="/admin/inbox" className="mb-2 flex items-center gap-2" role="search">
        {folder && folder !== "inbox" && <input type="hidden" name="f" value={folder} />}
        {label && <input type="hidden" name="label" value={label} />}
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-full bg-[#EAF1FB] px-4 focus-within:bg-white focus-within:shadow">
          <input name="q" defaultValue={f.q ?? ""} className="min-w-0 flex-1 bg-transparent py-2.5 outline-none" placeholder="Search mail" aria-label="Search mail" data-mail-search />
          {f.q && <Link href={folder && folder !== "inbox" ? `/admin/inbox?f=${folder}` : "/admin/inbox"} className="text-lg text-muted" aria-label="Clear search">×</Link>}
          <SlidersHorizontal className="h-4 w-4 text-muted" aria-hidden />
        </div>
        <button className="btn-dark !rounded-full">Search</button>
      </form>
      <Chips base={base} f={f} />
      <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
        <aside className="hidden min-w-0 lg:block">
          <Link href="/admin/inbox/new" className="mb-3 inline-flex items-center gap-3 rounded-2xl bg-[#C2E7FF] px-6 py-4 font-bold text-navy shadow-sm hover:shadow" data-compose>
            <Pencil className="h-5 w-5" aria-hidden /> Compose
          </Link>
          <nav className="flex gap-1 overflow-x-auto pb-2 lg:flex-col lg:overflow-visible" aria-label="Mail folders">
            {FOLDERS.filter((x) => !("more" in x)).map(item)}
            <details className="group lg:contents" open={moreOpen} data-more-folders>
              <summary className="flex shrink-0 cursor-pointer list-none items-center gap-3 rounded-r-full px-4 py-1.5 text-sm hover:bg-bg">
                <ChevronDown className="h-4 w-4 group-open:hidden" aria-hidden />
                <ChevronUp className="hidden h-4 w-4 group-open:block" aria-hidden />
                <span className="group-open:hidden">More</span>
                <span className="hidden group-open:inline">Less</span>
              </summary>
              {FOLDERS.filter((x) => "more" in x).map(item)}
              <Link href="/admin/inbox/labels" className="flex shrink-0 items-center gap-3 rounded-r-full px-4 py-1.5 text-sm hover:bg-bg" data-manage-labels>
                <Tags className="h-4 w-4" aria-hidden /> Manage labels
              </Link>
              <a href="#new-label" className="flex shrink-0 items-center gap-3 rounded-r-full px-4 py-1.5 text-sm hover:bg-bg">
                <span className="w-4 text-center" aria-hidden>+</span> Create new label
              </a>
            </details>
          </nav>
          <div className="mt-3 hidden lg:block" data-labels>
            <div className="flex items-center justify-between px-4 text-base font-bold">Labels <a href="#new-label" className="text-xl font-normal text-muted" aria-label="Create new label">+</a></div>
            {labels.map((l) => (
              <div key={l.id} className={`group flex items-center gap-2 rounded-r-full px-4 py-1.5 text-sm ${label === l.name ? "bg-[#D3E7F8] font-bold text-navy" : "hover:bg-bg"}`}>
                <Tag className="h-4 w-4" style={{ color: l.color }} aria-hidden />
                <Link href={`/admin/inbox?f=all&label=${encodeURIComponent(l.name)}`} className="flex-1 truncate">{l.name}</Link>
                <form action={removeLabelAction}>
                  <input type="hidden" name="name" value={l.name} />
                  <button className="hidden text-xs text-muted hover:text-coral-dark group-hover:inline" aria-label={`Remove the label ${l.name}`} title="Remove this label (the emails stay)">×</button>
                </form>
              </div>
            ))}
            <form action={createLabelAction} className="mt-2 flex gap-1 px-4" data-new-label id="new-label">
              <input name="name" className="input !py-1 text-sm" placeholder="New label" aria-label="New label name" maxLength={40} />
              <input type="hidden" name="color" value={LABEL_COLORS[labels.length % LABEL_COLORS.length]} />
              <button className="text-sm font-bold text-navy">Add</button>
            </form>
          </div>
        </aside>
        <section className="min-w-0">{children}</section>
      </div>
    </div>
  );
}
