import { describe, expect, it } from 'vitest';
import { allowedDecisions, needsComment } from './gate-rules.js';

type Option = {
  id: string;
  label: string;
  kind: 'approve' | 'modify' | 'dismiss' | 'answer';
  requiresComment?: boolean;
};
const o = (kind: Option['kind'], requiresComment?: boolean): Option => ({
  id: kind,
  label: kind,
  kind,
  ...(requiresComment === undefined ? {} : { requiresComment }),
});

// The same cases are asserted in SQL by supabase/tests/resolve_gate_test.sql (resolve_gate): keep them in sync.
describe('allowedDecisions', () => {
  it('allows approve and dismiss when the gate has no options', () => {
    expect(allowedDecisions([])).toEqual(['approve', 'dismiss']);
  });
  it('lists the option kinds once, in order', () => {
    expect(allowedDecisions([o('approve'), o('modify'), o('approve')])).toEqual([
      'approve',
      'modify',
    ]);
    expect(allowedDecisions([o('answer')])).toEqual(['answer']);
  });
});

describe('needsComment', () => {
  it('modify and answer always need a comment', () => {
    expect(needsComment('modify', [o('modify')])).toBe(true);
    expect(needsComment('answer', [o('answer')])).toBe(true);
    expect(needsComment('modify', [])).toBe(true);
  });
  it('approve and dismiss only when their option requires one', () => {
    expect(needsComment('approve', [o('approve')])).toBe(false);
    expect(needsComment('approve', [o('approve', true)])).toBe(true);
    expect(needsComment('dismiss', [o('approve', true), o('dismiss')])).toBe(false);
    expect(needsComment('approve', [])).toBe(false);
  });
});
