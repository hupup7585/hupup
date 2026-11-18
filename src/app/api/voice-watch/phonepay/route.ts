import { after } from "next/server";
import { runWatchChunk, verifyWatch, watchUrl } from "@/lib/phonepay-watch";

export const dynamic = "force-dynamic";
// Each chunk watches about 45 seconds, then starts the next one (works within the free plan's one-minute limit)
export const maxDuration = 60;

/** The PhonePay watcher (Abraham, Nov 17, 2026): signed by our server; answers at once and watches in the background. */
export async function POST(req: Request) {
  const u = new URL(req.url);
  const a = Number(u.searchParams.get("a"));
  if (!verifyWatch(a, u.searchParams.get("s"))) return new Response("Not found", { status: 404 });
  after(async () => {
    const more = await runWatchChunk(a).catch((e) => (console.error("[phonepay watch]", (e as Error).message), false));
    if (more) await fetch(watchUrl(a), { method: "POST" }).catch(() => null);
  });
  return new Response(null, { status: 202 });
}
