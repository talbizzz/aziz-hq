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

describe('parseCommand: usage modes (milestone 4)', () => {
  it('recognises /working, /stop and /sleeping', () => {
    expect(parseCommand('/working')).toEqual({ name: 'working' });
    expect(parseCommand('/stop')).toEqual({ name: 'stop' });
    expect(parseCommand('/sleeping@my_bot')).toEqual({ name: 'sleeping' });
  });

  it('parses /custom <cap> <duration>', () => {
    expect(parseCommand('/custom 70 2h')).toEqual({ name: 'custom', capPct: 70, minutes: 120 });
    expect(parseCommand('/custom 70% 90m')).toEqual({ name: 'custom', capPct: 70, minutes: 90 });
    expect(parseCommand('/custom 0 30')).toEqual({ name: 'custom', capPct: 0, minutes: 30 });
    expect(parseCommand('/custom 100 24h')).toEqual({ name: 'custom', capPct: 100, minutes: 1440 });
  });

  it('rejects malformed or out-of-range /custom arguments with a usage hint', () => {
    for (const text of [
      '/custom',
      '/custom 70',
      '/custom abc 2h',
      '/custom 101 2h',
      '/custom -1 2h',
      '/custom 70 0m',
      '/custom 70 25h',
      '/custom 70 2d',
    ]) {
      expect(parseCommand(text), text).toEqual({
        name: 'invalid',
        reason: expect.stringContaining('/custom'),
      });
    }
  });
});
