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

test.beforeEach(async () => {
  await service.from('runs').delete().not('id', 'is', null);
  await service.from('overrides').delete().not('id', 'is', null);
  await service.from('settings').update({ value: 'Europe/Berlin' }).eq('key', 'timezone');
  await service
    .from('settings')
    .update({ value: { start: '22:00', end: '07:00' } })
    .eq('key', 'quiet_hours');
  await service.from('settings').update({ value: '08:00' }).eq('key', 'digest_time');
  await engine.createRun({
    moduleId: 'factory',
    title: 'override run',
    tasks: [{ key: 't', type: 'system', title: 'work' }],
  });
});

test('pausing from the header stops claiming; resume restarts it', async ({ page }) => {
  await loginAsOwner(page);
  await expect(page.getByTestId('override-chip')).toHaveCount(0);

  await page.getByText('Pause', { exact: true }).click();
  await page.getByTestId('override-pause-1h').click();
  await expect(page.getByTestId('override-chip')).toContainText('Paused until');
  expect(await engine.claimTask('e2e')).toBeNull();

  await page.getByTestId('override-resume').click();
  await expect(page.getByTestId('override-chip')).toHaveCount(0);
  expect((await engine.claimTask('e2e'))?.title).toBe('work');
});

test('an override set elsewhere (Telegram) appears on the open page', async ({ page }) => {
  await loginAsOwner(page);
  await expect(page.getByTestId('off-today-toggle')).not.toBeChecked();
  await page.waitForTimeout(2000); // Realtime subscription settles (ADR-4)
  const { error } = await service.rpc('set_override', {
    p_kind: 'pause',
    p_minutes: 30,
    p_via: 'telegram',
  });
  expect(error).toBeNull();
  await expect(page.getByTestId('override-chip')).toContainText('Paused until', { timeout: 5000 });
  await service.rpc('clear_override', { p_kind: 'pause' });
  await expect(page.getByTestId('override-chip')).toHaveCount(0, { timeout: 5000 });
});

test('"I\'m off today" can be switched on and off', async ({ page }) => {
  await loginAsOwner(page);
  const toggle = page.getByTestId('off-today-toggle');
  await toggle.check();
  await expect(page.getByTestId('override-chip')).toContainText('Off today');
  const active = (await service.from('active_overrides').select('kind, created_by')).data!;
  expect(active).toEqual([{ kind: 'off_today', created_by: 'dashboard' }]);
  await toggle.uncheck();
  await expect(page.getByTestId('override-chip')).toHaveCount(0);
  expect((await service.from('active_overrides').select('kind')).data).toEqual([]);
});

test('settings persist and invalid values are rejected', async ({ page }) => {
  await loginAsOwner(page);
  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByTestId('settings-quiet-start')).toHaveValue('22:00');

  await page.getByTestId('settings-quiet-start').fill('23:30');
  await page.getByTestId('settings-quiet-end').fill('06:15');
  await page.getByTestId('settings-digest-time').fill('09:00');
  await page.getByTestId('settings-timezone').selectOption('Europe/London');
  await page.getByTestId('settings-save').click();
  await expect(page.getByTestId('settings-saved')).toBeVisible();

  const rows = (
    await service
      .from('settings')
      .select('key, value')
      .in('key', ['timezone', 'quiet_hours', 'digest_time'])
  ).data!;
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  expect(byKey).toEqual({
    timezone: 'Europe/London',
    quiet_hours: { start: '23:30', end: '06:15' },
    digest_time: '09:00',
  });

  await page.reload();
  await expect(page.getByTestId('settings-quiet-start')).toHaveValue('23:30');
  await expect(page.getByTestId('settings-timezone')).toHaveValue('Europe/London');

  await page.getByTestId('settings-quiet-start').fill('');
  await page.getByTestId('settings-save').click();
  await expect(page.getByTestId('settings-error')).toContainText('Quiet hours start');
  expect(
    (await service.from('settings').select('value').eq('key', 'quiet_hours').single()).data!.value,
  ).toEqual({ start: '23:30', end: '06:15' });
});
