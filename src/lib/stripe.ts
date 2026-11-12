import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Stripe, for phone payments only (Sola stays for the website). The card charge itself happens inside Twilio's
 * Stripe Pay Connector; the website talks to Stripe only for refunds, fees and payouts, and disputes.
 *
 * Vercel variables (Hark adds the values; never in chat):
 *   STRIPE_READ_KEY      restricted key, READ only: Balance, Balance transactions, Payouts, Charges, Disputes
 *                        (Stripe fees and payouts in the books, and the phone payment status in Admin)
 *   STRIPE_WRITE_KEY     restricted key: Refunds WRITE, Disputes WRITE, Files WRITE, Charges READ, PaymentIntents READ
 *                        (Refund from Admin and Send proof for a dispute)
 *   STRIPE_WEBHOOK_SECRET  signing secret of the webhook endpoint https://hupupattractions.com/api/stripe/webhook
 * Test-mode keys (rk_test_...) while Stripe is in the sandbox; live keys (rk_live_...) only after Abraham's yes.
 */
export type StripeKeyUse = "read" | "write";

export function stripeKey(use: StripeKeyUse, env: Record<string, string | undefined> = process.env) {
  return use === "read" ? env.STRIPE_READ_KEY : env.STRIPE_WRITE_KEY;
}

/** "test" or "live" from the key (rk_test_ / rk_live_), or null when no key is set yet. */
export function stripeMode(env: Record<string, string | undefined> = process.env): "test" | "live" | null {
  const k = env.STRIPE_READ_KEY || env.STRIPE_WRITE_KEY || "";
  if (/^(rk|sk)_test_/.test(k)) return "test";
  if (/^(rk|sk)_live_/.test(k)) return "live";
  return null;
}

export class StripeError extends Error {
  constructor(message: string, public status = 0, public code?: string) {
    super(message);
  }
}

/** Form-encode nested params the way Stripe expects (evidence[customer_name]=...). */
export function formEncode(params: Record<string, unknown>, prefix = ""): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === "object") out.push(...formEncode(v as Record<string, unknown>, key));
    else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
  }
  return out;
}

export async function stripeApi<T = Record<string, unknown>>(
  use: StripeKeyUse,
  method: "GET" | "POST",
  path: string,
  params: Record<string, unknown> = {},
  opts: { idempotencyKey?: string; fetcher?: typeof fetch } = {},
): Promise<T> {
  const key = stripeKey(use);
  if (!key) throw new StripeError(`Not active yet: ${use === "read" ? "STRIPE_READ_KEY" : "STRIPE_WRITE_KEY"} isn't in Vercel.`);
  const body = formEncode(params).join("&");
  const url = `https://api.stripe.com${path}${method === "GET" && body ? `?${body}` : ""}`;
  const res = await (opts.fetcher ?? fetch)(url, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      ...(method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      ...(opts.idempotencyKey ? { "Idempotency-Key": opts.idempotencyKey } : {}),
    },
    body: method === "POST" ? body : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as { error?: { message?: string; code?: string } } & T;
  if (!res.ok) throw new StripeError(json.error?.message || `Stripe answered ${res.status}`, res.status, json.error?.code);
  return json;
}

/** Stripe-Signature check (t=..., v1=...): HMAC-SHA256 of "t.payload" with the webhook secret, within 5 minutes. */
export function verifyStripeSignature(payload: string, header: string | null, secret: string | undefined, now = Date.now()): boolean {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=") as [string, string]));
  const t = Number(parts.t);
  const v1s = header.split(",").filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  if (!t || !v1s.length || Math.abs(now / 1000 - t) > 300) return false;
  const want = Buffer.from(createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex"));
  return v1s.some((v) => {
    const got = Buffer.from(v);
    return got.length === want.length && timingSafeEqual(got, want);
  });
}
