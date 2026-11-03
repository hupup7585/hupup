import twilio from "twilio";
import { readTwilioRequest, twiml } from "@/lib/http/twilio-request";
import { handleInboundSms } from "@/lib/sms-inbound";

export const dynamic = "force-dynamic";

/** Twilio "A message comes in" webhook for the hotline number. */
export async function POST(req: Request) {
  const { ok, body } = await readTwilioRequest(req);
  if (!ok) return new Response("Invalid signature", { status: 403 });
  const r = await handleInboundSms(body);
  const resp = new twilio.twiml.MessagingResponse();
  if (r.reply) resp.message(r.reply);
  return twiml(resp.toString());
}
