import { NextRequest, NextResponse } from "next/server";
import {
  isCustomerOnlyPath,
  isLocalAdminHost,
  isMenuBlockedApiPath,
  isMenuHost,
  isOrderingPath,
  isPortalHost,
  shouldBlockAdminOnHost,
  toInternalAdminPath,
  toPortalPath,
} from "@/lib/domains/host-routing";

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icons/|.*\\.(?:png|jpg|jpeg|webp|svg|ico|woff2?|txt|xml)$).*)",
  ],
};

function rewrite(request: NextRequest, internalPath: string) {
  const url = request.nextUrl.clone();
  url.pathname = internalPath;
  return NextResponse.rewrite(url);
}

function redirectHome(request: NextRequest) {
  const target = request.nextUrl.clone();
  target.pathname = "/";
  target.search = "";
  return NextResponse.redirect(target);
}

export function middleware(request: NextRequest) {
  const host = request.headers.get("host");
  const pathname = request.nextUrl.pathname;

  // Local development stays on the current origin. Never send /admin to PORTAL.
  if (isLocalAdminHost(host)) {
    return NextResponse.next();
  }

  // --- Digital menu host (VIEW ONLY) ---
  if (isMenuHost(host)) {
    if (pathname === "/sw.js" || pathname === "/manifest.webmanifest") {
      return new NextResponse(null, { status: 404 });
    }

    if (pathname.startsWith("/api")) {
      if (isMenuBlockedApiPath(pathname)) {
        return NextResponse.json(
          { ok: false, error: "Ordering is disabled on the menu display domain" },
          { status: 403 }
        );
      }
      return NextResponse.next();
    }

    if (isOrderingPath(pathname)) {
      return redirectHome(request);
    }

    if (pathname === "/" || pathname === "/menu-display") {
      return rewrite(request, "/menu-display");
    }

    // Unknown paths → menu home
    return redirectHome(request);
  }

  // --- Admin portal host ---
  if (isPortalHost(host)) {
    if (pathname === "/sw.js") {
      return new NextResponse(null, { status: 404 });
    }
    if (pathname === "/manifest.webmanifest") {
      return NextResponse.next();
    }

    if (pathname.startsWith("/admin")) {
      const clean = toPortalPath(pathname);
      const target = request.nextUrl.clone();
      target.pathname = clean;
      return NextResponse.redirect(target);
    }

    if (pathname.startsWith("/api")) {
      return NextResponse.next();
    }

    if (isCustomerOnlyPath(pathname) || pathname.startsWith("/menu-display")) {
      const target = request.nextUrl.clone();
      target.pathname = "/";
      return NextResponse.redirect(target);
    }

    return rewrite(request, toInternalAdminPath(pathname));
  }

  // --- Public production host: block /admin ---
  if (shouldBlockAdminOnHost(host) && pathname.startsWith("/admin")) {
    return redirectHome(request);
  }

  return NextResponse.next();
}
