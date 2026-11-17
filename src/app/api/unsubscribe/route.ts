import { unsubscribe } from "@/lib/unsubscribe";

export const dynamic = "force-dynamic";

/** One-click unsubscribe from the email app's own button (List-Unsubscribe-Post). Signed link only. */
export async function POST(req: Request) {
  const u = new URL(req.url);
  const done = await unsubscribe(u.searchParams.get("e"), u.searchParams.get("s"));
  return new Response(done ? "Unsubscribed" : "Not valid", { status: done ? 200 : 400 });
}
