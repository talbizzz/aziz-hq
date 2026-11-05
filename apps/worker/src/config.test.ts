import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

const required = { SUPABASE_URL: 'http://127.0.0.1:54321', SUPABASE_SECRET_KEY: 'sb_secret_x' };

describe('loadConfig', () => {
  it('applies the documented defaults', () => {
    const c = loadConfig(required);
    expect(c).toMatchObject({
      supabaseUrl: 'http://127.0.0.1:54321',
      supabaseSecretKey: 'sb_secret_x',
      concurrency: 2,
      pollIntervalMs: 2000,
      leaseSeconds: 120,
      heartbeatIntervalMs: 60000,
      taskTimeoutMs: 2700000,
      shutdownGraceMs: 30000,
    });
    expect(c.workerId).toMatch(/-\d+$/);
  });

  it('reads overrides', () => {
    const c = loadConfig({
      ...required,
      WORKER_ID: 'w9',
      WORKER_CONCURRENCY: '3',
      LEASE_SECONDS: '10',
      POLL_INTERVAL_MS: '50',
    });
    expect(c).toMatchObject({
      workerId: 'w9',
      concurrency: 3,
      leaseSeconds: 10,
      pollIntervalMs: 50,
    });
  });

  it('names the missing required variable', () => {
    expect(() => loadConfig({ SUPABASE_SECRET_KEY: 'k' })).toThrow(/SUPABASE_URL/);
    expect(() => loadConfig({ SUPABASE_URL: 'http://x.test' })).toThrow(/SUPABASE_SECRET_KEY/);
  });

  it('rejects invalid numbers and urls', () => {
    expect(() => loadConfig({ ...required, WORKER_CONCURRENCY: '0' })).toThrow(
      /WORKER_CONCURRENCY/,
    );
    expect(() => loadConfig({ ...required, LEASE_SECONDS: 'abc' })).toThrow(/LEASE_SECONDS/);
    expect(() => loadConfig({ ...required, SUPABASE_URL: 'not a url' })).toThrow(/SUPABASE_URL/);
  });
});
