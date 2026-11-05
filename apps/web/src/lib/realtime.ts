import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { supabase } from './supabase';

/**
 * Invalidates `queryKey` whenever one of `tables` changes (ADR-4, ADR-9). Two details from spike S3:
 * the Realtime token must be set before subscribing, and rows inserted between SUBSCRIBED and the moment
 * postgres_changes becomes active are lost, so everything is refetched shortly after SUBSCRIBED.
 */
export function useRealtimeInvalidation(tables: readonly string[], queryKey: readonly unknown[]) {
  const queryClient = useQueryClient();
  const tableKey = tables.join(',');
  const keyJson = JSON.stringify(queryKey);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let channel: ReturnType<typeof supabase.channel> | undefined;
    const invalidate = () => void queryClient.invalidateQueries({ queryKey });

    void (async () => {
      const { data } = await supabase.auth.getSession();
      await supabase.realtime.setAuth(data.session?.access_token ?? null);
      if (cancelled) return;
      channel = supabase.channel(`rt-${tableKey}-${Math.random().toString(36).slice(2)}`);
      for (const table of tableKey.split(',')) {
        channel.on('postgres_changes', { event: '*', schema: 'public', table }, invalidate);
      }
      channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') timer = setTimeout(invalidate, 1500);
      });
    })();

    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (channel) void supabase.removeChannel(channel);
    };
    // queryKey is represented by keyJson
  }, [tableKey, keyJson, queryClient]);
}
