# S1 — Does headless `claude -p` expose usage / rate limits?

Written before running. Time-box: one session.

## Question
Does `claude -p` (Pro plan login) expose `rate_limits` / usage %? If not, what is the most reliable estimate?

## Experiments
- (a) `claude -p "Reply with OK" --output-format json` and `--output-format stream-json --verbose`; list every field, esp. usage/token/cost.
- (b) `statusLine` command in scratch settings that dumps its stdin JSON; run headless with `--settings`; check whether `rate_limits` (`five_hour`/`seven_day` `used_percentage`, `resets_at`) ever appears. Interactive comparison is [Aziz]-assisted.
- (c) Read-only look for other sources: `claude --help` / subcommands, non-credential files under the config dir (names only; never read credentials).
- (d) Calibration: 5 prompts of increasing size; record token totals after each + [Aziz] `/usage` percentages (5h and weekly); compute %-per-token and error margin.
- (e) `CLAUDE_CONFIG_DIR` isolation: separate dir, login stays valid? interactive config untouched?

## Field checklist (looked for in every output)
- [ ] `usage.input_tokens` / `output_tokens` / `cache_creation_input_tokens` / `cache_read_input_tokens`
- [ ] `total_cost_usd`, `modelUsage`
- [ ] `is_error`, `subtype`, `session_id`
- [ ] `rate_limits.five_hour.used_percentage` / `resets_at`
- [ ] `rate_limits.seven_day.used_percentage` / `resets_at`
- [ ] any `rate_limit_event` in stream-json

## Decision rule
`rate_limits` present headless -> primary source. Else calibrated token estimate with measured error.

## Evidence
`docs/spikes/evidence/S1-*.json|txt` (scrubbed).
