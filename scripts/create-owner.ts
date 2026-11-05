// Creates the single owner: an auth user (Admin API) plus the app_owner row.
// Run locally with the service-role key in your shell env; never commit or log it.
// Requires: SUPABASE_URL (or VITE_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY, OWNER_EMAIL, OWNER_PASSWORD.
import { createClient } from '@supabase/supabase-js';

const need = (name: string, alt?: string): string => {
  const v = process.env[name] ?? (alt ? process.env[alt] : undefined);
  if (!v) throw new Error(`${name} is not set`);
  return v;
};

const url = need('SUPABASE_URL', 'VITE_SUPABASE_URL');
const serviceKey = need('SUPABASE_SERVICE_ROLE_KEY');
const email = need('OWNER_EMAIL');
const password = need('OWNER_PASSWORD');

// sb_secret_ keys are not JWTs: they go in the apikey header only.
const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: existing, error: readError } = await admin
  .from('app_owner')
  .select('user_id')
  .limit(1);
if (readError) throw new Error(`cannot read app_owner: ${readError.message}`);
if (existing && existing.length > 0)
  throw new Error('app_owner already has a row; refusing to create another owner');

const { data: created, error: createError } = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
});
if (createError || !created.user) throw new Error(`cannot create user: ${createError?.message}`);

const { error: insertError } = await admin.from('app_owner').insert({ user_id: created.user.id });
if (insertError) {
  await admin.auth.admin.deleteUser(created.user.id);
  throw new Error(`cannot insert app_owner (user rolled back): ${insertError.message}`);
}
console.log(`Owner created: ${email}`);
