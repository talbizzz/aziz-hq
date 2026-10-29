# Milestone 3: Human-Loop

> Stub — detail with project-plan before starting.

## Goal

Aziz approves a fake gate from his phone and the run continues.

## Scope

### In Scope

- Gates inbox (sortable by priority), gate detail with approve / modify+comment / dismiss / answer via `resolve_gate` RPC (ADR-2).
- Telegram bot: webhook per ADR-5, inline buttons for simple gates, blocking gates instant, quiet hours except critical.
- Overrides (table, Telegram command, dashboard header, auto-expiry), "I'm off today" switch.
- Daily digest for info events.
- Worker-offline watchdog: **decided (Aziz, 2026-10-29)** — Supabase `pg_cron` every few minutes checks `worker_heartbeats.last_seen_at` age; if stale, `pg_net` calls the Telegram API. Detail at planning: bot token in Supabase Vault, alert de-duplication (once per outage + "back online" message), extensions enabled via manual migration, pgTAP test of the stale-detection function (HTTP call mocked/separated).
- Webhook per S4 verdict (Pages Function with Cloudflare Access bypass for that path only, or Supabase Edge Function).

### Out of Scope

- Real usage-policy enforcement (M4).

## Depends on

Milestone 2.

## Done Criteria

- Fake gate approved from Telegram on the phone; run continues; double press is idempotent; foreign chat ignored.
- Requirements 2, 3, 8 covered by tests. Digest delivered. Offline worker triggers a Telegram alert.
