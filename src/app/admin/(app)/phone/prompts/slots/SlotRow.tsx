"use client";

import { useRef, useState, useTransition } from "react";
import { recordingChunkAction, selectRecordingAction, startRecordingAction } from "../actions";
import { confirmSlotAction, markRecordedAction, unconfirmSlotAction } from "./actions";

const CHUNK = 3 * 1024 * 1024;
const STYLE: Record<string, string> = {
  waiting: "bg-[#FFF4D6] text-[#7A5600]",
  confirmed: "bg-[#E7F1FB] text-navy",
  recorded: "bg-[#E7F1FB] text-navy",
  uploaded: "bg-[#E5F4E4] text-[#13895C]",
};

/** One recording slot: its exact text, status, and the next step (confirm, mark recorded, upload, use it). */
export default function SlotRow(props: { slotKey: string; label: string; text: string; status: "waiting" | "confirmed" | "recorded" | "uploaded"; statusWords: string; latestUpload: { id: number; url: string } | null; playing: boolean }) {
  const [msg, setMsg] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, start] = useTransition();
  const [progress, setProgress] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const run = (fn: () => Promise<{ ok: boolean; message: string }>) => start(async () => setMsg(await fn()));

  async function upload(file: File) {
    setMsg(null);
    const opened = await startRecordingAction(props.slotKey, file.name, file.size);
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
    <tr data-slot={props.slotKey}>
      <td className="td align-top text-xs text-muted">{props.label}</td>
      <td className="td align-top font-mono text-sm" data-slot-text>{props.text}</td>
      <td className="td align-top">
        <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${STYLE[props.status]}`} data-slot-status>{props.statusWords}</span>
        {props.playing && <span className="mt-1 block text-xs text-[#13895C]">Playing on the line</span>}
      </td>
      <td className="td align-top">
        <div className="flex flex-wrap gap-1">
          {props.status === "waiting" && (
            <button className="btn-dark !py-1 text-xs" disabled={pending} onClick={() => run(() => confirmSlotAction(props.slotKey))}>
              Confirm this exact text
            </button>
          )}
          {props.status === "confirmed" && (
            <button className="btn-ghost !py-1 text-xs" disabled={pending} onClick={() => run(() => markRecordedAction(props.slotKey))}>
              Mark recorded
            </button>
          )}
          {(props.status === "confirmed" || props.status === "recorded") && (
            <button className="btn-ghost !py-1 text-xs" disabled={pending} onClick={() => run(() => unconfirmSlotAction(props.slotKey))} data-unconfirm>
              Undo confirm
            </button>
          )}
          {props.status !== "waiting" && (
            <>
              <input ref={fileRef} type="file" accept=".mp3,.wav,audio/mpeg,audio/wav" className="sr-only" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
              <button className="btn-ghost !py-1 text-xs" disabled={pending || Boolean(progress)} onClick={() => fileRef.current?.click()}>
                {progress ?? "Upload recording"}
              </button>
            </>
          )}
          {props.latestUpload && (
            <>
              <audio controls preload="none" src={props.latestUpload.url} className="h-8 max-w-[14rem]" />
              {!props.playing && (
                <button className="btn-dark !py-1 text-xs" disabled={pending} onClick={() => run(() => selectRecordingAction(props.slotKey, props.latestUpload!.id))}>
                  Use this one
                </button>
              )}
            </>
          )}
        </div>
        {msg && <p className={`mt-1 text-xs font-semibold ${msg.ok ? "text-navy" : "text-[#b3261e]"}`}>{msg.message}</p>}
      </td>
    </tr>
  );
}
