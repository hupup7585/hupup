"use client";

import { Trash2 } from "lucide-react";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { discardDraftAction, replyFileChunkAction, saveDraftAction, sendNewEmailAction, sendReplyAction, startReplyFileAction } from "../actions";

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
    if (!body.trim()) setBody(props.catalog.body);
  }
  const [msg, setMsg] = useState<{ ok: boolean; message: string } | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const ref = useRef<HTMLInputElement>(null);
  // Files over 18 MB are sent as a download link, so only the smaller ones count toward the 18 MB attached
  const attached = files.filter((f) => f.size <= MAX).reduce((n, f) => n + f.size, 0);

  async function send() {
    setMsg(null);
    if (files.some((f) => f.size > LINK_MAX)) return setMsg({ ok: false, message: "A file can be up to 100 MB." });
    if (attached > MAX) return setMsg({ ok: false, message: "Attachments can be up to 18 MB in all. Files over 18 MB each go as a download link." });
    const ids: number[] = [];
    for (const f of files) {
      const opened = await startReplyFileAction(f.name, f.type, f.size);
      if (!opened.ok || !opened.id) return setMsg(opened);
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
          return setMsg(r);
        }
      }
      ids.push(opened.id);
    }
    setProgress("Sending");
    const r = isNew ? await sendNewEmailAction(to, subject, body, ids, draftId ?? null, props.forwardOf ?? null, withCatalog) : await sendReplyAction(props.emailId!, body, ids, draftId ?? null);
    setProgress(null);
    setMsg(r);
    if (r.ok) {
      setBody("");
      setTo("");
      setSubject("");
      setFiles([]);
      setWithCatalog(false);
      setDraftId(undefined);
      setSaved("");
      first.current = true;
      router.refresh();
    }
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
      <textarea className="input mt-3" rows={isNew ? 10 : 6} value={body} onChange={(e) => setBody(e.target.value)} placeholder={isNew ? "Write your email" : "Write your reply"} aria-label={isNew ? "Email" : "Reply"} disabled={!props.active} />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input ref={ref} type="file" multiple className="hidden" onChange={(e) => { setFiles([...files, ...Array.from(e.target.files ?? [])]); e.target.value = ""; }} />
        <button type="button" className="btn-ghost !py-1.5 text-sm" disabled={!props.active || pending} onClick={() => ref.current?.click()}>
          Attach files
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
        <button className="btn-dark" disabled={!props.active || pending || !body.trim() || (isNew && (!to.trim() || !subject.trim()))} onClick={() => start(send)}>
          {isNew ? "Send email" : "Send reply"}
        </button>
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
              setBody("");
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
