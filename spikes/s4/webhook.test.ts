import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createWebhook, gateKeyboard, parseCallbackData, type DecisionStore } from "./webhook";

const SECRET = "s3cret-token", OWNER = 4242, GATE = "0b9c1f2e-7d4a-4e1b-9a33-5f6c8d2e1a77";

// in-memory store with the semantic of a UNIQUE(gate_id) constraint
class MemStore implements DecisionStore {
  rows = new Map<string, string>();
  async decide(gateId: string, decision: string) {
    const existing = this.rows.get(gateId);
    if (existing) return { first: false, decision: existing };
    this.rows.set(gateId, decision);
    return { first: true, decision };
  }
}

// mock Telegram Bot API: records calls
let api: Server, apiRoot = "", calls: { method: string; body: any }[] = [];
beforeAll(async () => {
  api = createServer((req, res) => {
    let b = ""; req.on("data", (c) => (b += c));
    req.on("end", () => {
      calls.push({ method: req.url!.split("/").pop()!, body: b ? JSON.parse(b) : {} });
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true, result: true }));
    });
  });
  await new Promise<void>((r) => api.listen(0, "127.0.0.1", r));
  apiRoot = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
});
afterAll(() => api.close());

let store: MemStore, logs: string[];
const hook = () => createWebhook({ token: "123:TEST", secret: SECRET, ownerChatId: OWNER, store, apiRoot, log: (m) => logs.push(m) });
beforeEach(() => { store = new MemStore(); logs = []; calls = []; });

const hex = GATE.replace(/-/g, "");
const cb = (data: string, from = OWNER, chat = OWNER, id = 1) => ({
  update_id: id,
  callback_query: { id: `cq${id}`, chat_instance: "x", from: { id: from, is_bot: false, first_name: "A" }, data,
    message: { message_id: 7, date: 0, chat: { id: chat, type: "private" }, text: "Gate" } },
});
const post = (h: (r: Request) => Promise<Response>, body: unknown, secret?: string) =>
  h(new Request("https://x/api/telegram/webhook", { method: "POST", headers: { "content-type": "application/json", ...(secret === undefined ? {} : { "x-telegram-bot-api-secret-token": secret }) }, body: JSON.stringify(body) }));

describe("callback data", () => {
  it("fits 64 bytes and round-trips", () => {
    for (const d of ["a", "m", "d"] as const) {
      const kb = gateKeyboard(GATE).inline_keyboard.flat().find((b) => b.callback_data.endsWith(`:${d}`))!;
      expect(Buffer.byteLength(kb.callback_data)).toBeLessThanOrEqual(64);
      expect(parseCallbackData(kb.callback_data)).toEqual({ gateId: GATE, decision: { a: "approve", m: "modify", d: "dismiss" }[d] });
    }
  });
  it("rejects malformed data", () => {
    for (const bad of ["", "g:xyz:a", `g:${hex}:z`, `x:${hex}:a`, `g:${hex}:a:extra`]) expect(parseCallbackData(bad)).toBeNull();
  });
});

describe("webhook security", () => {
  it("rejects missing secret header: 401, no side effect", async () => {
    const res = await post(hook().handle, cb(`g:${hex}:a`));
    expect(res.status).toBe(401); expect(store.rows.size).toBe(0); expect(calls).toHaveLength(0);
  });
  it("rejects wrong secret: 401, no side effect", async () => {
    const res = await post(hook().handle, cb(`g:${hex}:a`), "nope");
    expect(res.status).toBe(401); expect(store.rows.size).toBe(0); expect(calls).toHaveLength(0);
  });
  it("ignores a different user/chat: 200, no decision, no Telegram call, logged", async () => {
    const res = await post(hook().handle, cb(`g:${hex}:a`, 999, 999), SECRET);
    expect(res.status).toBe(200); expect(store.rows.size).toBe(0); expect(calls).toHaveLength(0);
    expect(logs.some((l) => l.includes("ignored") && l.includes("999"))).toBe(true);
  });
  it("ignores right user in a different chat (e.g. a group)", async () => {
    const res = await post(hook().handle, cb(`g:${hex}:a`, OWNER, -100), SECRET);
    expect(res.status).toBe(200); expect(store.rows.size).toBe(0);
  });
  it("ignores unparseable callback data without a decision", async () => {
    const res = await post(hook().handle, cb("garbage"), SECRET);
    expect(res.status).toBe(200); expect(store.rows.size).toBe(0);
  });
});

describe("decisions", () => {
  it("records the decision, answers the callback and edits the message", async () => {
    const res = await post(hook().handle, cb(`g:${hex}:a`), SECRET);
    expect(res.status).toBe(200);
    expect(store.rows.get(GATE)).toBe("approve");
    expect(calls.map((c) => c.method)).toEqual(expect.arrayContaining(["answerCallbackQuery", "editMessageText"]));
    expect(calls.find((c) => c.method === "editMessageText")!.body.text).toMatch(/approve/i);
  });
  it("is idempotent: pressing twice, or a Telegram retry, keeps the first decision", async () => {
    const h = hook().handle;
    await post(h, cb(`g:${hex}:a`, OWNER, OWNER, 1), SECRET);
    await post(h, cb(`g:${hex}:d`, OWNER, OWNER, 2), SECRET); // different button, later
    await post(h, cb(`g:${hex}:a`, OWNER, OWNER, 1), SECRET); // retry of the same update
    expect(store.rows.get(GATE)).toBe("approve");
    expect(store.rows.size).toBe(1);
    const edits = calls.filter((c) => c.method === "editMessageText");
    expect(edits[1].body.text).toMatch(/already.*approve/i);
  });
  it("owner plain messages are acknowledged without a decision", async () => {
    const res = await post(hook().handle, { update_id: 3, message: { message_id: 1, date: 0, chat: { id: OWNER, type: "private" }, from: { id: OWNER, is_bot: false, first_name: "A" }, text: "hi" } }, SECRET);
    expect(res.status).toBe(200); expect(store.rows.size).toBe(0);
  });
});
