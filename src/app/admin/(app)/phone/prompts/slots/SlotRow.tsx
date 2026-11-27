"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { recordingChunkAction, selectRecordingAction, startRecordingAction } from "../actions";
import { confirmSlotAction, deleteSlotAction, markRecordedAction, renameSlotAction, setNameSlotTextAction, unconfirmSlotAction } from "./actions";

const CHUNK = 3 * 1024 * 1024;
const STYLE: Record<string, string> = {
  waiting: "bg-[#FFF4D6] text-[#7A5600]",
  confirmed: "bg-[#E7F1FB] text-navy",
  recorded: "bg-[#E7F1FB] text-navy",
  uploaded: "bg-[#E5F4E4] text-[#13895C]",
};

/** One recording slot: its exact text, status, and the next step (confirm, mark recorded, upload, use it). */
export default function SlotRow(props: { slotKey: string; label: string; text: string; status: "waiting" | "confirmed" | "recorded" | "uploaded"; statusWords: string; latestUpload: { id: number; url: string } | null; playing: boolean; liveRecordingId?: number | null; custom?: { name: string; plays: string } | null }) {
  const [msg, setMsg] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, start] = useTransition();
  const [progress, setProgress] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  // Nov 20, 2026: after every step the list reloads, so a new upload shows its player and the Use this one button
  const run = (fn: () => Promise<{ ok: boolean; message: string }>) =>
    start(async () => {
      setMsg(await fn());
      router.refresh();
    });

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
    router.refresh();
  }

  return (
    <tr data-slot={props.slotKey}>
      <td className="td align-top text-xs text-muted">
        {props.label}
        {props.custom?.plays && <span className="block">Plays: {props.custom.plays}</span>}
        {props.custom && (
          <span className="mt-1 flex gap-2">
            <button
              type="button"
              className="font-bold text-navy underline-offset-2 hover:underline"
              data-rename-slot
              onClick={() => {
                const name = window.prompt("New slot name", props.custom!.name);
                if (name && name.trim() && name.trim() !== props.custom!.name) run(() => renameSlotAction(props.slotKey, name));
              }}
            >
              Rename
            </button>
            <button
              type="button"
              className="font-bold text-[#b3261e] underline-offset-2 hover:underline"
              data-delete-slot
              onClick={() => {
                if (window.confirm(`Are you sure you want to delete the slot "${props.custom!.name}"? This cannot be undone.`)) run(() => deleteSlotAction(props.slotKey));
              }}
            >
              Delete
            </button>
          </span>
        )}
      </td>
      <td className="td align-top font-mono text-sm" data-slot-text>
        {props.text}
        {/^item:\d+(:plural)?$/.test(props.slotKey) && (
          <button
            type="button"
            className="mt-1 block font-sans text-xs font-bold text-navy underline-offset-2 hover:underline"
            data-edit-name-text
            title="Change only what this name slot says on the phone. The rental's name on the website and in Admin stays the same. Leave it empty to go back to the rental's name."
            onClick={() => {
              const t = window.prompt("What this name slot says on the phone (empty = the rental's name)", props.text);
              if (t !== null && t.trim() !== props.text) run(() => setNameSlotTextAction(props.slotKey, t));
            }}
          >
            Edit text
          </button>
        )}
      </td>
      <td className="td align-top">
        <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${STYLE[props.status]}`} data-slot-status>{props.statusWords}</span>
        {props.playing && <span className="mt-1 block text-xs text-[#13895C]">{props.latestUpload && props.latestUpload.id !== props.liveRecordingId ? "An older recording is playing on the line" : "Playing on the line"}</span>}
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
              {/* Nov 22, 2026: the button shows whenever the newest upload is not the one on the line (also when an older one is) */}
              {props.latestUpload.id !== props.liveRecordingId && (
                <button type="button" className="btn-dark !min-h-8 !py-1 text-xs" disabled={pending} onClick={() => run(() => selectRecordingAction(props.slotKey, props.latestUpload!.id))} data-use-recording>
                  Use this one
                </button>
              )}
            </>
          )}
        </div>
        {msg && (
          <p role="status" data-save-result={msg.ok ? "saved" : "failed"} className={`mt-1 inline-block rounded px-1.5 py-0.5 text-xs font-bold ${msg.ok ? "bg-[#E3F8EF] text-[#13895C]" : "bg-[#ffe6e4] text-[#b3261e]"}`}>
            {msg.ok ? msg.message || "Saved" : `Not saved. ${msg.message || "Please try again."}`}
          </p>
        )}
      </td>
    </tr>
  );
}
