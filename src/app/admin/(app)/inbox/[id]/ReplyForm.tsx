"use client";

import { useRef, useState, useTransition } from "react";
import { replyFileChunkAction, sendNewEmailAction, sendReplyAction, startReplyFileAction } from "../actions";

const CHUNK = 3 * 1024 * 1024;
const MAX = 10 * 1024 * 1024;

/**
 * Reply from Hup Up Attractions <info@hupupattractions.com>, signed "Hup Up Attractions". Attachments up to 10 MB.
 * Without an emailId it is a new email (Abraham, Nov 13, 2026): To and Subject are typed in.
 */
export default function ReplyForm(props: { emailId?: number; to?: string; active: boolean }) {
  const isNew = props.emailId === undefined;
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; message: string } | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const ref = useRef<HTMLInputElement>(null);
  const total = files.reduce((n, f) => n + f.size, 0);

  async function send() {
    setMsg(null);
    if (total > MAX) return setMsg({ ok: false, message: "Attachments can be up to 10 MB in all." });
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
    const r = isNew ? await sendNewEmailAction(to, subject, body, ids) : await sendReplyAction(props.emailId!, body, ids);
    setProgress(null);
    setMsg(r);
    if (r.ok) {
      setBody("");
      setTo("");
      setSubject("");
      setFiles([]);
    }
  }

  return (
    <div className="card mt-3 p-5" data-reply-form>
      <h2 className="font-bold">{isNew ? "New email" : `Reply to ${props.to}`}</h2>
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
        {files.map((f, i) => (
          <span key={i} className="rounded-full bg-bg px-2 py-0.5 text-xs">
            {f.name}{" "}
            <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))}>
              ×
            </button>
          </span>
        ))}
        <span className={`text-xs ${total > MAX ? "font-bold text-coral-dark" : "text-muted"}`}>{files.length ? `${(total / 1024 / 1024).toFixed(1)} MB of 10 MB` : "Up to 10 MB"}</span>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button className="btn-dark" disabled={!props.active || pending || !body.trim() || (isNew && (!to.trim() || !subject.trim()))} onClick={() => start(send)}>
          {isNew ? "Send email" : "Send reply"}
        </button>
        {progress && <span className="text-sm">{progress}…</span>}
        {msg?.message && <span className={`text-sm font-semibold ${msg.ok ? "text-[#13895C]" : "text-coral-dark"}`}>{msg.message}</span>}
      </div>
    </div>
  );
}
