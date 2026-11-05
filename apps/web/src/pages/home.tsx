import { UsagePanel } from '../components/usage-panel';

export function HomePage() {
  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted-foreground" data-testid="dashboard-empty">
        No gates. Nothing running.
      </p>
      <UsagePanel />
    </div>
  );
}
