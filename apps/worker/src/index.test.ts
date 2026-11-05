import { describe, expect, it } from 'vitest';
import { main, packageName } from './index.js';

describe('@aziz-hq/worker', () => {
  it('exports its package name', () => {
    expect(packageName).toBe('@aziz-hq/worker');
  });

  it('exposes a main() stub that returns without output', () => {
    expect(main()).toBeUndefined();
  });
});
