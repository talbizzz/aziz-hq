// Spike-only extra measurements. (1) aal1 token must not read rows (RLS requires aal2). (2) browser websocket target.
import { createClient } from "@supabase/supabase-js";
import { chromium } from "@playwright/test";
import { generate } from "otplib";
import { readFileSync } from "node:fs";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter(Boolean).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const API = env.NEXT_PUBLIC_SUPABASE_URL, KEY = env.NEXT_PUBLIC_SUPABASE_KEY, SECRET = env.SUPABASE_SECRET_KEY;
const email = `extra+${Date.now()}@example.test`, password = "Sp1ke-Passw0rd!";
await fetch(`${API}/auth/v1/admin/users`, { method: "POST", headers: { apikey: SECRET, "Content-Type": "application/json" }, body: JSON.stringify({ email, password, email_confirm: true }) });
await fetch(`${API}/rest/v1/s3_events`, { method: "POST", headers: { apikey: SECRET, "Content-Type": "application/json" }, body: JSON.stringify({ note: "seed" }) });
const sb = createClient(API, KEY);
await sb.auth.signInWithPassword({ email, password });
const aal1 = await sb.from("s3_events").select("note");
console.log("aal1 select rows:", aal1.data?.length, "error:", aal1.error?.message ?? null);
const { data: en } = await sb.auth.mfa.enroll({ factorType: "totp" });
const { data: ch } = await sb.auth.mfa.challenge({ factorId: en.id });
const v = await sb.auth.mfa.verify({ factorId: en.id, challengeId: ch.id, code: await generate({ secret: en.totp.secret }) });
console.log("verify error:", v.error?.message ?? null);
const aal2 = await sb.from("s3_events").select("note");
console.log("aal2 select rows:", aal2.data?.length);
// websocket target from the browser (page is served by the Worker on :8787)
const b = await chromium.launch(); const page = await b.newPage(); const ws = [];
page.on("websocket", (w) => ws.push(w.url().replace(/apikey=[^&]+/, "apikey=<redacted>")));
await page.goto("http://localhost:8787/login");
await page.fill('input[name="email"]', email); await page.fill('input[name="password"]', password); await page.click('button[type="submit"]');
await page.waitForURL(/mfa/); const { data: l } = await sb.auth.mfa.listFactors();
// factor already verified in the node session; use its secret
const secret = en.totp.secret; await page.waitForTimeout(500);
await page.fill('input[name="code"]', await generate({ secret })); await page.click('button[type="submit"]');
await page.waitForURL(/dashboard/, { timeout: 8000 }).catch((e) => console.log("dashboard nav:", e.message.split("\n")[0]));
await page.waitForTimeout(1500);
console.log("browser websockets:", ws);
await b.close(); process.exit(0);
