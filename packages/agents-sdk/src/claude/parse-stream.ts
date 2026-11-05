import type { RunnerResult } from '../runner.js';
import { jsonEvents, num, obj, str, type Obj } from './events.js';

export interface WindowReading {
  /** Percent used (the CLI reports a fraction: 0.15 = 15%; accurate to about +-1 pp, spike S1). */
  pct: number;
  resetsAt: Date;
  status: string;
}

export interface ParsedClaudeStream {
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    costUsd: number;
    model: string;
  } | null;
  rateLimit: { fiveHour: WindowReading; sevenDay: WindowReading } | null;
  result: {
    isError: boolean;
    text: string;
    subtype: string | undefined;
    terminalReason: string | undefined;
  } | null;
  events: RunnerResult['events'];
}

const round2 = (n: number) => Math.round(n * 10_000) / 100; // fraction -> percent with two decimals

function windowReading(w: Obj): WindowReading | null {
  if (typeof w.utilization !== 'number' || typeof w.resetsAt !== 'number') return null;
  return {
    pct: round2(w.utilization),
    resetsAt: new Date(w.resetsAt * 1000),
    status: str(w.status) ?? 'allowed',
  };
}

/** Parses `claude -p --output-format stream-json --verbose` output (verified against a recorded real stream). */
export function parseClaudeStream(stdout: string): ParsedClaudeStream {
  const events = jsonEvents(stdout);
  const system = events.find((e) => e.type === 'system');
  const resultEvent = events.filter((e) => e.type === 'result').pop();
  const rateEvent = events.filter((e) => e.type === 'rate_limit_event').pop();

  let rateLimit: ParsedClaudeStream['rateLimit'] = null;
  if (rateEvent) {
    const windows = obj(obj(rateEvent.rate_limit_info).unifiedWindows);
    const fiveHour = windowReading(obj(windows.five_hour));
    const sevenDay = windowReading(obj(windows.seven_day));
    if (fiveHour && sevenDay) rateLimit = { fiveHour, sevenDay };
  }

  let usage: ParsedClaudeStream['usage'] = null;
  let result: ParsedClaudeStream['result'] = null;
  const out: ParsedClaudeStream['events'] = [];

  if (system)
    out.push({
      kind: 'claude.started',
      data: { sessionId: str(system.session_id) ?? null, model: str(system.model) ?? null },
    });

  if (resultEvent) {
    const u = obj(resultEvent.usage);
    const modelUsage = obj(resultEvent.modelUsage);
    const topModel = Object.entries(modelUsage).sort(
      (a, b) => num(obj(b[1]).costUSD) - num(obj(a[1]).costUSD),
    )[0]?.[0];
    const costUsd = num(resultEvent.total_cost_usd);
    usage = {
      inputTokens: num(u.input_tokens),
      outputTokens: num(u.output_tokens),
      cacheReadTokens: num(u.cache_read_input_tokens),
      cacheWriteTokens: num(u.cache_creation_input_tokens),
      costUsd,
      model: str(system?.model) ?? topModel ?? 'unknown',
    };
    result = {
      isError: resultEvent.is_error === true,
      text: str(resultEvent.result) ?? '',
      subtype: str(resultEvent.subtype),
      terminalReason: str(resultEvent.terminal_reason),
    };
    out.push({
      kind: 'claude.finished',
      data: {
        costUsd,
        terminalReason: result.terminalReason ?? null,
        durationMs: num(resultEvent.duration_ms),
        numTurns: num(resultEvent.num_turns),
      },
    });
  }

  return { usage, rateLimit, result, events: out };
}
