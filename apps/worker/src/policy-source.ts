import {
  defaultUsagePolicy,
  evaluateUsagePolicy,
  usagePolicySettingsSchema,
  type PolicyDecision,
  type PolicyOverride,
  type UsageSnapshot,
} from '@aziz-hq/core';

/** Where the policy inputs come from; the Supabase implementation is `createPolicyDb`. */
export interface PolicyDb {
  latestSnapshot(): Promise<UsageSnapshot | null>;
  activeOverrides(): Promise<PolicyOverride[]>;
  settings(): Promise<{ usagePolicy: unknown; timezone: unknown }>;
}

const DEFAULT_TIMEZONE = 'Europe/Berlin';

function validTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || tz === '') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Reads the latest snapshot, the active overrides and the settings, and asks the pure policy engine (ADR-15). */
export function createPolicyProvider(
  db: PolicyDb,
  now: () => Date = () => new Date(),
): () => Promise<PolicyDecision> {
  return async () => {
    const [snapshot, overrides, settings] = await Promise.all([
      db.latestSnapshot(),
      db.activeOverrides(),
      db.settings(),
    ]);
    const parsed = usagePolicySettingsSchema.safeParse(settings.usagePolicy);
    return evaluateUsagePolicy({
      now: now(),
      timezone: validTimeZone(settings.timezone) ? settings.timezone : DEFAULT_TIMEZONE,
      settings: parsed.success ? parsed.data : defaultUsagePolicy,
      snapshot,
      overrides,
    });
  };
}
