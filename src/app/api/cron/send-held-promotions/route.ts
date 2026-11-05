import { processHeldPromotions } from "@/lib/sms";

export const dynamic = "force-dynamic";

/**
 * Sends promotional texts that were held for quiet hours and are now due, rechecking consent and opt-out for each
 * one right before sending. Protected by CRON_SECRET. Not yet on a schedule (adding one changes vercel.json and
 * needs approval; on the Hobby plan a job can run at most once a day).
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return new Response("Unauthorized", { status: 401 });
  return Response.json(await processHeldPromotions());
}
