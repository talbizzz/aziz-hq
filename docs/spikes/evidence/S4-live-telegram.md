# S4 live Telegram phase (2026-11-05)

Setup: real bot (BotFather), webhook registered with `setWebhook` to `https://aziz-hq-spike.pages.dev/api/telegram/webhook` (Pages Function variant, `spikes/s3/functions/api/telegram/webhook.ts`), `secret_token` set, `allowed_updates=["callback_query","message"]`. Bot token, webhook secret and owner chat ID were set with `wrangler pages secret put`; none are recorded here.

| Check | Result |
|---|---|
| `getMe` with the token | ok |
| `setWebhook` | ok; `getWebhookInfo`: no `last_error_message`, `pending_update_count` 0, allowed updates as set |
| POST to the webhook with no secret header / a wrong one | 401 |
| Telegram delivered a real `callback_query` press to the Pages Function | yes: 4 requests, 200, seen in `wrangler pages deployment tail` |
| Handler with the owner secret mis-set (empty) | all 4 presses logged `ignored callback from user=... chat=...` and nothing was changed: fails closed |
| After fixing the secret: press Approve on a real inline button | message edited to `Gate <8 hex>: approve` and "Recorded: approve" toast; reported by Aziz as "almost instantly" (not timed) |

Findings:
- Real Telegram reaches a `*.pages.dev` Pages Function with the secret-token header verified; the Telegram path needs no Access bypass **on `pages.dev`** (the middleware skips only that path), but on the Access-protected custom hostname the same path is redirected to the login page (see S3 live evidence).
- A missing or empty `TELEGRAM_OWNER_CHAT_ID` makes the handler ignore everyone (`Number("")` is 0), which is safe, but the cause is only visible in logs. M3 should log a startup warning or fail the health check when the owner ID is not a positive integer.
- `callback_data` `g:<32hex>:<a|m|d>` is 36 bytes, well under Telegram's 64-byte limit.
- Not measured: a timed press-to-edit latency, a repeat press on an already decided gate on the live bot (covered by unit tests), the hosted Supabase Edge Function variant (needs the hosted project, M1 T1.9).
