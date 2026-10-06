import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const protectedPrefixes = ["/dashboard", "/admin"];

export default function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const requiresAuth = protectedPrefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix + "/"),
  );

  if (!requiresAuth) {
    return NextResponse.next();
  }

  const session = request.cookies.get("ts_session")?.value;
  const preview = request.nextUrl.searchParams.get("preview") === "1";
  const isProduction = process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production";

  if (!session && !(preview && !isProduction)) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/admin/:path*"],
};
