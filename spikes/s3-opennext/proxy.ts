import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify, createLocalJWKSet } from "jose";

// Spike: does edge-style middleware work under OpenNext, with jose verifying the Access JWT?
export async function proxy(req: NextRequest) {
  if (!req.nextUrl.pathname.startsWith("/api/guarded")) return NextResponse.next();
  const token = req.headers.get("cf-access-jwt-assertion");
  if (!token || !process.env.ACCESS_JWKS_JSON) return new NextResponse("denied", { status: 401 });
  try {
    await jwtVerify(token, createLocalJWKSet(JSON.parse(process.env.ACCESS_JWKS_JSON)), { audience: process.env.CF_ACCESS_AUD });
    return NextResponse.next();
  } catch { return new NextResponse("denied", { status: 403 }); }
}
export const config = { matcher: ["/api/guarded/:path*"] };
