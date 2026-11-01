import { handleVoice } from "@/lib/ivr/flow";
import { readTwilioRequest, twiml } from "@/lib/http/twilio-request";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ action: string }> }) {
  const { action } = await params;
  const { ok, body, query } = await readTwilioRequest(req);
  if (!ok) return new Response("Invalid signature", { status: 403 });
  const xml = await handleVoice({
    action,
    query,
    body,
    callSid: body.CallSid || "unknown",
    from: body.From || null,
  });
  return twiml(xml);
}
