import { describe, expect, expectTypeOf, it } from 'vitest';
import type { z } from 'zod';
import { Constants, type Database } from '../db/types.js';
import {
  actorType,
  eventDataSchema,
  gateDecision,
  gateKind,
  gateOptionSchema,
  runStatus,
  taskStatus,
  taskType,
} from './enums.js';

type Enums = Database['public']['Enums'];

// Compile-time: Zod enums and generated DB enums must be the same union.
expectTypeOf<z.infer<typeof taskStatus>>().toEqualTypeOf<Enums['task_status']>();
expectTypeOf<z.infer<typeof taskType>>().toEqualTypeOf<Enums['task_type']>();
expectTypeOf<z.infer<typeof runStatus>>().toEqualTypeOf<Enums['run_status']>();
expectTypeOf<z.infer<typeof gateDecision>>().toEqualTypeOf<Enums['gate_decision']>();
expectTypeOf<z.infer<typeof actorType>>().toEqualTypeOf<Enums['actor_type']>();

describe('Zod enums equal the DB enums', () => {
  it.each([
    ['task_status', taskStatus],
    ['task_type', taskType],
    ['run_status', runStatus],
    ['gate_decision', gateDecision],
    ['actor_type', actorType],
  ] as const)('%s', (name, schema) => {
    expect([...schema.options]).toEqual([...Constants.public.Enums[name]]);
  });

  it('every DB enum has a Zod counterpart', () => {
    expect(Object.keys(Constants.public.Enums).sort()).toEqual(
      ['actor_type', 'gate_decision', 'run_status', 'task_status', 'task_type'].sort(),
    );
  });
});

describe('gateKind', () => {
  it('lists the kinds allowed by the gates.kind check', () => {
    expect([...gateKind.options]).toEqual([
      'spec',
      'plan',
      'milestone_review',
      'release',
      'checklist',
      'budget',
      'usage_extension',
      'secret_request',
      'escalation',
      'other',
    ]);
  });
});

describe('gateOptionSchema', () => {
  it('accepts a minimal and a full option', () => {
    expect(gateOptionSchema.safeParse({ id: 'a', label: 'Approve', kind: 'approve' }).success).toBe(
      true,
    );
    expect(
      gateOptionSchema.safeParse({
        id: 'm',
        label: 'Modify',
        kind: 'modify',
        requiresComment: true,
      }).success,
    ).toBe(true);
  });

  it('rejects unknown kinds, missing fields and wrong types', () => {
    expect(gateOptionSchema.safeParse({ id: 'a', label: 'x', kind: 'maybe' }).success).toBe(false);
    expect(gateOptionSchema.safeParse({ id: 'a', kind: 'approve' }).success).toBe(false);
    expect(gateOptionSchema.safeParse({ id: 1, label: 'x', kind: 'approve' }).success).toBe(false);
    expect(
      gateOptionSchema.safeParse({ id: 'a', label: 'x', kind: 'approve', requiresComment: 'yes' })
        .success,
    ).toBe(false);
  });
});

describe('eventDataSchema', () => {
  it('accepts any JSON object and rejects non-objects', () => {
    expect(eventDataSchema.safeParse({ from: 'pending', to: 'running', n: 1 }).success).toBe(true);
    expect(eventDataSchema.safeParse({}).success).toBe(true);
    expect(eventDataSchema.safeParse('x').success).toBe(false);
    expect(eventDataSchema.safeParse([1]).success).toBe(false);
  });
});
