import { afterAll, describe, expect, it } from 'vitest';
import { createStorageTranscriptSink } from '../src/supabase-adapters.js';
import { localSupabase, serviceClient } from './support.js';
import { createClient } from '@supabase/supabase-js';

const local = localSupabase();
const service = serviceClient(local);
const runId = crypto.randomUUID();
const taskId = crypto.randomUUID();
const path = `${runId}/${taskId}/attempt-1.txt`;

afterAll(async () => {
  await service.storage.from('transcripts').remove([path]);
});

describe('transcript storage (local Storage)', () => {
  it('stores a redacted transcript through the sink, readable by the service role', async () => {
    const secret = 'sk-ant-api03-' + 'Z9y8X7w6'.repeat(8);
    await createStorageTranscriptSink(service as never).save({
      runId,
      taskId,
      attempt: 1,
      text: `{"type":"result"} token ${secret}`,
    });
    const { data, error } = await service.storage.from('transcripts').download(path);
    expect(error).toBeNull();
    const text = await data!.text();
    expect(text).toContain('"type":"result"');
    expect(text).not.toContain(secret);
  });

  it('is private: anon neither lists nor downloads it, and there is no public URL access', async () => {
    const anon = createClient(local.url, local.publishableKey, { auth: { persistSession: false } });
    const { data } = await anon.storage.from('transcripts').download(path);
    expect(data).toBeNull();
    const list = await anon.storage.from('transcripts').list(`${runId}/${taskId}`);
    expect(list.data ?? []).toEqual([]);
    const res = await fetch(`${local.url}/storage/v1/object/public/transcripts/${path}`);
    expect(res.ok).toBe(false);
  });

  it('refuses a non-text upload', async () => {
    const { error } = await service.storage
      .from('transcripts')
      .upload(`${runId}/${taskId}/x.png`, new Blob(['x'], { type: 'image/png' }), {
        contentType: 'image/png',
      });
    expect(error).not.toBeNull();
  });
});
