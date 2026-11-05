# Runbook: Cloudflare Pages, DNS and Access for hq.aziztalbi.com

Verified on a spike deployment (2026-11-05, see `docs/spikes/evidence/S3-live-cloudflare.md`). Do these once, in this order.

## 1. Pages project

1. Create a scoped API token (dashboard > My Profile > API Tokens > Custom): **Account > Cloudflare Pages > Edit** and **Zone > DNS > Edit** for `aziztalbi.com` only, with an expiry. Store it as the GitHub secret `CLOUDFLARE_API_TOKEN`, and the account id as `CLOUDFLARE_ACCOUNT_ID`.
2. Create the project: `npx wrangler pages project create aziz-hq-web --production-branch main` (with the token in the environment).
3. Preview deployments: `*.aziz-hq-web.pages.dev` URLs are also protected by the middleware (403 without an Access JWT), so they are safe; still, only deploy `main`.

## 2. Custom domain and DNS

1. Add `hq.aziztalbi.com` to the Pages project (dashboard: Pages > aziz-hq-web > Custom domains, or the Pages domains API).
2. Adding the domain through the API does **not** create DNS: add a proxied `CNAME hq -> aziz-hq-web.pages.dev` in the `aziztalbi.com` zone. Activation takes a couple of minutes (522, then 500, then the app).

## 3. Access application

The Zero Trust organisation is per account (here shared with another project, team `gigaway`): never edit its existing applications, policies or login methods.

1. Zero Trust > Access > Applications > Add > Self-hosted. Name `aziz-hq`, public hostname `hq.aziztalbi.com` (all paths), session 24 h.
2. Policy `owner-only`: Action Allow, Include > Emails > the owner's email. Login methods: select only the method you use (the account's default **Cloudflare** method works for the account owner); turn off "Accept all available identity providers".
3. Turn **off** "Authenticate with Cloudflare One Client" (otherwise saving fails with `allow_authenticate_via_warp ...`).
4. Application > Additional settings: copy the **Application Audience (AUD) Tag**.
5. Set the Pages production secrets: `CF_ACCESS_TEAM_DOMAIN` = the team name only (e.g. `gigaway`; the middleware appends `.cloudflareaccess.com`), `CF_ACCESS_AUD` = the AUD tag. Redeploy (secrets apply to new deployments). `ENVIRONMENT=production` comes from `wrangler.jsonc`.
6. No Telegram bypass application: the webhook is a Supabase Edge Function (ADR-5).

## 4. Verify

`pnpm tsx scripts/smoke-prod.ts` (automated), then in a browser: open `https://hq.aziztalbi.com`, log in through Access, sign in with email and password, enrol TOTP, see the empty dashboard, sign out.

## Recovery (lockout)

- Locked out of the app (MFA lost): use the Supabase dashboard (Authentication > Users > the owner > remove the MFA factor), or the service-role key from a shell, then sign in again and re-enrol.
- Locked out by Access (wrong policy): fix the policy in the Cloudflare dashboard (the account login is independent of Access).
- If Access is misconfigured the Pages middleware still returns 403/500 (fail closed); never "fix" that by disabling the middleware.
