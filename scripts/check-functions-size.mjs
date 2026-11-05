// Fails if the compiled Pages Functions bundle (gzipped) exceeds the Workers Free limit recorded in FINDINGS S3.
// Usage: node scripts/check-functions-size.mjs <bundle-dir>   (default apps/web/.functions-build)
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const LIMIT_BYTES = 3 * 1024 * 1024; // Workers Free: 3 MB gzipped
const dir = process.argv[2] ?? 'apps/web/.functions-build';

const walk = (d) =>
  readdirSync(d).flatMap((f) => {
    const p = join(d, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

const files = walk(dir).filter((f) => /\.(m?js)$/.test(f));
if (files.length === 0) {
  console.error(`check-functions-size: no JavaScript found in ${dir}`);
  process.exit(2);
}
const total = files.reduce((sum, f) => sum + gzipSync(readFileSync(f)).length, 0);
console.log(
  `Functions bundle: ${(total / 1024).toFixed(1)} kB gzip (limit ${LIMIT_BYTES / 1024} kB)`,
);
if (total > LIMIT_BYTES) process.exit(1);
