import { test, expect } from "@playwright/test";
import { createServer } from "node:http";
const GATE = "0b9c1f2e7d4a4e1b9a335f6c8d2e1a77";
const upd = (data: string, from = 4242, chat = 4242, id = 1) => ({ update_id: id, callback_query: { id: `c${id}`, chat_instance: "x", from: { id: from, is_bot: false, first_name: "A" }, data, message: { message_id: 7, date: 0, chat: { id: chat, type: "private" }, text: "Gate" } } });
const H = (s?: string) => ({ "content-type": "application/json", ...(s ? { "x-telegram-bot-api-secret-token": s } : {}) });

test("telegram webhook inside the Worker (mock Telegram API)", async ({ request }) => {
  const calls: string[] = [];
  const mock = createServer((req, res) => { calls.push(req.url!.split("/").pop()!); res.setHeader("content-type", "application/json"); res.end('{"ok":true,"result":true}'); });
  await new Promise<void>((r) => mock.listen(9999, "127.0.0.1", r));
  try {
    expect((await request.post("/api/telegram/webhook", { data: upd(`g:${GATE}:a`) })).status()).toBe(401);
    expect((await request.post("/api/telegram/webhook", { headers: H("wrong"), data: upd(`g:${GATE}:a`) })).status()).toBe(401);
    expect(calls).toHaveLength(0);
    expect((await request.post("/api/telegram/webhook", { headers: H("spike-hook-secret"), data: upd(`g:${GATE}:a`, 999, 999) })).status()).toBe(200);
    expect(calls).toHaveLength(0);
    const t0 = Date.now();
    expect((await request.post("/api/telegram/webhook", { headers: H("spike-hook-secret"), data: upd(`g:${GATE}:a`) })).status()).toBe(200);
    console.log(`webhook handling ms (incl. 2 mock Telegram calls): ${Date.now() - t0}`);
    expect(calls.sort()).toEqual(["answerCallbackQuery", "editMessageText"]);
    expect((await request.post("/api/telegram/webhook", { headers: H("spike-hook-secret"), data: upd(`g:${GATE}:d`, 4242, 4242, 2) })).status()).toBe(200);
  } finally { mock.close(); }
});
