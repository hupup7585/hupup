"use client";

import { useState, useTransition } from "react";
import { completeReviewAction, reportIssueAction } from "./actions";

export function ReportIssueForm() {
  const [text, setText] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder="What happened? For example: a promotional text went to someone who replied STOP, a message went to the wrong person, a lost phone, or a login you don't recognize." className="w-full rounded-xl border p-3 text-sm" />
      <button type="button" className="btn-dark mt-2" disabled={pending || !text.trim()} onClick={() => start(async () => { const r = await reportIssueAction(text); setMsg(r); if (r.ok) setText(""); })}>
        {pending ? "Sending..." : "Report to the owner now"}
      </button>
      {msg && <p className={`mt-2 text-sm font-semibold ${msg.ok ? "text-[#13895C]" : "text-coral"}`}>{msg.message}</p>}
    </div>
  );
}

export function CompleteReviewForm() {
  const [notes, setNotes] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <div>
      <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Notes: what you checked, anything corrected." className="w-full rounded-xl border p-3 text-sm" />
      <button type="button" className="btn-dark mt-2" disabled={pending} onClick={() => start(async () => setMsg(await completeReviewAction(notes)))}>
        {pending ? "Saving..." : "Mark this review complete"}
      </button>
      {msg && <p className={`mt-2 text-sm font-semibold ${msg.ok ? "text-[#13895C]" : "text-coral"}`}>{msg.message}</p>}
    </div>
  );
}
