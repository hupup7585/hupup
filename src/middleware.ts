import { NextResponse, type NextRequest } from "next/server";

/** Fast gate: no session cookie -> login page. The real session check happens server-side in requireAdmin(). */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/admin/login")) return NextResponse.next();
  // Sola bridge (Abraham, Nov 18, 2026): a separate admin API key in a header, checked in the route itself
  if (pathname.startsWith("/api/admin/sola/") && req.headers.get("x-admin-api-key")) return NextResponse.next();
  if (!req.cookies.get("hup_admin")) {
    if (pathname.startsWith("/api/admin")) return new NextResponse("Unauthorized", { status: 401 });
    const url = req.nextUrl.clone();
    url.pathname = "/admin/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/admin/:path*", "/api/admin/:path*"] };
