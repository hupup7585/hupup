import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { googleLogin, homeFor } from "@/lib/auth";
import { GOOGLE_STATE_COOKIE, googleEmailForCode, googleLoginActive, sameState, siteOrigin } from "@/lib/google-login";

export const dynamic = "force-dynamic";

/** Google sends the person back here. Only a Google email saved on an active staff member signs in. */
export async function GET(req: Request) {
  const origin = siteOrigin(req);
  const fail = (why: "not_set_up" | "failed" | "not_active") => {
    const res = NextResponse.redirect(`${origin}/admin/login?google=${why}`);
    res.cookies.delete({ name: GOOGLE_STATE_COOKIE, path: "/api/auth/google" });
    return res;
  };
  if (!googleLoginActive()) return fail("not_active");
  const q = new URL(req.url).searchParams;
  const state = q.get("state");
  const saved = (await cookies()).get(GOOGLE_STATE_COOKIE)?.value;
  if (!sameState(state, saved) || !q.get("code")) return fail("failed");
  const email = await googleEmailForCode(q.get("code")!, origin).catch((e) => (console.error("[google sign-in] token exchange failed:", (e as Error).message), null));
  if (!email) return fail("failed");
  const r = await googleLogin(email, state!.endsWith(".1"));
  if (!r.ok || !r.role) return fail("not_set_up");
  const res = NextResponse.redirect(`${origin}${homeFor(r.role)}`);
  res.cookies.delete({ name: GOOGLE_STATE_COOKIE, path: "/api/auth/google" });
  return res;
}
