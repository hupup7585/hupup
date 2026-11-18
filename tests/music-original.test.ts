import { beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

/* Music: real upload button, several songs, the original file kept for Download and full playback (Abraham, Nov 18, 2026). */
const h = vi.hoisted(() => ({ stored: new Map<string, Uint8Array>(), role: "owner" }));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/r2", async (orig) => ({
  ...(await orig<typeof import("@/lib/r2")>()),
  r2Put: async (key: string, data: Uint8Array) => void h.stored.set(key, new Uint8Array(data)),
  r2Get: async (key: string) => (h.stored.has(key) ? new Response(new Uint8Array(h.stored.get(key)!)) : new Response("no", { status: 404 })),
}));
vi.mock("@/lib/auth", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth")>()),
  requireOwner: async () => ({ userId: 1, role: "owner" }),
  currentStaff: async () => ({ userId: 1, role: h.role }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

import { db, schema } from "@/lib/db";
import { finishOriginalAction, finishTrackAction, saveOriginalPieceAction, startTrackAction } from "@/app/admin/(app)/phone/music/actions";
import { GET } from "@/app/api/admin/music/[id]/route";
import { joinWav, ORIGINAL_PIECE_BYTES, pieceKey } from "@/lib/music";

beforeAll(() => void 0);

describe("music original file", () => {
  it("the original goes up in 3 MB pieces and comes back whole, with its own name, for Download and playback", async () => {
    const { id } = await startTrackAction("Niggun.mp3");
    const size = ORIGINAL_PIECE_BYTES + 1000;
    const data = new Uint8Array(size).map((_, i) => i % 199);
    for (let n = 0; n < 2; n++) {
      const fd = new FormData();
      fd.set("id", String(id));
      fd.set("n", String(n));
      fd.set("piece", new File([data.subarray(n * ORIGINAL_PIECE_BYTES, (n + 1) * ORIGINAL_PIECE_BYTES)], `${n}`));
      expect((await saveOriginalPieceAction(fd)).ok).toBe(true);
    }
    expect((await finishOriginalAction(id, { name: "Niggun.mp3", type: "audio/mpeg", bytes: size, pieces: 2 })).ok).toBe(true);
    await finishTrackAction(id, 3, 24);
    const r = await GET(new Request(`https://x/api/admin/music/${id}?download=1`), { params: Promise.resolve({ id: String(id) }) });
    expect(r.status).toBe(200);
    expect(r.headers.get("content-disposition")).toContain('attachment; filename="Niggun.mp3"');
    const got = new Uint8Array(await r.arrayBuffer());
    expect(got.length).toBe(size);
    expect(got[size - 1]).toBe(data[size - 1]);
    const play = await GET(new Request(`https://x/api/admin/music/${id}`), { params: Promise.resolve({ id: String(id) }) });
    expect(play.headers.get("content-disposition")).toMatch(/^inline/);
  });
  it("a song from before (no original): the whole song from its pieces, as one WAV", async () => {
    const [t] = await db.insert(schema.musicTracks).values({ name: "Old", pieces: 2, complete: true }).returning();
    const piece = (b: number) => new Uint8Array(joinWav([new Uint8Array(10).fill(b)]));
    h.stored.set(pieceKey(t.id, 0), piece(1));
    h.stored.set(pieceKey(t.id, 1), piece(2));
    const r = await GET(new Request(`https://x/api/admin/music/${t.id}`), { params: Promise.resolve({ id: String(t.id) }) });
    const wav = new Uint8Array(await r.arrayBuffer());
    expect(wav.length).toBe(44 + 20);
    expect(new TextDecoder().decode(wav.slice(0, 4))).toBe("RIFF");
  });
  it("Owner only", async () => {
    h.role = "secretary";
    const r = await GET(new Request("https://x/api/admin/music/1"), { params: Promise.resolve({ id: "1" }) });
    expect(r.status).toBe(401);
    h.role = "owner";
  });
  it("a real button; the file box is reachable (not display:none) and takes several songs", () => {
    const s = readFileSync("src/app/admin/(app)/phone/music/MusicUpload.tsx", "utf8");
    expect(s).toContain('className="sr-only"');
    expect(s).toContain("multiple");
    expect(s).not.toContain('className="hidden"');
    expect(readFileSync("src/app/admin/(app)/phone/music/page.tsx", "utf8")).toContain("data-music-download");
  });
});
