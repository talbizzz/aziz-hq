import type { TelegramApi } from './flush.ts';

/** Minimal Bot API client (sendMessage only). `apiRoot` lets tests point at a mock server. */
export function createTelegramApi(options: { token: string; apiRoot?: string }): TelegramApi {
  const root = (options.apiRoot ?? 'https://api.telegram.org').replace(/\/+$/, '');
  return {
    async sendMessage(chatId, text, replyMarkup) {
      const res = await fetch(`${root}/bot${options.token}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: 'HTML',
          ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        description?: string;
        result?: { message_id?: number };
      };
      if (!res.ok || !body.ok || typeof body.result?.message_id !== 'number') {
        throw new Error(
          `Telegram sendMessage failed (${res.status}): ${body.description ?? 'no description'}`,
        );
      }
      return body.result.message_id;
    },
  };
}
