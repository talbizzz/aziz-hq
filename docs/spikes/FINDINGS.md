# Spike Findings (Milestone 0)

Versions: `claude` 2.1.312 (more added per spike).

| Spike | Question | Verdict |
|---|---|---|
| S1 | Headless `claude -p` usage visibility | CONFIRMED WITH CHANGES |
| S5 | Behaviour at plan limit | _pending_ |
| S2 | Per-task Docker sandbox + `supabase start` | _pending_ |
| S3 | OpenNext on Workers + Supabase MFA + Access | _pending_ |
| S4 | Telegram buttons → secure webhook | _pending_ |

## S1: Does headless `claude -p` expose usage / rate limits?
- **Verdict:** CONFIRMED WITH CHANGES (the signal exists, but in a different place than assumed)
- **Evidence:** [version](evidence/S1-version.txt), [json output](evidence/S1-a-json.json), [stream output](evidence/S1-a-stream.jsonl), [headless statusLine dump (empty)](evidence/S1-b-statusline-headless.jsonl), [usage vs /usage](evidence/S1-d-usage-compare.md), [calibration](evidence/S1-d-calibration.jsonl), [isolated auth](evidence/S1-e-isolated-auth-status.txt), [isolated headless](evidence/S1-e-isolated-headless.txt)
- **What we learned:**
  - `--output-format json` returns token counts (`usage`, `modelUsage`) and `total_cost_usd`, but **no** rate-limit fields.
  - `--output-format stream-json --verbose` emits a `rate_limit_event` per call: `rate_limit_info.unifiedWindows.{five_hour,seven_day}` each with `utilization` (fraction, 0.02 = 2%), `resetsAt` (unix seconds) and `status` (`allowed`, ...). It also has `overageStatus`/`isUsingOverage`.
  - Matches interactive `/usage`: reset times identical; percentages equal within ±1pp (weekly 0.09 vs 10%).
  - The event reflects state **before** the call; the effect of a call shows in the next call's event.
  - Resolution is 1%. Six calls (~$0.45 list cost) moved 5h from 0.02 to 0.04, so per-call token calibration is too coarse to be useful; the real percentage is available directly.
  - A `statusLine` command is **never** invoked in headless mode (dump file stayed empty), so `rate_limits` via statusLine is not an option headless.
  - `CLAUDE_CONFIG_DIR=<dir>` isolation works after a separate `claude auth login`: `auth status` is logged in, headless calls succeed, sessions are written under `<dir>/projects`, the default config is unaffected. **Quota is per account, not per config dir**: the isolated call showed the same shared 5h/weekly utilization.
  - Each `claude -p` call carries ~38k tokens of baseline context (cache create + read), costing ~$0.06 list even for "Reply with OK".
- **Decision for the plan:** Usage policy (M4) uses the `rate_limit_event` from `stream-json` as the primary source; the worker runs `claude -p --output-format stream-json --verbose`. Fallback if the event is missing: cost-based estimate (`total_cost_usd`) plus limit-error detection (S5). Use `CLAUDE_CONFIG_DIR` to give the worker its own login/session state; it does not give it separate quota. Project-Plan pre-mortem #2 and the M4 stub should say this (applied in T0.7).
- **Open follow-ups:** The event schema is undocumented and may change between versions: pin/record the `claude` version and treat a missing event as a warning (M4). Check whether the event is emitted when the 5h window is near full or blocked (S5, T0.3).
