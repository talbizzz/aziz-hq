import { createLocalJWKSet, createRemoteJWKSet, jwtVerify } from "jose";

// Verifies Cf-Access-Jwt-Assertion. Fail closed: missing config in production -> 500.
export async function verifyAccess(req: Request): Promise<{ ok: boolean; status: number; email?: string }> {
  const token = req.headers.get("cf-access-jwt-assertion");
  const team = process.env.CF_ACCESS_TEAM_DOMAIN, aud = process.env.CF_ACCESS_AUD;
  if (!team || !aud) return { ok: false, status: process.env.NODE_ENV === "production" ? 500 : 401 };
  if (!token) return { ok: false, status: 401 };
  try {
    // ACCESS_JWKS_JSON: spike-only override so the accept path can be tested without Cloudflare
    const jwks = process.env.ACCESS_JWKS_JSON
      ? createLocalJWKSet(JSON.parse(process.env.ACCESS_JWKS_JSON))
      : createRemoteJWKSet(new URL(`https://${team}.cloudflareaccess.com/cdn-cgi/access/certs`));
    const { payload } = await jwtVerify(token, jwks, { audience: aud, issuer: `https://${team}.cloudflareaccess.com` });
    return { ok: true, status: 200, email: payload.email as string | undefined };
  } catch {
    return { ok: false, status: 403 };
  }
}
