import { execFileSync } from 'node:child_process';

export interface LocalSupabase {
  url: string;
  publishableKey: string;
  secretKey: string;
}

// Reads the running local stack's endpoints and keys (local development keys only).
export function localSupabase(): LocalSupabase {
  const out = execFileSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8' });
  const s = JSON.parse(out.slice(out.indexOf('{'))) as Record<string, string>;
  return { url: s.API_URL!, publishableKey: s.PUBLISHABLE_KEY!, secretKey: s.SECRET_KEY! };
}
