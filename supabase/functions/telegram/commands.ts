export type Command =
  | { name: 'status' | 'resume' | 'off' | 'on' | 'help' | 'start' | 'unknown' }
  | { name: 'pause'; minutes: number }
  | { name: 'invalid'; reason: string };

const PAUSE_USAGE = 'Duration must be between 1 minute and 24 hours, e.g. /pause 90m or /pause 2h.';

export function parseCommand(text: string): Command {
  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) return { name: 'unknown' };
  const [head = '', ...rest] = trimmed.split(/\s+/);
  const name = head.slice(1).split('@')[0]!.toLowerCase();

  switch (name) {
    case 'status':
    case 'resume':
    case 'off':
    case 'on':
    case 'help':
    case 'start':
      return { name };
    case 'pause': {
      const arg = rest[0];
      if (arg === undefined) return { name: 'pause', minutes: 60 };
      const m = /^(\d+)([mh]?)$/i.exec(arg);
      if (!m) return { name: 'invalid', reason: PAUSE_USAGE };
      const minutes = Number(m[1]) * (m[2]!.toLowerCase() === 'h' ? 60 : 1);
      return minutes >= 1 && minutes <= 1440
        ? { name: 'pause', minutes }
        : { name: 'invalid', reason: PAUSE_USAGE };
    }
    default:
      return { name: 'unknown' };
  }
}
