"use client";

import Link from "next/link";
import { Fragment, useState, useTransition } from "react";
import { AlarmClock, Archive, Bookmark, ChevronDown, EllipsisVertical, FileText, Image as ImageIcon, Inbox, MailOpen, Mail, OctagonAlert, Paperclip, RotateCw, Star, Tag, Trash2, Undo2 } from "lucide-react";
import { bulkAction, toggleStarAction, trashOneAction } from "./actions";

export type MailRow = {
  id: number;
  from: string;
  subject: string;
  snippet: string;
  when: string;
  unread: boolean;
  starred: boolean;
  important: boolean;
  inbox: boolean;
  snoozedUntil: string | null;
  labels: { name: string; color: string }[];
  files: string[];
};

/** Search words in yellow, like Gmail. */
function Hl({ text, words }: { text: string; words: string[] }) {
  if (!words.length) return <>{text}</>;
  const re = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  return (
    <>
      {text.split(re).map((part, i) => (i % 2 ? <mark key={i} className="rounded-sm bg-[#FFE36E] px-0.5 text-inherit">{part}</mark> : <Fragment key={i}>{part}</Fragment>))}
    </>
  );
}

const fileIcon = (name: string) => (/\.(png|jpe?g|gif|webp|heic)$/i.test(name) ? ImageIcon : FileText);

/** The email list, like Gmail: select menu, toolbar icons, star, Important, labels, attachments under the row. */
export default function MailList({ rows, folder, label, back, labels, highlight = [] }: { rows: MailRow[]; folder: string; label?: string; back: string; labels: { name: string; color: string }[]; highlight?: string[] }) {
  const [picked, setPicked] = useState<number[]>([]);
  const [stars, setStars] = useState<Record<number, boolean>>({});
  const [, start] = useTransition();
  const [gone, setGone] = useState<number[]>([]);
  const all = rows.length > 0 && picked.length === rows.length;
  const tool = "inline-flex items-center gap-1 rounded-full p-2 text-sm hover:bg-bg disabled:opacity-40";
  const none = picked.length === 0;
  const pick = (f: (r: MailRow) => boolean) => setPicked(rows.filter(f).map((r) => r.id));
  return (
    <form action={bulkAction} className="card overflow-visible" data-mail-list>
      <input type="hidden" name="back" value={back} />
      <input type="hidden" name="folder" value={folder} />
      {label && <input type="hidden" name="labelFilter" value={label} />}
      {picked.map((id) => <input key={id} type="hidden" name="id" value={id} />)}
      <div className="flex flex-wrap items-center gap-1 border-b border-line px-2 py-1.5" data-mail-toolbar>
        <span className="inline-flex items-center rounded p-1 hover:bg-bg">
          <input type="checkbox" className="mx-1 h-4 w-4" checked={all} ref={(el) => void (el && (el.indeterminate = !none && !all))} onChange={() => setPicked(all || !none ? [] : rows.map((r) => r.id))} aria-label="Select all" />
          <details className="relative" data-select-menu>
            <summary className="cursor-pointer list-none px-0.5" aria-label="Select"><ChevronDown className="h-3.5 w-3.5" /></summary>
            <div className="absolute left-0 z-30 mt-1 w-36 rounded-xl border border-line bg-white py-1 text-sm shadow-lg">
              {[
                ["All", () => pick(() => true)],
                ["None", () => setPicked([])],
                ["Read", () => pick((r) => !r.unread)],
                ["Unread", () => pick((r) => r.unread)],
                ["Starred", () => pick((r) => stars[r.id] ?? r.starred)],
                ["Unstarred", () => pick((r) => !(stars[r.id] ?? r.starred))],
              ].map(([t, f]) => (
                <button key={t as string} type="button" className="block w-full px-3 py-1.5 text-left hover:bg-bg" onClick={f as () => void}>{t as string}</button>
              ))}
            </div>
          </details>
        </span>
        <button type="button" className={tool} title="Refresh" aria-label="Refresh" onClick={() => location.reload()}><RotateCw className="h-4 w-4" /></button>
        {!none && (
          <>
            {folder === "trash" ? (
              <button name="action" value="restore" className={tool} title="Restore"><Undo2 className="h-4 w-4" /><span className="sr-only">Restore</span></button>
            ) : folder === "spam" ? (
              <button name="action" value="notspam" className={tool} title="Not spam"><Inbox className="h-4 w-4" /> <span className="text-xs font-semibold">Not spam</span></button>
            ) : (
              <>
                {folder === "archive" ? (
                  <button name="action" value="inbox" className={tool} title="Move to Inbox"><Inbox className="h-4 w-4" /><span className="sr-only">Move to Inbox</span></button>
                ) : (
                  <button name="action" value="archive" className={tool} title="Archive"><Archive className="h-4 w-4" /><span className="sr-only">Archive</span></button>
                )}
                <button name="action" value="spam" className={tool} title="Report spam"><OctagonAlert className="h-4 w-4" /><span className="sr-only">Report spam</span></button>
              </>
            )}
            {folder !== "trash" && <button name="action" value="trash" className={tool} title="Delete (Trash)"><Trash2 className="h-4 w-4" /><span className="sr-only">Trash</span></button>}
            <span className="mx-1 h-5 w-px bg-line" aria-hidden />
            <button name="action" value="read" className={tool} title="Mark as read"><MailOpen className="h-4 w-4" /><span className="sr-only">Mark as read</span></button>
            <button name="action" value="unread" className={tool} title="Mark as unread"><Mail className="h-4 w-4" /><span className="sr-only">Mark as unread</span></button>
            <details className="relative" data-snooze-menu>
              <summary className={`${tool} cursor-pointer list-none`} title="Snooze"><AlarmClock className="h-4 w-4" /><span className="sr-only">Snooze</span></summary>
              <div className="absolute left-0 z-30 mt-1 w-60 rounded-xl border border-line bg-white p-2 text-sm shadow-lg">
                <div className="px-2 pb-1 text-xs font-bold text-muted">Snooze until...</div>
                {[["later", "Later today"], ["tomorrow", "Tomorrow"], ["weekend", "This weekend (Sunday)"], ["nextweek", "Next week"]].map(([k, t]) => (
                  <button key={k} name="action" value="snooze" onClick={(e) => { const f = e.currentTarget.form!; (f.elements.namedItem("snooze") as HTMLInputElement).value = k; }} className="block w-full rounded px-2 py-1.5 text-left hover:bg-bg">{t}</button>
                ))}
                <input type="hidden" name="snooze" defaultValue="" />
                <div className="mt-1 border-t border-line pt-2">
                  <label className="block px-2 text-xs text-muted">Pick date and time</label>
                  <div className="flex gap-1 px-2">
                    <input type="datetime-local" name="snoozeAt" className="input !py-1 text-xs" />
                    <button name="action" value="snooze" className="btn-dark !px-2 !py-1 text-xs" onClick={(e) => { const f = e.currentTarget.form!; (f.elements.namedItem("snooze") as HTMLInputElement).value = ""; }}>Save</button>
                  </div>
                </div>
              </div>
            </details>
            {folder === "snoozed" && <button name="action" value="unsnooze" className={tool} title="Unsnooze"><Inbox className="h-4 w-4" /> <span className="text-xs font-semibold">Unsnooze</span></button>}
            {labels.length > 0 && (
              <details className="relative" data-label-menu>
                <summary className={`${tool} cursor-pointer list-none`} title="Labels"><Tag className="h-4 w-4" /><span className="sr-only">Labels</span></summary>
                <div className="absolute left-0 z-30 mt-1 w-56 rounded-xl border border-line bg-white p-2 text-sm shadow-lg">
                  <div className="px-2 pb-1 text-xs font-bold text-muted">Label as:</div>
                  <select name="label" className="input !py-1 text-sm" aria-label="Label" defaultValue={labels[0].name}>
                    {labels.map((l) => <option key={l.name} value={l.name}>{l.name}</option>)}
                  </select>
                  <div className="mt-2 flex gap-1">
                    <button name="action" value="label" className="btn-dark !px-2 !py-1 text-xs">Apply</button>
                    <button name="action" value="unlabel" className="btn-ghost !px-2 !py-1 text-xs">Remove</button>
                  </div>
                </div>
              </details>
            )}
          </>
        )}
        <details className="relative" data-more-menu>
          <summary className={`${tool} cursor-pointer list-none`} title="More"><EllipsisVertical className="h-4 w-4" /><span className="sr-only">More</span></summary>
          <div className="absolute left-0 z-30 mt-1 w-56 rounded-xl border border-line bg-white py-1 text-sm shadow-lg">
            <button name="action" value="markall" className="block w-full px-3 py-1.5 text-left hover:bg-bg">Mark all as read</button>
            {!none && (
              <>
                <button name="action" value="important" className="block w-full px-3 py-1.5 text-left hover:bg-bg">Mark as important</button>
                <button name="action" value="unimportant" className="block w-full px-3 py-1.5 text-left hover:bg-bg">Mark as not important</button>
                <button name="action" value="star" className="block w-full px-3 py-1.5 text-left hover:bg-bg">Add star</button>
                <button name="action" value="unstar" className="block w-full px-3 py-1.5 text-left hover:bg-bg">Remove star</button>
              </>
            )}
          </div>
        </details>
        {!none && <span className="ml-auto pr-2 text-xs text-muted">{picked.length} selected</span>}
      </div>
      <ul className="divide-y divide-line">
        {rows.filter((r) => !gone.includes(r.id)).map((r) => {
          const on = picked.includes(r.id);
          const starred = stars[r.id] ?? r.starred;
          return (
            <li key={r.id} className={`group px-2 py-1.5 ${on ? "bg-[#D3E7F8]" : r.unread ? "bg-white" : "bg-[#F2F6FC]"} hover:shadow-[inset_1px_0_0_#dadce0,inset_-1px_0_0_#dadce0,0_1px_2px_rgba(60,64,67,.3)]`} data-mail-row={r.id}>
              <div className="flex items-center gap-1.5">
                <input type="checkbox" className="mx-1 h-4 w-4 shrink-0" checked={on} onChange={() => setPicked(on ? picked.filter((x) => x !== r.id) : [...picked, r.id])} aria-label={`Select email from ${r.from}`} />
                <button
                  type="button"
                  aria-label={starred ? "Remove star" : "Star"}
                  className="shrink-0 p-1"
                  onClick={() => {
                    setStars({ ...stars, [r.id]: !starred });
                    start(async () => void (await toggleStarAction(r.id, !starred)));
                  }}
                  data-star={starred ? "on" : "off"}
                >
                  <Star className={`h-4 w-4 ${starred ? "fill-[#FFD229] text-[#E5B800]" : "text-muted"}`} aria-hidden />
                </button>
                <Bookmark className={`h-4 w-4 shrink-0 ${r.important ? "fill-[#F4B400] text-[#F4B400]" : "text-transparent"}`} aria-label={r.important ? "Important" : undefined} />
                <Link href={`/admin/inbox/${r.id}`} className={`flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3 sm:flex-nowrap ${r.unread ? "font-bold" : ""}`}>
                  <span className="w-full truncate sm:w-52 sm:shrink-0"><Hl text={r.from} words={highlight} /></span>
                  <span className="min-w-0 flex-1 truncate">
                    {r.inbox && <span className="mr-1 rounded bg-[#DDE3EA] px-1.5 py-0.5 text-[11px] font-normal text-ink">Inbox</span>}
                    {r.labels.map((l) => (
                      <span key={l.name} className="mr-1 rounded px-1.5 py-0.5 text-[11px] font-semibold text-white" style={{ background: l.color }}>{l.name}</span>
                    ))}
                    <Hl text={r.subject} words={highlight} />
                    <span className="font-normal text-muted"> - <Hl text={r.snippet} words={highlight} /></span>
                  </span>
                  {r.files.length > 0 && <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted" aria-label="Has attachments" />}
                  <span className={`shrink-0 text-xs ${r.unread ? "" : "font-normal text-muted"}`}>{r.snoozedUntil ? <span className="text-coral-dark">Snoozed until {r.snoozedUntil}</span> : r.when}</span>
                </Link>
                <button
                  type="button"
                  className="shrink-0 rounded-full p-1.5 text-muted opacity-60 hover:bg-bg hover:text-coral-dark group-hover:opacity-100"
                  aria-label={folder === "trash" ? "Restore" : "Move to Trash"}
                  title={folder === "trash" ? "Restore" : "Move to Trash"}
                  data-row-trash={r.id}
                  onClick={() => {
                    setGone([...gone, r.id]);
                    start(async () => void (await trashOneAction(r.id, folder === "trash")));
                  }}
                >
                  {folder === "trash" ? <Undo2 className="h-4 w-4" aria-hidden /> : <Trash2 className="h-4 w-4" aria-hidden />}
                </button>
              </div>
              {r.files.length > 0 && (
                <Link href={`/admin/inbox/${r.id}`} className="ml-[5.5rem] mt-1 flex flex-wrap gap-1.5 sm:ml-[18.5rem]" data-row-files>
                  {r.files.slice(0, 3).map((f, i) => {
                    const Icon = fileIcon(f);
                    return (
                      <span key={i} className="inline-flex max-w-[11rem] items-center gap-1.5 rounded-full border border-line bg-white px-2.5 py-1 text-xs">
                        <Icon className="h-3.5 w-3.5 shrink-0 text-coral-dark" aria-hidden />
                        <span className="truncate">{f}</span>
                      </span>
                    );
                  })}
                  {r.files.length > 3 && <span className="inline-flex items-center rounded-full border border-line bg-white px-2 py-1 text-xs">+{r.files.length - 3}</span>}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
      {rows.length === 0 && <p className="px-4 py-10 text-center text-muted" data-mail-empty>Nothing here.</p>}
    </form>
  );
}
