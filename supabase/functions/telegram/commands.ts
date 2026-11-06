export type Command =
  | {
      name:
        | 'status'
        | 'resume'
        | 'off'
        | 'on'
        | 'help'
        | 'start'
        | 'working'
        | 'stop'
        | 'sleeping'
        | 'pacing'
        | 'unknown';
    }
  | { name: 'pause'; minutes: number }
  | { name: 'custom'; capPct: number; minutes: number }
  | { name: 'nopacing'; scope: 'day' | 'week' }
  | { name: 'invalid'; reason: string };

const CUSTOM_USAGE = 'Use /custom <cap 0-100> <duration 1m-24h>, e.g. /custom 70 2h.';
const NOPACING_USAGE =
  'Say how long to ignore the weekly pacing: /nopacing day or /nopacing week (the 90% ceiling still applies).';
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
    case 'working':
    case 'stop':
    case 'sleeping':
    case 'pacing':
      return { name };
    case 'nopacing': {
      const scope = (rest[0] ?? '').toLowerCase();
      if (scope === 'day' || scope === 'today') return { name: 'nopacing', scope: 'day' };
      if (scope === 'week') return { name: 'nopacing', scope: 'week' };
      return { name: 'invalid', reason: NOPACING_USAGE };
    }
    case 'custom': {
      const cap = /^(\d{1,3})%?$/.exec(rest[0] ?? '');
      const duration = /^(\d+)([mh]?)$/i.exec(rest[1] ?? '');
      if (!cap || !duration) return { name: 'invalid', reason: CUSTOM_USAGE };
      const capPct = Number(cap[1]);
      const minutes = Number(duration[1]) * (duration[2]!.toLowerCase() === 'h' ? 60 : 1);
      return capPct <= 100 && minutes >= 1 && minutes <= 1440
        ? { name: 'custom', capPct, minutes }
        : { name: 'invalid', reason: CUSTOM_USAGE };
    }
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
