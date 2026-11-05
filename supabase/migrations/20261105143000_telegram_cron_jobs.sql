-- Manual migration (listed in docs/MANUAL_MIGRATIONS.md): pg_cron jobs are rows in cron.job, not schema objects, so the
-- diff tool does not track them. cron.schedule upserts by job name, so re-running is safe.
select cron.schedule('flush_notifications', '* * * * *', 'select public.flush_notifications()');
select cron.schedule('worker_watchdog', '*/3 * * * *', 'select public.watchdog_tick()');
