import { after } from "next/server";
import { runWhileAwake } from "@/lib/cron-schedule";
import { handleVoice } from "@/lib/ivr/flow";
import { readTwilioRequest, twiml } from "@/lib/http/twilio-request";
import { twimlSummary } from "@/lib/ivr/twiml-log";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ action: string }> }) {
  const { action } = await params;
  const { ok, body, query } = await readTwilioRequest(req);
  if (!ok) return new Response("Invalid signature", { status: 403 });
  // The database is awake for this call anyway: the time-sensitive jobs get a chance to run, after the reply
  after(() => runWhileAwake().catch((e) => console.error("[run while awake]", e)));
  const xml = await handleVoice({
    action,
    query,
    body,
    callSid: body.CallSid || "unknown",
    from: body.From || null,
  });
  console.log(twimlSummary(action, xml)); // what the caller heard at this step (recording ids, spoken words)
  return twiml(xml);
}
