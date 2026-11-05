export interface SettingsForm {
  timezone: string;
  quietStart: string;
  quietEnd: string;
  digestTime: string;
}

export type SettingsParse = { ok: true; value: SettingsForm } | { ok: false; error: string };

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function validTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz !== '';
  } catch {
    return false;
  }
}

export function parseSettingsForm(input: SettingsForm): SettingsParse {
  const fields = [
    ['Quiet hours start', input.quietStart],
    ['Quiet hours end', input.quietEnd],
    ['Digest time', input.digestTime],
  ] as const;
  for (const [label, value] of fields) {
    if (!TIME.test(value)) return { ok: false, error: `${label} must be a time like 07:00` };
  }
  if (!validTimeZone(input.timezone))
    return { ok: false, error: `Unknown time zone: ${input.timezone}` };
  if (input.quietStart === input.quietEnd)
    return { ok: false, error: 'Quiet hours start and end must be different' };
  return { ok: true, value: input };
}

/** The `settings` rows (key + jsonb value) the Edge Function and the SQL functions read. */
export function settingsToRows(form: SettingsForm) {
  return [
    { key: 'timezone', value: form.timezone },
    { key: 'quiet_hours', value: { start: form.quietStart, end: form.quietEnd } },
    { key: 'digest_time', value: form.digestTime },
  ];
}
