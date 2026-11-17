import { and, inArray, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { config } from "@/lib/config";
import { getSettings } from "@/lib/settings";

/*
 * Music like a radio (Abraham, Nov 17, 2026, item 10). Each song is kept as short pieces. For each place (waiting for
 * staff, connecting to the payment line) the system remembers which piece is playing and when it started:
 *  - a caller who starts waiting hears the piece that is playing now (callers waiting together hear the same piece,
 *    at most one piece apart);
 *  - when a piece has finished, the next request moves on to the next piece (the next song after the last piece,
 *    and back to the first song after the last one);
 *  - when nobody is waiting, nothing moves on: the music pauses there, and the next caller picks it up from that point.
 * Free: the pieces are in R2 (the free storage already used for photos) and Twilio plays them as ordinary audio.
 */
export const MUSIC_PLACES = {
  staff: { label: "Waiting for staff to answer", setting: "musicStaffWait" },
  pay: { label: "Connecting to the payment line", setting: "musicPayConnect" },
} as const;
export type MusicPlace = keyof typeof MUSIC_PLACES;
export const PIECE_SECONDS = 8;

type Exec = { execute: typeof db.execute };

export const pieceKey = (trackId: number, piece: number) => `music/${trackId}/${piece}.wav`;
export const pieceUrl = (trackId: number, piece: number) => `${config.baseUrl()}/api/music/${pieceKey(trackId, piece)}`;

/** The songs chosen for a place, in order (only complete, not in Garbage). */
export async function placeTracks(place: MusicPlace): Promise<{ id: number; pieces: number; pieceSeconds: number }[]> {
  const s = (await getSettings()) as Record<string, unknown>;
  const ids = String(s[MUSIC_PLACES[place].setting] ?? "")
    .split(",")
    .map((x) => Number(x.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
  if (!ids.length) return [];
  const rows = await db
    .select({ id: schema.musicTracks.id, pieces: schema.musicTracks.pieces, pieceSeconds: schema.musicTracks.pieceSeconds, complete: schema.musicTracks.complete })
    .from(schema.musicTracks)
    .where(and(inArray(schema.musicTracks.id, ids), isNull(schema.musicTracks.trashedAt)));
  return ids.map((id) => rows.find((r) => r.id === id && r.complete && r.pieces > 0)).filter((r): r is NonNullable<typeof r> => Boolean(r));
}

/**
 * The piece to play now for this place (radio rules above), or null when the place has no music.
 * One database row per place, locked while it is read and moved on, so callers waiting together get the same piece.
 */
export async function nextPiece(place: MusicPlace, now = new Date()): Promise<{ trackId: number; piece: number; url: string } | null> {
  const tracks = await placeTracks(place);
  if (!tracks.length) return null;
  return db.transaction(async (tx) => {
    await tx.execute(sql`INSERT INTO music_radio (place, track_pos, piece, started_at) VALUES (${place}, 0, 0, ${now.toISOString()}::timestamptz) ON CONFLICT (place) DO NOTHING`); // a new place starts at the first piece, now
    const r = await (tx as unknown as Exec).execute(sql`SELECT track_pos, piece, started_at FROM music_radio WHERE place = ${place} FOR UPDATE`);
    const row = r.rows[0] as { track_pos: number; piece: number; started_at: string | Date };
    let pos = Number(row.track_pos);
    let piece = Number(row.piece);
    const started = new Date(row.started_at);
    // The list changed (a song removed): start that place from the top
    if (pos >= tracks.length || piece >= tracks[pos].pieces) {
      pos = 0;
      piece = 0;
    } else if (now.getTime() >= started.getTime() + tracks[pos].pieceSeconds * 1000) {
      // This piece has finished: on to the next one (next song, then back to the first)
      piece += 1;
      if (piece >= tracks[pos].pieces) {
        piece = 0;
        pos = (pos + 1) % tracks.length;
      }
    } else {
      // Still playing: join the same piece
      return { trackId: tracks[pos].id, piece, url: pieceUrl(tracks[pos].id, piece) };
    }
    await tx.execute(sql`UPDATE music_radio SET track_pos = ${pos}, piece = ${piece}, started_at = ${now.toISOString()}::timestamptz WHERE place = ${place}`);
    return { trackId: tracks[pos].id, piece, url: pieceUrl(tracks[pos].id, piece) };
  });
}
