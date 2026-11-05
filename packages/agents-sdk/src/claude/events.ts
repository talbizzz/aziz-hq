export type StreamEvent = Record<string, unknown> & { type?: string };

/** The JSON objects in `claude -p --output-format stream-json` output; noise and a truncated last line are skipped. */
export function jsonEvents(stdout: string): StreamEvent[] {
  const out: StreamEvent[] = [];
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed))
        out.push(parsed as StreamEvent);
    } catch {
      // not JSON (or cut off): matched as text by the classifier
    }
  }
  return out;
}

export type Obj = Record<string, unknown>;
export const obj = (v: unknown): Obj =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Obj) : {};
export const num = (v: unknown, fallback = 0): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;
export const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
