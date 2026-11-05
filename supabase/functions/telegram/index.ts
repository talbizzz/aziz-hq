// Supabase Edge Function `telegram` (ADR-5, ADR-14). Deployed with verify_jwt = false: Telegram cannot send a Supabase JWT,
// so authentication is the webhook secret token + the owner chat id (POST /telegram) and the shared flush secret
// (POST /telegram/flush, called by pg_cron). All secrets come from Vault through the service_role-only RPC.
import { createClient } from '@supabase/supabase-js';
import { createHandler } from './handler.ts';
import { processFlush } from './flush.ts';
import { createServer, type TelegramConfig } from './server.ts';
import {
  createFlushStore,
  createHandlerStore,
  createTelegramApi,
  loadTelegramConfig,
} from './wiring.ts';

const env = (name: string) => Deno.env.get(name);
const log = (msg: string) => console.log('[telegram]', msg);

const db = createClient(env('SUPABASE_URL')!, env('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const apiRoot = env('TELEGRAM_API_ROOT') || undefined; // tests only: a mock Bot API

// Config is read once per cold start (secrets rotate rarely; a redeploy or a new isolate picks changes up).
let cached: Promise<TelegramConfig> | undefined;
const loadConfig = () =>
  (cached ??= loadTelegramConfig(db).catch((e) => ((cached = undefined), Promise.reject(e))));

// test-only clock: honoured solely when ENVIRONMENT=test
const nowFor = (req: Request) => {
  const forced = env('ENVIRONMENT') === 'test' ? req.headers.get('x-test-now') : null;
  return () => (forced ? new Date(forced) : new Date());
};

const server = createServer({
  loadConfig,
  webhook: (config) =>
    createHandler({
      token: config.bot_token!,
      secret: config.webhook_secret!,
      ownerChatId: Number(config.chat_id),
      store: createHandlerStore(db),
      apiRoot,
      log,
    }).handle,
  flush: (config, req) =>
    processFlush({
      store: createFlushStore(db),
      api: createTelegramApi({ token: config.bot_token!, apiRoot }),
      chatId: Number(config.chat_id),
      dashboardUrl: config.dashboard_url!,
      now: nowFor(req),
      log,
    }),
  log,
});

const port = env('PORT');
if (port) Deno.serve({ port: Number(port) }, server);
else Deno.serve(server);
