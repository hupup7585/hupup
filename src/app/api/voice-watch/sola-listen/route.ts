import { helperHangup, helperSilence, verifyHelper } from "@/lib/phonepay-watch";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * The Sola hang-up helper calls these (Abraham, Nov 18, 2026, option a). Signed by our server; the helper holds no secret
 * and decides nothing: a hang-up happens only when Sola's own record shows the result, or after the silence check.
 */
export async function POST(req: Request) {
  const u = new URL(req.url);
  const a = Number(u.searchParams.get("a"));
  const what = u.searchParams.get("do") ?? "";
  if (!verifyHelper(a, what, u.searchParams.get("s"))) return new Response("Not found", { status: 404 });
  try {
    return Response.json(what === "hangup" ? await helperHangup(a) : await helperSilence(a));
  } catch (e) {
    console.error("[sola listen]", (e as Error).message);
    return Response.json({ result: null }, { status: 500 });
  }
}
