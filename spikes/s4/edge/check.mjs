// Spike-only: starts the Deno function, times cold start, runs the same webhook checks against a mock Telegram API.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
const DENO = process.argv[2], PORT = 8791, URL = `http://127.0.0.1:${PORT}/telegram`, GATE = "0b9c1f2e7d4a4e1b9a335f6c8d2e1a77";
const calls = [];
const mock = createServer((req, res) => { calls.push(req.url.split("/").pop()); res.setHeader("content-type", "application/json"); res.end('{"ok":true,"result":true}'); });
await new Promise((r) => mock.listen(9998, "127.0.0.1", r));
const t0 = Date.now();
const p = spawn(DENO, ["run", "-A", "--config", "edge/deno.json", "edge/index.ts"], { env: { ...process.env, PORT, TELEGRAM_BOT_TOKEN: "123:TESTTOKEN", TELEGRAM_WEBHOOK_SECRET: "spike-hook-secret", TELEGRAM_OWNER_CHAT_ID: "4242", TELEGRAM_API_ROOT: "http://127.0.0.1:9998" }, stdio: "inherit" });
const upd = (data, from = 4242, chat = 4242, id = 1) => ({ update_id: id, callback_query: { id: `c${id}`, chat_instance: "x", from: { id: from, is_bot: false, first_name: "A" }, data, message: { message_id: 7, date: 0, chat: { id: chat, type: "private" }, text: "Gate" } } });
const post = (body, secret) => fetch(URL, { method: "POST", headers: { "content-type": "application/json", ...(secret ? { "x-telegram-bot-api-secret-token": secret } : {}) }, body: JSON.stringify(body) });
let first;
for (let i = 0; i < 200; i++) { try { first = await post(upd(`g:${GATE}:a`)); break; } catch { await new Promise((r) => setTimeout(r, 50)); } }
console.log(`cold start to first response (incl. deno npm resolution, warm cache): ${Date.now() - t0} ms; first status (no secret): ${first.status}`);
const ok = (name, cond) => { console.log(`${cond ? "PASS" : "FAIL"} ${name}`); if (!cond) process.exitCode = 1; };
ok("no secret -> 401", first.status === 401);
ok("wrong secret -> 401", (await post(upd(`g:${GATE}:a`), "wrong")).status === 401);
ok("foreign chat -> 200, no telegram call", (await post(upd(`g:${GATE}:a`, 999, 999), "spike-hook-secret")).status === 200 && calls.length === 0);
const t1 = Date.now(); const r = await post(upd(`g:${GATE}:a`), "spike-hook-secret");
console.log(`warm webhook handling ms (2 mock Telegram calls): ${Date.now() - t1}`);
ok("owner press -> 200 + answerCallbackQuery + editMessageText", r.status === 200 && calls.sort().join() === "answerCallbackQuery,editMessageText");
ok("second press -> 200, still 1 decision (edit says already decided)", (await post(upd(`g:${GATE}:d`, 4242, 4242, 2), "spike-hook-secret")).status === 200 && calls.filter((c) => c === "editMessageText").length === 2);
p.kill(); mock.close();
