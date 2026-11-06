# Parking lot

Ideas that are outside the current milestone's scope. Append here instead of building them.

| Date       | Idea                                                          | Source                    |
| ---------- | ------------------------------------------------------------- | ------------------------- |
| 2026-11-05 | Lane exclusion in `claim_task` (one running task per `lane`)  | M2 planning, for M7 lanes |
| 2026-11-05 | Retry backoff column `tasks.not_before`                       | M2 planning               |
| 2026-11-05 | GIN index on `tasks.depends_on` once graphs get large         | M2 planning               |
| 2026-11-05 | Run cancellation from the dashboard                           | M2 planning               |
| 2026-11-05 | Automate `supabase functions deploy telegram` in `deploy.yml` | M3 planning               |
| 2026-11-05 | Free-text Telegram replies for modify/answer gates            | M3 planning               |

- **Flaky e2e: `auth.spec.ts` "owner: login, MFA enrolment" (2026-11-06).** On one CI run the `mfa-qr` element was not visible within 5 s after `page.reload()` on `/mfa`; the same code passed on the re-run and on the previous commit. Suspect: enrolment after reload races with cleaning up the stale unverified factor. Investigate (longer expect timeout is a workaround, not a fix) if it recurs.
