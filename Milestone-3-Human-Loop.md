# Milestone 3: Human-Loop

## Goal

Aziz approves a fake gate from his phone (Telegram button) or the dashboard inbox and the run continues; he is told when the worker goes offline.

## Context

- Milestone 2 provides the engine: gates are `type='gate'` tasks with a `gates` row; `decide_gate(task, decision, comment, via)` (service role only) is the idempotent decision primitive; `scheduler_tick`, `claim_task`, `worker_heartbeat`, `worker_heartbeats` rows, and the run view exist. Read `Milestone-2-Engine.md` C3 for exact semantics.
- Milestone 1 provides: owner model (`is_owner()` needs aal2), `settings` (owner can update), RLS, Realtime publication, the dashboard shell and `RouteGuard`, `data-testid` conventions, CI (`database`, `web` jobs).
- **Decisions in force:** ADR-2 (dashboard writes through `security definer` RPCs that call `is_owner()`), ADR-4/ADR-9 (Realtime invalidation, refetch after subscribe), ADR-5 (the Telegram webhook is a **Supabase Edge Function** with `verify_jwt = false`, grammY on `grammy/web`, secret-token header, owner chat id, callback data `g:<32hex>:<a|m|d>`; the Pages-Function variant with an Access bypass is the proven fallback only), ADR-14 (notification outbox, Vault, one function with two paths). The worker-offline watchdog was **decided by Aziz (2026-10-29)**: `pg_cron` + `pg_net` straight to the Telegram API, bot token in Vault, one alert per outage.
- Proven by spike S4 (see `docs/spikes/FINDINGS.md` and `spikes/s4/`): the handler logic, secret check, owner check, idempotency and callback parsing work in Node and Deno; `grammy/web` must be used on edge runtimes; `botInfo` is preset so no `getMe` call at cold start; a missing/empty owner id makes the handler ignore everyone (fail closed) and should be logged loudly at startup. **Still unverified live (owner steps at the end of this milestone, T3.11):** hosted Edge Function deployment and cold start, real `setWebhook` to the Supabase URL, press-to-edit latency, `pg_cron`/`pg_net`/Vault on the free plan.
- Assumptions made while planning (flag in the summary): "critical" = `gates.priority = 2` (blocking) and watchdog alerts; priority 1 is normal; priority 0 is info. The platform uses a **new** Telegram bot (`@Hqspikebot` was a spike bot; reusing it is fine if Aziz prefers). Timezone default `Europe/Berlin`.

## Scope

### In Scope

- `resolve_gate` RPC and the dashboard gates inbox + gate detail (approve / modify with comment / dismiss / answer).
- Telegram: webhook Edge Function, inline buttons for simple gates, dashboard link for complex ones, instant for blocking gates, quiet hours except critical, commands (`/status`, `/pause`, `/resume`, `/off`, `/on`).
- Notification outbox table, enqueue triggers, delivery policy, flush endpoint driven by `pg_cron`.
- Overrides: table, RPCs, Telegram commands, dashboard header, auto-expiry; `pause` is enforced by `claim_task`; "I'm off today" suppresses non-critical notifications.
- Daily digest of info events.
- Worker-offline watchdog (`pg_cron` + `pg_net` + Vault) with de-duplicated alerts and a "back online" message.
- Settings page for quiet hours, timezone and digest time.

### Out of Scope

- Usage-policy enforcement and the time-of-day caps themselves (M4): M3 only provides the `overrides` table/RPCs it will read, and the `pause` override that stops claiming.
- Free-text replies to the bot (modify/answer with a comment happens in the dashboard; Telegram shows a link).
- Multiple chats or users; Telegram groups.
- Transcript/log views (M4).

## Contracts (build these first)

### C1 — Tables (declarative, RLS on, explicit grants in `15_grants.sql`: `authenticated` select, `service_role` all)

`notifications` (the outbox):

| Column                | Type / constraint                                                                               |
| --------------------- | ----------------------------------------------------------------------------------------------- |
| `id`                  | `uuid pk default gen_random_uuid()`                                                             |
| `kind`                | `text not null check in ('gate_open','run_done','run_failed','worker_offline','worker_online')` |
| `priority`            | `smallint not null check (priority between 0 and 2)` (0 info, 1 normal, 2 critical)             |
| `gate_task_id`        | `uuid` (FK-less, like `events`)                                                                 |
| `run_id`              | `uuid`                                                                                          |
| `payload`             | `jsonb not null default '{}'` (title, run title, gate kind, options summary, simple flag)       |
| `status`              | `text not null default 'pending' check in ('pending','sent','skipped','failed')`                |
| `deliver_after`       | `timestamptz not null default now()`                                                            |
| `attempts`            | `int not null default 0`                                                                        |
| `sent_at`             | `timestamptz`                                                                                   |
| `telegram_message_id` | `bigint`                                                                                        |
| `error`               | `text`                                                                                          |
| `created_at`          | `timestamptz not null default now()`                                                            |

Unique partial index `notifications_gate_open_once` on `(gate_task_id) where kind = 'gate_open'`. Index `(status, deliver_after)` where `status = 'pending'`.

`overrides`: `id uuid pk`, `kind text not null check in ('pause','off_today')`, `expires_at timestamptz not null`, `created_by text not null check in ('dashboard','telegram')`, `created_at`, `cleared_at timestamptz`. **Active** means `cleared_at is null and expires_at > now()`. View `active_overrides` (security invoker). At most one active row per kind (partial unique index on `(kind) where cleared_at is null` plus `set_override` clearing the previous one first).

Both tables join the Realtime publication (`50_realtime.sql` **and** a listed manual migration) so the header chip and inbox badge update live.

`settings` seed (idempotent DML in a manual migration, local `seed.sql` too), values are jsonb: `timezone` `"Europe/Berlin"`, `quiet_hours` `{"start":"22:00","end":"07:00"}`, `digest_time` `"08:00"`, `worker_offline_after_seconds` `180`. Runtime state keys written by the platform: `last_digest_date` (`"YYYY-MM-DD"`), `worker_alert` (`{"active":bool,"since":ts}`).

### C2 — Functions (`public`; grants as stated)

| Function                                                                                                                                                        | Callable by                                                     | Behaviour                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `resolve_gate(p_task_id uuid, p_decision gate_decision, p_comment text default null) returns jsonb`                                                             | `authenticated` (checks `is_owner()` inside; `42501` otherwise) | Validates that `p_decision` appears among the gate's `options[].kind` (when `options` is non-empty; when empty only approve/dismiss are allowed); a non-blank comment is required when `p_decision in ('modify','answer')` or the chosen option has `requiresComment`; then `decide_gate(..., 'dashboard')`. Returns `{"first": bool, "decision": d}`.                                                                       |
| `set_override(p_kind text, p_minutes int default null, p_via text default 'dashboard') returns uuid`                                                            | owner (`is_owner()`) **or** `service_role`                      | `pause`: `p_minutes` 1..1440 required, `expires_at = now() + minutes`. `off_today`: ignores minutes, expires at the next local midnight (per `settings.timezone`). Clears (sets `cleared_at`) any active row of the same kind first.                                                                                                                                                                                         |
| `clear_override(p_kind text) returns int`                                                                                                                       | owner or `service_role`                                         | Sets `cleared_at` on the active row; returns rows cleared.                                                                                                                                                                                                                                                                                                                                                                   |
| `enqueue_gate_notification()` (trigger fn)                                                                                                                      | trigger                                                         | After a gate task becomes `waiting_human`: insert `notifications` row `kind='gate_open'`, priority = `gates.priority`, payload with title, gate kind, run title, `simple` (true iff every `options[].kind` is `approve`/`dismiss` and none has `requiresComment`, or `options` is empty), `deliver_after = now()`. Duplicate gate -> unique index, `on conflict do nothing`.                                                 |
| `enqueue_run_notification()` (trigger fn)                                                                                                                       | trigger                                                         | After a run becomes `done`/`failed`: `run_done`/`run_failed`, priority 0 (info).                                                                                                                                                                                                                                                                                                                                             |
| `due_notifications(p_limit int default 50) returns setof notifications`                                                                                         | `service_role`                                                  | Pending rows with `deliver_after <= now()`, oldest first, `for update skip locked`.                                                                                                                                                                                                                                                                                                                                          |
| `mark_notification(p_id uuid, p_status text, p_message_id bigint default null, p_error text default null, p_defer_until timestamptz default null) returns void` | `service_role`                                                  | `sent` sets `sent_at`/message id; `failed` increments `attempts` and re-pends with `deliver_after = now() + attempts * 1 min` until `attempts = 5`, then stays `failed`; `skipped`; `p_defer_until` re-pends with that `deliver_after`.                                                                                                                                                                                      |
| `check_worker_offline() returns text`                                                                                                                           | `service_role` (and `pg_cron`)                                  | Reads `max(last_seen_at)` of `worker_heartbeats` and `worker_offline_after_seconds`. Stale and no active alert -> sets `worker_alert={"active":true,...}`, enqueues `worker_offline` (priority 2), returns `'alerted'`. Fresh and active alert -> clears it, enqueues `worker_online` (priority 2), returns `'recovered'`. Otherwise `'none'`. No heartbeat row ever -> `'none'` (a worker that never ran is not an outage). |
| `send_telegram_direct(p_text text) returns bigint`                                                                                                              | `service_role` (and `pg_cron`)                                  | Reads token and chat id from Vault and calls `net.http_post` to `https://api.telegram.org/bot<token>/sendMessage`; returns the `pg_net` request id. Used by the watchdog job so alerts do not depend on the Edge Function.                                                                                                                                                                                                   |
| `telegram_config() returns jsonb`                                                                                                                               | `service_role` only                                             | `{"bot_token","chat_id","webhook_secret","flush_secret","dashboard_url"}` from Vault; the Edge Function calls it once per cold start. Never exposed to `anon`/`authenticated` (pgTAP).                                                                                                                                                                                                                                       |
| `flush_notifications() returns void`                                                                                                                            | `pg_cron` / `service_role`                                      | `net.http_post` to `<functions_url>/telegram/flush` with header `x-flush-secret` (values from Vault).                                                                                                                                                                                                                                                                                                                        |

`claim_task` (M2) gains: returns nothing while an active `pause` override exists. Gate tasks are unaffected by `pause`.

Vault secret names: `telegram_bot_token`, `telegram_chat_id`, `telegram_webhook_secret`, `flush_secret`, `functions_url`, `dashboard_url`. Created by Aziz with `vault.create_secret(...)` (never in the repo); local development uses the same function with test values from `.env`-style local config.

`pg_cron` jobs (manual migration, listed in `docs/MANUAL_MIGRATIONS.md`): `flush_notifications` every minute (`select public.flush_notifications()`), `worker_watchdog` every 3 minutes (`select public.check_worker_offline()` then, if the result is not `'none'`, `public.send_telegram_direct(<message>)` for the newest unsent `worker_offline`/`worker_online` row, marking it `sent` with `payload.via = 'pg_net'`).

### C3 — Delivery policy (pure TypeScript, `supabase/functions/telegram/policy.ts`)

`decideDelivery(notification, ctx) -> { action: 'send' } | { action: 'defer', until: Date } | { action: 'digest' } | { action: 'skip', reason }` with `ctx = { now, timezone, quietHours, offToday: boolean }`:

| priority   | normal hours | inside quiet hours       | "off today" active                        |
| ---------- | ------------ | ------------------------ | ----------------------------------------- |
| 2 critical | send         | send                     | send                                      |
| 1 normal   | send         | defer to quiet-hours end | defer to the next local `quiet_hours.end` |
| 0 info     | digest       | digest                   | digest                                    |

`worker_online` is sent only if a `worker_offline` was sent for the same outage; otherwise skipped. Quiet hours may span midnight. Everything deferred or digested stays visible in the dashboard inbox (the inbox, not Telegram, is the source of truth).

### C4 — Telegram behaviour (Edge Function `supabase/functions/telegram`)

- Routes: `POST /telegram` (Telegram webhook; header `X-Telegram-Bot-Api-Secret-Token` compared in constant time with `webhook_secret`; wrong/missing -> 401, nothing processed) and `POST /telegram/flush` (header `x-flush-secret` constant-time compared with `flush_secret`, else 401; processes `due_notifications`, then the digest check). `verify_jwt = false` in `supabase/config.toml` for the function. Any other path -> 404.
- Owner check on every update: `from.id` and `chat.id` must equal `chat_id`; otherwise log `ignored ... user=<id> chat=<id>` and do nothing. A non-positive-integer `chat_id` makes the function log a startup error and ignore all updates.
- Gate message: HTML-escaped `<b>Blocking gate</b>` (priority 2) / `<b>Gate</b>`, then the title and `run title · kind`. **Simple** gates: inline buttons `Approve` / `Dismiss` with callback data `g:<task id without dashes>:<a|d>` (36 bytes). **Complex** gates (or any with `requiresComment`): one URL button `Open in dashboard` -> `<dashboard_url>/gates/<task id>`.
- Callback handling: parse (`parseCallbackData`), call `decide_gate(task, decision, null, 'telegram')`; answer the callback query with `Recorded: approve|dismiss` (first) or `Already decided: <decision>` (repeat); edit the message to `✅ Approved` / `🚫 Dismissed` / `Already decided` and remove the keyboard. A gate that is not open answers `Gate is no longer open`.
- Commands (owner only): `/status` (worker online/offline with age, active run count, open gate count, active overrides), `/pause <n>[m|h]` (1 min–24 h, default 1h) -> `set_override('pause', minutes, 'telegram')`, `/resume` -> `clear_override('pause')`, `/off` -> `set_override('off_today', null, 'telegram')`, `/on` -> `clear_override('off_today')`, `/start` and `/help` -> command list. Unknown input -> help text.
- Digest (inside the flush call): when local time >= `digest_time` and `settings.last_digest_date <> today`, send **one** message listing counts and one line per pending priority-0 notification plus runs done/failed in the last 24 h; mark those notifications `sent`, set `last_digest_date`. An empty digest sends nothing but still sets `last_digest_date`.
- grammY runs on `grammy/web` with `botInfo` preset; `deno.json` import map keeps the same bare specifiers as Node so the pure modules (`policy.ts`, `format.ts`, `handler.ts`, `digest.ts`) are unit-tested with Vitest from `supabase/functions/**`.

### C5 — Dashboard contract (`apps/web`)

| Route / element  | Behaviour                                                                                                                                                                                                                                                                                                                                                        |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/inbox`         | Open gates (`gates` joined to `tasks.status = 'waiting_human'`), default order priority desc then oldest first; clickable headers sort by priority, age, run; tabs `Open` / `Decided`. Priority badge (0 info, 1 normal, 2 blocking). Row links to the gate. Nav "Inbox" shows the open-gate count live.                                                         |
| `/gates/:taskId` | Title, kind, priority, run link, pretty-printed `context` (collapsible), one button per `options[]` entry (falls back to Approve/Dismiss when empty), a comment textarea (required when the choice needs it), submit calls `rpc('resolve_gate')`. After a decision the page shows who/how/when and disables the form; a repeated submit shows "Already decided". |
| header           | Override chip (e.g. `Paused until 14:30`, `Off today`), a `Pause` menu (1 h, 4 h, until tomorrow), `Resume`, and an `I'm off today` toggle; all through `set_override` / `clear_override`. Updates live.                                                                                                                                                         |
| `/settings`      | Quiet hours start/end, timezone (IANA list), digest time; Zod-validated (`HH:MM`, known timezone); saved through the existing `settings` update policy.                                                                                                                                                                                                          |

Test IDs: `inbox-table`, `gate-row`, `inbox-count`, `gate-title`, `gate-option-<kind>`, `gate-comment`, `gate-submit`, `gate-decided`, `override-chip`, `override-pause-1h`, `override-resume`, `off-today-toggle`, `settings-quiet-start`, `settings-quiet-end`, `settings-digest-time`, `settings-save`.

## Tasks

### T3.1 — `resolve_gate`

- **Depends on:** — (needs M2 `decide_gate`)
- **Area:** database
- **What:** C2 `resolve_gate` in `supabase/schemas/`, grant to `authenticated`; owner check inside the function.
- **Tests (write first):** `supabase/tests/resolve_gate_test.sql` using the M1 helpers (`support/helpers.inc`): owner at aal2 resolves (task becomes `done`, `gate_decided` event once); owner at aal1 and non-owner raise `42501`; anon cannot execute; decision not among `options` is rejected; `modify`/`answer`/`requiresComment` without a comment rejected; second call returns `first=false` and keeps the first decision; `dismiss` cancels the task; works for an empty `options` gate (approve/dismiss only).
- **Done when:** pgTAP green, drift clean.

### T3.2 — Overrides

> **Plan updated (implementation, 2026-11-05):** `set_override`/`clear_override` check `auth.role() = 'service_role' or is_owner()` (pgTAP simulates the service role with `support/helpers.inc` `act_as_service()`; the integration test `pause.integration.ts` proves the real `sb_secret` key arrives as that role and the publishable key is refused). Publication membership is tracked by the diff tool, so `overrides` is added in `supabase/schemas/50_realtime.sql` only (no manual migration); M1's publication assertion in `tables_test.sql` now expects the extended table list (a deliberate contract extension, to be updated again when `notifications` joins).

- **Depends on:** T3.1
- **Area:** database
- **What:** `overrides` table, `active_overrides` view, `set_override`, `clear_override` (owner-or-service check helper `is_owner_or_service()`), RLS/grants, realtime publication, and the `claim_task` pause check.
- **Tests (write first):** `supabase/tests/overrides_test.sql`: owner at aal2 and service role can set/clear; non-owner and aal1 cannot; `pause` bounds (0 and 1441 rejected); `off_today` expiry is the next local midnight for `Europe/Berlin` (use fixed `now()` via a `set_config`-free approach: pass the clock through a `p_now timestamptz default now()` argument on an internal helper and test the helper); a second `set_override` of the same kind clears the previous; expired rows are not in `active_overrides`; `claim_task` returns nothing while paused and works after `clear_override` and after expiry; gate tasks still open while paused.
- **Done when:** pgTAP green, drift clean; `pause` verified against the M2 integration harness (one added case).

### T3.3 — Notification outbox and watchdog logic

> **Plan updated (implementation, 2026-11-05):** `notifications` is deliberately **not** in the Realtime publication (the inbox is gate-based); `mark_notification` takes `p_status` in `sent | skipped | failed | deferred` (`deferred` + `p_defer_until` replaces the contract's bare `p_defer_until`). The settings defaults are the manual migration `20261105142900_settings_defaults.sql` (not `seed.sql`: local `db reset` runs migrations, so one file serves local and hosted). pgTAP also runs the gate-opening trigger flow as `service_role`.

- **Depends on:** T3.2
- **Area:** database
- **What:** `notifications` table, enqueue triggers (gate opens, run done/failed), `due_notifications`, `mark_notification`, `check_worker_offline`, settings seed (manual migration + `seed.sql`), realtime publication entry. No HTTP here.
- **Tests (write first):** `supabase/tests/notifications_test.sql`: gate task -> `waiting_human` enqueues exactly one `gate_open` with the right priority and `simple` flag (matrix of options); a second transition attempt cannot duplicate; run done/failed enqueue priority 0; `due_notifications` respects `deliver_after` and skips locked rows; `mark_notification` sent/failed/retry-count/defer behaviour; RLS (owner at aal2 reads, others none); `check_worker_offline`: fresh -> `'none'`; stale -> `'alerted'` once (second call `'none'`, requirement: one alert per outage); heartbeat returns -> `'recovered'` once; never-seen worker -> `'none'`; threshold read from settings.
- **Done when:** pgTAP green, drift clean; `docs/MANUAL_MIGRATIONS.md` lists the settings seed.

### T3.4 — Vault, `pg_net`, `pg_cron` plumbing

> **Plan updated (implementation, 2026-11-05):** `pg_cron`, `pg_net` and `supabase_vault` are all available on the local image (`pg_cron` is created in `schemas/05_extensions.sql`; the diff tool tracks extensions). All HTTP goes through the private wrapper `public.http_post_json` so pgTAP can replace it with a recorder and assert URLs, bodies and headers without sending anything; the Vault reader `vault_secret` and the wrapper are not executable by any API role. `watchdog_tick()` is the cron job body (`check_worker_offline()` then direct Bot API sends, marking `sent` with `payload.via = 'pg_net'`; without Telegram configuration the notification stays pending). Free-plan availability of the three extensions is still checked live in T3.11.

- **Depends on:** T3.3
- **Area:** database
- **What:** Manual migration enabling `pg_net`, `pg_cron` and using `supabase_vault`; functions `telegram_config`, `send_telegram_direct`, `flush_notifications`; the two cron jobs (C2). Document `vault.create_secret` commands in `docs/runbooks/telegram-setup.md` (names only). Confirm the extensions exist on the local image and note the free-plan availability result.
- **Tests (write first):** pgTAP: extensions installed; the functions exist with `service_role`-only execute (anon/authenticated `42501`); `telegram_config()` returns the Vault values (test secrets created inside the test transaction); `send_telegram_direct` and `flush_notifications` build the expected request via a stubbed `net.http_post` (create a temporary stub function in the test schema search path) — assert URL, body and headers without sending anything; both cron jobs are registered with the specified schedules.
- **Done when:** pgTAP green, drift clean; manual-migration entries added.

### T3.5 — Telegram core logic (pure modules)

> **Plan updated (implementation, 2026-11-05):** the modules also include `time.ts` (Intl-based zone helpers: `nextLocalTime`, `localDate`, DST-safe) and `flush.ts` (`processFlush`: the whole flush decision flow behind `FlushStore`/`TelegramApi` interfaces, so T3.6/T3.9 only add the real adapters). Callback data keeps the `m` letter (parsed, answered with a dashboard hint, never decides). Keyboards are plain `reply_markup` JSON, not grammY objects, so the pure modules stay runtime-agnostic. `grammy` is a root devDependency (catalog) so Vitest resolves `grammy/web`; Deno resolves it through `deno.json`. Test count 58 (the 10 S4 tests ported and extended).

- **Depends on:** T3.3
- **Area:** functions
- **What:** In `supabase/functions/telegram/`: `policy.ts` (C3), `format.ts` (message text, keyboards, escaping, callback data builder/parser, ported from `spikes/s4/webhook.ts`), `commands.ts` (parse `/pause 90m`, `/pause 2h`, defaults and bounds), `digest.ts` (compile digest text + decide due), `handler.ts` (owner check, callback and command handling against a `Store` interface: `decideGate`, `setOverride`, `clearOverride`, `status`). Vitest project for `supabase/functions/**/*.test.ts` added to the root config.
- **Tests (write first):** port the 10 S4 tests (secret, owner, idempotency, malformed data, wrong chat, double press) and add: full `decideDelivery` matrix including quiet hours spanning midnight and DST dates; digest due/not due/empty; command parsing edge cases (`/pause`, `/pause 0`, `/pause 25h`, `/pause abc`, `/off`, `/on`, unknown); HTML escaping of titles with `<`, `&`; simple vs complex message shapes; `Gate is no longer open`; `worker_online` skipped without a prior `worker_offline`.
- **Done when:** unit tests, typecheck, lint pass.

### T3.6 — Edge Function entry and local end-to-end

> **Plan updated (implementation, 2026-11-05):** the local end-to-end runs the real `index.ts` with **plain Deno** (`deno run -A --config supabase/functions/telegram/deno.json`), not `supabase functions serve`: same code and import map, no edge-runtime container (`[edge_runtime]` stays disabled locally and in CI; `[functions.telegram] verify_jwt = false` is in `config.toml` for deployment). Relative imports use explicit `.ts` extensions (Deno requires them; `allowImportingTsExtensions` in `tsconfig.scripts.json`; `index.ts` is excluded from the Node typecheck and checked with `deno check`). The Deno entry is thin: routing is `server.ts` (unit-tested), Supabase adapters are `supabase-store.ts`. The test-only clock is the header `x-test-now`, honoured only when `ENVIRONMENT=test`. The same e2e (`e2e.integration.ts`, 8 tests) also covers the quiet-hours, off-today, digest and failure-retry flows of T3.9, so T3.9 reduces to hosted verification and edge cases. CI installs Deno (`denoland/setup-deno`, SHA-pinned) in the `database` job. The generated DB types were regenerated for `notifications`/`overrides`.

- **Depends on:** T3.4, T3.5
- **Area:** functions
- **What:** `supabase/functions/telegram/index.ts` (routes, constant-time secret compare, config via `telegram_config()` with a startup log when the owner id is invalid), `deno.json`, `[functions.telegram] verify_jwt = false` and `[edge_runtime] enabled = true` in `supabase/config.toml` (CI `database` job removes `edge-runtime` from `SUPABASE_EXCLUDES` only for the job that runs this test). Telegram API calls use a base URL from config so tests can point at a mock server (`TELEGRAM_API_ROOT`).
- **Tests (write first):** `supabase/functions/telegram/e2e.integration.test.ts` against local Supabase + `supabase functions serve` + a mock Telegram API (Node http server): create a fake run with a simple gate via the M2 scenario helper, call `/telegram/flush` with the secret -> the mock receives a `sendMessage` with the right keyboard; POST a callback to `/telegram` with the webhook secret -> gate decided via `decide_gate`, the run continues (worker or `scheduler_tick`), the mock receives `answerCallbackQuery` and `editMessageText`; a second identical callback answers "Already decided"; wrong secret -> 401; foreign chat id -> ignored; flush without secret -> 401; complex gate -> URL button only; quiet-hours deferral and digest paths with a controlled clock (`NOW` override env, test only, ignored unless `ENVIRONMENT=test`).
- **Done when:** the local end-to-end passes 3 times in a row; Done Criteria on idempotency, foreign chat and flush are demonstrated locally.

### T3.7 — Dashboard: inbox and gate detail

> **Plan updated (implementation, 2026-11-05):** the pure rules live in `packages/core/src/domain/gate-rules.ts` (`allowedDecisions`, `needsComment`, mirror of `resolve_gate`; the matching SQL cases are in `resolve_gate_test.sql`), the inbox sort in `apps/web/src/lib/inbox.ts`. One Realtime subscription in `AppShell` (tables `gates`, `tasks`, key `['inbox']`) refreshes the list, the gate pages and the nav badge. The "stale submit" e2e is replaced by the live-update case (a decision made through the service role appears on an open page within 5 s); double-submit idempotency is asserted in pgTAP (`resolve_gate_test.sql`) where it can be made deterministic.

- **Depends on:** T3.1
- **Area:** web
- **What:** C5 `/inbox` and `/gates/:taskId`, queries and mutation (`resolve_gate`), Realtime invalidation (reuse M2 hook), nav badge, enable the "Inbox" nav item; Zod schema for `gates.options`/`context` rendering (from `packages/core`).
- **Tests (write first):** Vitest for the sort helpers and the "needs comment" rule (shared with the SQL rule through a documented fixture list); Playwright `e2e/inbox.spec.ts`: seed three gates with priorities 0/1/2 through the service role, owner sees them ordered by priority, count badge = 3; open one, approve -> row leaves `Open` and appears under `Decided`, the run continues (second task becomes claimable); `modify` requires the comment (submit disabled until filled); double submit shows "Already decided"; a decision made via the service role (as Telegram would) appears live in an open page within 5 s; non-owner at aal2 sees an empty inbox and `resolve_gate` is refused.
- **Done when:** unit and e2e tests pass locally and in CI.

### T3.8 — Dashboard: overrides, off-today, settings

- **Depends on:** T3.2, T3.7
- **Area:** web
- **What:** C5 header controls and `/settings`; enable the "Settings" nav item.
- **Tests (write first):** Vitest for the settings Zod schema (`HH:MM`, timezone validity); Playwright `e2e/overrides.spec.ts`: pause for 1 h -> chip shows it, the worker integration helper cannot claim while paused, Resume removes it, the chip updates live when the override is set from the service role; "I'm off today" toggles and shows; settings save persists and rejects an invalid time; non-owner cannot change settings (RLS).
- **Done when:** unit and e2e tests pass locally and in CI.

### T3.9 — Daily digest and delivery policy end to end

- **Depends on:** T3.6
- **Area:** functions
- **What:** Wire `digest.ts` and `policy.ts` into the flush path (already scaffolded in T3.6) and add the remaining behaviour: `off_today` deferral, digest batching of priority 0, `last_digest_date` handling, retry/backoff through `mark_notification`.
- **Tests (write first):** extend `e2e.integration.test.ts` with the controlled clock: priority 1 gate at 23:00 is deferred to 07:00 and sent after; priority 2 at 23:00 is sent immediately; `off_today` defers priority 1; three info notifications become one digest at `digest_time`, the digest is sent once per day; a mock Telegram 500 is retried with backoff and ends `failed` after 5 attempts without duplicate sends.
- **Done when:** the extended integration test passes; requirement 8 (instant blocking, inline buttons, digest) demonstrated locally against the mock.

### T3.10 — CI wiring and docs

- **Depends on:** T3.6, T3.7, T3.8, T3.9
- **Area:** infra
- **What:** Run the Edge Function integration test and the new Playwright specs in CI (enable `edge-runtime` in the job that needs it, keep the rest excluded); `docs/runbooks/telegram-setup.md` (BotFather steps, Vault commands by name, `setWebhook` command with `secret_token` and `allowed_updates=["callback_query","message"]`, `supabase functions deploy telegram --no-verify-jwt`, `supabase secrets` not needed because config comes from Vault); extend `docs/runbooks/m1-manual-steps.md` pointers.
- **Tests (write first):** none locally; green CI run on `main`; a red demo (break the policy, see the unit job fail) recorded in `docs/ci-failure-demos.md`.
- **Done when:** CI green including the new steps.

### T3.11 — Live verification **[Aziz]** (needs the hosted project from M1 T1.9)

- **Depends on:** T3.10, M1 T1.9
- **Area:** infra
- **What:** Steps, in order, each logged in `docs/spikes/evidence/M3-live-*.md` (no tokens): (1) create the platform bot with BotFather; (2) store the six Vault secrets (names in the runbook); (3) `supabase functions deploy telegram --no-verify-jwt --project-ref ...`; (4) `setWebhook` to `https://<ref>.supabase.co/functions/v1/telegram` with the secret token; (5) create a fake run with a simple gate (`pnpm fake-run` against hosted with the service key in the shell) and approve it from the phone: record press-to-edit latency (10 presses, median/p95) and the cold-start time of the first press after 10 minutes idle; (6) press twice (idempotent), message from a second Telegram account (ignored); (7) stop the worker, wait for the watchdog alert (one message), restart, see the "back online" message; (8) wait for the digest at `digest_time`; (9) confirm `pg_cron`, `pg_net` and Vault work on the free plan.
- **Tests (write first):** the checklist is the test; results recorded as evidence.
- **Done when:** all nine steps recorded and `docs/spikes/FINDINGS.md` open items for S4 (hosted Edge Function, cold start, latency) updated; if a step fails, record it and add a `> **Plan updated:**` note instead of working around it silently.

## Environment & Configuration

| Name                                                                                                                                | Where                                                           | Purpose                                                                         |
| ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Vault secrets `telegram_bot_token`, `telegram_chat_id`, `telegram_webhook_secret`, `flush_secret`, `functions_url`, `dashboard_url` | hosted Supabase Vault (Aziz creates them), test values in pgTAP | Telegram access and cron-to-function calls; never in the repo, GitHub or logs   |
| `TELEGRAM_API_ROOT`, `ENVIRONMENT`, `NOW`                                                                                           | Edge Function env, **tests only**                               | point at the mock API, enable the controlled clock only when `ENVIRONMENT=test` |
| `SUPABASE_URL`, `SUPABASE_SECRET_KEY`                                                                                               | local env for `pnpm fake-run`                                   | as in M2                                                                        |

No new GitHub secrets. The Edge Function is deployed by hand in T3.11 (CLI); automating `functions deploy` in `deploy.yml` is parked until it has proven stable.

## Done Criteria

- [ ] Every task's "Done when" met
- [ ] Fake gate approved from Telegram on the phone; run continues; double press idempotent; foreign chat ignored (T3.6 locally, T3.11 live)
- [ ] Requirements 2, 3, 8 covered by tests: inbox order/sort (T3.7), gate actions (T3.1, T3.7), Telegram instant/inline/digest (T3.5, T3.6, T3.9)
- [ ] Digest delivered; offline worker triggers exactly one Telegram alert and one recovery message (T3.3 logic, T3.11 live)
- [ ] `pause` override stops claiming and auto-expires; "I'm off today" suppresses non-critical notifications
- [ ] `docs/MANUAL_MIGRATIONS.md`, `docs/runbooks/telegram-setup.md` accurate; `supabase db diff` clean; CI green
- [ ] S4 open items (hosted Edge Function, cold start, latency) closed in `FINDINGS.md`
- [ ] TODO.md updated; Milestone 4 detailed with `project-plan` before starting it

## Risks & Watch-Outs

- **Secrets:** the bot token and flush secret live only in Vault; `telegram_config()` must stay `service_role`-only (pgTAP asserts it). Redact tokens in every log line; a gitleaks-clean evidence folder is part of T3.11.
- **Idempotency and trust:** the decision is made by `decide_gate` (first call wins). The webhook secret header and the owner id are the only authentication on the Edge Function; keep both checks constant-time and fail closed.
- **`pg_cron`/`pg_net`/Vault on the free plan** are assumed available (Aziz's decision); T3.4 and T3.11 verify it. If not, fall back to the worker calling `flush`/`check_worker_offline` (loses offline alerts) and record a Plan-updated note.
- **Time zones:** quiet hours, `off_today` and digest all use `settings.timezone`; test DST changeover days.
- **Notification fatigue (pre-mortem #10):** priority matrix, digest, inline buttons and quiet hours are the mitigation; resist adding more notification types.
- **Realtime + RLS:** the new tables must be readable by the owner at aal2 for live updates; the M2 `setAuth`/refetch pattern applies.
- **Edge runtime cost in CI:** enabling `edge-runtime` pulls an extra image; keep it to the single job that needs it.
- **Keep to scope:** no usage policy (M4), no free-text Telegram conversations. Park ideas in `docs/parking-lot.md`.
