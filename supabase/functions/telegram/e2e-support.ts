import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';

export const repoRoot = join(import.meta.dirname, '../../..');

export function localSupabase() {
  const out = execFileSync('supabase', ['status', '-o', 'json'], {
    encoding: 'utf8',
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const s = JSON.parse(out.slice(out.indexOf('{'))) as Record<string, string>;
  return { url: s.API_URL!, secretKey: s.SECRET_KEY!, serviceRoleKey: s.SERVICE_ROLE_KEY! };
}

/** Runs SQL in the local database container (used for Vault secrets, which the API does not expose). */
export function psql(sql: string): string {
  return execFileSync(
    'docker',
    ['exec', 'supabase_db_aziz-hq', 'psql', '-U', 'postgres', '-tAc', sql],
    { encoding: 'utf8' },
  ).trim();
}

export const SECRETS = {
  token: '123:E2ETOKEN',
  chatId: '4242',
  webhook: 'e2e-webhook-secret',
  flush: 'e2e-flush-secret',
  dashboard: 'https://hq.e2e.test',
};

export function setVaultSecrets() {
  psql(
    "delete from vault.secrets where name in ('telegram_bot_token','telegram_chat_id','telegram_webhook_secret','flush_secret','functions_url','dashboard_url')",
  );
  for (const [name, value] of [
    ['telegram_bot_token', SECRETS.token],
    ['telegram_chat_id', SECRETS.chatId],
    ['telegram_webhook_secret', SECRETS.webhook],
    ['flush_secret', SECRETS.flush],
    ['functions_url', 'http://127.0.0.1:1/functions/v1'],
    ['dashboard_url', SECRETS.dashboard],
  ] as const) {
    psql(`select vault.create_secret('${value}', '${name}')`);
  }
}

export interface Call {
  method: string;
  // the mock records whatever Telegram would receive; tests index into it freely
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: Record<string, any>;
}

/** A mock Telegram Bot API that records calls; `failNext` makes the next sendMessage answer 500. */
export class MockTelegram {
  calls: Call[] = [];
  failNext = 0;
  private server!: Server;
  private nextMessageId = 500;
  root = '';

  async start() {
    this.server = createServer((req, res) => {
      let b = '';
      req.on('data', (c) => (b += c));
      req.on('end', () => {
        const method = req.url!.split('/').pop()!;
        this.calls.push({ method, body: b ? JSON.parse(b) : {} });
        res.setHeader('content-type', 'application/json');
        if (method === 'sendMessage' && this.failNext > 0) {
          this.failNext--;
          res.statusCode = 500;
          res.end(JSON.stringify({ ok: false, description: 'Internal Server Error' }));
          return;
        }
        res.end(
          JSON.stringify({
            ok: true,
            result: method === 'sendMessage' ? { message_id: this.nextMessageId++ } : true,
          }),
        );
      });
    });
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', r));
    this.root = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }
  stop() {
    this.server.close();
  }
  reset() {
    this.calls = [];
    this.failNext = 0;
  }
  of(method: string) {
    return this.calls.filter((c) => c.method === method);
  }
}

export interface RunningFunction {
  url: string;
  child: ChildProcess;
  stop(): void;
}

/** Starts the real function with plain Deno (same code as the edge runtime, minus the container). */
export async function startFunction(mock: MockTelegram): Promise<RunningFunction> {
  const local = localSupabase();
  const port = 18_000 + Math.floor(Math.random() * 1000);
  const child = spawn(
    'deno',
    [
      'run',
      '-A',
      '--config',
      'supabase/functions/telegram/deno.json',
      'supabase/functions/telegram/index.ts',
    ],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        PORT: String(port),
        SUPABASE_URL: local.url,
        SUPABASE_SERVICE_ROLE_KEY: local.serviceRoleKey,
        TELEGRAM_API_ROOT: mock.root,
        ENVIRONMENT: 'test',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const url = `http://127.0.0.1:${port}/telegram`;
  for (let i = 0; i < 200; i++) {
    try {
      await fetch(url, { method: 'POST' });
      return { url, child, stop: () => child.kill('SIGTERM') };
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  child.kill('SIGKILL');
  throw new Error('the function did not start');
}
