import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..');

describe('db scripts', () => {
  it('db:push refuses to run when SUPABASE_PROJECT_REF is unset', () => {
    const env = { ...process.env };
    delete env.SUPABASE_PROJECT_REF;
    const r = spawnSync('bash', ['scripts/db-push.sh'], { cwd: root, env, encoding: 'utf8' });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('SUPABASE_PROJECT_REF');
  });

  it('db:push passes the project ref explicitly and dry-runs unless CONFIRM=1', () => {
    const src = readFileSync(join(root, 'scripts/db-push.sh'), 'utf8');
    expect(src).toContain('--project-ref "$SUPABASE_PROJECT_REF"');
    expect(src).toContain('--dry-run');
    expect(src).toContain('CONFIRM');
  });

  it('no script, workflow or package.json runs `supabase link`', () => {
    const files = [
      'package.json',
      ...readdirSync(join(root, 'scripts'))
        .filter((f) => !f.endsWith('.test.ts'))
        .map((f) => `scripts/${f}`),
    ];
    try {
      files.push(
        ...readdirSync(join(root, '.github/workflows')).map((f) => `.github/workflows/${f}`),
      );
    } catch {
      // no workflows yet
    }
    for (const f of files) {
      expect(readFileSync(join(root, f), 'utf8'), f).not.toMatch(/supabase\s+link/);
    }
  });

  it('defines the db scripts in package.json', () => {
    const { scripts } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    for (const s of [
      'db:start',
      'db:stop',
      'db:reset',
      'db:diff',
      'db:test',
      'db:types',
      'db:push',
    ]) {
      expect(scripts, s).toHaveProperty(s);
    }
  });

  it('keeps supabase config consistent with the plan', () => {
    const toml = readFileSync(join(root, 'supabase/config.toml'), 'utf8');
    expect(toml).toMatch(/^project_id = "aziz-hq"/m);
    expect(toml).toMatch(/enable_signup = false/);
    expect(toml).toMatch(/schema_paths = \["\.\/schemas\/\*\.sql"\]/);
    expect(toml).toMatch(
      /\[auth\.mfa\.totp\][\s\S]*?enroll_enabled = true[\s\S]*?verify_enabled = true/,
    );
  });

  it('.env.example lists names only', () => {
    const lines = readFileSync(join(root, '.env.example'), 'utf8')
      .split('\n')
      .filter((l) => l.trim() && !l.startsWith('#'));
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) expect(l, l).toMatch(/^[A-Z][A-Z0-9_]*=$/);
  });
});
