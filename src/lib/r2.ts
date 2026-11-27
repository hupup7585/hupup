import { createHash } from "node:crypto";
import { AwsClient } from "aws4fetch";
import { eq, sum } from "drizzle-orm";
import { db, schema } from "@/lib/db";

/**
 * Cloudflare R2 for delivery photos (Abraham, Nov 15, 2026). Free tier: 10 GB stored a month. Uses the limited token
 * Hark made (CLOUDFLARE_R2_WORKERS_TOKEN, R2 and Workers only) with CLOUDFLARE_ACCOUNT_ID. Cloudflare's rule for R2's
 * S3 keys: the access key is the token's ID and the secret is the SHA-256 of the token. Nothing here is ever logged.
 * The bucket (hupup-delivery-photos) is made by the build (scripts/deploy-setup.ts). Photos are private: staff see
 * them only through /api/admin/photos/[id] after signing in.
 */
export const R2_BUCKET = "hupup-delivery-photos";
/** Uploads stop well inside the free 10 GB, and the Owner is told before anything could cost money. */
export const R2_STOP_BYTES = 9 * 1024 * 1024 * 1024;
export const R2_WARN_BYTES = 8 * 1024 * 1024 * 1024;
export const PHOTO_MAX_BYTES = 4 * 1024 * 1024;

const token = (env: Record<string, string | undefined>) => env.CLOUDFLARE_R2_WORKERS_TOKEN || env.CLOUDFLARE_API_TOKEN || "";
export function r2Ready(env: Record<string, string | undefined> = process.env) {
  return Boolean(token(env) && env.CLOUDFLARE_ACCOUNT_ID);
}

let cached: { client: AwsClient; base: string } | null = null;
async function r2(env: Record<string, string | undefined> = process.env, fetcher: typeof fetch = fetch) {
  if (cached) return cached;
  const t = token(env);
  const account = env.CLOUDFLARE_ACCOUNT_ID;
  if (!t || !account) throw new Error("Photo storage is not set up yet (Cloudflare token or account ID missing in Vercel).");
  let id = "";
  for (const path of [`/accounts/${account}/tokens/verify`, "/user/tokens/verify"]) {
    const r = await fetcher(`https://api.cloudflare.com/client/v4${path}`, { headers: { authorization: `Bearer ${t}` } });
    const j = (await r.json().catch(() => ({}))) as { result?: { id?: string } };
    if (r.ok && j.result?.id) {
      id = j.result.id;
      break;
    }
  }
  if (!id) throw new Error("Photo storage could not sign in to Cloudflare.");
  cached = {
    client: new AwsClient({ accessKeyId: id, secretAccessKey: createHash("sha256").update(t).digest("hex"), service: "s3", region: "auto" }),
    base: `https://${account}.r2.cloudflarestorage.com/${R2_BUCKET}`,
  };
  return cached;
}

/**
 * Everything stored in the bucket: delivery photos, files sent or received with texts, and (extra check HP2, Nov 27,
 * 2026) the phone music (each song's original plus its phone pieces, removed songs too: their files are kept) and
 * Inbox attachments kept in R2. Used by every upload's free-tier stop.
 */
export async function r2Used(): Promise<number> {
  const [row] = await db.select({ n: sum(schema.deliveryPhotos.sizeBytes) }).from(schema.deliveryPhotos);
  const [files] = await db.select({ n: sum(schema.messageFiles.sizeBytes) }).from(schema.messageFiles);
  // a phone piece is at most 8 kHz x 16-bit x 8 seconds (+ header), counted at that size
  const [music] = await db.select({ orig: sum(schema.musicTracks.originalBytes), pieces: sum(schema.musicTracks.pieces) }).from(schema.musicTracks);
  const [inbox] = await db.select({ n: sum(schema.inboxFiles.sizeBytes) }).from(schema.inboxFiles).where(eq(schema.inboxFiles.inR2, true));
  return Number(row?.n ?? 0) + Number(files?.n ?? 0) + Number(music?.orig ?? 0) + Number(music?.pieces ?? 0) * MUSIC_PIECE_MAX_BYTES + Number(inbox?.n ?? 0);
}
const MUSIC_PIECE_MAX_BYTES = 8000 * 2 * 8 + 1024;

export async function r2Put(key: string, data: Uint8Array, contentType: string) {
  const { client, base } = await r2();
  const body = new Uint8Array(data);
  // Sign first, then send the bytes themselves: a signed Request turns the body into a stream with no size, and R2
  // refuses that with 411 (Length Required) — the music upload error of Nov 18, 2026.
  const signed = await client.sign(`${base}/${key}`, { method: "PUT", body, headers: { "content-type": contentType } });
  const headers = new Headers(signed.headers);
  headers.set("content-length", String(body.byteLength));
  const r = await fetch(signed.url, { method: "PUT", headers, body });
  if (!r.ok) throw new Error(`Photo storage refused the file (${r.status}).`);
}

export async function r2Delete(key: string) {
  const { client, base } = await r2();
  const r = await client.fetch(`${base}/${key}`, { method: "DELETE" });
  if (!r.ok && r.status !== 404) throw new Error(`Storage could not delete the file (${r.status}).`);
}

export async function r2Get(key: string): Promise<Response> {
  const { client, base } = await r2();
  return client.fetch(`${base}/${key}`);
}

/** For tests. */
export function _resetR2() {
  cached = null;
}
