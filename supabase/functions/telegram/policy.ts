import { localMinutes, nextLocalTime, parseHHMM } from './time.ts';

export interface PolicyNotification {
  kind: 'gate_open' | 'run_done' | 'run_failed' | 'worker_offline' | 'worker_online';
  priority: 0 | 1 | 2;
}

export interface DeliveryContext {
  now: Date;
  timezone: string;
  quietHours: { start: string; end: string };
  offToday: boolean;
  /** A worker_offline alert was sent for the current outage (a recovery message makes no sense otherwise). */
  offlineAlertSent: boolean;
}

export type Delivery =
  | { action: 'send' }
  | { action: 'defer'; until: Date }
  | { action: 'digest' }
  | { action: 'skip'; reason: string };

function inQuietHours(ctx: DeliveryContext): boolean {
  const start = parseHHMM(ctx.quietHours.start);
  const end = parseHHMM(ctx.quietHours.end);
  const now = localMinutes(ctx.now, ctx.timezone);
  return start <= end ? now >= start && now < end : now >= start || now < end;
}

/** Delivery policy (milestone 3, C3): critical always, normal outside quiet hours / off-today, info in the digest. */
export function decideDelivery(n: PolicyNotification, ctx: DeliveryContext): Delivery {
  if (n.kind === 'worker_online' && !ctx.offlineAlertSent)
    return { action: 'skip', reason: 'no offline alert was sent' };
  if (n.priority === 2) return { action: 'send' };
  if (n.priority === 0) return { action: 'digest' };

  const next = () => nextLocalTime(ctx.now, ctx.quietHours.end, ctx.timezone);
  if (ctx.offToday || inQuietHours(ctx)) return { action: 'defer', until: next() };
  return { action: 'send' };
}
