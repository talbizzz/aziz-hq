import { localSupabase } from './local-supabase';

export const OWNER = { email: 'owner@e2e.test', password: 'E2e-Owner-Passw0rd!' };
export const OTHER = { email: 'other@e2e.test', password: 'E2e-Other-Passw0rd!' };

// Clean state: remove the e2e users (and the owner row first: it restricts user deletion), then recreate them.
export default async function globalSetup() {
  const { url, secretKey } = localSupabase();
  // sb_secret_ keys are not JWTs: apikey header only, never Authorization: Bearer.
  const headers = { apikey: secretKey, 'Content-Type': 'application/json' };
  const call = async (path: string, init: RequestInit = {}) => {
    const res = await fetch(`${url}${path}`, { ...init, headers: { ...headers, ...init.headers } });
    if (!res.ok)
      throw new Error(`${init.method ?? 'GET'} ${path} -> ${res.status} ${await res.text()}`);
    return res;
  };

  await call('/rest/v1/app_owner?user_id=not.is.null', { method: 'DELETE' });
  const { users } = (await (await call('/auth/v1/admin/users?per_page=200')).json()) as {
    users: { id: string; email: string }[];
  };
  for (const u of users.filter((u) => u.email.endsWith('@e2e.test'))) {
    await call(`/auth/v1/admin/users/${u.id}`, { method: 'DELETE' });
  }

  const create = async (c: { email: string; password: string }) =>
    (
      (await (
        await call('/auth/v1/admin/users', {
          method: 'POST',
          body: JSON.stringify({ ...c, email_confirm: true }),
        })
      ).json()) as { id: string }
    ).id;
  const ownerId = await create(OWNER);
  await create(OTHER);
  await call('/rest/v1/app_owner', { method: 'POST', body: JSON.stringify({ user_id: ownerId }) });
}
