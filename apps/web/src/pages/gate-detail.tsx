import {
  allowedDecisions,
  gateOptionSchema,
  needsComment,
  type GateDecisionKind,
} from '@aziz-hq/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { z } from 'zod';
import { PriorityBadge } from '../components/priority-badge';
import { Button } from '../components/ui/button';
import { fetchGate } from '../lib/queries';
import { supabase } from '../lib/supabase';
import { cn } from '../lib/utils';

const optionsSchema = z.array(gateOptionSchema);
const label = (d: string) => d.charAt(0).toUpperCase() + d.slice(1);

export function GateDetailPage() {
  const { taskId = '' } = useParams();
  const queryClient = useQueryClient();
  const gate = useQuery({ queryKey: ['inbox', 'gate', taskId], queryFn: () => fetchGate(taskId) });
  const [choice, setChoice] = useState<GateDecisionKind | null>(null);
  const [comment, setComment] = useState('');
  const [notice, setNotice] = useState('');

  const resolve = useMutation({
    mutationFn: async (input: { decision: GateDecisionKind; comment: string }) => {
      const { data, error } = await supabase.rpc('resolve_gate', {
        p_task_id: taskId,
        p_decision: input.decision,
        p_comment: input.comment.trim() === '' ? undefined : input.comment,
      });
      if (error) throw new Error(error.message);
      return data as { first: boolean; decision: string };
    },
    onSuccess: (result) => {
      setNotice(result.first ? '' : `Already decided: ${result.decision}`);
      void queryClient.invalidateQueries({ queryKey: ['inbox'] });
    },
    onError: (e: Error) => setNotice(e.message),
  });

  if (gate.isPending) return <p className="text-sm text-muted-foreground">Loading gate…</p>;
  if (gate.isError)
    return (
      <p role="alert" className="text-sm text-destructive">
        Could not load the gate.
      </p>
    );
  if (!gate.data)
    return (
      <p className="text-sm">
        Gate not found.{' '}
        <Link to="/inbox" className="underline">
          Back to the inbox
        </Link>
      </p>
    );

  const g = gate.data;
  const parsed = optionsSchema.safeParse(g.options);
  const options = parsed.success ? parsed.data : [];
  const decisions = allowedDecisions(options);
  const decided = g.decision !== null;
  const commentRequired = choice !== null && needsComment(choice, options);
  const canSubmit =
    !decided &&
    choice !== null &&
    (!commentRequired || comment.trim() !== '') &&
    !resolve.isPending;

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <div className="flex items-center gap-3">
        <Link to="/inbox" className="text-sm text-muted-foreground underline">
          Inbox
        </Link>
        <PriorityBadge priority={g.priority} />
      </div>
      <h1 className="text-lg font-semibold" data-testid="gate-title">
        {g.title}
      </h1>
      <p className="text-sm text-muted-foreground">
        {g.kind} · run{' '}
        <Link to={`/runs/${g.tasks.run_id}`} className="underline">
          {g.tasks.runs?.title ?? g.tasks.run_id}
        </Link>
      </p>

      <details open className="rounded-lg border p-4">
        <summary className="cursor-pointer text-sm font-medium">Context</summary>
        <pre className="mt-2 max-h-64 overflow-auto text-xs">
          {JSON.stringify(g.context, null, 2)}
        </pre>
      </details>

      {decided && (
        <div className="rounded-lg border bg-muted p-4 text-sm" data-testid="gate-decided">
          Decision: <strong>{g.decision}</strong> via {g.decided_via} at{' '}
          {g.decided_at ? new Date(g.decided_at).toLocaleString() : ''}
          {g.comment ? <p className="mt-1 text-muted-foreground">“{g.comment}”</p> : null}
        </div>
      )}

      <div className="flex flex-wrap gap-2" role="group" aria-label="Decision">
        {decisions.map((d) => (
          <Button
            key={d}
            type="button"
            variant={choice === d ? 'default' : 'outline'}
            disabled={decided}
            aria-pressed={choice === d}
            data-testid={`gate-option-${d}`}
            onClick={() => setChoice(d)}
          >
            {options.find((o) => o.kind === d)?.label ?? label(d)}
          </Button>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="comment" className="text-sm font-medium">
          Comment{commentRequired ? ' (required)' : ' (optional)'}
        </label>
        <textarea
          id="comment"
          rows={3}
          value={comment}
          disabled={decided}
          onChange={(e) => setComment(e.target.value)}
          className={cn(
            'w-full rounded-md border border-input bg-transparent p-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          )}
          data-testid="gate-comment"
        />
      </div>

      {notice && (
        <p role="alert" className="text-sm text-destructive" data-testid="gate-notice">
          {notice}
        </p>
      )}
      <div>
        <Button
          type="button"
          disabled={!canSubmit}
          data-testid="gate-submit"
          onClick={() => choice && resolve.mutate({ decision: choice, comment })}
        >
          Submit decision
        </Button>
      </div>
    </div>
  );
}
