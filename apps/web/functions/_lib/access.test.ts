import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { type Env, createAccessMiddleware } from './access.js';

const TEAM = 'testteam';
const AUD = 'aud-123';
const ISSUER = `https://${TEAM}.cloudflareaccess.com`;

let privateKey: CryptoKey;
let otherKey: CryptoKey;
let getJwks: ReturnType<typeof createLocalJWKSet>;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  privateKey = pair.privateKey;
  otherKey = (await generateKeyPair('RS256')).privateKey;
  getJwks = createLocalJWKSet({
    keys: [{ ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256' }],
  });
});

const sign = (opts: { aud?: string; iss?: string; exp?: string; key?: CryptoKey } = {}) =>
  new SignJWT({ email: 'owner@example.test' })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer(opts.iss ?? ISSUER)
    .setAudience(opts.aud ?? AUD)
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? '5m')
    .sign(opts.key ?? privateKey);

const prod: Env = { CF_ACCESS_TEAM_DOMAIN: TEAM, CF_ACCESS_AUD: AUD, ENVIRONMENT: 'production' };

async function call(env: Env, path = '/', token?: string) {
  const next = vi.fn(async () => new Response('app'));
  const request = new Request(`https://hq.example.test${path}`, {
    headers: token ? { 'Cf-Access-Jwt-Assertion': token } : {},
  });
  const ctx = { request, env, next } as unknown as Parameters<
    ReturnType<typeof createAccessMiddleware>
  >[0];
  const res = await createAccessMiddleware(() => getJwks)(ctx);
  return { res, next };
}

describe('Access JWT middleware (ADR-10)', () => {
  it('passes a valid token to next()', async () => {
    const { res, next } = await call(prod, '/', await sign());
    expect(next).toHaveBeenCalledOnce();
    expect(await res.text()).toBe('app');
  });

  it('rejects a missing header with 403', async () => {
    const { res, next } = await call(prod, '/api/health');
    expect(res.status).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects a static asset path without the header', async () => {
    const { res, next } = await call(prod, '/assets/index-abc123.js');
    expect(res.status).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects the wrong audience, wrong issuer, expired, garbage and foreign-key tokens', async () => {
    for (const token of [
      await sign({ aud: 'other' }),
      await sign({ iss: 'https://evil.cloudflareaccess.com' }),
      await sign({ exp: '-1m' }),
      'garbage',
      await sign({ key: otherKey }),
    ]) {
      const { res, next } = await call(prod, '/', token);
      expect(res.status, token.slice(0, 20)).toBe(403);
      expect(next).not.toHaveBeenCalled();
    }
  });

  it('fails closed (500) when production config is missing', async () => {
    for (const env of [
      { ENVIRONMENT: 'production' },
      { ENVIRONMENT: 'production', CF_ACCESS_TEAM_DOMAIN: TEAM },
      { ENVIRONMENT: 'production', CF_ACCESS_AUD: AUD },
      {},
    ] as Env[]) {
      const { res, next } = await call(env, '/', await sign());
      expect(res.status).toBe(500);
      expect(next).not.toHaveBeenCalled();
    }
  });

  it('passes through in development when Access is not configured', async () => {
    const { next } = await call({ ENVIRONMENT: 'development' }, '/');
    expect(next).toHaveBeenCalledOnce();
  });

  it('still enforces the token in development once Access is configured', async () => {
    const { res } = await call({ ...prod, ENVIRONMENT: 'development' }, '/');
    expect(res.status).toBe(403);
  });
});
