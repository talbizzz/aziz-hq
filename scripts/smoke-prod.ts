// Automated production smoke checks for the Access gate (T1.11). URLs are overridable so the script can be pointed at
// any deployment. Usage: pnpm tsx scripts/smoke-prod.ts
const hq = process.env.HQ_URL ?? 'https://hq.aziztalbi.com';
const pages = process.env.PAGES_URL ?? 'https://aziz-hq-web.pages.dev';
const failures: string[] = [];
const check = (ok: boolean, label: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures.push(label);
};
const get = (url: string, headers: Record<string, string> = {}) =>
  fetch(url, { redirect: 'manual', headers });

const root = await get(`${hq}/`);
const location = root.headers.get('location') ?? '';
check(
  root.status === 302 && location.includes('.cloudflareaccess.com'),
  `${hq}/ redirects to Cloudflare Access (status ${root.status})`,
);

for (const path of ['/', '/assets/does-not-matter.js', '/api/health']) {
  const res = await get(`${pages}${path}`);
  const blocked =
    res.status === 403 ||
    (res.status === 302 && (res.headers.get('location') ?? '').includes('cloudflareaccess.com'));
  check(blocked, `${pages}${path} is denied without a token (status ${res.status})`);
}

const forged = await get(`${pages}/api/health`, {
  'Cf-Access-Jwt-Assertion': 'forged',
});
check(
  forged.status === 403,
  `${pages}/api/health rejects a forged Access JWT (status ${forged.status})`,
);

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('\nAll automated smoke checks passed');

export {};
