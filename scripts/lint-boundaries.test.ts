import { join } from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..');
const eslint = new ESLint({ cwd: root, overrideConfigFile: join(root, 'eslint.config.js') });

async function lint(filePath: string, code: string) {
  const [result] = await eslint.lintText(code, { filePath: join(root, filePath) });
  return result?.messages.filter((m) => m.ruleId === 'boundaries/workspace-imports') ?? [];
}

describe('module boundaries (ADR-8)', () => {
  it('rejects a module importing another module', async () => {
    const msgs = await lint('modules/factory/src/x.ts', "import '@aziz-hq/training';\n");
    expect(msgs).toHaveLength(1);
    expect(msgs[0]?.severity).toBe(2);
  });

  it('allows a module importing a package', async () => {
    expect(await lint('modules/factory/src/x.ts', "import '@aziz-hq/core';\n")).toEqual([]);
  });

  it('rejects a package importing an app by relative path', async () => {
    const msgs = await lint('packages/core/src/x.ts', "import '../../apps/web/src/x';\n");
    expect(msgs).toHaveLength(1);
  });

  it('allows an app importing a module', async () => {
    expect(await lint('apps/web/src/x.ts', "import '@aziz-hq/factory';\n")).toEqual([]);
  });

  it('rejects a package importing a module or an app by name', async () => {
    expect(await lint('packages/core/src/x.ts', "import '@aziz-hq/factory';\n")).toHaveLength(1);
    expect(await lint('packages/ui/src/x.ts', "import '@aziz-hq/worker';\n")).toHaveLength(1);
  });

  it('rejects a module importing an app', async () => {
    expect(await lint('modules/factory/src/x.ts', "import '@aziz-hq/worker';\n")).toHaveLength(1);
  });

  it('rejects deep imports into another workspace src, by name or by relative path', async () => {
    expect(await lint('modules/factory/src/x.ts', "import '@aziz-hq/core/src/x';\n")).toHaveLength(
      1,
    );
    expect(
      await lint('modules/factory/src/x.ts', "import '../../../packages/core/src/index';\n"),
    ).toHaveLength(1);
  });

  it('allows imports inside the same workspace, and third-party packages', async () => {
    expect(await lint('modules/factory/src/x.ts', "import './y';\nimport 'zod';\n")).toEqual([]);
    expect(await lint('modules/factory/src/a/x.ts', "import '../y';\n")).toEqual([]);
  });

  it('covers re-exports and dynamic imports', async () => {
    expect(
      await lint('modules/factory/src/x.ts', "export * from '@aziz-hq/training';\n"),
    ).toHaveLength(1);
    expect(
      await lint('modules/factory/src/x.ts', "await import('@aziz-hq/training');\n"),
    ).toHaveLength(1);
  });
});
