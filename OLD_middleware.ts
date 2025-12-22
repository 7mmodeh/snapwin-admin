// middleware.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

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

  if (!isAdminRoute) return NextResponse.next();

  // UX cookie only — do not hard-block production navigation based on this cookie alone.
  // Client-side AdminLayout will verify Supabase auth + admin_users membership.
  return NextResponse.next();
}

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
