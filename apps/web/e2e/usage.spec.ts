import { createEngine, type Database } from '@aziz-hq/core';
import { expect, test } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { loginAsOwner } from './helpers';
import { localSupabase } from './local-supabase';

const local = localSupabase();
const service = createClient<Database>(local.url, local.secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const engine = createEngine(service);

const hours = (n: number) => new Date(Date.now() + n * 3_600_000).toISOString();

test.beforeEach(async () => {
  await service.from('overrides').delete().not('id', 'is', null);
  await service.from('usage_snapshots').delete().not('id', 'is', null);
  // a one-minute sleeping window far from "now" keeps the work cap (50) in force whatever time the test runs
  await service
    .from('settings')
    .update({
      value: {
        sleeping_hours: { start: '03:00', end: '03:01' },
        cap_work_pct: 50,
        cap_sleeping_pct: 100,
        weekly_margin_pct: 10,
        weekly_ceiling_pct: 90,
      },
    })
    .eq('key', 'usage_policy');
});

test('the header mode menu sets working, stop, sleeping and custom modes', async ({ page }) => {
  await loginAsOwner(page);
  const chip = page.getByTestId('override-chip');

  await page.getByText('Mode', { exact: true }).click();
  await page.getByTestId('mode-working').click();
  await expect(chip).toContainText('Working until');
  expect(
    (await service.from('active_overrides').select('kind, created_by').eq('kind', 'working')).data,
  ).toEqual([{ kind: 'working', created_by: 'dashboard' }]);

  await page.getByText('Mode', { exact: true }).click();
  await page.getByTestId('mode-stop').click();
  await expect(chip).toContainText('Stopped until');

  await page.getByText('Mode', { exact: true }).click();
  await page.getByTestId('mode-sleeping').click();
  await expect(chip).toContainText('Sleeping until');

  await page.getByText('Mode', { exact: true }).click();
  await page.getByTestId('mode-custom-cap').fill('70');
  await page.getByTestId('mode-custom-minutes').fill('120');
  await page.getByTestId('mode-custom-apply').click();
  await expect(chip).toContainText('Custom 70% until');
  const custom = (await service.from('active_overrides').select('cap_pct').eq('kind', 'custom'))
    .data!;
  expect(custom).toEqual([{ cap_pct: 70 }]);

  await page.getByTestId('override-clear-modes').click();
  await expect(chip).toHaveCount(0);
  expect((await service.from('active_overrides').select('kind')).data).toEqual([]);
});

test('the weekly pacing can be ignored for today or the week, then restored', async ({ page }) => {
  await loginAsOwner(page);
  const chip = page.getByTestId('override-chip');

  await page.getByText('Mode', { exact: true }).click();
  await page.getByTestId('pacing-bypass-day').click();
  await expect(chip).toContainText('Weekly pacing ignored until');
  expect(
    (
      await service
        .from('active_overrides')
        .select('kind, created_by')
        .eq('kind', 'pacing_bypass_day')
    ).data,
  ).toEqual([{ kind: 'pacing_bypass_day', created_by: 'dashboard' }]);

  await page.getByText('Mode', { exact: true }).click();
  await page.getByTestId('pacing-bypass-week').click();
  await expect(chip).toContainText('Weekly pacing ignored until the week resets');

  await page.getByTestId('pacing-restore').click();
  await expect(chip).toHaveCount(0);
  expect((await service.from('active_overrides').select('kind')).data).toEqual([]);
});

test('the usage panel shows the windows and the policy decision, live', async ({ page }) => {
  await service.rpc('record_usage_snapshot', {
    p_source: 'rate_limit_event',
    p_five_pct: 35,
    p_five_resets: hours(2),
    p_seven_pct: 12,
    p_seven_resets: hours(24 * 5),
  });
  await loginAsOwner(page);
  const panel = page.getByTestId('usage-panel');
  await expect(panel).toBeVisible();
  await expect(page.getByTestId('usage-five-hour')).toContainText('35%');
  await expect(page.getByTestId('usage-weekly')).toContainText('12%');
  await expect(page.getByTestId('usage-decision')).toHaveAttribute('data-allow', 'true');
  await expect(page.getByTestId('usage-decision')).toContainText('up to 50%');

  await page.waitForTimeout(2000); // Realtime subscription settles (ADR-4)
  await service.rpc('record_usage_snapshot', {
    p_source: 'rate_limit_event',
    p_five_pct: 55,
    p_five_resets: hours(2),
    p_seven_pct: 12,
    p_seven_resets: hours(24 * 5),
  });
  await expect(page.getByTestId('usage-five-hour')).toContainText('55%', { timeout: 5000 });
  await expect(page.getByTestId('usage-decision')).toHaveAttribute('data-allow', 'false');
  await expect(page.getByTestId('usage-decision')).toContainText('five-hour cap');

  // a sleeping override lifts the cap to 100: the decision flips back to allow, live
  await service.rpc('set_mode_override', { p_kind: 'sleeping', p_via: 'telegram' });
  await expect(page.getByTestId('usage-decision')).toHaveAttribute('data-allow', 'true', {
    timeout: 5000,
  });
});

test('with no reading yet the panel says so', async ({ page }) => {
  await loginAsOwner(page);
  await expect(page.getByTestId('usage-decision')).toContainText('no usage reading yet');
  expect(engine).toBeTruthy();
});

test('usage policy settings persist and invalid values are rejected', async ({ page }) => {
  await loginAsOwner(page);
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByTestId('usage-cap-work').fill('40');
  await page.getByTestId('usage-ceiling').fill('85');
  await page.getByTestId('usage-save').click();
  await expect(page.getByTestId('usage-saved')).toBeVisible();
  const value = (await service.from('settings').select('value').eq('key', 'usage_policy').single())
    .data!.value as { cap_work_pct: number; weekly_ceiling_pct: number };
  expect(value).toMatchObject({ cap_work_pct: 40, weekly_ceiling_pct: 85 });

  await page.getByTestId('usage-cap-work').fill('150');
  await page.getByTestId('usage-save').click();
  await expect(page.getByTestId('usage-error')).toContainText('Work cap');
  expect(
    (
      (await service.from('settings').select('value').eq('key', 'usage_policy').single()).data!
        .value as { cap_work_pct: number }
    ).cap_work_pct,
  ).toBe(40);
});
