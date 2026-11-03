import { createLocalJWKSet, createRemoteJWKSet, jwtVerify } from "jose";

interface Env { CF_ACCESS_TEAM_DOMAIN?: string; CF_ACCESS_AUD?: string; ENVIRONMENT?: string; ACCESS_JWKS_JSON?: string }

// ADR-10: verify Cf-Access-Jwt-Assertion on every route except the Telegram webhook. Fail closed.
export const onRequest: PagesFunction<Env> = async (ctx) => {
  const url = new URL(ctx.request.url);
  if (url.pathname === "/api/telegram/webhook") return ctx.next();
  const { CF_ACCESS_TEAM_DOMAIN: team, CF_ACCESS_AUD: aud, ENVIRONMENT, ACCESS_JWKS_JSON } = ctx.env;
  if (!team || !aud) return ENVIRONMENT === "development" ? ctx.next() : new Response("access not configured", { status: 500 });
  const token = ctx.request.headers.get("cf-access-jwt-assertion");
  if (!token) return new Response("denied", { status: 403 });
  try {
    // ACCESS_JWKS_JSON: spike-only override so the accept path can be tested without Cloudflare
    const jwks = ACCESS_JWKS_JSON ? createLocalJWKSet(JSON.parse(ACCESS_JWKS_JSON)) : createRemoteJWKSet(new URL(`https://${team}.cloudflareaccess.com/cdn-cgi/access/certs`));
    await jwtVerify(token, jwks, { audience: aud, issuer: `https://${team}.cloudflareaccess.com` });
    return ctx.next();
  } catch { return new Response("denied", { status: 403 }); }
};
