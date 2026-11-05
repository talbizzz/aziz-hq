import type { z } from 'zod';
import type { gateDecision, gateOptionSchema } from './enums.js';

export type GateOption = z.infer<typeof gateOptionSchema>;
export type GateDecisionKind = z.infer<typeof gateDecision>;

// Client-side mirror of public.resolve_gate (supabase/schemas/25_resolve_gate.sql); the dashboard uses it to offer only
// valid choices. The database remains the authority.

/** A gate without options allows approve and dismiss; otherwise exactly the kinds of its options. */
export function allowedDecisions(options: GateOption[]): GateDecisionKind[] {
  if (options.length === 0) return ['approve', 'dismiss'];
  return [...new Set(options.map((o) => o.kind))];
}

/** modify and answer always need a comment; approve/dismiss only when their option says `requiresComment`. */
export function needsComment(decision: GateDecisionKind, options: GateOption[]): boolean {
  if (decision === 'modify' || decision === 'answer') return true;
  return options.some((o) => o.kind === decision && o.requiresComment === true);
}
