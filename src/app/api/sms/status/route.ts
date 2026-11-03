import { readTwilioRequest } from "@/lib/http/twilio-request";
import { handleSmsStatus } from "@/lib/sms-inbound";

export const dynamic = "force-dynamic";

/** Twilio message status callback (queued → sent → delivered / failed / undelivered). */
export async function POST(req: Request) {
  const { ok, body } = await readTwilioRequest(req);
  if (!ok) return new Response("Invalid signature", { status: 403 });
  await handleSmsStatus(body);
  return new Response(null, { status: 204 });
}
