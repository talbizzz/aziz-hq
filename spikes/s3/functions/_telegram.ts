import { Bot, InlineKeyboard, webhookCallback } from "grammy/web";

export type Decision = "approve" | "modify" | "dismiss";
export interface DecisionStore {
  /** Idempotent: first caller wins (UNIQUE(gate_id) in the real table). */
  decide(gateId: string, decision: Decision): Promise<{ first: boolean; decision: string }>;
}
export interface WebhookDeps {
  token: string; secret: string; ownerChatId: number; store: DecisionStore;
  apiRoot?: string; log?: (msg: string) => void;
}

const CODE = { a: "approve", m: "modify", d: "dismiss" } as const;
const LETTER: Record<Decision, string> = { approve: "a", modify: "m", dismiss: "d" };
const hex = (uuid: string) => uuid.replace(/-/g, "");
const unhex = (h: string) => `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;

/** `g:<32 hex of gate uuid>:<a|m|d>` = 36 bytes, under Telegram's 64-byte callback_data limit. */
export function parseCallbackData(data: string): { gateId: string; decision: Decision } | null {
  const m = /^g:([0-9a-f]{32}):([amd])$/.exec(data);
  return m ? { gateId: unhex(m[1]), decision: CODE[m[2] as keyof typeof CODE] } : null;
}
export function gateKeyboard(gateId: string) {
  const d = (x: Decision) => `g:${hex(gateId)}:${LETTER[x]}`;
  return new InlineKeyboard().text("Approve", d("approve")).text("Modify", d("modify")).text("Dismiss", d("dismiss"));
}

export function createWebhook(deps: WebhookDeps) {
  const log = deps.log ?? (() => {});
  const bot = new Bot(deps.token, {
    // botInfo given -> no getMe call at startup (also avoids a network call in the Worker's cold start)
    botInfo: { id: 1, is_bot: true, first_name: "spike", username: "spike_bot", can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false, can_connect_to_business: false, has_main_web_app: false, has_topics_enabled: false, allows_users_to_create_topics: false } as any, // shape varies across grammY versions
    client: deps.apiRoot ? { apiRoot: deps.apiRoot } : undefined,
  });
  const isOwner = (fromId?: number, chatId?: number) => fromId === deps.ownerChatId && chatId === deps.ownerChatId;

  bot.on("callback_query:data", async (ctx) => {
    const chatId = ctx.callbackQuery.message?.chat.id;
    if (!isOwner(ctx.from.id, chatId)) { log(`ignored callback from user=${ctx.from.id} chat=${chatId}`); return; }
    const parsed = parseCallbackData(ctx.callbackQuery.data);
    if (!parsed) { log(`ignored malformed callback data`); return; }
    const r = await deps.store.decide(parsed.gateId, parsed.decision);
    await ctx.answerCallbackQuery({ text: r.first ? `Recorded: ${r.decision}` : `Already decided: ${r.decision}` });
    await ctx.editMessageText(r.first ? `Gate ${parsed.gateId.slice(0, 8)}: ${r.decision}` : `Gate ${parsed.gateId.slice(0, 8)}: already decided (${r.decision})`);
  });
  bot.on("message", async (ctx) => {
    if (!isOwner(ctx.from?.id, ctx.chat.id)) log(`ignored message from user=${ctx.from?.id} chat=${ctx.chat.id}`);
  });
  bot.catch((e) => log(`handler error: ${String(e.error)}`));

  return { handle: webhookCallback(bot, "std/http", { secretToken: deps.secret }) as (req: Request) => Promise<Response> };
}
