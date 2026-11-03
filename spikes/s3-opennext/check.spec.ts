import { test, expect } from "@playwright/test";
import { generate } from "otplib";
import { SignJWT, importJWK } from "jose";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter(Boolean).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const API = env.NEXT_PUBLIC_SUPABASE_URL, SECRET = env.SUPABASE_SECRET_KEY;
const EMAIL = `owner+${Date.now()}@example.test`, PASSWORD = "Sp1ke-Passw0rd!";

test.beforeAll(async () => {
  const r = await fetch(`${API}/auth/v1/admin/users`, { method: "POST", headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, email_confirm: true }) });
  expect(r.status, await r.clone().text()).toBeLessThan(300);
});

test("1 unauthenticated dashboard redirects to login", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
});

test("2-4 login -> MFA enroll -> dashboard -> realtime insert", async ({ page }) => {
  await page.goto("/login");
  await page.fill('input[name="email"]', EMAIL); await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/mfa/);
  // aal1 must not reach the dashboard
  await page.goto("/dashboard"); await expect(page).toHaveURL(/\/mfa/);
  const secret = (await page.getByTestId("secret").textContent())!.trim();
  await page.fill('input[name="code"]', await generate({ secret }));
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByTestId("who")).toHaveText(EMAIL);
  await expect(page.getByTestId("rt-status")).toHaveText("SUBSCRIBED", { timeout: 10_000 });
  const t0 = Date.now();
  const ins = await fetch(`${API}/rest/v1/s3_events`, { method: "POST", headers: { apikey: SECRET, "Content-Type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify({ note: "hello-rt" }) });
  expect(ins.status).toBeLessThan(300);
  await expect(page.getByTestId("row").first()).toHaveText("hello-rt", { timeout: 5_000 });
  console.log(`realtime latency ms: ${Date.now() - t0}`);
});

test("5 /api/ping rejects without Access JWT, accepts a valid one, rejects a wrong audience", async ({ request }) => {
  expect((await request.get("/api/ping")).status()).toBe(401);
  expect((await request.get("/api/ping", { headers: { "Cf-Access-Jwt-Assertion": "garbage" } })).status()).toBe(403);
  const key = await importJWK(JSON.parse(readFileSync(".test-key.json", "utf8")), "RS256");
  const sign = (aud: string) => new SignJWT({ email: "aziz@example.test" }).setProtectedHeader({ alg: "RS256", kid: "spike" })
    .setIssuer("https://spiketeam.cloudflareaccess.com").setAudience(aud).setExpirationTime("5m").sign(key);
  const ok = await request.get("/api/ping", { headers: { "Cf-Access-Jwt-Assertion": await sign("spike-aud") } });
  expect(ok.status()).toBe(200);
  expect((await ok.json()).email).toBe("aziz@example.test");
  expect((await request.get("/api/ping", { headers: { "Cf-Access-Jwt-Assertion": await sign("other") } })).status()).toBe(403);
});

test("6 middleware guards a route with the Access JWT", async ({ request }) => {
  expect((await request.get("/api/guarded")).status()).toBe(401);
  const key = await importJWK(JSON.parse(readFileSync(".test-key.json", "utf8")), "RS256");
  const t = await new SignJWT({}).setProtectedHeader({ alg: "RS256", kid: "spike" }).setIssuer("https://spiketeam.cloudflareaccess.com").setAudience("spike-aud").setExpirationTime("5m").sign(key);
  expect((await request.get("/api/guarded", { headers: { "Cf-Access-Jwt-Assertion": t } })).status()).toBe(200);
});
