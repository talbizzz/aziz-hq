import { describe, expect, it } from 'vitest';
import { matchesAny, matchesGlob } from './glob.js';

describe('matchesGlob', () => {
  it('matches * within one path segment only', () => {
    expect(matchesGlob('src/a.ts', 'src/*.ts')).toBe(true);
    expect(matchesGlob('src/deep/a.ts', 'src/*.ts')).toBe(false);
    expect(matchesGlob('src/a.tsx', 'src/*.ts')).toBe(false);
  });
  it('matches ** across directories, including none', () => {
    expect(matchesGlob('src/a.test.ts', '**/*.test.ts')).toBe(true);
    expect(matchesGlob('a.test.ts', '**/*.test.ts')).toBe(true);
    expect(matchesGlob('src/deep/er/a.test.ts', '**/*.test.ts')).toBe(true);
    expect(matchesGlob('src/a.ts', '**/*.test.ts')).toBe(false);
    expect(matchesGlob('tests/x/y.ts', 'tests/**')).toBe(true);
    expect(matchesGlob('tests', 'tests/**')).toBe(false);
  });
  it('matches ? as one non-slash character and escapes regex characters', () => {
    expect(matchesGlob('a1.ts', 'a?.ts')).toBe(true);
    expect(matchesGlob('a/.ts', 'a?.ts')).toBe(false);
    expect(matchesGlob('a+b.ts', 'a+b.ts')).toBe(true);
    expect(matchesGlob('aab.ts', 'a+b.ts')).toBe(false);
    expect(matchesGlob('a(1).ts', 'a(1).ts')).toBe(true);
  });
  it('treats dotfiles like any other file and anchors the whole path', () => {
    expect(matchesGlob('.github/workflows/ci.yml', '.github/**')).toBe(true);
    expect(matchesGlob('x/.env', '**/.env')).toBe(true);
    expect(matchesGlob('prefix/src/a.ts', 'src/*.ts')).toBe(false);
  });
  it('matchesAny', () => {
    expect(matchesAny('src/a.ts', ['docs/**', 'src/*.ts'])).toBe(true);
    expect(matchesAny('src/a.ts', [])).toBe(false);
  });
});
