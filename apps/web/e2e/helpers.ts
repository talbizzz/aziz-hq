import { expect, type Page } from '@playwright/test';
import { generate } from 'otplib';
import { OWNER } from './global-setup';
import { localSupabase } from './local-supabase';

export async function login(page: Page, who: { email: string; password: string }) {
  await page.goto('/login');
  await page.getByTestId('login-email').fill(who.email);
  await page.getByTestId('login-password').fill(who.password);
  await page.getByTestId('login-submit').click();
}

export async function enrolAndVerify(page: Page) {
  await expect(page).toHaveURL(/\/mfa/);
  await expect(page.getByTestId('mfa-qr')).toBeVisible();
  const secret = (await page.getByTestId('mfa-secret').textContent())!.trim();
  await page.getByTestId('mfa-code').fill(await generate({ secret }));
  await page.getByTestId('mfa-submit').click();
}

/** Removes a user's TOTP factors through the Admin API so the next login enrols afresh (specs share one database). */
export async function resetMfa(email: string) {
  const { url, secretKey } = localSupabase();
  const headers = { apikey: secretKey, 'Content-Type': 'application/json' };
  const { users } = (await (
    await fetch(`${url}/auth/v1/admin/users?per_page=200`, { headers })
  ).json()) as {
    users: { id: string; email: string }[];
  };
  const user = users.find((u) => u.email === email);
  if (!user) throw new Error(`no such user ${email}`);
  const factors = (await (
    await fetch(`${url}/auth/v1/admin/users/${user.id}/factors`, { headers })
  ).json()) as { id: string }[];
  for (const f of Array.isArray(factors) ? factors : []) {
    await fetch(`${url}/auth/v1/admin/users/${user.id}/factors/${f.id}`, {
      method: 'DELETE',
      headers,
    });
  }
}

export async function loginAs(page: Page, who: { email: string; password: string }) {
  await resetMfa(who.email);
  await login(page, who);
  await enrolAndVerify(page);
  await expect(page).toHaveURL(/localhost:3000\/$/);
}

export const loginAsOwner = (page: Page) => loginAs(page, OWNER);
