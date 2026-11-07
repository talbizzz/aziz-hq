# M3 live verification: Telegram on the hosted project (T3.11, partial)

Date: 2026-11-07. Project: hosted Supabase (free plan). Bot: a fresh bot created for the platform (not the spike bot). No token, secret or chat id appears here.

## Done and passing

| Check | Result |
| --- | --- |
| Six Vault secrets stored on hosted (`telegram_bot_token`, `telegram_chat_id`, `telegram_webhook_secret`, `flush_secret`, `functions_url`, `dashboard_url`); the two random ones generated locally, never printed | pass |
| `supabase functions deploy telegram --no-verify-jwt --use-api` | pass |
| `setWebhook` accepted; `getWebhookInfo`: no `last_error_message`, `pending_update_count` 0 | pass |
| POST without the secret header, with a wrong secret, and POST `/flush` without the flush secret | 401, 401, 401 |
| `/status` and `/help` from the owner | answered, quick (owner's observation) |
| `pg_cron` jobs `flush_notifications` (every minute) and `worker_watchdog` (every 3 min) active; `pg_net`, Vault and `pg_cron` all work on the free plan | pass, after the pg_net fix below |
| A critical gate (priority 2) opened by `scheduler_tick` produced one `gate_open` notification, sent to Telegram with Approve/Dismiss | pass |
| Approve pressed on the phone: decision `approve`, `decided_via = telegram`, task `done`; the press felt instant (owner's observation) | pass |
| Forged update from another Telegram user: `/pause 5` and a gate dismissal, both with the correct webhook secret | 200, ignored: no override created, decision unchanged |
| Forged repeat press with the opposite button from the owner | decision stays `approve` (idempotent) |

## Found by the live check, and fixed

1. **`pg_net` was not enabled on hosted** (`schema "net" does not exist`): every minute's flush failed. It ships enabled on the local stack only. Enabled by hand in the `extensions` schema, then declared in `supabase/schemas/05_extensions.sql` with a manual migration (PR #5).
2. **A rejected `answerCallbackQuery` became a 500.** grammY's `bot.catch` does not cover webhooks, so Telegram would redeliver such an update repeatedly. Every update that passes the secret check is now acknowledged with 200 and the failure is logged (unit tests added; PR #6). Verified live after redeploying the function.

Also noted: the gate stays `pending` until a scheduler tick promotes it, and the tick runs inside the worker, so no notification appears until a worker is running (here the tick was run by hand).

## Not done yet

- Press-to-edit latency over 10 presses (median, p95) and the cold start after 10 idle minutes: only the cold start right after a deploy was seen (about 1.5 s for `/help`; a warm no-op update answers in about 0.2 s).
- A message from a real second Telegram account (only forged updates were tested).
- "Worker offline" and "back online" alerts: need a worker running against the hosted project (needs the hosted secret key in the owner's shell).
- The daily digest at `digest_time`.
