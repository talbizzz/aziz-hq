import { describe, expect, it } from 'vitest';
import { packageName } from './index.js';

describe('@aziz-hq/agents-sdk', () => {
  it('exports its package name', () => {
    expect(packageName).toBe('@aziz-hq/agents-sdk');
  });
});
