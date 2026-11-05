import { useQuery } from '@tanstack/react-query';
import { fetchWorkerLastSeen } from '../lib/queries';
import { useRealtimeInvalidation } from '../lib/realtime';
import { isWorkerOnline } from '../lib/worker-status';
import { cn } from '../lib/utils';

const TABLES = ['worker_heartbeats'] as const;
const KEY = ['workers'] as const;

export function WorkerStatus() {
  useRealtimeInvalidation(TABLES, KEY);
  // refetch every 30 s too: staleness (going offline) produces no database event
  const { data: lastSeen = null } = useQuery({
    queryKey: KEY,
    queryFn: fetchWorkerLastSeen,
    refetchInterval: 30_000,
  });
  const online = isWorkerOnline(lastSeen);
  return (
    <span
      className="inline-flex items-center gap-2 text-sm"
      data-testid="worker-status"
      data-online={online}
    >
      <span
        className={cn('size-2 rounded-full', online ? 'bg-primary' : 'bg-muted-foreground/40')}
      />
      {online ? 'Worker online' : 'Worker offline'}
    </span>
  );
}
