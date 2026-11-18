"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { finishOriginalAction, finishTrackAction, saveOriginalPieceAction, savePieceAction, startTrackAction } from "./actions";

const RATE = 8000; // phone quality
const PIECE_SECONDS = 8;
const ORIGINAL_PIECE = 3 * 1024 * 1024; // the original file goes up in 3 MB pieces (under the 4.5 MB upload limit)
const ORIGINAL_MAX = 200 * 1024 * 1024;

/** 16-bit mono WAV for one piece of samples (-1..1). */
function wav(samples: Float32Array): Blob {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + samples.length * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, RATE, true);
  v.setUint32(28, RATE * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 0x7fff, true);
  return new Blob([buf], { type: "audio/wav" });
}

/** Upload songs (MP3, WAV, M4A): each is cut into phone-quality pieces in this browser, then saved. */
export default function MusicUpload() {
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function upload(file: File): Promise<boolean> {
    try {
      setStatus(`Reading ${file.name}...`);
      const ctx = new AudioContext();
      const decoded = await ctx.decodeAudioData(await file.arrayBuffer());
      await ctx.close();
      const off = new OfflineAudioContext(1, Math.ceil(decoded.duration * RATE), RATE);
      const src = off.createBufferSource();
      src.buffer = decoded;
      src.connect(off.destination);
      src.start();
      const phone = (await off.startRendering()).getChannelData(0);
      const per = RATE * PIECE_SECONDS;
      const count = Math.ceil(phone.length / per);
      const { id } = await startTrackAction(file.name);
      for (let n = 0; n < count; n++) {
        setStatus(`Saving ${file.name}: ${Math.round(((n + 1) / count) * 100)}%`);
        const fd = new FormData();
        fd.set("id", String(id));
        fd.set("n", String(n));
        fd.set("piece", new File([wav(phone.slice(n * per, (n + 1) * per))], `${n}.wav`, { type: "audio/wav" }));
        const r = await savePieceAction(fd);
        if (!r.ok) throw new Error("A piece could not be saved.");
      }
      // The original file, full quality, for Download and full playback (Abraham, Nov 18, 2026)
      if (file.size <= ORIGINAL_MAX) {
        const parts = Math.ceil(file.size / ORIGINAL_PIECE);
        for (let n = 0; n < parts; n++) {
          setStatus(`Keeping the original of ${file.name}: ${Math.round(((n + 1) / parts) * 100)}%`);
          const fd = new FormData();
          fd.set("id", String(id));
          fd.set("n", String(n));
          fd.set("piece", new File([file.slice(n * ORIGINAL_PIECE, (n + 1) * ORIGINAL_PIECE)], `${n}`, { type: "application/octet-stream" }));
          const r = await saveOriginalPieceAction(fd);
          if (!r.ok) throw new Error("The original file could not be saved.");
        }
        await finishOriginalAction(id, { name: file.name, type: file.type, bytes: file.size, pieces: parts });
      }
      await finishTrackAction(id, count, decoded.duration);
      setStatus(`${file.name} is ready.`);
      return true;
    } catch (e) {
      setStatus(`Could not use ${file.name}: ${(e as Error).message || "unknown problem"}. Try an MP3 or WAV file.`);
      return false;
    }
  }

  /** Several songs at once, one after another, in the order chosen. */
  async function uploadAll(files: File[]) {
    setBusy(true);
    let ok = 0;
    for (const f of files) if (await upload(f)) ok++;
    setBusy(false);
    if (files.length > 1) setStatus(`${ok} of ${files.length} songs are ready.`);
    router.refresh();
  }

  return (
    <div data-music-upload>
      {/* A real button, like "Upload recording" on Hotline prompts; the file box is visually hidden but reachable */}
      <button type="button" className="btn-dark" disabled={busy} onClick={(e) => (e.currentTarget.nextElementSibling as HTMLInputElement | null)?.click()} data-music-upload-button>
        {busy ? "Working..." : "Upload songs"}
      </button>
      <input
        type="file"
        accept="audio/*"
        multiple
        className="sr-only"
        aria-label="Upload songs"
        data-music-file
        disabled={busy}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length) void uploadAll(files);
        }}
      />
      {status && <p className="mt-2 text-sm text-muted">{status}</p>}
    </div>
  );
}
