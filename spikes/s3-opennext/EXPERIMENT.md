# S3 — OpenNext on Cloudflare Workers + Supabase Auth MFA + Cloudflare Access

Written before running. Time-box: one session. Two phases:
- **Phase 1 (local, no Cloudflare account):** app builds with `@opennextjs/cloudflare`, runs in local workerd (`opennextjs-cloudflare preview`), against local Supabase (auth, MFA TOTP, Realtime). Measures bundle size (gzip) vs Workers Free 3 MB, startup time, build warnings, `nodejs_compat` behaviour of supabase-js/jose.
- **Phase 2 ([Aziz]: needs CLOUDFLARE_API_TOKEN/ACCOUNT_ID, zone, Zero Trust org):** deploy to `spike-hq.aziztalbi.com`, Access policy, `workers_dev:false`, unauthenticated redirect, real Access JWT check, webhook bypass (S4).

Local Supabase here is a lean stack (db, auth, rest, realtime, kong) because the Mac was low on disk; Storage/pg_meta are not needed for S3.

## Checks (Playwright `check.spec.ts`)
1. unauthenticated `/dashboard` -> redirected to `/login`
2. login (password) -> forced to `/mfa` (aal1 cannot see dashboard)
3. enroll TOTP (secret read from page, code via otplib) -> `/dashboard` (aal2)
4. Realtime: insert into `s3_events` (service role) appears in dashboard within 5 s
5. `/api/ping` without `Cf-Access-Jwt-Assertion` -> 401; with a validly signed token (test JWKS) -> 200

## Measure
gzip size of the Worker (`wrangler deploy --dry-run --outdir`), startup time, CPU per request (workerd local, indicative only; real Free CPU limit is 10 ms), OpenNext build warnings, whether the browser websocket goes direct to Supabase.

## Decision rule
Works -> CONFIRMED. Over 3 MB gz -> record minimal remedy + cost (Workers Paid $5/mo breaks the ~EUR10 target: Aziz decides).
