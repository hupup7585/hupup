"use client";

import { ChevronDown, Clock, Paperclip, Trash2 } from "lucide-react";
import RichEditor from "./RichEditor";
import { textToHtml } from "@/lib/email-format";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { discardDraftAction, replyFileChunkAction, saveDraftAction, scheduleSendAction, sendNewEmailAction, sendReplyAction, startReplyFileAction } from "../actions";

const CHUNK = 3 * 1024 * 1024;
const MAX = 18 * 1024 * 1024; // same as INBOX_FILE_MAX_BYTES (18 MB attached in all per email)
const LINK_MAX = 100 * 1024 * 1024; // a single file over 18 MB, up to 100 MB, goes as a 30-day download link (Nov 18, 2026)

/**
 * Reply from Hup Up Attractions <info@hupupattractions.com>, signed "Hup Up Attractions". Attachments up to 18 MB in all.
 * Without an emailId it is a new email (Abraham, Nov 13, 2026): To and Subject are typed in.
 */
export default function ReplyForm(props: { emailId?: number; to?: string; active: boolean; draftId?: number; initialTo?: string; initialSubject?: string; initialBody?: string; forwardOf?: number; forwardFiles?: string[]; catalog?: { fileName: string; subject: string; body: string } | null }) {
  const isNew = props.emailId === undefined;
  const router = useRouter();
  const [to, setTo] = useState(props.initialTo ?? "");
  const [subject, setSubject] = useState(props.initialSubject ?? "");
  const [body, setBody] = useState(props.initialBody ?? "");
  // Formatting (Gmail-style bar, Nov 19, 2026): the formatted version; `seed` refills the box when text is set from outside
  const [html, setHtml] = useState(textToHtml(props.initialBody ?? ""));
  const [seed, setSeed] = useState(textToHtml(props.initialBody ?? ""));
  const fill = (t: string) => {
    setBody(t);
    setHtml(textToHtml(t));
    setSeed(textToHtml(t));
  };
  // Drafts save by themselves 2 seconds after typing stops (Gmail-style, Abraham, Nov 15, 2026)
  const [draftId, setDraftId] = useState<number | undefined>(props.draftId);
  const [saved, setSaved] = useState<string>("");
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!body.trim() && !subject.trim() && !to.trim()) return;
    const t = setTimeout(async () => {
      const r = await saveDraftAction({ id: draftId ?? null, to: isNew ? to : (props.to ?? ""), subject, body, replyTo: props.emailId ?? null, forwardOf: props.forwardOf ?? null });
      if (r.id) setDraftId(r.id);
      setSaved("Draft saved");
    }, 2000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [to, subject, body]);
  const [files, setFiles] = useState<File[]>([]);
  // Compose > Add our catalog (Abraham, Nov 17, 2026): attaches the catalog PDF; an empty subject and message get the catalog wording
  const [withCatalog, setWithCatalog] = useState(false);
  function addCatalog() {
    if (!props.catalog) return;
    setWithCatalog(true);
    if (!subject.trim()) setSubject(props.catalog.subject);
    if (!body.trim()) fill(props.catalog.body);
  }
  const [msg, setMsg] = useState<{ ok: boolean; message: string } | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const ref = useRef<HTMLInputElement>(null);
  // Files over 18 MB are sent as a download link, so only the smaller ones count toward the 18 MB attached
  const attached = files.filter((f) => f.size <= MAX).reduce((n, f) => n + f.size, 0);

  /** Uploads the attached files; their ids, or null after showing the problem. */
  async function uploadAll(): Promise<number[] | null> {
    if (files.some((f) => f.size > LINK_MAX)) return setMsg({ ok: false, message: "A file can be up to 100 MB." }), null;
    if (attached > MAX) return setMsg({ ok: false, message: "Attachments can be up to 18 MB in all. Files over 18 MB each go as a download link." }), null;
    const ids: number[] = [];
    for (const f of files) {
      const opened = await startReplyFileAction(f.name, f.type, f.size);
      if (!opened.ok || !opened.id) return setMsg(opened), null;
      const parts = Math.ceil(f.size / CHUNK);
      for (let i = 0; i < parts; i++) {
        setProgress(`Uploading ${f.name}`);
        const fd = new FormData();
        fd.set("id", String(opened.id));
        fd.set("idx", String(i));
        fd.set("last", i === parts - 1 ? "1" : "0");
        fd.set("data", f.slice(i * CHUNK, (i + 1) * CHUNK));
        const r = await replyFileChunkAction(fd);
        if (!r.ok) {
          setProgress(null);
          return setMsg(r), null;
        }
      }
      ids.push(opened.id);
    }
    return ids;
  }

  function reset() {
    fill("");
    setTo("");
    setSubject("");
    setFiles([]);
    setWithCatalog(false);
    setDraftId(undefined);
    setSaved("");
    first.current = true;
    router.refresh();
  }

  /** Schedule send (Abraham, Nov 19, 2026): new emails wait under Scheduled and go out at their time. */
  const [when, setWhen] = useState("");
  async function schedule(w: string) {
    setMsg(null);
    const ids = await uploadAll();
    if (!ids) return;
    setProgress("Scheduling");
    const r = await scheduleSendAction({ draftId: draftId ?? null, to, subject, body, fileIds: ids, attachCatalog: withCatalog, forwardOf: props.forwardOf ?? null, when: w, bodyHtml: html });
    setProgress(null);
    setMsg(r);
    if (r.ok) {
      reset();
      router.push("/admin/inbox?f=scheduled");
    }
  }

  async function send() {
    setMsg(null);
    const ids = await uploadAll();
    if (!ids) return;
    setProgress("Sending");
    const r = isNew ? await sendNewEmailAction(to, subject, body, ids, draftId ?? null, props.forwardOf ?? null, withCatalog, html) : await sendReplyAction(props.emailId!, body, ids, draftId ?? null, html);
    setProgress(null);
    setMsg(r);
    if (r.ok) reset();
  }

  return (
    <div className="card mt-3 p-5" data-reply-form>
      <h2 className="font-bold">{isNew ? (props.forwardOf ? "Forward" : "New email") : `Reply to ${props.to}`}</h2>
      <p className="text-sm text-muted">From Hup Up Attractions &lt;info@hupupattractions.com&gt;, signed &quot;Hup Up Attractions&quot;.</p>
      {!props.active && <p className="mt-2 text-sm"><b>Not active yet:</b> replies go out once the info@ sender is set up in Resend.</p>}
      {isNew && (
        <>
          <label className="mt-3 block"><span className="label">To</span><input className="input" type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="customer@example.com" disabled={!props.active} data-new-to /></label>
          <label className="mt-2 block"><span className="label">Subject</span><input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} disabled={!props.active} data-new-subject /></label>
        </>
      )}
      <RichEditor initialHtml={seed} rows={isNew ? 10 : 6} disabled={!props.active} placeholder={isNew ? "Write your email" : "Write your reply"} onChange={(t, h) => { setBody(t); setHtml(h); }} />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input ref={ref} type="file" multiple className="hidden" onChange={(e) => { setFiles([...files, ...Array.from(e.target.files ?? [])]); e.target.value = ""; }} />
        <button type="button" className="btn-ghost inline-flex items-center gap-1 !py-1.5 text-sm" disabled={!props.active || pending} onClick={() => ref.current?.click()} title="Attach files">
          <Paperclip className="h-4 w-4" aria-hidden /> Attach files
        </button>
        {isNew && (
          <button
            type="button"
            className="btn-ghost !py-1.5 text-sm"
            disabled={!props.active || pending || !props.catalog || withCatalog}
            title={props.catalog ? "Attach our catalog PDF and fill in the catalog email" : "Upload the catalog PDF in Admin, Catalog email & text first"}
            onClick={addCatalog}
            data-add-catalog
          >
            Add our catalog
          </button>
        )}
        {withCatalog && props.catalog && (
          <span className="rounded-full bg-[#FFF3C4] px-2 py-0.5 text-xs" data-catalog-file>
            {props.catalog.fileName} (our catalog){" "}
            <button type="button" aria-label="Remove the catalog" onClick={() => setWithCatalog(false)}>
              ×
            </button>
          </span>
        )}
        {files.map((f, i) => (
          <span key={i} className="rounded-full bg-bg px-2 py-0.5 text-xs">
            {f.name}{" "}
            <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))}>
              ×
            </button>
          </span>
        ))}
        {props.forwardFiles?.map((n) => <span key={n} className="rounded-full bg-[#D3E7F8] px-2 py-0.5 text-xs" data-forward-file>{n} (from the original)</span>)}
        <span className={`text-xs ${attached > MAX ? "font-bold text-coral-dark" : "text-muted"}`}>
          {files.length ? `${(attached / 1024 / 1024).toFixed(1)} MB of 18 MB attached` : "Up to 18 MB attached"}
          {files.some((f) => f.size > MAX) ? `; ${files.filter((f) => f.size > MAX).length} sent as a download link` : "; larger files up to 100 MB go as a download link"}
        </span>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <span className="inline-flex">
          <button className={`btn-dark ${isNew ? "!rounded-r-none" : ""}`} disabled={pending} onClick={() => {
            // Every button answers (Abraham, Nov 26, 2026): say what is missing instead of a greyed-out button
            const why = !props.active ? "Email sending is not set up yet: replies go out once the info@ sender is set up." : isNew && !to.trim() ? "Type who the email goes to first." : isNew && !subject.trim() ? "Type a subject first." : !body.trim() ? "Write the message first." : null;
            if (why) return setMsg({ ok: false, message: why });
            start(send);
          }}>
            {isNew ? "Send email" : "Send reply"}
          </button>
          {isNew && (
            <details className="relative" data-schedule-send>
              <summary className={`btn-dark !rounded-l-none !border-l !border-white/30 !px-2 cursor-pointer list-none ${!props.active || pending || !body.trim() || !to.trim() || !subject.trim() ? "pointer-events-none opacity-50" : ""}`} aria-label="Schedule send" title="Schedule send"><ChevronDown className="h-4 w-4" /></summary>
              <div className="absolute bottom-full left-0 z-30 mb-1 w-64 rounded-xl border border-line bg-white p-2 text-sm shadow-lg">
                <div className="flex items-center gap-1 px-2 pb-1 text-xs font-bold text-muted"><Clock className="h-3.5 w-3.5" aria-hidden /> Schedule send</div>
                {[["tomorrow-am", "Tomorrow morning, 8:00 AM"], ["tomorrow-pm", "Tomorrow afternoon, 1:00 PM"], ["monday-am", "Monday morning, 8:00 AM"]].map(([k, t]) => (
                  <button key={k} type="button" className="block w-full rounded px-2 py-1.5 text-left hover:bg-bg" onClick={() => start(() => schedule(k))}>{t}</button>
                ))}
                <label className="mt-1 block border-t border-line px-2 pt-2 text-xs text-muted">Pick date and time</label>
                <div className="flex gap-1 px-2">
                  <input type="datetime-local" className="input !py-1 text-xs" value={when} onChange={(e) => setWhen(e.target.value)} />
                  <button type="button" className="btn-dark !px-2 !py-1 text-xs" disabled={!when} onClick={() => start(() => schedule(when))}>Schedule</button>
                </div>
              </div>
            </details>
          )}
        </span>
        {/* A trash can that is always there (Abraham, Nov 16, 2026): throws away what was typed, and the saved draft if any */}
        <button
          type="button"
          className="btn-ghost inline-flex items-center gap-1"
          disabled={pending}
          title="Discard"
          onClick={() =>
            start(async () => {
              if (draftId) await discardDraftAction(draftId);
              setDraftId(undefined);
              fill("");
              setSubject(isNew ? "" : subject);
              setTo("");
              setSaved("Discarded");
              first.current = true;
              if (isNew) router.push("/admin/inbox");
            })
          }
          data-discard-draft
        >
          <Trash2 className="h-4 w-4" aria-hidden /> Discard
        </button>
        {saved && !progress && <span className="text-xs text-muted" data-draft-status>{saved}</span>}
        {progress && <span className="text-sm">{progress}…</span>}
        {msg?.message && <span className={`text-sm font-semibold ${msg.ok ? "text-[#13895C]" : "text-coral-dark"}`}>{msg.message}</span>}
      </div>
    </div>
  );
}
