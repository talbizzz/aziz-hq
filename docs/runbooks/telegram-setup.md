# Runbook: Telegram bot, Vault secrets, Edge Function

Everything here needs the hosted Supabase project (M1 T1.9). Never paste a token or secret into a chat, a PR or a file in the repo; use your shell, the Supabase SQL editor, or the password manager.

## 1. Create the bot

1. In Telegram, open `@BotFather`, send `/newbot`, pick a name and a username ending in `bot`. Keep the token in your password manager.
2. Send any message to your new bot, then find your chat id (a positive integer for a private chat):
   `curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getUpdates"` with the token in your shell environment, read `message.chat.id`.

## 2. Store the secrets in Vault

In the hosted project's SQL editor, once per name (values are yours; the names are fixed, the code reads exactly these):

```sql
select vault.create_secret('<bot token>', 'telegram_bot_token');
select vault.create_secret('<your chat id>', 'telegram_chat_id');
select vault.create_secret('<random, 24+ bytes>', 'telegram_webhook_secret');   -- openssl rand -hex 24
select vault.create_secret('<random, 24+ bytes>', 'flush_secret');              -- openssl rand -hex 24
select vault.create_secret('https://<project-ref>.supabase.co/functions/v1', 'functions_url');
select vault.create_secret('https://hq.aziztalbi.com', 'dashboard_url');
```

To rotate one, delete it (`delete from vault.secrets where name = '...'`) and create it again, then redeploy the function (it caches the config per cold start) and, for the webhook secret, re-run `setWebhook`.

## 3. Deploy the Edge Function

```
supabase functions deploy telegram --no-verify-jwt --project-ref "$SUPABASE_PROJECT_REF"
```

`--no-verify-jwt` matches `[functions.telegram] verify_jwt = false` in `supabase/config.toml`: Telegram cannot send a Supabase JWT, so the function authenticates with the webhook secret token plus the owner chat id (POST `/telegram`) and the flush secret (POST `/telegram/flush`, called by `pg_cron`).

## 4. Register the webhook

```
curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -d "url=https://$SUPABASE_PROJECT_REF.supabase.co/functions/v1/telegram" \
  -d "secret_token=$WEBHOOK_SECRET" \
  -d 'allowed_updates=["callback_query","message"]' \
  -d "drop_pending_updates=true"
```

`$WEBHOOK_SECRET` is the same value as the Vault secret `telegram_webhook_secret`. Check it with `getWebhookInfo` (no `last_error_message`, `pending_update_count` 0).

## 5. Verify

- Send `/status` to the bot: you get the worker, run and gate counts. Any other chat gets no reply (it is ignored and logged).
- `pnpm fake-run` (service key in your shell) creates a run with a gate; the gate arrives within a minute (the flush job runs every minute) with Approve / Dismiss buttons; pressing one edits the message and the run continues.
- Troubleshooting: webhook `401` in `getWebhookInfo` = secret mismatch; function `503` = a Vault secret is missing; no messages but no errors = `pg_cron` job `flush_notifications` not running (`select * from cron.job_run_details order by start_time desc limit 5`); quiet hours or "off today" hold normal gates back (they show in the dashboard inbox regardless).

## 6. Live verification checklist (T3.11)

Record each step in `docs/spikes/evidence/M3-live-*.md` (no tokens): hosted function deployed; `setWebhook` accepted; press-to-edit latency (10 presses, median and p95); cold start (first press after 10 minutes idle); double press is idempotent; a message from a second Telegram account is ignored; stop the worker and wait for exactly one "Worker offline" alert, restart it for one "back online"; the daily digest arrives at `digest_time`; `pg_cron`, `pg_net` and Vault work on the free plan.
