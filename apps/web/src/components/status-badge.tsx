import { cn } from '../lib/utils';

const styles: Record<string, string> = {
  pending: 'bg-muted text-muted-foreground',
  running: 'bg-primary text-primary-foreground',
  waiting_human: 'bg-accent text-accent-foreground ring-1 ring-ring',
  paused: 'bg-accent text-accent-foreground',
  done: 'bg-secondary text-secondary-foreground',
  failed: 'bg-destructive/10 text-destructive',
  cancelled: 'bg-muted text-muted-foreground line-through',
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        'inline-flex rounded-md px-2 py-0.5 text-xs font-medium',
        styles[status] ?? styles.pending,
      )}
    >
      {status.replace('_', ' ')}
    </span>
  );
}
