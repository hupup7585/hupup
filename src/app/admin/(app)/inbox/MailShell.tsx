import Link from "next/link";
import { Archive, File, Inbox, Mail, Pencil, Send, Star, Tag, Trash2 } from "lucide-react";
import { FOLDERS, LABEL_COLORS, folderCounts, listLabels, type Folder } from "@/lib/inbox-folders";
import { createLabelAction, removeLabelAction } from "./actions";

const ICON: Record<Folder, typeof Inbox> = { inbox: Inbox, starred: Star, sent: Send, drafts: File, all: Mail, archive: Archive, trash: Trash2 };

/** The Gmail-style frame: Compose, folders with counts, labels; the folder or email on the right. */
export default async function MailShell({ folder, label, q, children }: { folder?: Folder; label?: string; q?: string; children: React.ReactNode }) {
  const [counts, labels] = await Promise.all([folderCounts(), listLabels()]);
  return (
    <div className="mx-auto max-w-7xl" data-mail-shell>
      <form action="/admin/inbox" className="mb-4 flex items-center gap-2" role="search">
        {folder && folder !== "inbox" && <input type="hidden" name="f" value={folder} />}
        {label && <input type="hidden" name="label" value={label} />}
        <input name="q" defaultValue={q ?? ""} className="input min-w-0 flex-1 !rounded-full !bg-white !px-5" placeholder="Search mail" aria-label="Search mail" data-mail-search />
        <button className="btn-dark !rounded-full">Search</button>
      </form>
      <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
        <aside className="min-w-0">
          <Link href="/admin/inbox/new" className="mb-3 inline-flex items-center gap-2 rounded-2xl bg-sky px-5 py-3 font-bold text-white shadow hover:opacity-90" data-compose>
            <Pencil className="h-4 w-4" aria-hidden /> Compose
          </Link>
          <nav className="flex gap-1 overflow-x-auto pb-2 lg:flex-col lg:overflow-visible" aria-label="Mail folders">
            {FOLDERS.map((f) => {
              const Icon = ICON[f.key];
              const on = folder === f.key && !label;
              const n = f.key === "inbox" ? counts.inbox : f.key === "drafts" ? counts.drafts : 0;
              return (
                <Link
                  key={f.key}
                  href={f.key === "inbox" ? "/admin/inbox" : `/admin/inbox?f=${f.key}`}
                  className={`flex shrink-0 items-center gap-3 rounded-r-full px-4 py-1.5 text-sm ${on ? "bg-[#D3E7F8] font-bold text-navy" : "hover:bg-bg"}`}
                  data-folder={f.key}
                  aria-current={on ? "page" : undefined}
                >
                  <Icon className="h-4 w-4" aria-hidden />
                  <span className="flex-1">{f.label}</span>
                  {n > 0 && <span className="text-xs font-bold">{n}</span>}
                </Link>
              );
            })}
          </nav>
          <div className="mt-3 hidden lg:block" data-labels>
            <div className="px-4 text-xs font-bold uppercase text-muted">Labels</div>
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
            <form action={createLabelAction} className="mt-2 flex gap-1 px-4" data-new-label>
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
