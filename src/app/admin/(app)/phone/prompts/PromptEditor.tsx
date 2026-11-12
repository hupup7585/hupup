"use client";

import { useRef, useState, useTransition } from "react";
import { approvePromptAction, googleVoiceAction, makeGoogleRecordingAction, recordingChunkAction, savePromptAction, selectRecordingAction, startRecordingAction } from "./actions";

export type RecordingView = { id: number; source: "upload" | "google"; fileName: string; createdAt: string; wording: string | null; src: string };

const CHUNK = 3 * 1024 * 1024;

export default function PromptEditor(props: {
  promptKey: string;
  label: string;
  defaultText: string;
  vars: string[];
  current: string;
  recordable: boolean;
  waiting: boolean;
  activeId: number | null;
  uploads: RecordingView[];
  google: RecordingView | null;
  ttsReady: boolean;
}) {
  const [text, setText] = useState(props.current || props.defaultText);
  const [msg, setMsg] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, start] = useTransition();
  const [progress, setProgress] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const customized = Boolean(props.current) && props.current !== props.defaultText;
  const active = props.uploads.find((u) => u.id === props.activeId) ?? null;

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
    <div className="border-b border-line pb-4 last:border-0 last:pb-0">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <span className="font-semibold">{props.label}</span>
        {props.waiting && <span className="rounded-full bg-coral/20 px-2 py-0.5 text-xs font-bold text-coral-dark">Waiting for approval</span>}
        {customized && <span className="rounded-full bg-sun/30 px-2 py-0.5 text-xs font-bold">Customized</span>}
        {props.recordable ? (
          <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${active ? "bg-[#13895C]/15 text-[#13895C]" : "bg-sky/15 text-navy"}`}>
            {active ? "Plays: your recording" : "Plays: Google voice"}
          </span>
        ) : (
          <span className="rounded-full bg-line px-2 py-0.5 text-xs font-bold text-muted">Changing parts: live Google voice</span>
        )}
        {props.vars.length > 0 && <span className="text-xs text-muted">Uses {props.vars.map((v) => `{${v}}`).join(" ")}</span>}
      </div>
      {props.waiting && <p className="mb-1 text-xs text-coral-dark">This line never plays on the phone until you approve it.</p>}
      <textarea className="input" rows={2} value={text} onChange={(e) => setText(e.target.value)} />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          className="btn-dark !py-1.5 text-sm"
          disabled={pending}
          onClick={() => start(async () => setMsg(await savePromptAction(props.promptKey, text === props.defaultText ? "" : text)))}
        >
          Save
        </button>
        <button
          className="btn-ghost !py-1.5 text-sm"
          disabled={pending}
          onClick={() => {
            setText(props.defaultText);
            start(async () => setMsg(await savePromptAction(props.promptKey, "")));
          }}
        >
          Reset to default
        </button>
        {props.waiting && (
          <button className="btn-ghost !py-1.5 text-sm" disabled={pending} onClick={() => start(async () => setMsg(await approvePromptAction(props.promptKey)))}>
            Approve this wording
          </button>
        )}
      </div>

      {props.recordable && (
        <div className="mt-3 rounded-xl bg-bg p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-32 shrink-0 font-semibold">Google voice</span>
            {props.google ? (
              <audio controls preload="none" src={props.google.src} className="h-8 max-w-full" aria-label={`Google voice: ${props.label}`} />
            ) : props.ttsReady ? (
              <button className="btn-ghost !py-1 text-sm" disabled={pending} onClick={() => start(async () => setMsg(await makeGoogleRecordingAction(props.promptKey, props.current || props.defaultText)))}>
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
