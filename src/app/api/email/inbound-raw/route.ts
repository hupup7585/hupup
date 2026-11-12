import { timingSafeEqual } from "node:crypto";
import { receiveRawPiece } from "@/lib/inbox";

export const dynamic = "force-dynamic";

/**
 * info@ mail from the Cloudflare Email Worker (cloudflare/info-inbox-worker.js): the full original email, sent in
 * pieces of up to 3 MB (?id=<upload id>&i=<piece>&n=<pieces>). Needs the shared INBOUND_EMAIL_SECRET header.
 */
export async function POST(req: Request) {
  const secret = process.env.INBOUND_EMAIL_SECRET;
  const got = req.headers.get("x-inbound-secret") ?? "";
  if (!secret || got.length !== secret.length || !timingSafeEqual(Buffer.from(got), Buffer.from(secret))) return new Response("Forbidden", { status: 403 });
  const q = new URL(req.url).searchParams;
  try {
    const r = await receiveRawPiece(q.get("id") ?? "", Number(q.get("i")), Number(q.get("n")), Buffer.from(await req.arrayBuffer()));
    return Response.json(r);
  } catch (e) {
    return new Response((e as Error).message, { status: 400 });
  }
}
