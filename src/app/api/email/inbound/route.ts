import { timingSafeEqual } from "node:crypto";
import { handleCatalogEmail } from "@/lib/catalog-send";

export const dynamic = "force-dynamic";

/**
 * info@ catalog requests (Abraham, section 9), posted by a Cloudflare Email Worker as JSON {from, subject}.
 * Not active yet: needs Abraham's OK for the DNS change (Cloudflare Email Routing) and INBOUND_EMAIL_SECRET set.
 */
export async function POST(req: Request) {
  const secret = process.env.INBOUND_EMAIL_SECRET;
  const got = req.headers.get("x-inbound-secret") ?? "";
  if (!secret || got.length !== secret.length || !timingSafeEqual(Buffer.from(got), Buffer.from(secret))) return new Response("Forbidden", { status: 403 });
  const body = (await req.json().catch(() => null)) as { from?: string; subject?: string } | null;
  if (!body?.from) return new Response("Bad request", { status: 400 });
  const r = await handleCatalogEmail(body.from, body.subject ?? null);
  return Response.json(r);
}
