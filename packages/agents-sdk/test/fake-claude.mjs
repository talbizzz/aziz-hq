#!/usr/bin/env node
// Stand-in for the `claude` CLI in tests: replays a recorded stream and exits as configured by the environment.
// FAKE_CLAUDE_FIXTURE: file whose content is printed to stdout   FAKE_CLAUDE_EXIT: exit code (default 0)
// FAKE_CLAUDE_STDERR: text for stderr   FAKE_CLAUDE_SLEEP_MS: wait before output   FAKE_CLAUDE_ARGS_FILE: write argv + env there
// FAKE_CLAUDE_WRITE: "path:content" lines separated by "|" to write in the cwd (simulates edits)
// FAKE_CLAUDE_APPEND_RESULT: text appended to every `result` string in the fixture (to test redaction)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const env = process.env;
if (env.FAKE_CLAUDE_ARGS_FILE) {
  writeFileSync(
    env.FAKE_CLAUDE_ARGS_FILE,
    JSON.stringify({
      argv: process.argv.slice(2),
      cwd: process.cwd(),
      configDir: env.CLAUDE_CONFIG_DIR ?? null,
      pid: process.pid,
    }),
  );
}
await new Promise((r) => setTimeout(r, Number(env.FAKE_CLAUDE_SLEEP_MS ?? 0)));
for (const entry of (env.FAKE_CLAUDE_WRITE ?? '').split('|').filter(Boolean)) {
  const i = entry.indexOf(':');
  const path = entry.slice(0, i);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, entry.slice(i + 1));
}
let out = env.FAKE_CLAUDE_FIXTURE ? readFileSync(env.FAKE_CLAUDE_FIXTURE, 'utf8') : '';
if (env.FAKE_CLAUDE_APPEND_RESULT) {
  out = out
    .split('\n')
    .map((line) => {
      try {
        const e = JSON.parse(line);
        if (e.type === 'result') e.result = `${e.result ?? ''} ${env.FAKE_CLAUDE_APPEND_RESULT}`;
        return JSON.stringify(e);
      } catch {
        return line;
      }
    })
    .join('\n');
}
process.stdout.write(out);
if (env.FAKE_CLAUDE_STDERR) process.stderr.write(env.FAKE_CLAUDE_STDERR);
process.exit(Number(env.FAKE_CLAUDE_EXIT ?? 0));
