import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

describe('worker container setup', () => {
  const compose = read('docker-compose.worker.yml');
  const dockerfile = read('apps/worker/Dockerfile');

  it('restarts always and reads its secrets from a gitignored env file', () => {
    expect(compose).toMatch(/restart:\s*always/);
    expect(compose).toMatch(/env_file:\s*\n?\s*-?\s*\.env\.worker/);
    expect(read('.gitignore')).toMatch(/^\.env\*/m);
  });

  it('has no secret values inline', () => {
    expect(compose).not.toMatch(/sb_secret_|eyJ[A-Za-z0-9_-]{10,}/);
    expect(compose).not.toMatch(/SECRET_KEY\s*[:=]\s*\S/);
  });

  it('joins the local Supabase network by name instead of publishing ports', () => {
    expect(compose).toContain('supabase_network_aziz-hq');
    expect(compose).not.toMatch(/ports:/);
  });

  it('runs as a non-root user from the pinned Node version', () => {
    expect(dockerfile).toMatch(/^USER node$/m);
    const nvmrc = read('.nvmrc').trim();
    expect(dockerfile).toMatch(new RegExp(`FROM node:${nvmrc}[-\\w.]*`));
  });

  it('ships an env example with names only', () => {
    const example = read('.env.worker.example');
    const lines = example.split('\n').filter((l) => l.trim() && !l.startsWith('#'));
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) expect(l).toMatch(/^[A-Z][A-Z0-9_]*=([A-Za-z0-9_:./-]*)$/);
    expect(example).not.toMatch(/sb_secret_[A-Za-z0-9_-]{8,}/);
  });
});
