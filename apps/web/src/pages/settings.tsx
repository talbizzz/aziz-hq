import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { fetchSettings } from '../lib/queries';
import { parseSettingsForm, settingsToRows, type SettingsForm } from '../lib/settings';
import { supabase } from '../lib/supabase';

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
          {!zones.includes(form.timezone) && <option value={form.timezone}>{form.timezone}</option>}
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
  );
}
