import { describe, expect, it, vi } from 'vitest';
import { task } from './test-helpers.js';
import { createRunRecorder, escalationGate } from './supabase-adapters.js';

describe('escalationGate', () => {
  it('builds a blocking escalation gate with the evidence and approve/dismiss options', () => {
    const t = task({
      id: '0b9c1f2e-7d4a-4e1b-9a33-5f6c8d2e1a77',
      title: 'Build the thing',
      role: 'builder',
    });
    const spec = escalationGate(t, {
      errorKind: 'protected_tests',
      summary: 'a.test.ts was modified',
      attempt: 2,
      maxAttempts: 3,
    });
    expect(spec).toMatchObject({
      key: 'escalation-0b9c1f2e',
      type: 'gate',
      title: 'Task failed: Build the thing',
      gate: {
        kind: 'escalation',
        priority: 2,
        title: 'Task failed: Build the thing',
        context: {
          task: { id: t.id, title: 'Build the thing', role: 'builder' },
          errorKind: 'protected_tests',
          summary: 'a.test.ts was modified',
          attempt: 2,
          maxAttempts: 3,
        },
        options: [
          { id: 'acknowledge', label: 'Acknowledge', kind: 'approve' },
          { id: 'dismiss', label: 'Dismiss', kind: 'dismiss' },
        ],
      },
    });
  });
});

describe('createRunRecorder', () => {
  const insert = vi.fn(async () => ({ error: null }));
  const db = { from: vi.fn(() => ({ insert })) };

  it('inserts a usage row per run', async () => {
    const engine = { createTaskGraph: vi.fn() };
    const recorder = createRunRecorder({ db: db as never, engine: engine as never });
    await recorder.usage(
      task({ id: 't1', run_id: 'r1', role: 'builder' }),
      'claude-code-subscription',
      {
        inputTokens: 1,
        outputTokens: 2,
        cacheReadTokens: 3,
        cacheWriteTokens: 4,
        costUsd: 0.5,
        model: 'sonnet',
      },
    );
    expect(db.from).toHaveBeenCalledWith('usage');
    expect(insert).toHaveBeenCalledWith({
      run_id: 'r1',
      task_id: 't1',
      role: 'builder',
      model: 'sonnet',
      runner: 'claude-code-subscription',
      input_tokens: 1,
      output_tokens: 2,
      cache_read_tokens: 3,
      cache_write_tokens: 4,
      cost_usd: 0.5,
    });
  });

  it('throws when the insert fails so the executor can log it', async () => {
    insert.mockResolvedValueOnce({ error: { message: 'boom' } } as never);
    const recorder = createRunRecorder({
      db: db as never,
      engine: { createTaskGraph: vi.fn() } as never,
    });
    await expect(
      recorder.usage(task(), 'r', {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0,
        model: 'm',
      }),
    ).rejects.toThrow('boom');
  });

  it("creates the escalation gate in the failed task's run", async () => {
    const createTaskGraph = vi.fn(async () => ({}));
    const recorder = createRunRecorder({ db: db as never, engine: { createTaskGraph } as never });
    await recorder.escalate(task({ id: 't1', run_id: 'r1' }), {
      errorKind: 'config',
      summary: 'x',
      attempt: 1,
      maxAttempts: 3,
    });
    expect(createTaskGraph).toHaveBeenCalledWith('r1', [expect.objectContaining({ type: 'gate' })]);
  });

  it('keeps transcripts in a pluggable sink (no-op until storage is configured)', async () => {
    const save = vi.fn(async () => undefined);
    const recorder = createRunRecorder({
      db: db as never,
      engine: { createTaskGraph: vi.fn() } as never,
      transcripts: { save },
    });
    await recorder.transcript(task({ id: 't1', run_id: 'r1', attempts: 2 }), 'text');
    expect(save).toHaveBeenCalledWith({ runId: 'r1', taskId: 't1', attempt: 2, text: 'text' });
    const quiet = createRunRecorder({
      db: db as never,
      engine: { createTaskGraph: vi.fn() } as never,
    });
    await expect(quiet.transcript(task(), 'text')).resolves.toBeUndefined();
  });
});
