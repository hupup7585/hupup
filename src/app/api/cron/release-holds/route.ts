import { releaseExpired } from "@/lib/orders";

export const dynamic = "force-dynamic";

/** Safety net: Vercel Cron calls this to release expired phone holds and unpaid orders. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const released = await releaseExpired();
  return Response.json({ released });
}
