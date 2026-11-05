import { beforeEach, describe, expect, it } from 'vitest';
import { engineFor, localSupabase, resetData, serviceClient } from './support.js';

describe('the pause override through the real API (service key)', () => {
  beforeEach(async () => {
    await resetData();
    await serviceClient().from('overrides').delete().not('id', 'is', null);
  });

  it('stops claiming while active and resumes on clear (the secret key arrives as role service_role)', async () => {
    const client = serviceClient();
    const engine = engineFor(client);
    await engine.createRun({
      moduleId: 'factory',
      title: 'pause',
      tasks: [{ key: 'a', type: 'system', title: 'A' }],
    });

    const set = await client.rpc('set_override', {
      p_kind: 'pause',
      p_minutes: 5,
      p_via: 'telegram',
    });
    expect(set.error).toBeNull();
    expect(await engine.claimTask('w')).toBeNull();

    const cleared = await client.rpc('clear_override', { p_kind: 'pause' });
    expect(cleared.data).toBe(1);
    expect((await engine.claimTask('w'))?.title).toBe('A');
  });

  it('refuses the publishable (anon) key', async () => {
    const { url, publishableKey } = localSupabase();
    const res = await fetch(`${url}/rest/v1/rpc/set_override`, {
      method: 'POST',
      headers: { apikey: publishableKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_kind: 'pause', p_minutes: 5 }),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(((await res.json()) as { code?: string }).code).toBe('42501'); // permission denied for the anon role
  });
});
