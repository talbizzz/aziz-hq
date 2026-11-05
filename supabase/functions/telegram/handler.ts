import { Bot, webhookCallback } from 'grammy/web';
import { parseCommand } from './commands.ts';
import { decisionText, escapeHtml, parseCallbackData } from './format.ts';

export interface HandlerStore {
  decideGate(
    taskId: string,
    decision: 'approve' | 'dismiss',
    via: 'telegram',
  ): Promise<{ first: boolean; decision: string }>;
  setOverride(kind: 'pause' | 'off_today', minutes: number | null, via: 'telegram'): Promise<void>;
  setMode(
    kind: 'working' | 'stop' | 'sleeping' | 'custom',
    minutes: number | null,
    capPct: number | null,
    via: 'telegram',
  ): Promise<void>;
  clearOverride(kind: 'pause' | 'off_today' | 'stop'): Promise<number>;
  status(): Promise<{
    workerOnline: boolean;
    workerLastSeenMinutes: number | null;
    activeRuns: number;
    openGates: number;
    overrides: { kind: string; expiresAt: string }[];
  }>;
}

export interface HandlerDeps {
  token: string;
  secret: string;
  ownerChatId: number;
  store: HandlerStore;
  apiRoot?: string;
  log?: (msg: string) => void;
}

const HELP = [
  'Commands:',
  '/status: worker, runs, open gates, overrides',
  '/pause [90m|2h]: stop starting new tasks (default 1 hour, max 24 hours)',
  '/working: I am working, use at most the work cap (5 hours)',
  '/sleeping: I am sleeping, the factory may use up to the sleeping cap (5 hours)',
  '/stop: do not use my tokens for 5 hours',
  '/custom 70 2h: use at most 70% for 2 hours',
  '/resume: end a pause or stop',
  '/off: "I\'m off today", only critical alerts until midnight',
  '/on: end "off today"',
].join('\n');

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function createHandler(deps: HandlerDeps) {
  const log = deps.log ?? (() => {});
  const { store } = deps;
  const ownerValid = Number.isInteger(deps.ownerChatId) && deps.ownerChatId > 0;
  if (!ownerValid) log(`invalid owner chat id (${deps.ownerChatId}): every update will be ignored`);
  const isOwner = (fromId?: number, chatId?: number) =>
    ownerValid && fromId === deps.ownerChatId && chatId === deps.ownerChatId;

  const bot = new Bot(deps.token, {
    // botInfo given: no getMe call at startup (matters on a cold start)
    botInfo: {
      id: 1,
      is_bot: true,
      first_name: 'aziz-hq',
      username: 'aziz_hq_bot',
      can_join_groups: false,
      can_read_all_group_messages: false,
      supports_inline_queries: false,
      can_connect_to_business: false,
      has_main_web_app: false,
      has_topics_enabled: false,
      allows_users_to_create_topics: false,
    } as never,
    client: deps.apiRoot ? { apiRoot: deps.apiRoot } : undefined,
  });

  bot.on('callback_query:data', async (ctx) => {
    const chatId = ctx.callbackQuery.message?.chat.id;
    if (!isOwner(ctx.from.id, chatId)) {
      log(`ignored callback from user=${ctx.from.id} chat=${chatId}`);
      return;
    }
    const parsed = parseCallbackData(ctx.callbackQuery.data);
    if (!parsed) {
      log('ignored malformed callback data');
      return;
    }
    if (parsed.decision === 'modify') {
      await ctx.answerCallbackQuery({ text: 'Open the dashboard to modify this gate.' });
      return;
    }

    let result;
    try {
      result = await store.decideGate(parsed.taskId, parsed.decision, 'telegram');
    } catch (e) {
      log(`decide failed: ${errorText(e)}`);
      await ctx.answerCallbackQuery({
        text: errorText(e).includes('not open')
          ? 'Gate is no longer open'
          : 'Something went wrong, try the dashboard',
      });
      return;
    }

    await ctx.answerCallbackQuery({
      text: result.first ? `Recorded: ${result.decision}` : `Already decided: ${result.decision}`,
    });
    try {
      const original = escapeHtml(ctx.callbackQuery.message?.text ?? '');
      await ctx.editMessageText(`${original}\n${decisionText(result.decision)}`, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [] },
      });
    } catch (e) {
      log(`edit failed: ${errorText(e)}`);
    }
  });

  bot.on('message:text', async (ctx) => {
    if (!isOwner(ctx.from?.id, ctx.chat.id)) {
      log(`ignored message from user=${ctx.from?.id} chat=${ctx.chat.id}`);
      return;
    }
    const reply = (text: string) => ctx.reply(text, { parse_mode: 'HTML' });
    const command = parseCommand(ctx.message.text);
    try {
      switch (command.name) {
        case 'status': {
          const s = await store.status();
          const worker = s.workerOnline ? 'online' : 'offline';
          const seen =
            s.workerLastSeenMinutes === null
              ? 'never seen'
              : `last seen ${s.workerLastSeenMinutes} min ago`;
          const overrides =
            s.overrides.length > 0
              ? s.overrides
                  .map((o) => `${escapeHtml(o.kind)} until ${escapeHtml(o.expiresAt)}`)
                  .join(', ')
              : 'none';
          await reply(
            [
              `Worker: ${worker} (${seen})`,
              `${s.activeRuns} active runs`,
              `${s.openGates} open gates`,
              `Overrides: ${overrides}`,
            ].join('\n'),
          );
          break;
        }
        case 'pause':
          await store.setOverride('pause', command.minutes, 'telegram');
          await reply(`⏸ Paused for ${command.minutes} min. /resume to continue.`);
          break;
        case 'working':
          await store.setMode('working', null, null, 'telegram');
          await reply('💼 Working mode for 5 hours: the factory stays within the work cap.');
          break;
        case 'sleeping':
          await store.setMode('sleeping', null, null, 'telegram');
          await reply('😴 Sleeping mode for 5 hours: the factory may use up to the sleeping cap.');
          break;
        case 'stop':
          await store.setMode('stop', null, null, 'telegram');
          await reply('⛔ Stopped for 5 hours: no new tasks will start. /resume to undo.');
          break;
        case 'custom':
          await store.setMode('custom', command.minutes, command.capPct, 'telegram');
          await reply(`🎚 Custom mode: at most ${command.capPct}% for ${command.minutes} min.`);
          break;
        case 'resume': {
          const cleared =
            (await store.clearOverride('pause')) + (await store.clearOverride('stop'));
          await reply(cleared > 0 ? '▶️ Resumed.' : 'Nothing was paused.');
          break;
        }
        case 'off':
          await store.setOverride('off_today', null, 'telegram');
          await reply('🌙 Off for today: only critical alerts until midnight. /on to undo.');
          break;
        case 'on':
          await reply(
            (await store.clearOverride('off_today')) > 0
              ? '☀️ Back on.'
              : 'You were not off today.',
          );
          break;
        case 'invalid':
          await reply(escapeHtml(command.reason));
          break;
        default:
          await reply(escapeHtml(HELP));
      }
    } catch (e) {
      log(`command failed: ${errorText(e)}`);
      await reply('That failed, please try again.');
    }
  });

  bot.catch((e) => log(`handler error: ${errorText(e.error)}`));

  return {
    handle: webhookCallback(bot, 'std/http', { secretToken: deps.secret }) as (
      req: Request,
    ) => Promise<Response>,
  };
}
