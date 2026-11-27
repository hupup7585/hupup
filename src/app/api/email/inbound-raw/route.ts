import { inboundEmailSecret } from "@/lib/signed-link";
import { timingSafeEqual } from "node:crypto";
import { receiveRawPiece } from "@/lib/inbox";

export const dynamic = "force-dynamic";

/**
 * info@ mail from the Cloudflare Email Worker (cloudflare/info-inbox-worker.js): the full original email, sent in
 * pieces of up to 3 MB (?id=<upload id>&i=<piece>&n=<pieces>). Needs the shared INBOUND_EMAIL_SECRET header.
 */
export async function POST(req: Request) {
  const secret = inboundEmailSecret();
  const got = req.headers.get("x-inbound-secret") ?? "";
  if (!secret || got.length !== secret.length || !timingSafeEqual(Buffer.from(got), Buffer.from(secret))) {
    console.warn("[inbound email] refused: wrong or missing secret");
    return new Response("Forbidden", { status: 403 });
  }
  const q = new URL(req.url).searchParams;
  try {
    const r = await receiveRawPiece(q.get("id") ?? "", Number(q.get("i")), Number(q.get("n")), Buffer.from(await req.arrayBuffer()), req.headers.get("x-envelope-from"));
    // One line per piece, so a test email can be confirmed in the logs; no sender, subject or text is logged
    console.log(`[inbound email] piece ${q.get("i")} of ${q.get("n")} received${r.complete ? (r.duplicate ? ", already in the Admin inbox" : ", saved to the Admin inbox") : ""}`);
    return Response.json(r);
  } catch (e) {
    console.error("[inbound email] failed:", (e as Error).message);
    return new Response((e as Error).message, { status: 400 });
  }
}
