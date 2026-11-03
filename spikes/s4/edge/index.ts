// Supabase Edge Function variant of the S4 webhook (Deno). Same shared handler as the Pages Function.
// Deployed with `verify_jwt = false` (Telegram cannot send a Supabase JWT); auth = secret token + owner chat id.
import { createWebhook, type DecisionStore } from "../webhook.ts";

const rows = new Map<string, string>();
const store: DecisionStore = { async decide(id, d) { const e = rows.get(id); if (e) return { first: false, decision: e }; rows.set(id, d); return { first: true, decision: d }; } };

const hook = createWebhook({
  token: Deno.env.get("TELEGRAM_BOT_TOKEN")!, secret: Deno.env.get("TELEGRAM_WEBHOOK_SECRET")!,
  ownerChatId: Number(Deno.env.get("TELEGRAM_OWNER_CHAT_ID")), store, apiRoot: Deno.env.get("TELEGRAM_API_ROOT") || undefined,
  log: (m) => console.log("[tg]", m),
});
Deno.serve({ port: Number(Deno.env.get("PORT") ?? 8791) }, (req) => req.method === "POST" ? hook.handle(req) : new Response("method not allowed", { status: 405 }));
