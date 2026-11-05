import { createEngine, type Database } from '@aziz-hq/core';
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

const approveDismiss = [
  { id: 'a', label: 'Approve', kind: 'approve' as const },
  { id: 'd', label: 'Dismiss', kind: 'dismiss' as const },
];

let gates: Record<string, string> = {};
let afterId = '';

test.beforeEach(async () => {
  await service.from('runs').delete().not('id', 'is', null);
  await service.from('notifications').delete().not('id', 'is', null);
  const { tasks } = await engine.createRun({
    moduleId: 'factory',
    title: 'inbox run',
    tasks: [
      {
        key: 'info',
        type: 'gate',
        title: 'Info gate',
        gate: { kind: 'other', title: 'Info gate', priority: 0, options: approveDismiss },
      },
      {
        key: 'normal',
        type: 'gate',
        title: 'Normal gate',
        gate: {
          kind: 'plan',
          title: 'Normal gate',
          priority: 1,
          context: { note: 'please check', items: [1, 2] },
          options: [...approveDismiss, { id: 'm', label: 'Modify', kind: 'modify' as const }],
        },
      },
      {
        key: 'blocking',
        type: 'gate',
        title: 'Blocking gate',
        gate: { kind: 'release', title: 'Blocking gate', priority: 2, options: approveDismiss },
      },
      { key: 'after', type: 'system', title: 'after the normal gate', depends_on: ['normal'] },
    ],
  });
  gates = tasks;
  afterId = tasks.after!;
  await engine.schedulerTick(); // opens the three gates
});

test('the owner sees open gates ordered by priority with a live count', async ({ page }) => {
  await loginAsOwner(page);
  await page.getByRole('link', { name: /Inbox/ }).click();
  await expect(page).toHaveURL(/\/inbox$/);
  await expect(page.getByTestId('inbox-count')).toHaveText('3');
  const rows = page.getByTestId('gate-row');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('Blocking gate');
  await expect(rows.nth(1)).toContainText('Normal gate');
  await expect(rows.nth(2)).toContainText('Info gate');

  // sorting by priority again flips the order
  await page.getByRole('button', { name: /Priority/ }).click();
  await expect(rows.nth(0)).toContainText('Info gate');
});

test('approve from the detail page: the gate moves to Decided and the run continues', async ({
  page,
}) => {
  await loginAsOwner(page);
  await page.goto('/inbox');
  await page.getByTestId('gate-row').filter({ hasText: 'Normal gate' }).click();
  await expect(page).toHaveURL(new RegExp(`/gates/${gates.normal}$`));
  await expect(page.getByTestId('gate-title')).toHaveText('Normal gate');
  await expect(page.getByText('please check')).toBeVisible(); // the context

  await page.getByTestId('gate-option-approve').click();
  await expect(page.getByTestId('gate-submit')).toBeEnabled(); // approve needs no comment
  await page.getByTestId('gate-comment').fill('looks good');
  await page.getByTestId('gate-submit').click();
  await expect(page.getByTestId('gate-decided')).toContainText('approve');
  await expect(page.getByTestId('gate-submit')).toBeDisabled();

  const decision = (
    await service
      .from('gates')
      .select('decision, comment, decided_via')
      .eq('task_id', gates.normal!)
      .single()
  ).data!;
  expect(decision).toEqual({
    decision: 'approve',
    comment: 'looks good',
    decided_via: 'dashboard',
  });
  expect((await engine.claimTask('e2e'))?.id).toBe(afterId); // the run continues

  await page.goto('/inbox');
  await expect(page.getByTestId('gate-row')).toHaveCount(2);
  await expect(page.getByTestId('inbox-count')).toHaveText('2');
  await page.getByRole('tab', { name: 'Decided' }).click();
  await expect(page.getByTestId('gate-row')).toHaveCount(1);
  await expect(page.getByTestId('gate-row')).toContainText('Normal gate');
});

test('modify requires a comment before it can be submitted', async ({ page }) => {
  await loginAsOwner(page);
  await page.goto(`/gates/${gates.normal}`);
  await page.getByTestId('gate-option-modify').click();
  await expect(page.getByTestId('gate-submit')).toBeDisabled();
  await page.getByTestId('gate-comment').fill('change the title');
  await expect(page.getByTestId('gate-submit')).toBeEnabled();
  await page.getByTestId('gate-submit').click();
  await expect(page.getByTestId('gate-decided')).toContainText('modify');
});

test('a decision made elsewhere (Telegram) shows up live on an open page, and a stale submit is harmless', async ({
  page,
}) => {
  await loginAsOwner(page);
  await page.goto(`/gates/${gates.blocking}`);
  await expect(page.getByTestId('gate-title')).toBeVisible();
  await page.waitForTimeout(2000); // Realtime subscription settles (ADR-4)
  await engine.decideGate({ taskId: gates.blocking!, decision: 'dismiss', via: 'telegram' });
  await expect(page.getByTestId('gate-decided')).toContainText('dismiss', { timeout: 5000 });
  await expect(page.getByTestId('gate-decided')).toContainText('telegram');
});

test('a non-owner is not authorised and sees no gates', async ({ page }) => {
  await loginAs(page, OTHER);
  await page.goto('/inbox');
  await expect(page.getByTestId('not-authorised')).toBeVisible();
  await expect(page.getByTestId('inbox-table')).toHaveCount(0);
  await expect(page.getByTestId('gate-row')).toHaveCount(0);
});
