import { eq } from "drizzle-orm";
import { currentStaff } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { joinWav, originalKey, pieceKey } from "@/lib/music";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The Owner's original song file (Abraham, Nov 18, 2026), full quality, under its original name: plays in the page,
 * or downloads with ?download=1. Owner only. Streamed piece by piece from R2.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await currentStaff();
  if (!s || s.role !== "owner") return new Response("Unauthorized", { status: 401 });
  const id = Number((await ctx.params).id);
  const [t] = id ? await db.select().from(schema.musicTracks).where(eq(schema.musicTracks.id, id)).limit(1) : [];
  if (!t || !t.complete) return new Response("Not found", { status: 404 });
  const { r2Get } = await import("@/lib/r2");
  const download = new URL(req.url).searchParams.get("download") === "1";
  if (!t.originalPieces) {
    // Uploaded before Nov 18, 2026 (no original kept): the whole song from its phone-quality pieces, as one WAV
    const pcm: Uint8Array[] = [];
    for (let i = 0; i < t.pieces; i++) {
      const r = await r2Get(pieceKey(id, i));
      if (r.ok) pcm.push(new Uint8Array(await r.arrayBuffer()).subarray(44));
    }
    const wav = joinWav(pcm);
    return new Response(new Uint8Array(wav), {
      headers: {
        "content-type": "audio/wav",
        "content-disposition": `${download ? "attachment" : "inline"}; filename="${t.name.replace(/["\\\r\n]/g, "_")} (phone quality).wav"`,
        "cache-control": "private, no-store",
      },
    });
  }
  let n = 0;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (n >= t.originalPieces) return controller.close();
      const r = await r2Get(originalKey(id, n++));
      if (!r.ok) return controller.error(new Error("A piece of the song is missing."));
      controller.enqueue(new Uint8Array(await r.arrayBuffer()));
    },
  });
  const name = t.originalName ?? `${t.name}.mp3`;
  return new Response(stream, {
    headers: {
      "content-type": /^audio\//.test(t.originalType ?? "") ? t.originalType! : "audio/mpeg",
      "content-length": String(t.originalBytes),
      "content-disposition": `${download ? "attachment" : "inline"}; filename="${name.replace(/["\\\r\n]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
