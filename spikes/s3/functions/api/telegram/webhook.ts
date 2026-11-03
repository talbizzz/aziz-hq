import { createWebhook, type DecisionStore } from "../../_telegram";

interface Env { TELEGRAM_BOT_TOKEN: string; TELEGRAM_WEBHOOK_SECRET: string; TELEGRAM_OWNER_CHAT_ID: string; TELEGRAM_API_ROOT?: string }
// spike store: in-memory per isolate (real one is a table with UNIQUE(gate_id))
const rows = ((globalThis as any).__s4rows ??= new Map<string, string>()) as Map<string, string>;
const store: DecisionStore = { async decide(id, d) { const e = rows.get(id); if (e) return { first: false, decision: e }; rows.set(id, d); return { first: true, decision: d }; } };

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) =>
  createWebhook({ token: env.TELEGRAM_BOT_TOKEN, secret: env.TELEGRAM_WEBHOOK_SECRET, ownerChatId: Number(env.TELEGRAM_OWNER_CHAT_ID), store, apiRoot: env.TELEGRAM_API_ROOT || undefined, log: (m) => console.log("[tg]", m) }).handle(request);
