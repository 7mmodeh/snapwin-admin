// middleware.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Routes to protect
  const adminRoutes = [
    "/dashboard",
    "/raffles",
    "/customers",
    "/payments",
    "/support",
    "/notifications",
  ];

  const isAdminRoute = adminRoutes.some(
    (base) => pathname === base || pathname.startsWith(`${base}/`)
  );

  if (!isAdminRoute) {
    return NextResponse.next();
  }

  const adminCookie = req.cookies.get("snapwin-admin");

  if (!adminCookie) {
    const loginUrl = new URL("/login", req.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

// Tell Next.js which routes to run middleware on
export const config = {
  matcher: [
    "/dashboard/:path*",
    "/raffles/:path*",
    "/customers/:path*",
    "/payments/:path*",
    "/support/:path*",
    "/notifications/:path*",
  ],
};
