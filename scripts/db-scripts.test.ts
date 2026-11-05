import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..');

describe('db scripts', () => {
  const REF = 'abcdefghijklmnopqrst';
  const URL_OK = `postgresql://postgres.${REF}:pw@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`;

  // Runs db-push.sh with a fake `supabase` first on PATH that records its arguments.
  function runPush(env: Record<string, string | undefined>) {
    const dir = mkdtempSync(join(tmpdir(), 'fake-supabase-'));
    const log = join(dir, 'args.txt');
    writeFileSync(join(dir, 'supabase'), `#!/usr/bin/env bash\necho "$@" > "${log}"\n`, {
      mode: 0o755,
    });
    const base = { ...process.env, PATH: `${dir}:${process.env.PATH}` } as Record<
      string,
      string | undefined
    >;
    for (const k of ['SUPABASE_PROJECT_REF', 'SUPABASE_DB_URL', 'CONFIRM']) delete base[k];
    const r = spawnSync('bash', ['scripts/db-push.sh'], {
      cwd: root,
      env: { ...base, ...env },
      encoding: 'utf8',
    });
    return { ...r, args: existsSync(log) ? readFileSync(log, 'utf8').trim() : null };
  }

  it('db:push refuses to run when SUPABASE_PROJECT_REF is unset', () => {
    const r = runPush({ SUPABASE_DB_URL: URL_OK });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('SUPABASE_PROJECT_REF');
    expect(r.args).toBeNull();
  });

  it('db:push refuses without SUPABASE_DB_URL, and when the URL belongs to another project', () => {
    const missing = runPush({ SUPABASE_PROJECT_REF: REF });
    expect(missing.status).not.toBe(0);
    expect(missing.stderr).toContain('SUPABASE_DB_URL');
    const other = runPush({
      SUPABASE_PROJECT_REF: REF,
      SUPABASE_DB_URL: URL_OK.replace(REF, 'zzzzzzzzzzzzzzzzzzzz'),
    });
    expect(other.status).not.toBe(0);
    expect(other.stderr).toContain('does not belong');
    expect(missing.args).toBeNull();
    expect(other.args).toBeNull();
  });

  it('db:push targets the explicit URL and dry-runs unless CONFIRM=1', () => {
    const dry = runPush({ SUPABASE_PROJECT_REF: REF, SUPABASE_DB_URL: URL_OK });
    expect(dry.status).toBe(0);
    expect(dry.args).toBe(`db push --db-url ${URL_OK} --dry-run`);
    const real = runPush({ SUPABASE_PROJECT_REF: REF, SUPABASE_DB_URL: URL_OK, CONFIRM: '1' });
    expect(real.status).toBe(0);
    expect(real.args).toBe(`db push --db-url ${URL_OK}`);
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
    const section = (name: string) =>
      toml.split(/^\[/m).find((part) => part.startsWith(`${name}]`)) ?? '';
    expect(section('auth')).toMatch(/^enable_signup = false$/m);
    // enable_signup = false under [auth.email] would disable email login altogether
    expect(section('auth.email')).toMatch(/^enable_signup = true$/m);
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
