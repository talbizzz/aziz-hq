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

## With a real worker on hosted (2026-11-09)

The worker ran as a plain Node process on the owner's Mac against the hosted project, with a separate secret key created for the test (deleted afterwards), scripted `fake` agents only (no plan quota).

| Check | Result |
| --- | --- |
| Heartbeat appears within seconds of starting | pass |
| `fake-run`: parallel tasks, a task that failed once and was retried (2 attempts), then a gate opened by the worker's own scheduler tick | pass |
| Gate notification delivered to Telegram | pass, 39 s after it was queued (the flush job runs once a minute) |
| Approve pressed on the phone: decision `approve` via `telegram`; the run continued and finished (`Ship it` done, run `done`) | pass |
| Worker stopped: exactly one "Worker offline" alert | pass, about 4 min after the stop (3 min threshold plus the 3-minute watchdog cycle) |
| Worker restarted: exactly one "back online" alert, no repeated offline alert | pass, about 3 min after the restart |
| `run_done` (priority 0) held for the daily digest, not sent immediately | pass |

Test runs, the heartbeat row and the key file were removed afterwards (the append-only `events` rows remain by design).

## Not done yet

- Press-to-edit latency over 10 presses (median, p95), and the cold start after 10 idle minutes. Seen so far: about 1.5 s for the first update right after a deploy, about 0.2 s warm; the owner reports presses as instant.
- A message from a real second Telegram account (only forged updates were tested).
- The daily digest: the `last_digest_date` setting moved to 2026-11-09 at 08:00 Berlin time, so the job ran; whether a message arrived is for the owner to confirm. The `run_done` note from the test run was queued for it.
