import { signingSecret } from "@/lib/secret";
import { createHmac, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { config } from "@/lib/config";
import { r2Delete, r2Put, r2Ready } from "@/lib/r2";

/**
 * Voicemail audio for the phone (Abraham, Nov 23, 2026): each message is cut into 5-second pieces when it arrives,
 * stored in Cloudflare R2 (free tier, not Vercel), so a listener can go back or forward 5 seconds and pause. Pieces
 * are deleted when a message is erased forever.
 */
export const PIECE_SECONDS = 5;

/** Splits a PCM WAV file into pieces of `seconds` each; every piece is a complete WAV file. */
export function splitWav(buf: Uint8Array, seconds = PIECE_SECONDS): Uint8Array[] {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const tag = (o: number) => String.fromCharCode(buf[o], buf[o + 1], buf[o + 2], buf[o + 3]);
  if (buf.byteLength < 44 || tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("not a WAV file");
  let fmt: Uint8Array | null = null;
  let byteRate = 0;
  let blockAlign = 1;
  let data: Uint8Array | null = null;
  for (let o = 12; o + 8 <= buf.byteLength; ) {
    const id = tag(o);
    const size = dv.getUint32(o + 4, true);
    const body = buf.subarray(o + 8, Math.min(o + 8 + size, buf.byteLength));
    if (id === "fmt ") {
      fmt = body;
      byteRate = dv.getUint32(o + 8 + 8, true);
      blockAlign = dv.getUint16(o + 8 + 12, true) || 1;
    } else if (id === "data") data = body;
    o += 8 + size + (size % 2);
  }
  if (!fmt || !data || !byteRate) throw new Error("WAV file without sound data");
  const step = Math.max(blockAlign, Math.floor((byteRate * seconds) / blockAlign) * blockAlign);
  const out: Uint8Array[] = [];
  for (let start = 0; start < data.byteLength; start += step) {
    const chunk = data.subarray(start, Math.min(start + step, data.byteLength));
    const piece = new Uint8Array(12 + 8 + fmt.byteLength + 8 + chunk.byteLength);
    const pv = new DataView(piece.buffer);
    piece.set([0x52, 0x49, 0x46, 0x46], 0);
    pv.setUint32(4, piece.byteLength - 8, true);
    piece.set([0x57, 0x41, 0x56, 0x45, 0x66, 0x6d, 0x74, 0x20], 8);
    pv.setUint32(16, fmt.byteLength, true);
    piece.set(fmt, 20);
    const d = 20 + fmt.byteLength;
    piece.set([0x64, 0x61, 0x74, 0x61], d);
    pv.setUint32(d + 4, chunk.byteLength, true);
    piece.set(chunk, d + 8);
    out.push(piece);
  }
  return out;
}

export const pieceKey = (audioId: number, n: number) => `voicemail/${audioId}/${n}.wav`;

/** The WAV of a Twilio recording (main account), retried while Twilio finishes the file. */
export async function twilioWav(recordingUrl: string, fetcher: typeof fetch = fetch, tries = 4): Promise<Uint8Array | null> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return null;
  const u = new URL(recordingUrl);
  if (u.hostname !== "api.twilio.com") return null;
  for (let i = 0; i < tries; i++) {
    const r = await fetcher(`${recordingUrl.replace(/\.(mp3|wav)$/, "")}.wav`, { headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}` } }).catch(() => null);
    if (r?.ok) return new Uint8Array(await r.arrayBuffer());
    if (i < tries - 1) await new Promise((res) => setTimeout(res, 700));
  }
  return null;
}

/** The message's pieces (made once; a forwarded copy uses the original's). Returns how many there are, 0 = none. */
export async function ensurePieces(v: { id: number; recordingUrl: string; pieces: number | null; audioOf: number | null }): Promise<number> {
  const audioId = v.audioOf ?? v.id;
  if (v.audioOf) {
    const [orig] = await db.select().from(schema.voicemails).where(eq(schema.voicemails.id, v.audioOf)).limit(1);
    return orig ? ensurePieces(orig) : 0;
  }
  if (v.pieces && v.pieces > 0) return v.pieces;
  if (!r2Ready()) return 0;
  try {
    const wav = await twilioWav(v.recordingUrl);
    if (!wav) return 0;
    const parts = splitWav(wav);
    for (let i = 0; i < parts.length; i++) await r2Put(pieceKey(audioId, i), parts[i], "audio/wav");
    await db.update(schema.voicemails).set({ pieces: parts.length }).where(eq(schema.voicemails.id, audioId));
    return parts.length;
  } catch (e) {
    console.error("[voicemail pieces]", (e as Error).message);
    return 0;
  }
}

export async function deletePieces(audioId: number, count: number) {
  for (let i = 0; i < count; i++) await r2Delete(pieceKey(audioId, i)).catch(() => null);
}

/** Signed link for one R2 voicemail file (a piece, a greeting, a name or a note); Twilio fetches it. */
const sign = (key: string, exp: number) => createHmac("sha256", signingSecret()).update(`vmr2:${key}:${exp}`).digest("hex").slice(0, 32);
export function r2AudioLink(key: string, now = Date.now()): string {
  const exp = Math.floor(now / 1000) + 2 * 86_400;
  return `${config.baseUrl()}/api/voicemail/r2?k=${encodeURIComponent(key)}&exp=${exp}&sig=${sign(key, exp)}`;
}
export function verifyR2AudioLink(key: string, exp: string | null, sig: string | null, now = Date.now()): boolean {
  const e = Number(exp);
  if (!key.startsWith("voicemail/") || key.includes("..") || !sig || !Number.isFinite(e) || e * 1000 < now) return false;
  const want = sign(key, e);
  const a = Buffer.from(want);
  const b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b); // byte lengths (deep check 29: a multibyte sig threw)
}

/** A recording made on the call (greeting, name, note) copied to R2 under its own key. */
export async function saveRecordingToR2(recordingUrl: string, key: string): Promise<boolean> {
  if (!r2Ready()) return false;
  const wav = await twilioWav(recordingUrl);
  if (!wav) return false;
  await r2Put(key, wav, "audio/wav");
  return true;
}
