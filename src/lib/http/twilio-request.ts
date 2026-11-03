import twilio from "twilio";
import { config } from "@/lib/config";

/**
 * Every URL Twilio might have signed for this request.
 * Twilio signs the exact public URL it called (e.g. https://hupup.vercel.app/api/voice/incoming),
 * which can differ from PUBLIC_BASE_URL (e.g. https://hupupattractions.com) while the domain is
 * being moved, so we accept either the configured base or the forwarded host.
 */
export function candidateUrls(req: Request): string[] {
  const u = new URL(req.url);
  const path = `${u.pathname}${u.search}`;
  const urls = new Set<string>([`${config.baseUrl()}${path}`]);
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  if (host) {
    const proto = (req.headers.get("x-forwarded-proto") || "https").split(",")[0].trim();
    urls.add(`${proto}://${host.split(",")[0].trim()}${path}`);
  }
  return [...urls];
}

/** Parse a Twilio form POST and verify its X-Twilio-Signature. */
export async function readTwilioRequest(
  req: Request,
): Promise<{ ok: boolean; body: Record<string, string>; query: URLSearchParams }> {
  const u = new URL(req.url);
  const form = await req.formData();
  const body: Record<string, string> = {};
  form.forEach((v, k) => {
    body[k] = String(v);
  });
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token) {
    // Allowed only for local development / the simulate-call script.
    return { ok: !config.isProd(), body, query: u.searchParams };
  }
  const sig = req.headers.get("x-twilio-signature") || "";
  const ok = Boolean(sig) && candidateUrls(req).some((url) => twilio.validateRequest(token, sig, url, body));
  return { ok, body, query: u.searchParams };
}

export function twiml(xml: string, status = 200) {
  return new Response(xml, { status, headers: { "Content-Type": "text/xml; charset=utf-8" } });
}

export const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response/>';
