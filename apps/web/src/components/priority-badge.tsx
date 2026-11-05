import { cn } from '../lib/utils';

const labels = ['Info', 'Normal', 'Blocking'] as const;
const styles = [
  'bg-muted text-muted-foreground',
  'bg-secondary text-secondary-foreground',
  'bg-destructive/10 text-destructive',
] as const;

export function PriorityBadge({ priority }: { priority: number }) {
  const level = Math.min(Math.max(priority, 0), 2);
  return (
    <span className={cn('inline-flex rounded-md px-2 py-0.5 text-xs font-medium', styles[level])}>
      {labels[level]}
    </span>
  );
}
