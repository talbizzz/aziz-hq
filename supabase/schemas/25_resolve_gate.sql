-- Milestone 3, contract C2: the dashboard's way to decide a gate (ADR-2). The owner (aal2) only; wraps decide_gate.

create function public.resolve_gate(p_task_id uuid, p_decision public.gate_decision, p_comment text default null) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_options jsonb;
  v_decided public.gate_decision;
  v_allowed boolean;
  v_needs_comment boolean;
begin
  if not public.is_owner() then
    raise exception 'not authorised' using errcode = 'insufficient_privilege';
  end if;

  select g.options, g.decision into v_options, v_decided from public.gates g where g.task_id = p_task_id;
  if not found then
    raise exception 'not a gate' using errcode = 'invalid_parameter_value';
  end if;

  -- already decided: idempotent, whatever is asked now (decide_gate returns the stored decision)
  if v_decided is not null then
    return public.decide_gate(p_task_id, p_decision, p_comment, 'dashboard');
  end if;

  if jsonb_array_length(v_options) = 0 then
    v_allowed := p_decision in ('approve', 'dismiss');
  else
    select exists (select 1 from jsonb_array_elements(v_options) o where o ->> 'kind' = p_decision::text) into v_allowed;
  end if;
  if not v_allowed then
    raise exception 'decision not allowed for this gate' using errcode = 'invalid_parameter_value';
  end if;

  v_needs_comment := p_decision in ('modify', 'answer')
    or exists (
      select 1 from jsonb_array_elements(v_options) o
      where o ->> 'kind' = p_decision::text and coalesce((o ->> 'requiresComment')::boolean, false)
    );
  if v_needs_comment and btrim(coalesce(p_comment, '')) = '' then
    raise exception 'comment required' using errcode = 'invalid_parameter_value';
  end if;

  return public.decide_gate(p_task_id, p_decision, p_comment, 'dashboard');
end $$;

revoke all on function public.resolve_gate(uuid, public.gate_decision, text) from public, anon;
grant execute on function public.resolve_gate(uuid, public.gate_decision, text) to authenticated;
