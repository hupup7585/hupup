import crypto from "node:crypto";

/**
 * Admin sign-in with Google (Abraham, Nov 16, 2026). Google's free "Sign in with Google" (OAuth 2.0, scopes openid and
 * email only): no paid Google service, no card. Needs GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Vercel, from a
 * free OAuth client Hark creates in Google Cloud Console. Until both are set, the button shows "Not active yet".
 *
 * Only a Google account the Owner saved on an active staff member (Admin > Staff) can sign in; that check is in
 * googleLogin (src/lib/auth.ts).
 */
export const GOOGLE_STATE_COOKIE = "hup_google_state";
export const GOOGLE_NOT_SET_UP = "This Google account is not set up for Admin.";
export const GOOGLE_FAILED = "Google sign-in did not work. Please try again.";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

export function googleLoginActive(env: Record<string, string | undefined> = process.env) {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

/** The site address this request came in on (hupup.vercel.app, hupupattractions.com or a preview), for the callback. */
export function siteOrigin(req: Request): string {
  const h = req.headers;
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? new URL(req.url).host;
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export const callbackUrl = (origin: string) => `${origin}/api/auth/google/callback`;

/** A one-time state value (also kept in a short-lived cookie) so a sign-in can't be started by another site. */
export function newState(trust: boolean) {
  return `${crypto.randomBytes(24).toString("base64url")}.${trust ? 1 : 0}`;
}

export function authorizeUrl(origin: string, state: string, env: Record<string, string | undefined> = process.env) {
  const q = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID ?? "",
    redirect_uri: callbackUrl(origin),
    response_type: "code",
    scope: "openid email",
    state,
    prompt: "select_account",
  });
  return `${AUTH_URL}?${q}`;
}

export function sameState(a: string | null | undefined, b: string | null | undefined) {
  if (!a || !b) return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

type IdClaims = { iss?: string; aud?: string; email?: string; email_verified?: boolean | string; exp?: number };

/**
 * The checked Google email from an ID token we received straight from Google's token endpoint over HTTPS (Google's
 * guidance: such a token can be trusted without checking its signature). Issuer, audience, expiry and a verified email
 * are still checked. Returns null when anything is off.
 */
export function emailFromIdToken(idToken: string, clientId: string, now = Date.now()): string | null {
  const part = idToken.split(".")[1];
  if (!part) return null;
  let c: IdClaims;
  try {
    c = JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as IdClaims;
  } catch {
    return null;
  }
  if (c.iss !== "https://accounts.google.com" && c.iss !== "accounts.google.com") return null;
  if (c.aud !== clientId) return null;
  if (!c.exp || c.exp * 1000 < now) return null;
  if (!(c.email_verified === true || c.email_verified === "true")) return null;
  return c.email ? c.email.toLowerCase() : null;
}

/** Trade the one-time code for Google's ID token, then read the verified email. */
export async function googleEmailForCode(code: string, origin: string, env: Record<string, string | undefined> = process.env, fetcher: typeof fetch = fetch): Promise<string | null> {
  const res = await fetcher(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: env.GOOGLE_CLIENT_ID ?? "", client_secret: env.GOOGLE_CLIENT_SECRET ?? "", redirect_uri: callbackUrl(origin), grant_type: "authorization_code" }),
  });
  if (!res.ok) return null;
  const j = (await res.json().catch(() => null)) as { id_token?: string } | null;
  return j?.id_token ? emailFromIdToken(j.id_token, env.GOOGLE_CLIENT_ID ?? "") : null;
}

/** A Google email as the Owner types it in Admin > Staff (blank removes it). */
export function cleanGoogleEmail(raw: string | undefined): { value: string | null; error?: string } {
  const v = (raw ?? "").trim().toLowerCase();
  if (!v) return { value: null };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) || v.length > 200) return { value: null, error: "Enter a full Google email address, or leave it blank to remove it." };
  return { value: v };
}
