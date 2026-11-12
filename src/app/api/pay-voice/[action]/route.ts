import { readTwilioRequest, twiml } from "@/lib/http/twilio-request";
import { handlePayVoice } from "@/lib/stripe-pay-voice";

export const dynamic = "force-dynamic";

/** The payment subaccount's webhooks (SIP domain voice URL = /api/pay-voice/incoming). Checked with its own token. */
export async function POST(req: Request, { params }: { params: Promise<{ action: string }> }) {
  const { action } = await params;
  const { ok, body, query } = await readTwilioRequest(req, process.env.TWILIO_PAY_AUTH_TOKEN);
  if (!ok || !process.env.TWILIO_PAY_AUTH_TOKEN) return new Response("Invalid signature", { status: 403 });
  return twiml(await handlePayVoice(action, query, body));
}
