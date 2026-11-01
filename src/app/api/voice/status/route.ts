import { handleCallStatus } from "@/lib/ivr/flow";
import { readTwilioRequest } from "@/lib/http/twilio-request";

export const dynamic = "force-dynamic";

/** Configure as the phone number's "Call status changes" webhook in Twilio. */
export async function POST(req: Request) {
  const { ok, body } = await readTwilioRequest(req);
  if (!ok) return new Response("Invalid signature", { status: 403 });
  if (body.CallSid) await handleCallStatus(body.CallSid, body.CallStatus || "");
  return new Response(null, { status: 204 });
}
