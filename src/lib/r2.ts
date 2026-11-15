import { createHash } from "node:crypto";
import { AwsClient } from "aws4fetch";
import { sum } from "drizzle-orm";
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

export async function r2Used(): Promise<number> {
  const [row] = await db.select({ n: sum(schema.deliveryPhotos.sizeBytes) }).from(schema.deliveryPhotos);
  return Number(row?.n ?? 0);
}

export async function r2Put(key: string, data: Uint8Array, contentType: string) {
  const { client, base } = await r2();
  const r = await client.fetch(`${base}/${key}`, { method: "PUT", body: new Uint8Array(data), headers: { "content-type": contentType } });
  if (!r.ok) throw new Error(`Photo storage refused the file (${r.status}).`);
}

export async function r2Get(key: string): Promise<Response> {
  const { client, base } = await r2();
  return client.fetch(`${base}/${key}`);
}

/** For tests. */
export function _resetR2() {
  cached = null;
}
