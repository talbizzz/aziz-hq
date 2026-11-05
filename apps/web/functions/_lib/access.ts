import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

export interface Env {
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
  /** Explicit environment name; Workers have no NODE_ENV (ADR-10). Only 'development' may run without Access. */
  ENVIRONMENT?: string;
}

const remoteJwks = (team: string): JWTVerifyGetKey =>
  createRemoteJWKSet(new URL(`https://${team}.cloudflareaccess.com/cdn-cgi/access/certs`));

// ADR-10: every request (static assets and pages.dev included) must carry a valid Cloudflare Access JWT. Fail closed.
export function createAccessMiddleware(
  jwksFor: (team: string) => JWTVerifyGetKey = remoteJwks,
): PagesFunction<Env> {
  return async (ctx) => {
    const { CF_ACCESS_TEAM_DOMAIN: team, CF_ACCESS_AUD: audience, ENVIRONMENT } = ctx.env;

    if (!team || !audience) {
      if (ENVIRONMENT === 'development') return ctx.next();
      return new Response('access not configured', { status: 500 });
    }

    const token = ctx.request.headers.get('cf-access-jwt-assertion');
    if (!token) return new Response('denied', { status: 403 });

    try {
      await jwtVerify(token, jwksFor(team), {
        audience,
        issuer: `https://${team}.cloudflareaccess.com`,
        algorithms: ['RS256'],
      });
    } catch {
      return new Response('denied', { status: 403 });
    }
    return ctx.next();
  };
}
