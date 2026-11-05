import { supabase } from './supabase';

const unwrap = <T>({ data, error }: { data: T | null; error: { message: string } | null }): T => {
  if (error) throw new Error(error.message);
  return data as T;
};

export const fetchRuns = async () =>
  unwrap(
    await supabase
      .from('runs')
      .select('id, title, module_id, status, updated_at, tasks(status)')
      .order('updated_at', { ascending: false }),
  );

export const fetchRun = async (runId: string) => {
  const { data, error } = await supabase.from('runs').select('*').eq('id', runId).maybeSingle();
  if (error) throw new Error(error.message);
  return data; // null when the run does not exist or is not visible
};

export const fetchTasks = async (runId: string) =>
  unwrap(
    await supabase.from('tasks').select('*').eq('run_id', runId).order('created_at').order('id'),
  );

// the timeline is capped: every status change writes an event
export const fetchEvents = async (runId: string) =>
  unwrap(
    await supabase
      .from('events')
      .select('*')
      .eq('run_id', runId)
      .order('id', { ascending: false })
      .limit(200),
  );

export const fetchWorkerLastSeen = async (): Promise<string | null> => {
  const rows = unwrap(
    await supabase
      .from('worker_heartbeats')
      .select('last_seen_at')
      .order('last_seen_at', { ascending: false })
      .limit(1),
  );
  return rows[0]?.last_seen_at ?? null;
};
