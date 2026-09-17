import { NextRequest, NextResponse } from "next/server";

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-pathname", pathname);

  const isProtectedPage = pathname.startsWith("/admin") && pathname !== "/admin/login";
  const isProtectedApi = pathname.startsWith("/api/admin") && pathname !== "/api/admin/login";

  if (!isProtectedPage && !isProtectedApi) {
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  const cookie = req.cookies.get("ttbik_admin")?.value;
  const expected = (process.env.ADMIN_PASSWORD || "").trim();
  const isAuthed = !!cookie && !!expected && cookie === expected;

  if (isAuthed) return NextResponse.next({ request: { headers: requestHeaders } });

  if (isProtectedApi) {
    return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  }

  const loginUrl = new URL("/admin/login", req.url);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*", "/mini-app", "/mini-app/:path*"],
};
