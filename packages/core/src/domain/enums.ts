import { z } from 'zod';

// Values MUST equal the DB enums (supabase/schemas/00_types.sql); enums.test.ts enforces it.
export const taskStatus = z.enum([
  'pending',
  'running',
  'waiting_human',
  'done',
  'failed',
  'cancelled',
]);
export const taskType = z.enum(['agent', 'gate', 'system']);
export const runStatus = z.enum(['pending', 'running', 'paused', 'done', 'failed', 'cancelled']);
export const gateDecision = z.enum(['approve', 'modify', 'dismiss', 'answer']);
export const actorType = z.enum(['system', 'worker', 'agent', 'human']);

// gates.kind is a text column with a check constraint, not a DB enum.
export const gateKind = z.enum([
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

// JSONB payloads that exist already.
export const gateOptionSchema = z.object({
  id: z.string(),
  label: z.string(),
  kind: gateDecision,
  requiresComment: z.boolean().optional(),
});

export const eventDataSchema = z.record(z.string(), z.unknown());
