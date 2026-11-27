"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { requireOwner } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { R2_STOP_BYTES, r2Put, r2Used } from "@/lib/r2";
import { saveSetting } from "@/lib/settings";
import { MUSIC_PLACES, ORIGINAL_MAX_BYTES, ORIGINAL_PIECE_BYTES, PIECE_SECONDS, originalKey, pieceKey, type MusicPlace } from "@/lib/music";

/* Music in Admin (Abraham, Nov 17, 2026): Owner only. The browser turns each song into phone-quality pieces. */

const MAX_PIECE_BYTES = 8000 * 2 * PIECE_SECONDS + 1024; // 8 kHz, 16-bit, mono WAV

/** Extra check HP2 (Nov 27, 2026): no new song once the free file storage (R2) is near its free limit. */
async function storageFull(adding = 0) {
  return (await r2Used()) + adding > R2_STOP_BYTES;
}

export async function startTrackAction(name: string): Promise<{ id: number }> {
  await requireOwner();
  if (await storageFull()) throw new Error("The free file storage is nearly full, so no new song can be uploaded. Remove old files or ask Hark.");
  const clean = name.replace(/\.[a-z0-9]+$/i, "").trim().slice(0, 120) || "Song";
  const [t] = await db.insert(schema.musicTracks).values({ name: clean, pieceSeconds: PIECE_SECONDS }).returning({ id: schema.musicTracks.id });
  return t;
}

export async function savePieceAction(fd: FormData): Promise<{ ok: boolean }> {
  await requireOwner();
  const id = Number(fd.get("id"));
  const n = Number(fd.get("n"));
  const file = fd.get("piece");
  if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(n) || n < 0 || n > 5000 || !(file instanceof File)) return { ok: false };
  const bytes = new Uint8Array(await file.arrayBuffer());
  // Only our own WAV pieces: "RIFF....WAVE", and no bigger than one piece
  const head = new TextDecoder().decode(bytes.slice(0, 12));
  if (bytes.length > MAX_PIECE_BYTES || !head.startsWith("RIFF") || head.slice(8) !== "WAVE") return { ok: false };
  await r2Put(pieceKey(id, n), bytes, "audio/wav");
  return { ok: true };
}

/** One 3 MB piece of the Owner's original file (kept for Download and full playback). */
export async function saveOriginalPieceAction(fd: FormData): Promise<{ ok: boolean }> {
  await requireOwner();
  const id = Number(fd.get("id"));
  const n = Number(fd.get("n"));
  const file = fd.get("piece");
  if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(n) || n < 0 || n > ORIGINAL_MAX_BYTES / ORIGINAL_PIECE_BYTES || !(file instanceof File)) return { ok: false };
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!bytes.length || bytes.length > ORIGINAL_PIECE_BYTES) return { ok: false };
  // Extra check HP2: an original of up to 200 MB is checked against the free limit as it arrives (every 10 pieces)
  if (n % 10 === 0 && (await storageFull(10 * ORIGINAL_PIECE_BYTES))) return { ok: false };
  await r2Put(originalKey(id, n), bytes, "application/octet-stream");
  return { ok: true };
}

/** The original file is all in: its name, type, size and number of pieces. */
export async function finishOriginalAction(id: number, info: { name: string; type: string; bytes: number; pieces: number }): Promise<{ ok: boolean }> {
  await requireOwner();
  if (!(info.bytes > 0 && info.bytes <= ORIGINAL_MAX_BYTES) || info.pieces !== Math.ceil(info.bytes / ORIGINAL_PIECE_BYTES)) return { ok: false };
  await db
    .update(schema.musicTracks)
    .set({ originalName: info.name.slice(0, 200), originalType: (info.type || "audio/mpeg").slice(0, 80), originalBytes: info.bytes, originalPieces: info.pieces })
    .where(eq(schema.musicTracks.id, id));
  revalidatePath("/admin/phone/music");
  return { ok: true };
}

export async function finishTrackAction(id: number, pieces: number, durationSec: number): Promise<{ ok: boolean }> {
  await requireOwner();
  await db.update(schema.musicTracks).set({ pieces, durationSec: Math.round(durationSec), complete: pieces > 0 }).where(eq(schema.musicTracks.id, id));
  revalidatePath("/admin/phone/music");
  return { ok: true };
}

export async function trashTrackAction(fd: FormData) {
  await requireOwner();
  const id = Number(fd.get("id"));
  if (id) await db.update(schema.musicTracks).set({ trashedAt: new Date() }).where(eq(schema.musicTracks.id, id));
  revalidatePath("/admin/phone/music");
}

/** Which songs play where, in order. */
export async function savePlacesAction(fd: FormData) {
  const owner = await requireOwner();
  for (const place of Object.keys(MUSIC_PLACES) as MusicPlace[]) {
    const ids = fd.getAll(place).map(String).filter((x) => /^\d+$/.test(x));
    await saveSetting(MUSIC_PLACES[place].setting as "musicStaffWait", ids.join(","), owner.userId);
  }
  revalidatePath("/admin/phone/music");
}
