"use client";

import { useRef, useState, useTransition } from "react";
import { approveDraftAction, approvePromptAction, discardDraftAction, googleVoiceAction, makeGoogleRecordingAction, recordingChunkAction, restoreVersionAction, savePromptAction, selectRecordingAction, startRecordingAction } from "./actions";

export type RecordingView = { id: number; source: "upload" | "google"; fileName: string; createdAt: string; wording: string | null; src: string };

const CHUNK = 3 * 1024 * 1024;

type Status = "Live" | "Waiting for approval" | "Not active yet" | "Not used";
type Ver = { id: number; text: string; status: string; when: string; by: string; note: string | null };

const STATUS_STYLE: Record<Status, string> = {
  Live: "bg-[#13895C]/15 text-[#13895C]",
  "Waiting for approval": "bg-coral/20 text-coral-dark",
  "Not active yet": "bg-sun/40 text-navy",
  "Not used": "bg-line text-muted",
};

/**
 * One phone line or message (Abraham, Nov 13, 2026): where it plays, the live wording, status, last change, an Edit
 * button that saves a draft for approval, the version history with Restore, and the recording controls.
 */
export default function PromptEditor(props: {
  promptKey: string;
  label: string;
  where: string;
  defaultText: string;
  live: string;
  vars: string[];
  message: boolean;
  status: Status;
  reason: string | null;
  codePending: boolean;
  changed: { when: string; by: string } | null;
  draft: { id: number; text: string; when: string; by: string } | null;
  versions: Ver[];
  recordable: boolean;
  activeId: number | null;
  uploads: RecordingView[];
  google: RecordingView | null;
  ttsReady: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(props.draft?.text ?? props.live);
  const [msg, setMsg] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, start] = useTransition();
  const [progress, setProgress] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const active = props.uploads.find((u) => u.id === props.activeId) ?? null;
  const run = (fn: () => Promise<{ ok: boolean; message: string }>) => start(async () => setMsg(await fn()));

  async function upload(file: File) {
    setMsg(null);
    const opened = await startRecordingAction(props.promptKey, file.name, file.size);
    if (!opened.ok || !opened.id) return setMsg(opened);
    const parts = Math.ceil(file.size / CHUNK);
    for (let i = 0; i < parts; i++) {
      setProgress(`Uploading ${Math.round((i / parts) * 100)}%`);
      const fd = new FormData();
      fd.set("id", String(opened.id));
      fd.set("idx", String(i));
      fd.set("last", i === parts - 1 ? "1" : "0");
      fd.set("data", file.slice(i * CHUNK, (i + 1) * CHUNK));
      const r = await recordingChunkAction(fd);
      if (!r.ok) {
        setProgress(null);
        return setMsg(r);
      }
      if (i === parts - 1) setMsg(r);
    }
    setProgress(null);
  }

  return (
    <div className="border-b border-line pb-4 last:border-0 last:pb-0" data-prompt-line={props.promptKey}>
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <span className="font-semibold">{props.label}</span>
        <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${STATUS_STYLE[props.status]}`} data-prompt-status>
          {props.status}
        </span>
        {props.draft && <span className="rounded-full bg-coral/20 px-2 py-0.5 text-xs font-bold text-coral-dark">New wording waiting for approval</span>}
        {!props.message && props.recordable && (
          <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${active ? "bg-[#13895C]/15 text-[#13895C]" : "bg-sky/15 text-navy"}`}>
            {active ? "Plays: your recording" : props.google ? "Plays: Google recording" : "Plays: Google voice"}
          </span>
        )}
        {!props.message && !props.recordable && <span className="rounded-full bg-line px-2 py-0.5 text-xs font-bold text-muted">Changing parts: live Google voice</span>}
      </div>
      <p className="text-xs text-muted">
        Where: {props.where}
        {props.vars.length > 0 && <> · changing parts {props.vars.map((v) => `{${v}}`).join(" ")}</>}
        {" · "}
        {props.changed ? <>last changed {props.changed.when} by {props.changed.by}</> : "original wording (never changed)"}
      </p>
      {props.reason && <p className="mt-1 text-xs font-semibold text-coral-dark">{props.reason}</p>}
      {props.status === "Waiting for approval" && props.codePending && !props.draft && (
        <p className="mt-1 text-xs text-coral-dark">This line never plays on the phone until you approve it.</p>
      )}
      <p className={`mt-2 whitespace-pre-wrap rounded-lg border border-line bg-white p-3 ${props.message ? "font-mono text-[13px]" : "text-[15px]"}`} data-prompt-live>
        {props.live}
      </p>
      {props.draft && (
        <div className="mt-2 rounded-lg border-2 border-coral bg-[#FDF1EF] p-3" data-prompt-draft>
          <p className="text-xs font-bold text-coral-dark">
            Draft from {props.draft.when} by {props.draft.by}, waiting for approval. The wording above keeps playing until you approve.
          </p>
          <p className={`mt-1 whitespace-pre-wrap ${props.message ? "font-mono text-[13px]" : "text-[15px]"}`}>{props.draft.text}</p>
          <div className="mt-2 flex gap-2">
            <button className="btn-dark !py-1.5 text-sm" disabled={pending} onClick={() => run(() => approveDraftAction(props.draft!.id))}>
              Approve and make live
            </button>
            <button className="btn-ghost !py-1.5 text-sm" disabled={pending} onClick={() => run(() => discardDraftAction(props.draft!.id))}>
              Discard draft
            </button>
          </div>
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {!editing && (
          <button className="btn-ghost !py-1.5 text-sm" disabled={pending} onClick={() => { setText(props.draft?.text ?? props.live); setEditing(true); }}>
            Edit
          </button>
        )}
        {props.codePending && !props.draft && props.status === "Waiting for approval" && (
          <button className="btn-ghost !py-1.5 text-sm" disabled={pending} onClick={() => run(() => approvePromptAction(props.promptKey))}>
            Approve this wording
          </button>
        )}
      </div>
      {editing && (
        <div className="mt-2" data-prompt-edit>
          <textarea className="input" rows={props.message ? 8 : 3} value={text} onChange={(e) => setText(e.target.value)} aria-label={`New wording: ${props.label}`} />
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              className="btn-dark !py-1.5 text-sm"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await savePromptAction(props.promptKey, text);
                  setMsg(r);
                  if (r.ok) setEditing(false);
                })
              }
            >
              Save as draft
            </button>
            <button className="btn-ghost !py-1.5 text-sm" disabled={pending} onClick={() => setText(props.defaultText)}>
              Start from the original wording
            </button>
            <button className="btn-ghost !py-1.5 text-sm" disabled={pending} onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {props.versions.length > 0 && (
        <details className="mt-2" data-prompt-versions>
          <summary className="cursor-pointer text-xs font-semibold text-muted">Older versions ({props.versions.filter((v) => v.status !== "live").length}, all kept)</summary>
          <ul className="mt-2 space-y-2 text-sm">
            {props.versions.map((v) => (
              <li key={v.id} className="rounded-lg bg-bg p-2">
                <p className="text-xs text-muted">
                  {v.status === "live" ? "Live now" : v.status === "discarded" ? "Draft set aside" : "Earlier version"} · {v.when} · {v.by}
                  {v.note && v.note !== "Original wording" ? ` · ${v.note.replace(/ of \d{4}-.*$/, "")}` : ""}
                </p>
                <p className="whitespace-pre-wrap">{v.text}</p>
                {v.status !== "live" && (
                  <button className="btn-ghost mt-1 !py-1 text-xs" disabled={pending} onClick={() => run(() => restoreVersionAction(v.id))}>
                    Go back to this version
                  </button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
      {props.recordable && !props.message && (
        <div className="mt-3 rounded-xl bg-bg p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-32 shrink-0 font-semibold">Google voice</span>
            {props.google ? (
              <audio controls preload="none" src={props.google.src} className="h-8 max-w-full" aria-label={`Google voice: ${props.label}`} />
            ) : props.ttsReady ? (
              <button className="btn-ghost !py-1 text-sm" disabled={pending} onClick={() => start(async () => setMsg(await makeGoogleRecordingAction(props.promptKey, props.live)))}>
                Make Google recording
              </button>
            ) : (
              <span className="text-muted">Play: Not active yet (Google Text-to-Speech not set up)</span>
            )}
            {active && (
              <button className="btn-ghost !py-1 text-sm" disabled={pending} onClick={() => start(async () => setMsg(await googleVoiceAction(props.promptKey)))}>
                Use Google voice
              </button>
            )}
          </div>
          {active && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="w-32 shrink-0 font-semibold">Your recording</span>
              <audio controls preload="none" src={active.src} className="h-8 max-w-full" aria-label={`Your recording: ${props.label}`} />
              <span className="text-xs text-muted">
                {active.fileName}, {active.createdAt}
              </span>
            </div>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept=".mp3,.wav,audio/mpeg,audio/wav,audio/x-wav"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) start(() => upload(f));
              }}
            />
            <button className="btn-dark !py-1 text-sm" disabled={pending} onClick={() => fileRef.current?.click()}>
              Upload recording
            </button>
            <span className="text-xs text-muted">MP3 or WAV, up to 10 MB</span>
            {progress && <span className="text-xs font-semibold">{progress}</span>}
          </div>
          {props.uploads.filter((u) => u.id !== props.activeId).length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs font-semibold text-muted">Older recordings ({props.uploads.filter((u) => u.id !== props.activeId).length}, kept)</summary>
              <ul className="mt-2 space-y-2">
                {props.uploads
                  .filter((u) => u.id !== props.activeId)
                  .map((u) => (
                    <li key={u.id} className="flex flex-wrap items-center gap-2">
                      <audio controls preload="none" src={u.src} className="h-8 max-w-full" aria-label={`Older recording ${u.fileName}`} />
                      <span className="text-xs text-muted">
                        {u.fileName}, {u.createdAt}
                      </span>
                      <button className="btn-ghost !py-1 text-xs" disabled={pending} onClick={() => start(async () => setMsg(await selectRecordingAction(props.promptKey, u.id)))}>
                        Use this one
                      </button>
                    </li>
                  ))}
              </ul>
            </details>
          )}
        </div>
      )}
      {msg?.message && <p className={`mt-2 text-sm font-semibold ${msg.ok ? "text-[#13895C]" : "text-coral-dark"}`}>{msg.message}</p>}
    </div>
  );
}
