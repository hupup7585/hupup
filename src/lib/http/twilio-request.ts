import twilio from "twilio";
import { config } from "@/lib/config";

/** Parse a Twilio form POST and verify its X-Twilio-Signature. */
export async function readTwilioRequest(req: Request): Promise<{ ok: boolean; body: Record<string, string>; query: URLSearchParams }> {
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
  // Twilio signs the exact public URL it called; behind Vercel's proxy we rebuild it from PUBLIC_BASE_URL.
  const publicUrl = `${config.baseUrl()}${u.pathname}${u.search}`;
  const sig = req.headers.get("x-twilio-signature") || "";
  const ok = twilio.validateRequest(token, sig, publicUrl, body);
  return { ok, body, query: u.searchParams };
}

export function twiml(xml: string, status = 200) {
  return new Response(xml, { status, headers: { "Content-Type": "text/xml; charset=utf-8" } });
}
