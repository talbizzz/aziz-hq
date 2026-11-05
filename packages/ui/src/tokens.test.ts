import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildTokensCss } from '../scripts/build-tokens.js';
import { tokens } from './tokens.js';

describe('design tokens', () => {
  it('defines light and dark values for every color token', () => {
    for (const [name, value] of Object.entries(tokens.color)) {
      expect(value.light, name).toBeTruthy();
      expect(value.dark, name).toBeTruthy();
    }
    expect(Object.keys(tokens.color)).toEqual(
      expect.arrayContaining(['background', 'foreground', 'primary', 'border', 'destructive']),
    );
  });

  it('generates a :root block, a .dark block and one variable per token', () => {
    const css = buildTokensCss(tokens);
    expect(css).toContain(':root {');
    expect(css).toContain('.dark {');
    for (const name of Object.keys(tokens.color)) expect(css).toContain(`--${name}:`);
    expect(css).toContain(`--radius: ${tokens.radius}`);
    expect(css).toContain(`--font-sans: ${tokens.font.sans}`);
  });

  it('keeps the committed tokens.css in sync with tokens.ts (run `pnpm tokens:build`)', () => {
    const committed = readFileSync(join(import.meta.dirname, 'tokens.css'), 'utf8');
    expect(committed).toBe(buildTokensCss(tokens));
  });
});
