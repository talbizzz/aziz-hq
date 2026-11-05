export type Decision = 'approve' | 'modify' | 'dismiss';
export type Button = { text: string; callback_data: string } | { text: string; url: string };
export interface ReplyMarkup {
  inline_keyboard: Button[][];
}

const CODE: Record<string, Decision> = { a: 'approve', m: 'modify', d: 'dismiss' };
const hex = (uuid: string) => uuid.replace(/-/g, '');
const unhex = (h: string) =>
  `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;

/** `g:<32 hex of the gate task id>:<a|m|d>` is 36 bytes, under Telegram's 64-byte callback_data limit. */
export const callbackData = (taskId: string, letter: 'a' | 'm' | 'd') =>
  `g:${hex(taskId)}:${letter}`;

export function parseCallbackData(data: string): { taskId: string; decision: Decision } | null {
  const m = /^g:([0-9a-f]{32}):([amd])$/.exec(data);
  return m ? { taskId: unhex(m[1]!), decision: CODE[m[2]!]! } : null;
}

export const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export interface GateNotification {
  priority: number;
  payload: Record<string, unknown>;
}

/** Simple gates get buttons; complex ones (comment needed, modify/answer options) link to the dashboard. */
export function gateMessage(
  n: GateNotification,
  taskId: string,
  dashboardUrl: string,
): { text: string; replyMarkup: ReplyMarkup } {
  const p = n.payload;
  const heading = n.priority === 2 ? 'Blocking gate' : 'Gate';
  const text = `<b>${heading}</b>\n${escapeHtml(String(p.title ?? ''))}\n${escapeHtml(String(p.run_title ?? ''))} · ${escapeHtml(String(p.gate_kind ?? ''))}`;
  const replyMarkup: ReplyMarkup =
    p.simple === false
      ? {
          inline_keyboard: [
            [
              {
                text: 'Open in dashboard',
                url: `${dashboardUrl.replace(/\/+$/, '')}/gates/${taskId}`,
              },
            ],
          ],
        }
      : {
          inline_keyboard: [
            [
              { text: 'Approve', callback_data: callbackData(taskId, 'a') },
              { text: 'Dismiss', callback_data: callbackData(taskId, 'd') },
            ],
          ],
        };
  return { text, replyMarkup };
}

export function decisionText(decision: string): string {
  switch (decision) {
    case 'approve':
      return '✅ Approved';
    case 'dismiss':
      return '🚫 Dismissed';
    case 'modify':
      return '✏️ Modified';
    case 'answer':
      return '💬 Answered';
    default:
      return decision;
  }
}
