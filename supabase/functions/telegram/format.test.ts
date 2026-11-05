import { describe, expect, it } from 'vitest';
import {
  callbackData,
  decisionText,
  escapeHtml,
  gateMessage,
  parseCallbackData,
} from './format.js';

const TASK = '0b9c1f2e-7d4a-4e1b-9a33-5f6c8d2e1a77';
const HEX = TASK.replace(/-/g, '');
const payload = (over: Record<string, unknown> = {}) => ({
  title: 'Approve the plan',
  gate_kind: 'plan',
  run_title: 'Build X',
  simple: true,
  ...over,
});

describe('callback data', () => {
  it('is 36 bytes and round-trips', () => {
    for (const [letter, decision] of [
      ['a', 'approve'],
      ['d', 'dismiss'],
      ['m', 'modify'],
    ] as const) {
      const data = callbackData(TASK, letter);
      expect(data).toBe(`g:${HEX}:${letter}`);
      expect(Buffer.byteLength(data)).toBe(36);
      expect(parseCallbackData(data)).toEqual({ taskId: TASK, decision });
    }
  });
  it('rejects malformed data', () => {
    for (const bad of [
      '',
      'g:xyz:a',
      `g:${HEX}:z`,
      `x:${HEX}:a`,
      `g:${HEX}:a:extra`,
      `g:${HEX.toUpperCase()}:a`,
    ])
      expect(parseCallbackData(bad), bad).toBeNull();
  });
});

describe('escapeHtml', () => {
  it('escapes the characters Telegram HTML mode cares about', () => {
    expect(escapeHtml('a < b & c > d')).toBe('a &lt; b &amp; c &gt; d');
  });
});

describe('gateMessage', () => {
  it('a simple normal gate has Approve and Dismiss buttons', () => {
    const m = gateMessage({ priority: 1, payload: payload() }, TASK, 'https://hq.example.test');
    expect(m.text).toBe('<b>Gate</b>\nApprove the plan\nBuild X · plan');
    expect(m.replyMarkup.inline_keyboard).toEqual([
      [
        { text: 'Approve', callback_data: `g:${HEX}:a` },
        { text: 'Dismiss', callback_data: `g:${HEX}:d` },
      ],
    ]);
  });
  it('marks blocking gates', () => {
    expect(
      gateMessage(
        { priority: 2, payload: payload() },
        TASK,
        'https://hq.example.test',
      ).text.startsWith('<b>Blocking gate</b>'),
    ).toBe(true);
  });
  it('a complex gate only links to the dashboard', () => {
    const m = gateMessage(
      { priority: 1, payload: payload({ simple: false }) },
      TASK,
      'https://hq.example.test/',
    );
    expect(m.replyMarkup.inline_keyboard).toEqual([
      [{ text: 'Open in dashboard', url: `https://hq.example.test/gates/${TASK}` }],
    ]);
  });
  it('escapes titles', () => {
    const m = gateMessage(
      { priority: 1, payload: payload({ title: 'Ship <b>now</b> & go', run_title: 'a&b' }) },
      TASK,
      'https://x.test',
    );
    expect(m.text).toContain('Ship &lt;b&gt;now&lt;/b&gt; &amp; go');
    expect(m.text).toContain('a&amp;b · plan');
  });
});

describe('decisionText', () => {
  it('has a line per decision', () => {
    expect(decisionText('approve')).toBe('✅ Approved');
    expect(decisionText('dismiss')).toBe('🚫 Dismissed');
  });
});
