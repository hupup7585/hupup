import { beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

/* Music like a radio (Abraham, Nov 17, 2026, items 5 and 10). In-memory database. */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});

import { db, schema } from "@/lib/db";
import { saveSetting } from "@/lib/settings";
import { nextPiece } from "@/lib/music";

const at = (s: number) => new Date(Date.UTC(2026, 10, 17, 12, 0, 0) + s * 1000);
let a = 0;
let b = 0;

beforeAll(async () => {
  process.env.PUBLIC_BASE_URL = "https://hupup.example";
  const [t1, t2] = await db
    .insert(schema.musicTracks)
    .values([
      { name: "Song A", pieces: 3, pieceSeconds: 8, durationSec: 24, complete: true },
      { name: "Song B", pieces: 2, pieceSeconds: 8, durationSec: 16, complete: true },
    ])
    .returning();
  a = t1.id;
  b = t2.id;
  await saveSetting("musicStaffWait", `${a},${b}`);
});

describe("music like a radio", () => {
  it("callers waiting together hear the same piece; pieces move on only while someone listens; then the next song, then the first again", async () => {
    expect(await nextPiece("staff", at(0))).toMatchObject({ trackId: a, piece: 0, url: `https://hupup.example/api/music/music/${a}/0.wav` });
    expect(await nextPiece("staff", at(3))).toMatchObject({ trackId: a, piece: 0 }); // a second caller joins the same piece
    expect(await nextPiece("staff", at(8))).toMatchObject({ trackId: a, piece: 1 });
    // nobody waiting for an hour: the music paused here; the next caller picks it up from the next piece
    expect(await nextPiece("staff", at(3600))).toMatchObject({ trackId: a, piece: 2 });
    expect(await nextPiece("staff", at(3608))).toMatchObject({ trackId: b, piece: 0 }); // song A done: song B
    expect(await nextPiece("staff", at(3616))).toMatchObject({ trackId: b, piece: 1 });
    expect(await nextPiece("staff", at(3624))).toMatchObject({ trackId: a, piece: 0 }); // the list again from the top
  });
  it("no songs for a place: no music", async () => {
    expect(await nextPiece("pay", at(0))).toBeNull();
  });
  it("Admin: Owner-only upload in phone-quality pieces, and a song list per place", () => {
    const page = readFileSync("src/app/admin/(app)/phone/music/page.tsx", "utf8");
    expect(page).toContain("await requireOwner()");
    expect(page).toContain("data-music-places");
    expect(readFileSync("src/app/admin/(app)/phone/music/MusicUpload.tsx", "utf8")).toContain("const RATE = 8000");
    expect(readFileSync("src/app/api/music/[...key]/route.ts", "utf8")).toContain("^music\\/\\d+\\/\\d+\\.wav$");
  });
});
