import { test, expect, chromium } from "@playwright/test";
import { generate } from "otplib";
import { SignJWT, importJWK } from "jose";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter(Boolean).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const API = env.VITE_SUPABASE_URL, SECRET = env.SUPABASE_SECRET_KEY;
const EMAIL = `owner+${Date.now()}@example.test`, PASSWORD = "Sp1ke-Passw0rd!";
const DEV = "http://localhost:8788", PROTECTED = "http://localhost:8789", UNCONFIGURED = "http://localhost:8790";

test.beforeAll(async () => {
  const r = await fetch(`${API}/auth/v1/admin/users`, { method: "POST", headers: { apikey: SECRET, "Content-Type": "application/json" }, body: JSON.stringify({ email: EMAIL, password: PASSWORD, email_confirm: true }) });
  expect(r.status, await r.clone().text()).toBeLessThan(300);
});

test("1 unauthenticated / and /dashboard redirect to /login (SPA), deep link served by _redirects", async ({ page }) => {
  await page.goto("/dashboard"); await expect(page).toHaveURL(/\/login/);
  await page.goto("/"); await expect(page).toHaveURL(/\/login/);
  await page.goto("/mfa"); await expect(page).toHaveURL(/\/login/);
});

test("2-4 login -> MFA -> dashboard (aal2) -> realtime -> refresh/second tab/sign-out", async ({ page, context }) => {
  await page.goto("/login");
  await page.fill('input[name="email"]', EMAIL); await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/mfa/);
  await page.goto("/dashboard"); await expect(page).toHaveURL(/\/mfa/); // aal1 cannot reach the dashboard
  const secret = (await page.getByTestId("secret").textContent())!.trim();
  await page.fill('input[name="code"]', await generate({ secret }));
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByTestId("who")).toHaveText(EMAIL);
  await expect(page.getByTestId("rt-status")).toHaveText("SUBSCRIBED", { timeout: 10_000 });
  await page.waitForTimeout(1500); // SUBSCRIBED fires on join; postgres_changes becomes active slightly later (rows inserted in that gap are lost)
  const t0 = Date.now();
  const ins = await fetch(`${API}/rest/v1/s3_events`, { method: "POST", headers: { apikey: SECRET, "Content-Type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify({ note: "hello-rt" }) });
  expect(ins.status).toBeLessThan(300);
  await expect(page.getByTestId("row").first()).toHaveText("hello-rt", { timeout: 5_000 });
  console.log(`realtime latency ms: ${Date.now() - t0}`);

  // session survives a refresh and realtime resubscribes (aal2 preserved)
  await page.reload(); await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByTestId("rt-status")).toHaveText("SUBSCRIBED", { timeout: 10_000 });
  // a second tab in the same context shares the session
  const tab2 = await context.newPage(); await tab2.goto("/dashboard"); await expect(tab2).toHaveURL(/\/dashboard/);
  await expect(tab2.getByTestId("who")).toHaveText(EMAIL);
  // sign-out in tab 1 clears the session for tab 2 on next load
  await page.getByText("sign out").click(); await expect(page).toHaveURL(/\/login/);
  await tab2.reload(); await expect(tab2).toHaveURL(/\/login/);
});

test("5 Access middleware: static assets and routes need the JWT; valid ok; wrong aud/garbage 403", async ({ request }) => {
  const key = await importJWK(JSON.parse(readFileSync(".test-key.json", "utf8")), "RS256");
  const sign = (aud: string, exp = "5m") => new SignJWT({ email: "aziz@example.test" }).setProtectedHeader({ alg: "RS256", kid: "spike" })
    .setIssuer("https://spiketeam.cloudflareaccess.com").setAudience(aud).setExpirationTime(exp).sign(key);
  for (const path of ["/api/ping", "/", "/index.html", "/_redirects", "/dashboard"]) {
    expect((await request.get(PROTECTED + path)).status(), `no header ${path}`).toBe(403);
  }
  const asset = (await (await request.get(DEV + "/")).text()).match(/\/assets\/[^"]+\.js/)![0];
  expect((await request.get(PROTECTED + asset)).status(), "static asset, no header").toBe(403);
  const ok = { "Cf-Access-Jwt-Assertion": await sign("spike-aud") };
  expect((await request.get(PROTECTED + "/api/ping", { headers: ok })).status()).toBe(200);
  expect((await request.get(PROTECTED + asset, { headers: ok })).status(), "static asset with token").toBe(200);
  expect((await request.get(PROTECTED + "/dashboard", { headers: ok })).status(), "SPA fallback with token").toBe(200);
  expect((await request.get(PROTECTED + "/api/ping", { headers: { "Cf-Access-Jwt-Assertion": await sign("other") } })).status()).toBe(403);
  expect((await request.get(PROTECTED + "/api/ping", { headers: { "Cf-Access-Jwt-Assertion": "garbage" } })).status()).toBe(403);
  expect((await request.get(PROTECTED + "/api/ping", { headers: { "Cf-Access-Jwt-Assertion": await sign("spike-aud", "-1m") } })).status(), "expired").toBe(403);
});

test("6 fail closed: Access vars unset in production -> 500 everywhere (webhook path excepted)", async ({ request }) => {
  for (const path of ["/api/ping", "/", "/index.html"]) expect((await request.get(UNCONFIGURED + path)).status(), path).toBe(500);
});

test("7 Telegram webhook path bypasses Access middleware but not its own secret/owner checks; others stay protected", async ({ request }) => {
  const calls: string[] = [];
  const mock = createServer((req, res) => { calls.push(req.url!.split("/").pop()!); res.setHeader("content-type", "application/json"); res.end('{"ok":true,"result":true}'); });
  await new Promise<void>((r) => mock.listen(9999, "127.0.0.1", r));
  const GATE = "0b9c1f2e7d4a4e1b9a335f6c8d2e1a77";
  const upd = (data: string, from = 4242, chat = 4242, id = 1) => ({ update_id: id, callback_query: { id: `c${id}`, chat_instance: "x", from: { id: from, is_bot: false, first_name: "A" }, data, message: { message_id: 7, date: 0, chat: { id: chat, type: "private" }, text: "Gate" } } });
  const H = (s?: string) => ({ "content-type": "application/json", ...(s ? { "x-telegram-bot-api-secret-token": s } : {}) });
  try {
    const u = PROTECTED + "/api/telegram/webhook"; // Access-protected instance, NO Access header: must still reach the handler
    expect((await request.post(u, { data: upd(`g:${GATE}:a`) })).status(), "no secret").toBe(401);
    expect((await request.post(u, { headers: H("wrong"), data: upd(`g:${GATE}:a`) })).status(), "wrong secret").toBe(401);
    expect((await request.post(u, { headers: H("spike-hook-secret"), data: upd(`g:${GATE}:a`, 999, 999) })).status()).toBe(200);
    expect(calls).toHaveLength(0);
    const t0 = Date.now();
    expect((await request.post(u, { headers: H("spike-hook-secret"), data: upd(`g:${GATE}:a`) })).status()).toBe(200);
    console.log(`webhook handling ms (incl. 2 mock Telegram calls): ${Date.now() - t0}`);
    expect(calls.sort()).toEqual(["answerCallbackQuery", "editMessageText"]);
    expect((await request.post(u, { headers: H("spike-hook-secret"), data: upd(`g:${GATE}:d`, 4242, 4242, 2) })).status()).toBe(200);
    expect(calls.filter((c) => c === "editMessageText")).toHaveLength(2); // second press answered "already decided"
    // five other paths stay protected on the same instance
    for (const p of ["/api/ping", "/", "/index.html", "/api/telegram", "/api/telegram/webhook/x"]) expect((await request.get(PROTECTED + p)).status(), p).toBe(403);
  } finally { mock.close(); }
});
