import { NextResponse } from "next/server";
import { GOOGLE_STATE_COOKIE, authorizeUrl, googleLoginActive, newState, siteOrigin } from "@/lib/google-login";

export const dynamic = "force-dynamic";

/** "Continue with Google" on the Admin sign-in page: off to Google's own sign-in screen. */
export async function GET(req: Request) {
  const origin = siteOrigin(req);
  if (!googleLoginActive()) return NextResponse.redirect(`${origin}/admin/login?google=not_active`);
  const trust = new URL(req.url).searchParams.get("trust") === "1";
  const state = newState(trust);
  const res = NextResponse.redirect(authorizeUrl(origin, state));
  res.cookies.set(GOOGLE_STATE_COOKIE, state, { httpOnly: true, secure: origin.startsWith("https"), sameSite: "lax", path: "/api/auth/google", maxAge: 600 });
  return res;
}
