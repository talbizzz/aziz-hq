import { describe, expect, it } from 'vitest';
import { checkProtectedTests, checkScope, changedFiles } from './diff-checks.js';

const TEST_GLOBS = ['**/*.test.ts', '**/*.spec.ts', 'tests/**', 'supabase/tests/**'];

const modified = (path: string) =>
  `diff --git a/${path} b/${path}\nindex 111..222 100644\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-old\n+new\n`;
const added = (path: string) =>
  `diff --git a/${path} b/${path}\nnew file mode 100644\nindex 0000000..222\n--- /dev/null\n+++ b/${path}\n@@ -0,0 +1 @@\n+new\n`;
const deleted = (path: string) =>
  `diff --git a/${path} b/${path}\ndeleted file mode 100644\nindex 111..0000000\n--- a/${path}\n+++ /dev/null\n@@ -1 +0,0 @@\n-old\n`;
const renamed = (from: string, to: string) =>
  `diff --git a/${from} b/${to}\nsimilarity index 100%\nrename from ${from}\nrename to ${to}\n`;

describe('changedFiles', () => {
  it('classifies added, modified, deleted and renamed files', () => {
    const files = changedFiles(
      [
        modified('src/a.ts'),
        added('src/b.ts'),
        deleted('src/c.ts'),
        renamed('src/d.ts', 'src/e.ts'),
      ].join(''),
    );
    expect(files).toEqual([
      { path: 'src/a.ts', status: 'modified' },
      { path: 'src/b.ts', status: 'added' },
      { path: 'src/c.ts', status: 'deleted' },
      { path: 'src/e.ts', status: 'renamed', from: 'src/d.ts' },
    ]);
  });
  it('handles an empty diff', () => {
    expect(changedFiles('')).toEqual([]);
  });
});

describe('checkProtectedTests', () => {
  it('accepts a source-only diff and new test files', () => {
    expect(
      checkProtectedTests(
        modified('src/a.ts') + added('src/a.test.ts') + added('tests/new.ts'),
        TEST_GLOBS,
      ),
    ).toEqual({ ok: true, violations: [] });
  });
  it('rejects modifying an existing test', () => {
    expect(checkProtectedTests(modified('src/a.test.ts'), TEST_GLOBS)).toEqual({
      ok: false,
      violations: [{ path: 'src/a.test.ts', change: 'modified' }],
    });
  });
  it('rejects deleting an existing test', () => {
    expect(checkProtectedTests(deleted('tests/login.ts'), TEST_GLOBS).violations).toEqual([
      { path: 'tests/login.ts', change: 'deleted' },
    ]);
  });
  it('rejects renaming an existing test (the old file disappears) and moving a test out of the globs', () => {
    expect(
      checkProtectedTests(renamed('src/a.test.ts', 'src/b.test.ts'), TEST_GLOBS).violations,
    ).toEqual([{ path: 'src/a.test.ts', change: 'renamed' }]);
    expect(checkProtectedTests(renamed('src/a.test.ts', 'src/helpers.ts'), TEST_GLOBS).ok).toBe(
      false,
    );
  });
  it('allows renaming a non-test file into a test name (a new test) but reports every violation at once', () => {
    expect(checkProtectedTests(renamed('src/x.ts', 'src/x.test.ts'), TEST_GLOBS).ok).toBe(true);
    const result = checkProtectedTests(
      modified('a.test.ts') + deleted('supabase/tests/rls.sql') + modified('src/ok.ts'),
      TEST_GLOBS,
    );
    expect(result.violations.map((v) => v.path)).toEqual(['a.test.ts', 'supabase/tests/rls.sql']);
  });
  it('ignores files outside the test globs', () => {
    expect(
      checkProtectedTests(modified('docs/testing.md') + deleted('src/test-utils.ts'), TEST_GLOBS)
        .ok,
    ).toBe(true);
  });
});

describe('checkScope', () => {
  it('accepts files inside the allowed globs and lists the ones outside', () => {
    expect(checkScope(['src/a.ts', 'src/deep/b.ts'], ['src/**'])).toEqual({
      ok: true,
      outside: [],
    });
    expect(checkScope(['src/a.ts', 'package.json', '.github/ci.yml'], ['src/**'])).toEqual({
      ok: false,
      outside: ['package.json', '.github/ci.yml'],
    });
  });
  it('an empty allow-list allows nothing; an empty change set is fine', () => {
    expect(checkScope(['a.ts'], []).ok).toBe(false);
    expect(checkScope([], ['src/**']).ok).toBe(true);
  });
});
