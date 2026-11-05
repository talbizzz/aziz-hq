import { expect, test } from '@playwright/test';
import { OTHER, OWNER } from './global-setup';
import { enrolAndVerify, login } from './helpers';

test('unauthenticated visits redirect to /login', async ({ page }) => {
  for (const path of ['/', '/mfa', '/runs/1']) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login$/);
  }
});

test('a wrong password shows an error and stays on /login', async ({ page }) => {
  await login(page, { email: OWNER.email, password: 'nope' });
  await expect(page.getByTestId('login-error')).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});

test('owner: login, MFA enrolment, empty dashboard, sign-out', async ({ page }) => {
  await login(page, OWNER);
  await expect(page).toHaveURL(/\/mfa/);

  // at aal1 the dashboard is out of reach
  await page.goto('/');
  await expect(page).toHaveURL(/\/mfa/);

  // a second visit to /mfa must not trip over the stale unverified factor from the first one
  await page.reload();
  await expect(page.getByTestId('mfa-qr')).toBeVisible();

  await enrolAndVerify(page);
  await expect(page).toHaveURL(/localhost:3000\/$/);
  await expect(page.getByTestId('dashboard-empty')).toBeVisible();
  await expect(page.getByTestId('not-authorised')).toHaveCount(0);

  await page.getByTestId('signout').click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
});

test('non-owner with MFA reaches the shell but is not authorised and sees no data', async ({
  page,
}) => {
  await login(page, OTHER);
  await enrolAndVerify(page);
  await expect(page).toHaveURL(/localhost:3000\/$/);
  await expect(page.getByText('Aziz HQ')).toBeVisible();
  await expect(page.getByTestId('not-authorised')).toBeVisible();
  await expect(page.getByTestId('dashboard-empty')).toHaveCount(0);
});
