import { createWebhook, type DecisionStore } from "@/lib/telegram";

// spike store: in-memory (a real one is a table with UNIQUE(gate_id)); lives per isolate
const rows = (globalThis as any).__s4rows ??= new Map<string, string>();
const store: DecisionStore = { async decide(id, d) { const e = rows.get(id); if (e) return { first: false, decision: e }; rows.set(id, d); return { first: true, decision: d }; } };

export async function POST(req: Request) {
  const hook = createWebhook({
    token: process.env.TELEGRAM_BOT_TOKEN!, secret: process.env.TELEGRAM_WEBHOOK_SECRET!,
    ownerChatId: Number(process.env.TELEGRAM_OWNER_CHAT_ID), store, apiRoot: process.env.TELEGRAM_API_ROOT || undefined, log: (m) => console.log("[tg]", m),
  });
  return hook.handle(req);
}
