# S3 — Vite SPA on Cloudflare Pages + Supabase Auth MFA + Cloudflare Access (ADR-12 default)

Written before running. Time-box: one session. (An earlier OpenNext/Next.js variant built against the older plan is kept in `../s3-opennext/` as the comparison variant.)

- **Phase 1 (local, no Cloudflare account):** Vite + React Router SPA built to `dist/`, served with `wrangler pages dev` (local workerd) with Pages Functions: `_middleware.ts` (Access JWT via `jose`, `_routes.json` includes `/*` so static assets are covered), `/api/ping`, `/api/telegram/webhook` (S4). Local Supabase (lean stack) for auth/MFA/Realtime.
- **Phase 2 ([Aziz]: Cloudflare token/zone/Zero Trust):** `wrangler pages deploy`, Access app for `spike-hq.aziztalbi.com`, `pages.dev`/preview protection, real JWKS. NOT possible without credentials.

## Checks (`check.spec.ts`, Playwright; two local Pages servers: :8788 dev mode, :8789 Access-protected)
1. unauthenticated `/` and `/dashboard` -> SPA redirects to `/login`
2. login -> `/mfa`; aal1 cannot open `/dashboard`; enroll TOTP (otplib) -> `/dashboard` (aal2)
3. Realtime insert appears within 5 s
4. session in browser storage: survives refresh, second tab sees it, sign-out clears both
5. :8789 middleware: no header -> 403 for `/api/ping` AND for a static asset AND for `/`; valid token -> 200; wrong aud -> 403; garbage -> 403
6. fail closed: Access vars unset with ENVIRONMENT != development -> 500
7. deep link `/dashboard` served by `_redirects` SPA fallback

## Measure
Pages Functions bundle gzip (`wrangler pages functions build`) vs Free 3 MB; SPA build size; `jose`/grammY running in workerd; build warnings; local wall time per request (CPU limit not measurable locally).

## Decision rule
Works -> ADR-12 CONFIRMED. A blocker -> record it and point to the OpenNext variant (`../s3-opennext`) as fallback.
