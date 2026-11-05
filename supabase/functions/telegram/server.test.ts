import { describe, expect, it, vi } from 'vitest';
import { createServer, safeEqual, type ServerDeps, type TelegramConfig } from './server.ts';

const config: TelegramConfig = {
  bot_token: '1:T',
  chat_id: '4242',
  webhook_secret: 'whsec',
  flush_secret: 'flushsec',
  dashboard_url: 'https://hq.example.test',
  functions_url: 'https://p.supabase.co/functions/v1',
};

function setup(over: Partial<ServerDeps> = {}) {
  const webhookHandle = vi.fn<(req: Request) => Promise<Response>>(
    async () => new Response('webhook ok'),
  );
  const deps: ServerDeps = {
    loadConfig: vi.fn(async () => config),
    webhook: vi.fn(() => webhookHandle),
    flush: vi.fn<ServerDeps['flush']>(async () => ({
      sent: 1,
      deferred: 0,
      skipped: 0,
      failed: 0,
      digestSent: false,
    })),
    log: vi.fn(),
    ...over,
  };
  return { deps, webhookHandle, server: createServer(deps) };
}
const req = (path: string, init: RequestInit = {}) =>
  new Request(`https://p.supabase.co/functions/v1${path}`, { method: 'POST', ...init });

describe('safeEqual', () => {
  it('compares strings of any length without short-circuiting on content', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(safeEqual('', '')).toBe(true);
    expect(safeEqual('abc', null)).toBe(false);
    expect(safeEqual(undefined, 'abc')).toBe(false);
  });
});

describe('routing', () => {
  it('hands POST /telegram to the webhook handler', async () => {
    const { server, webhookHandle } = setup();
    const res = await server(req('/telegram'));
    expect(await res.text()).toBe('webhook ok');
    expect(webhookHandle).toHaveBeenCalledOnce();
  });

  it('flushes on POST /telegram/flush with the right secret and returns the summary', async () => {
    const { server, deps } = setup();
    const res = await server(req('/telegram/flush', { headers: { 'x-flush-secret': 'flushsec' } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      sent: 1,
      deferred: 0,
      skipped: 0,
      failed: 0,
      digestSent: false,
    });
    expect(deps.flush).toHaveBeenCalledOnce();
  });

  it('rejects flush without or with a wrong secret (401) and does nothing', async () => {
    const { server, deps } = setup();
    expect((await server(req('/telegram/flush'))).status).toBe(401);
    expect(
      (await server(req('/telegram/flush', { headers: { 'x-flush-secret': 'nope' } }))).status,
    ).toBe(401);
    expect(deps.flush).not.toHaveBeenCalled();
  });

  it('answers 405 for non-POST and 404 for other paths', async () => {
    const { server } = setup();
    expect((await server(req('/telegram', { method: 'GET' }))).status).toBe(405);
    expect((await server(req('/telegram/flush', { method: 'GET' }))).status).toBe(405);
    expect((await server(req('/other/thing'))).status).toBe(404);
    expect((await server(req('/telegram/other'))).status).toBe(404);
  });

  it('is not configured (503) when a secret or the token is missing, without calling anything', async () => {
    for (const missing of ['bot_token', 'chat_id', 'webhook_secret'] as const) {
      const { server, deps } = setup({
        loadConfig: vi.fn(async () => ({ ...config, [missing]: null })),
      });
      expect((await server(req('/telegram'))).status, missing).toBe(503);
      expect(deps.webhook).not.toHaveBeenCalled();
    }
    for (const missing of ['flush_secret', 'dashboard_url', 'bot_token'] as const) {
      const { server, deps } = setup({
        loadConfig: vi.fn(async () => ({ ...config, [missing]: null })),
      });
      expect(
        (await server(req('/telegram/flush', { headers: { 'x-flush-secret': 'flushsec' } })))
          .status,
        missing,
      ).toBe(503);
      expect(deps.flush).not.toHaveBeenCalled();
    }
  });

  it('survives a config load failure with 503', async () => {
    const { server, deps } = setup({
      loadConfig: vi.fn(async () => {
        throw new Error('db down');
      }),
    });
    expect((await server(req('/telegram'))).status).toBe(503);
    expect(deps.log).toHaveBeenCalled();
  });

  it('reports a flush failure as 500 without leaking details', async () => {
    const { server } = setup({
      flush: vi.fn(async () => {
        throw new Error('secret internal detail');
      }),
    });
    const res = await server(req('/telegram/flush', { headers: { 'x-flush-secret': 'flushsec' } }));
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain('secret internal detail');
  });
});
