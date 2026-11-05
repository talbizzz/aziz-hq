import { describe, expect, it } from 'vitest';
import { redactSecrets } from './redact.js';

// Secret-shaped values are assembled at runtime so no secret-looking literal sits in the repository (gitleaks).
const b64url = (s: string) => Buffer.from(s).toString('base64url');
const fake = {
  anthropic: ['sk', 'ant', 'api03', 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4'].join('-'),
  supabaseSecret: ['sb', 'secret', 'N7UND0UgjKTVKUodkm0HgxSvEMPvz'].join('_'),
  supabasePublishable: ['sb', 'publishable', 'ACJWlzQHlZjBrEguHvfOxg3BJgxAaH'].join('_'),
  jwt: [
    b64url('{"alg":"HS256","typ":"JWT"}'),
    b64url('{"role":"service_role","iss":"x"}'),
    b64url('signature-bytes-here'),
  ].join('.'),
  telegram: `${'123456789'}:${'AAEhBP0abcdefghijklmnopqrstuvwxyz01'}`,
  github: ['ghp', 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8'].join('_'),
  githubPat: [
    'github',
    'pat',
    '11ABCDEFG0abcdefghijkl_MNOPQRSTUVWXYZ0123456789abcdefghijklmnopqrstuv',
  ].join('_'),
  aws: ['AKIA', 'IOSFODNN7EXAMPL3'].join(''),
};

describe('redactSecrets', () => {
  it.each([
    ['anthropic', fake.anthropic],
    ['supabase', fake.supabaseSecret],
    ['supabase', fake.supabasePublishable],
    ['jwt', fake.jwt],
    ['telegram', fake.telegram],
    ['github', fake.github],
    ['github', fake.githubPat],
    ['aws', fake.aws],
  ])('redacts a %s secret', (kind, secret) => {
    const out = redactSecrets(`before ${secret} after`);
    expect(out).toBe(`before [REDACTED:${kind}] after`);
    expect(out).not.toContain(secret);
  });

  it('redacts bearer tokens but keeps the scheme, and credential assignments but keeps the key', () => {
    expect(redactSecrets('Authorization: Bearer abcdefghijklmnop1234567890')).toBe(
      'Authorization: Bearer [REDACTED:bearer]',
    );
    expect(redactSecrets('password=hunter2hunter2')).toBe('password=[REDACTED:credential]');
    expect(redactSecrets('{"api_key": "abcd1234efgh5678"}')).toBe(
      '{"api_key": "[REDACTED:credential]"}',
    );
    expect(redactSecrets('DB_PASSWORD: s3cr3tvalue99')).toBe('DB_PASSWORD: [REDACTED:credential]');
  });

  it('redacts several secrets in one text', () => {
    const out = redactSecrets(`a=${fake.anthropic}\nb=${fake.jwt}\nc=${fake.github}`);
    expect(out).not.toMatch(/sk-ant|eyJ|ghp_/);
    expect(out.match(/\[REDACTED:/g)).toHaveLength(3);
  });

  it('is idempotent', () => {
    const once = redactSecrets(`x ${fake.anthropic} y password=abcdefgh1234`);
    expect(redactSecrets(once)).toBe(once);
  });

  it('leaves ordinary text alone: UUIDs, commit hashes, short values, code', () => {
    const text = [
      'run 0b9c1f2e-7d4a-4e1b-9a33-5f6c8d2e1a77 at commit 3f786850e387550fdab836ed7e6dc881de23001b',
      'const token = getToken(); // password handling is in auth.ts',
      'the key is short: key=abc',
      'image: data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk',
      'version 1.2.3 and ratio 12:34',
    ].join('\n');
    expect(redactSecrets(text)).toBe(text);
  });

  it('never leaks a generated secret (property)', () => {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let seed = 7;
    const rand = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    const word = (n: number) =>
      Array.from({ length: n }, () => chars[Math.floor(rand() * chars.length)]).join('');
    for (let i = 0; i < 200; i++) {
      const secrets = [
        `${['sk', 'ant', 'api03'].join('-')}-${word(30 + Math.floor(rand() * 20))}`,
        ['ghp', word(36)].join('_'),
        `${['sb', 'secret'].join('_')}_${word(24)}`,
      ];
      const out = redactSecrets(`noise ${word(8)} ${secrets.join(' | ')} ${word(8)}`);
      for (const s of secrets) expect(out, s).not.toContain(s);
    }
  });
});
