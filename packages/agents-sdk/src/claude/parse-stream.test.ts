import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseClaudeStream } from './parse-stream.js';

const recorded = readFileSync(
  new URL('../../test/fixtures/claude-stream-recorded.jsonl', import.meta.url),
  'utf8',
);

describe('parseClaudeStream on a real recorded stream (spike S1)', () => {
  const parsed = parseClaudeStream(recorded);

  it('reads usage and cost from the result event', () => {
    expect(parsed.usage).toEqual({
      inputTokens: 2,
      outputTokens: 4,
      cacheReadTokens: 23485,
      cacheWriteTokens: 14599,
      costUsd: 0.060913,
      model: expect.any(String),
    });
  });

  it('converts the rate-limit utilization fraction to percent and the reset to a Date', () => {
    expect(parsed.rateLimit).toEqual({
      fiveHour: { pct: 15, resetsAt: new Date(1793621400 * 1000), status: 'allowed' },
      sevenDay: { pct: 9, resetsAt: new Date(1794110400 * 1000), status: 'allowed' },
    });
  });

  it('reads the result', () => {
    expect(parsed.result).toMatchObject({
      isError: false,
      subtype: 'success',
      terminalReason: 'completed',
    });
    expect(typeof parsed.result?.text).toBe('string');
  });

  it('summarises the run as runner events', () => {
    expect(parsed.events.map((e) => e.kind)).toEqual(
      expect.arrayContaining(['claude.started', 'claude.finished']),
    );
    expect(parsed.events.find((e) => e.kind === 'claude.finished')?.data).toMatchObject({
      costUsd: 0.060913,
    });
  });
});

describe('parseClaudeStream edge cases', () => {
  it('returns empty parts for empty or non-JSON output', () => {
    for (const out of ['', 'plain text\nmore text']) {
      expect(parseClaudeStream(out)).toMatchObject({
        usage: null,
        rateLimit: null,
        result: null,
        events: [],
      });
    }
  });
  it('ignores noise lines and a truncated final line', () => {
    const lines = recorded.trim().split('\n');
    const noisy = ['npm warn something', ...lines, '{"type":"assistant","mess'].join('\n');
    const parsed = parseClaudeStream(noisy);
    expect(parsed.usage?.outputTokens).toBe(4);
    expect(parsed.rateLimit?.fiveHour.pct).toBe(15);
  });
  it('marks an error result', () => {
    const out =
      '{"type":"result","subtype":"error_during_execution","is_error":true,"result":"boom","terminal_reason":"error","total_cost_usd":0,"usage":{}}';
    expect(parseClaudeStream(out).result).toMatchObject({
      isError: true,
      text: 'boom',
      subtype: 'error_during_execution',
    });
  });
  it('uses the last rate-limit event and rounds percentages', () => {
    const a =
      '{"type":"rate_limit_event","rate_limit_info":{"unifiedWindows":{"five_hour":{"utilization":0.1,"resetsAt":1,"status":"allowed"},"seven_day":{"utilization":0.2,"resetsAt":2,"status":"allowed"}}}}';
    const b =
      '{"type":"rate_limit_event","rate_limit_info":{"unifiedWindows":{"five_hour":{"utilization":0.123456,"resetsAt":3,"status":"allowed"},"seven_day":{"utilization":0.5,"resetsAt":4,"status":"allowed"}}}}';
    expect(parseClaudeStream(`${a}\n${b}`).rateLimit?.fiveHour).toEqual({
      pct: 12.35,
      resetsAt: new Date(3000),
      status: 'allowed',
    });
  });
  it('falls back to the model with the highest cost in modelUsage when there is no system event', () => {
    const out =
      '{"type":"result","subtype":"success","is_error":false,"result":"ok","total_cost_usd":0.2,"usage":{"input_tokens":1,"output_tokens":2},"modelUsage":{"small":{"costUSD":0.01},"big":{"costUSD":0.19}}}';
    expect(parseClaudeStream(out).usage?.model).toBe('big');
  });
});
