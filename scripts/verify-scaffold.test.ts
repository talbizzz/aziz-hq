import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
type Obj = Record<string, unknown>;
const json = (p: string) => JSON.parse(read(p)) as Obj;

const workspaces = [
  ['packages/core', '@aziz-hq/core'],
  ['packages/ui', '@aziz-hq/ui'],
  ['packages/agents-sdk', '@aziz-hq/agents-sdk'],
  ['modules/factory', '@aziz-hq/factory'],
  ['apps/worker', '@aziz-hq/worker'],
] as const;

describe('scaffold', () => {
  it('has the required root files', () => {
    for (const f of [
      'pnpm-workspace.yaml',
      'turbo.json',
      'tsconfig.base.json',
      'eslint.config.js',
      '.prettierrc.json',
      '.gitleaks.toml',
      '.nvmrc',
      'CLAUDE.md',
      'commitlint.config.js',
      'docs/parking-lot.md',
      'docs/MANUAL_MIGRATIONS.md',
      'docs/adr/README.md',
    ]) {
      expect(existsSync(join(root, f)), f).toBe(true);
    }
  });

  it('declares the three workspace globs', () => {
    const ws = read('pnpm-workspace.yaml');
    for (const g of ['apps/*', 'packages/*', 'modules/*']) expect(ws).toContain(`- ${g}`);
  });

  it('pins the package manager and matches engines to .nvmrc', () => {
    const pkg = json('package.json');
    expect(pkg.packageManager).toMatch(/^pnpm@\d+\.\d+\.\d+$/);
    const major = read('.nvmrc').trim();
    expect((pkg.engines as Obj).node).toBe(`>=${major}`);
  });

  it('defines the four turbo tasks', () => {
    const tasks = json('turbo.json').tasks as Obj;
    for (const t of ['build', 'typecheck', 'lint', 'test']) expect(tasks).toHaveProperty(t);
  });

  it('has strict compiler options in tsconfig.base.json', () => {
    const co = json('tsconfig.base.json').compilerOptions as Obj;
    expect(co).toMatchObject({
      strict: true,
      noUncheckedIndexedAccess: true,
      verbatimModuleSyntax: true,
      moduleResolution: 'bundler',
    });
  });

  it.each(workspaces)('workspace %s exists with its package name and entry', (dir, name) => {
    const pkg = json(`${dir}/package.json`);
    expect(pkg.name).toBe(name);
    expect(existsSync(join(root, dir, 'src/index.ts'))).toBe(true);
  });

  it('uses the pnpm catalog for every shared tool dependency (single version)', () => {
    const shared = new Set(['typescript', 'eslint', 'prettier', 'zod', 'vitest']);
    const files = ['package.json', ...workspaces.map(([d]) => `${d}/package.json`)];
    for (const f of files) {
      const pkg = json(f);
      for (const section of ['dependencies', 'devDependencies', 'peerDependencies']) {
        for (const [dep, version] of Object.entries(
          (pkg[section] ?? {}) as Record<string, string>,
        )) {
          if (shared.has(dep)) expect(version, `${f} ${dep}`).toBe('catalog:');
        }
      }
    }
    expect(read('pnpm-workspace.yaml')).toMatch(/^catalog:/m);
  });
});
