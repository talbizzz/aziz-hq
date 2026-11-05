import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { fetchSettings } from '../lib/queries';
import { parseSettingsForm, settingsToRows, type SettingsForm } from '../lib/settings';
import { parseUsagePolicyForm, type UsagePolicyForm } from '../lib/usage';
import { supabase } from '../lib/supabase';
import { defaultUsagePolicy, usagePolicySettingsSchema } from '@aziz-hq/core';

const DEFAULTS: SettingsForm = {
  timezone: 'Europe/Berlin',
  quietStart: '22:00',
  quietEnd: '07:00',
  digestTime: '08:00',
};
const zones =
  typeof Intl.supportedValuesOf === 'function'
    ? Intl.supportedValuesOf('timeZone')
    : [DEFAULTS.timezone];

function fromRows(rows: { key: string; value: unknown }[]): SettingsForm {
  const get = (k: string) => rows.find((r) => r.key === k)?.value;
  const quiet = get('quiet_hours') as { start?: string; end?: string } | undefined;
  return {
    timezone: (get('timezone') as string | undefined) ?? DEFAULTS.timezone,
    quietStart: quiet?.start ?? DEFAULTS.quietStart,
    quietEnd: quiet?.end ?? DEFAULTS.quietEnd,
    digestTime: (get('digest_time') as string | undefined) ?? DEFAULTS.digestTime,
  };
}

function usageFormFrom(rows: { key: string; value: unknown }[]): UsagePolicyForm {
  const parsed = usagePolicySettingsSchema.safeParse(
    rows.find((r) => r.key === 'usage_policy')?.value,
  );
  const p = parsed.success ? parsed.data : defaultUsagePolicy;
  return {
    sleepStart: p.sleeping_hours.start,
    sleepEnd: p.sleeping_hours.end,
    capWork: String(p.cap_work_pct),
    capSleeping: String(p.cap_sleeping_pct),
    margin: String(p.weekly_margin_pct),
    ceiling: String(p.weekly_ceiling_pct),
  };
}

function UsagePolicySection({ rows }: { rows: { key: string; value: unknown }[] }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<UsagePolicyForm>(() => usageFormFrom(rows));
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => setForm(usageFormFrom(rows)), [rows]);

  const save = useMutation({
    mutationFn: async (value: unknown) => {
      const { error: e } = await supabase
        .from('settings')
        .update({ value: value as never })
        .eq('key', 'usage_policy');
      if (e) throw new Error(e.message);
    },
    onSuccess: () => {
      setSaved(true);
      void queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const set = (field: keyof UsagePolicyForm) => (e: { target: { value: string } }) => {
    setSaved(false);
    setForm((f) => ({ ...f, [field]: e.target.value }));
  };

  function submit(e: FormEvent) {
    e.preventDefault();
    setSaved(false);
    const parsed = parseUsagePolicyForm(form);
    if (!parsed.ok) return setError(parsed.error);
    setError('');
    save.mutate(parsed.value);
  }

  const number = (id: string, label: string, field: keyof UsagePolicyForm, testId: string) => (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        min={0}
        max={100}
        value={form[field]}
        onChange={set(field)}
        data-testid={testId}
      />
    </div>
  );

  return (
    <form onSubmit={submit} noValidate className="flex max-w-md flex-col gap-4 border-t pt-6">
      <h2 className="text-lg font-semibold">Usage policy</h2>
      <p className="text-sm text-muted-foreground">
        How much of your Claude plan the factory may use. Caps are percentages of the five-hour
        window.
      </p>
      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="sleep-start">Sleeping hours start</Label>
          <Input
            id="sleep-start"
            type="time"
            value={form.sleepStart}
            onChange={set('sleepStart')}
            data-testid="usage-sleep-start"
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="sleep-end">Sleeping hours end</Label>
          <Input
            id="sleep-end"
            type="time"
            value={form.sleepEnd}
            onChange={set('sleepEnd')}
            data-testid="usage-sleep-end"
          />
        </div>
        {number('cap-work', 'Work cap (%)', 'capWork', 'usage-cap-work')}
        {number('cap-sleeping', 'Sleeping cap (%)', 'capSleeping', 'usage-cap-sleeping')}
        {number('margin', 'Weekly margin (%)', 'margin', 'usage-margin')}
        {number('ceiling', 'Weekly ceiling (%)', 'ceiling', 'usage-ceiling')}
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive" data-testid="usage-error">
          {error}
        </p>
      )}
      {saved && (
        <p className="text-sm text-muted-foreground" data-testid="usage-saved">
          Saved.
        </p>
      )}
      <div>
        <Button type="submit" disabled={save.isPending} data-testid="usage-save">
          Save usage policy
        </Button>
      </div>
    </form>
  );
}

export function SettingsPage() {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ['settings'], queryFn: fetchSettings });
  const [form, setForm] = useState<SettingsForm>(DEFAULTS);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (settings.data) setForm(fromRows(settings.data));
  }, [settings.data]);

  const save = useMutation({
    mutationFn: async (value: SettingsForm) => {
      // the rows exist from the settings-defaults migration; the owner may only update them (RLS)
      for (const row of settingsToRows(value)) {
        const { error: e } = await supabase
          .from('settings')
          .update({ value: row.value as never })
          .eq('key', row.key);
        if (e) throw new Error(e.message);
      }
    },
    onSuccess: () => {
      setSaved(true);
      void queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
    onError: (e: Error) => setError(e.message),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setSaved(false);
    const parsed = parseSettingsForm(form);
    if (!parsed.ok) return setError(parsed.error);
    setError('');
    save.mutate(parsed.value);
  }

  const set = (field: keyof SettingsForm) => (e: { target: { value: string } }) => {
    setSaved(false);
    setForm((f) => ({ ...f, [field]: e.target.value }));
  };

  if (settings.isPending) return <p className="text-sm text-muted-foreground">Loading settings…</p>;
  if (settings.isError)
    return (
      <p role="alert" className="text-sm text-destructive">
        Could not load settings.
      </p>
    );

  return (
    <div className="flex flex-col gap-8">
      <form onSubmit={submit} className="flex max-w-md flex-col gap-4">
        <h1 className="text-lg font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Quiet hours hold back normal notifications; blocking gates and worker alerts always get
          through.
        </p>
        <div className="flex flex-col gap-2">
          <Label htmlFor="timezone">Time zone</Label>
          <select
            id="timezone"
            value={form.timezone}
            onChange={set('timezone')}
            data-testid="settings-timezone"
            className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
          >
            {!zones.includes(form.timezone) && (
              <option value={form.timezone}>{form.timezone}</option>
            )}
            {zones.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="quiet-start">Quiet hours start</Label>
            <Input
              id="quiet-start"
              type="time"
              value={form.quietStart}
              onChange={set('quietStart')}
              data-testid="settings-quiet-start"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="quiet-end">Quiet hours end</Label>
            <Input
              id="quiet-end"
              type="time"
              value={form.quietEnd}
              onChange={set('quietEnd')}
              data-testid="settings-quiet-end"
            />
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="digest">Daily digest time</Label>
          <Input
            id="digest"
            type="time"
            value={form.digestTime}
            onChange={set('digestTime')}
            data-testid="settings-digest-time"
          />
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive" data-testid="settings-error">
            {error}
          </p>
        )}
        {saved && (
          <p className="text-sm text-muted-foreground" data-testid="settings-saved">
            Saved.
          </p>
        )}
        <div>
          <Button type="submit" disabled={save.isPending} data-testid="settings-save">
            Save
          </Button>
        </div>
      </form>
      <UsagePolicySection rows={settings.data} />
    </div>
  );
}
