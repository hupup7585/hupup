"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { finishTrackAction, savePieceAction, startTrackAction } from "./actions";

const RATE = 8000; // phone quality
const PIECE_SECONDS = 8;

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

  async function upload(file: File) {
    setBusy(true);
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
      await finishTrackAction(id, count, decoded.duration);
      setStatus(`${file.name} is ready.`);
      router.refresh();
    } catch (e) {
      setStatus(`Could not use that file: ${(e as Error).message || "unknown problem"}. Try an MP3 or WAV file.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-music-upload>
      <label className="btn-dark inline-block cursor-pointer">
        {busy ? "Working..." : "Upload a song"}
        <input type="file" accept="audio/*" className="hidden" disabled={busy} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
      </label>
      {status && <p className="mt-2 text-sm text-muted">{status}</p>}
    </div>
  );
}
