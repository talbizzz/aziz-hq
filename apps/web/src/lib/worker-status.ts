const ONLINE_WINDOW_MS = 2 * 60 * 1000;

/** The worker heartbeats every minute; two missed beats count as offline. */
export function isWorkerOnline(lastSeenAt: string | null, now: Date = new Date()): boolean {
  if (!lastSeenAt) return false;
  const seen = Date.parse(lastSeenAt);
  return Number.isFinite(seen) && now.getTime() - seen < ONLINE_WINDOW_MS;
}
