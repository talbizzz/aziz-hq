import type { FlushSummary } from './flush.ts';

export interface TelegramConfig {
  bot_token: string | null;
  chat_id: string | null;
  webhook_secret: string | null;
  flush_secret: string | null;
  dashboard_url: string | null;
  functions_url: string | null;
}

export interface ServerDeps {
  loadConfig(): Promise<TelegramConfig>;
  /** The webhook handler for a complete configuration (grammY verifies the secret token itself). */
  webhook(config: TelegramConfig): (req: Request) => Promise<Response>;
  flush(config: TelegramConfig, req: Request): Promise<FlushSummary>;
  log(msg: string): void;
}

/** Constant-time string comparison (length differences are not hidden, contents are). */
export function safeEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (a == null || b == null) return false;
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

const text = (status: number, body: string) => new Response(body, { status });
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Routes: POST .../telegram (Telegram webhook), POST .../telegram/flush (pg_cron). Everything fails closed. */
export function createServer(deps: ServerDeps): (req: Request) => Promise<Response> {
  return async (req) => {
    const path = new URL(req.url).pathname.replace(/\/+$/, '');
    const isFlush = path.endsWith('/telegram/flush');
    const isWebhook = path.endsWith('/telegram');
    if (!isFlush && !isWebhook) return text(404, 'not found');
    if (req.method !== 'POST') return text(405, 'method not allowed');

    let config: TelegramConfig;
    try {
      config = await deps.loadConfig();
    } catch (e) {
      deps.log(`config load failed: ${e instanceof Error ? e.message : String(e)}`);
      return text(503, 'not configured');
    }

    if (isFlush) {
      if (!config.flush_secret || !config.bot_token || !config.chat_id || !config.dashboard_url)
        return text(503, 'not configured');
      if (!safeEqual(req.headers.get('x-flush-secret'), config.flush_secret))
        return text(401, 'denied');
      try {
        return json(200, await deps.flush(config, req));
      } catch (e) {
        deps.log(`flush failed: ${e instanceof Error ? e.message : String(e)}`);
        return text(500, 'flush failed');
      }
    }

    if (!config.bot_token || !config.chat_id || !config.webhook_secret)
      return text(503, 'not configured');
    return deps.webhook(config)(req);
  };
}
