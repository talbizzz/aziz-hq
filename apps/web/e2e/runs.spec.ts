import { createEngine, fakeRunSpec, type Database } from '@aziz-hq/core';
import { expect, test } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { OTHER } from './global-setup';
import { loginAs, loginAsOwner } from './helpers';
import { localSupabase } from './local-supabase';

const local = localSupabase();
const service = createClient<Database>(local.url, local.secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const engine = createEngine(service);

let runId = '';
let tasks: Record<string, string> = {};

test.beforeAll(async () => {
  // fresh data: runs cascade to tasks; events are append-only and stay
  await service.from('runs').delete().not('id', 'is', null);
  await service.from('worker_heartbeats').delete().not('worker_id', 'is', null);
  ({ runId, tasks } = await engine.createRun({
    moduleId: 'factory',
    title: 'e2e fake run',
    tasks: fakeRunSpec(),
  }));
});

test('the owner sees the run in the list and its graph in the run view', async ({ page }) => {
  await loginAsOwner(page);
  await page.getByRole('link', { name: 'Runs' }).click();
  await expect(page).toHaveURL(/\/runs$/);
  const row = page.getByTestId('run-row').filter({ hasText: 'e2e fake run' });
  await expect(row).toBeVisible();
  await expect(row).toContainText('0/5');

  await row.click();
  await expect(page).toHaveURL(new RegExp(`/runs/${runId}$`));
  await expect(page.getByTestId('run-graph')).toBeVisible();
  for (const id of Object.values(tasks))
    await expect(page.getByTestId(`task-node-${id}`)).toHaveAttribute('data-status', 'pending');
  await expect(page.getByTestId('worker-status')).toHaveAttribute('data-online', 'false');
  await expect(page.getByTestId('event-item').first()).toBeVisible();

  // selecting a task shows its details
  await page.getByTestId(`task-node-${tasks['build-b']}`).click();
  await expect(page.getByTestId('task-panel')).toContainText('Build part B');
  await expect(page.getByTestId('task-panel')).toContainText('builder');
});

test('statuses, the timeline and the worker dot update live without reloading', async ({
  page,
}) => {
  await loginAsOwner(page);
  await page.goto(`/runs/${runId}`);
  const setup = page.getByTestId(`task-node-${tasks.setup}`);
  await expect(setup).toBeVisible();
  const itemsBefore = await page.getByTestId('event-item').count();
  await page.waitForTimeout(2000); // Realtime: SUBSCRIBED fires before postgres_changes is active (ADR-4)

  const claimed = await engine.claimTask('e2e-worker');
  expect(claimed?.id).toBe(tasks.setup);
  await expect(setup).toHaveAttribute('data-status', 'running', { timeout: 5000 });
  await expect
    .poll(() => page.getByTestId('event-item').count(), { timeout: 5000 })
    .toBeGreaterThan(itemsBefore);

  await engine.completeTask(tasks.setup!, 'e2e-worker', { summary: 'ok' });
  await expect(setup).toHaveAttribute('data-status', 'done', { timeout: 5000 });

  await engine.workerHeartbeat('e2e-worker', {});
  await expect(page.getByTestId('worker-status')).toHaveAttribute('data-online', 'true', {
    timeout: 5000,
  });
});

test('a non-owner is not authorised and sees no runs', async ({ page }) => {
  await loginAs(page, OTHER);
  await page.goto('/runs');
  await expect(page.getByTestId('not-authorised')).toBeVisible();
  await expect(page.getByTestId('runs-list')).toHaveCount(0);
  await expect(page.getByTestId('run-row')).toHaveCount(0);
});
