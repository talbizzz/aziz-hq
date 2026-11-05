import { describe, expect, it } from 'vitest';
import { parseCommand } from './commands.ts';

describe('parseCommand', () => {
  it('recognises the simple commands, ignoring case and a bot suffix', () => {
    expect(parseCommand('/status')).toEqual({ name: 'status' });
    expect(parseCommand('/resume')).toEqual({ name: 'resume' });
    expect(parseCommand('/off')).toEqual({ name: 'off' });
    expect(parseCommand('/on')).toEqual({ name: 'on' });
    expect(parseCommand('/help')).toEqual({ name: 'help' });
    expect(parseCommand('/start')).toEqual({ name: 'start' });
    expect(parseCommand('/STATUS@my_bot')).toEqual({ name: 'status' });
  });

  it('parses /pause durations: minutes by default, m and h units, default one hour', () => {
    expect(parseCommand('/pause')).toEqual({ name: 'pause', minutes: 60 });
    expect(parseCommand('/pause 45')).toEqual({ name: 'pause', minutes: 45 });
    expect(parseCommand('/pause 90m')).toEqual({ name: 'pause', minutes: 90 });
    expect(parseCommand('/pause 2h')).toEqual({ name: 'pause', minutes: 120 });
    expect(parseCommand('/pause 24h')).toEqual({ name: 'pause', minutes: 1440 });
    expect(parseCommand('/pause   3H ')).toEqual({ name: 'pause', minutes: 180 });
  });

  it('rejects out-of-range and malformed pause durations', () => {
    for (const arg of ['0', '0m', '25h', '1441', 'abc', '-5', '1.5h', '2d']) {
      expect(parseCommand(`/pause ${arg}`), arg).toEqual({
        name: 'invalid',
        reason: expect.stringContaining('1 minute'),
      });
    }
  });

  it('treats everything else as unknown', () => {
    expect(parseCommand('hello')).toEqual({ name: 'unknown' });
    expect(parseCommand('/dance')).toEqual({ name: 'unknown' });
    expect(parseCommand('')).toEqual({ name: 'unknown' });
  });
});
