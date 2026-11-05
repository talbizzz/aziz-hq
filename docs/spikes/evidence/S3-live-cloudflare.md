# S3 live Cloudflare phase (2026-11-05)

Setup: Pages project `aziz-hq-spike` (`spikes/s3` build), custom domain `spike-hq.aziztalbi.com` (proxied CNAME), Access self-hosted application `spike-hq` with policy `owner-only` (one email), login method restricted to "Cloudflare". Team domain `gigaway` (existing organisation, shared with another project; no existing Access application or policy was touched). Secrets set with `wrangler pages secret put`: `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`. Tokens and Access `meta` query strings are deliberately not recorded.

| Request | Result |
|---|---|
| `GET https://spike-hq.aziztalbi.com/` (no session) | 500 `access not configured` before secrets were set (fail closed), then 302 to `https://gigaway.cloudflareaccess.com/cdn-cgi/access/login/spike-hq.aziztalbi.com` after |
| `GET /api/ping`, `/api/telegram/webhook` on the custom domain (no session) | 302 to the Access login (Access runs before the Pages Function) |
| `GET https://aziz-hq-spike.pages.dev/`, `/api/ping` | 403 (middleware: no Access JWT) |
| `GET https://<deployment-id>.aziz-hq-spike.pages.dev/api/ping` (preview URL) | 403 |
| `POST https://aziz-hq-spike.pages.dev/api/telegram/webhook` with no bot secrets configured | Worker error 1101 / 500 (handler needs its secrets; not a gate bypass) |
| Browser login via Cloudflare method, then `GET /api/ping` on the custom domain | 200 JSON (reported by Aziz): real Access JWT passed `jose` verification against the live JWKS with the real AUD |

Findings:
- Access redirect, real JWT/AUD and `pages.dev`/preview rejection all work as ADR-12 expects.
- With Access enforced on the hostname, the Telegram webhook path is redirected to the login page, so the Pages-Function webhook variant would need a path-scoped Bypass application. The Edge Function variant (ADR-5) does not.
- Creating the Access application failed once with `allow_authenticate_via_warp cannot be set until a Cloudflare One Client Authentication session duration is set`: the "Authenticate with Cloudflare One Client" toggle must be off.
- Adding the Pages custom domain through the API does not create DNS; the proxied CNAME has to be created too. Activation took about 2 minutes (522 then 500).
- `CF_ACCESS_TEAM_DOMAIN` is the team name only (`gigaway`), since the middleware appends `.cloudflareaccess.com`.
- Cloudflare account has one Zero Trust organisation, so a second project shares the team domain; consider this for T1.11.
- Not measured: Workers Free 10 ms CPU in production.
