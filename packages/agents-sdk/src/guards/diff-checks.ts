import { matchesAny } from './glob.js';

export interface ChangedFile {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  /** The previous path of a renamed file. */
  from?: string;
}

/** The files a unified `git diff` touches. */
export function changedFiles(diff: string): ChangedFile[] {
  const files: ChangedFile[] = [];
  for (const block of diff.split(/^diff --git /m).slice(1)) {
    const header = /^a\/(.+?) b\/(.+)$/m.exec(block);
    if (!header) continue;
    const [, a, b] = header as unknown as [string, string, string];
    const renameFrom = /^rename from (.+)$/m.exec(block)?.[1];
    const renameTo = /^rename to (.+)$/m.exec(block)?.[1];
    if (/^new file mode/m.test(block)) files.push({ path: b, status: 'added' });
    else if (/^deleted file mode/m.test(block)) files.push({ path: a, status: 'deleted' });
    else if (renameFrom && renameTo)
      files.push({ path: renameTo, status: 'renamed', from: renameFrom });
    else files.push({ path: b, status: 'modified' });
  }
  return files;
}

export interface ProtectedTestViolation {
  path: string;
  change: 'modified' | 'deleted' | 'renamed';
}

/**
 * Builders may add tests but never change or remove existing ones (Project-Raw loop guards): flags modified, deleted and
 * renamed files that match the test globs. A renamed test is a violation on its old path (the old test disappears).
 */
export function checkProtectedTests(
  diff: string,
  testGlobs: string[],
): { ok: boolean; violations: ProtectedTestViolation[] } {
  const violations: ProtectedTestViolation[] = [];
  for (const file of changedFiles(diff)) {
    if (file.status === 'modified' && matchesAny(file.path, testGlobs))
      violations.push({ path: file.path, change: 'modified' });
    else if (file.status === 'deleted' && matchesAny(file.path, testGlobs))
      violations.push({ path: file.path, change: 'deleted' });
    else if (file.status === 'renamed' && file.from && matchesAny(file.from, testGlobs))
      violations.push({ path: file.from, change: 'renamed' });
  }
  return { ok: violations.length === 0, violations };
}

/** Files touched must stay inside the task's scope (Project-Raw: "files touched is a subset of task scope"). */
export function checkScope(
  files: string[],
  allowedGlobs: string[],
): { ok: boolean; outside: string[] } {
  const outside = files.filter((f) => !matchesAny(f, allowedGlobs));
  return { ok: outside.length === 0, outside };
}
