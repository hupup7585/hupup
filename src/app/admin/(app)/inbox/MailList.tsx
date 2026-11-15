"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Archive, Inbox, MailOpen, Mail, Paperclip, Star, Tag, Trash2, Undo2 } from "lucide-react";
import { bulkAction, toggleStarAction } from "./actions";

export type MailRow = { id: number; from: string; subject: string; snippet: string; when: string; unread: boolean; starred: boolean; labels: { name: string; color: string }[]; attach: boolean };

/** The email list with check boxes and a toolbar, like Gmail. */
export default function MailList({ rows, folder, back, labels }: { rows: MailRow[]; folder: string; back: string; labels: { name: string; color: string }[] }) {
  const [picked, setPicked] = useState<number[]>([]);
  const [stars, setStars] = useState<Record<number, boolean>>({});
  const [, start] = useTransition();
  const all = rows.length > 0 && picked.length === rows.length;
  const tool = "inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-sm hover:bg-bg disabled:opacity-40";
  const none = picked.length === 0;
  return (
    <form action={bulkAction} className="card overflow-hidden" data-mail-list>
      <input type="hidden" name="back" value={back} />
      {picked.map((id) => <input key={id} type="hidden" name="id" value={id} />)}
      <div className="flex flex-wrap items-center gap-1 border-b border-line px-3 py-2" data-mail-toolbar>
        <input type="checkbox" className="mx-2 h-4 w-4" checked={all} onChange={() => setPicked(all ? [] : rows.map((r) => r.id))} aria-label="Select all" />
        {folder === "trash" ? (
          <button name="action" value="restore" className={tool} disabled={none}><Undo2 className="h-4 w-4" aria-hidden /> Restore</button>
        ) : (
          <>
            {folder === "archive" ? (
              <button name="action" value="inbox" className={tool} disabled={none}><Inbox className="h-4 w-4" aria-hidden /> Move to Inbox</button>
            ) : (
              <button name="action" value="archive" className={tool} disabled={none}><Archive className="h-4 w-4" aria-hidden /> Archive</button>
            )}
            <button name="action" value="trash" className={tool} disabled={none}><Trash2 className="h-4 w-4" aria-hidden /> Trash</button>
          </>
        )}
        <button name="action" value="read" className={tool} disabled={none}><MailOpen className="h-4 w-4" aria-hidden /> Mark as read</button>
        <button name="action" value="unread" className={tool} disabled={none}><Mail className="h-4 w-4" aria-hidden /> Mark as unread</button>
        <button name="action" value="star" className={tool} disabled={none}><Star className="h-4 w-4" aria-hidden /> Star</button>
        {labels.length > 0 && (
          <span className="inline-flex items-center gap-1">
            <Tag className="h-4 w-4" aria-hidden />
            <select name="label" className="input !w-36 !py-1 text-sm" aria-label="Label" defaultValue={labels[0].name}>
              {labels.map((l) => <option key={l.name} value={l.name}>{l.name}</option>)}
            </select>
            <button name="action" value="label" className={tool} disabled={none}>Add label</button>
            <button name="action" value="unlabel" className={tool} disabled={none}>Remove label</button>
          </span>
        )}
        {!none && <span className="ml-auto text-xs text-muted">{picked.length} selected</span>}
      </div>
      <ul className="divide-y divide-line">
        {rows.map((r) => {
          const on = picked.includes(r.id);
          const starred = stars[r.id] ?? r.starred;
          return (
            <li key={r.id} className={`flex items-center gap-2 px-3 py-2 ${on ? "bg-[#D3E7F8]" : r.unread ? "bg-white" : "bg-bg/60"} hover:shadow-[inset_0_-1px_0_#cfd8e3]`} data-mail-row={r.id}>
              <input type="checkbox" className="h-4 w-4 shrink-0" checked={on} onChange={() => setPicked(on ? picked.filter((x) => x !== r.id) : [...picked, r.id])} aria-label={`Select email from ${r.from}`} />
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
              <Link href={`/admin/inbox/${r.id}`} className={`flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3 sm:flex-nowrap ${r.unread ? "font-bold" : ""}`}>
                <span className="w-full truncate sm:w-48 sm:shrink-0">{r.from}</span>
                <span className="min-w-0 flex-1 truncate">
                  {r.labels.map((l) => (
                    <span key={l.name} className="mr-1 rounded px-1.5 py-0.5 text-[11px] font-semibold text-white" style={{ background: l.color }}>{l.name}</span>
                  ))}
                  {r.subject}
                  <span className="font-normal text-muted"> - {r.snippet}</span>
                </span>
                {r.attach && <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted" aria-label="Has attachments" />}
                <span className={`shrink-0 text-xs ${r.unread ? "" : "font-normal text-muted"}`}>{r.when}</span>
              </Link>
            </li>
          );
        })}
      </ul>
      {rows.length === 0 && <p className="px-4 py-10 text-center text-muted" data-mail-empty>Nothing here.</p>}
    </form>
  );
}
