create trigger runs_set_updated_at before update on public.runs
  for each row execute function public.set_updated_at();
create trigger tasks_set_updated_at before update on public.tasks
  for each row execute function public.set_updated_at();
create trigger settings_set_updated_at before update on public.settings
  for each row execute function public.set_updated_at();

create trigger runs_log_created after insert on public.runs
  for each row execute function public.log_status_event();
create trigger runs_log_status after update of status on public.runs
  for each row when (old.status is distinct from new.status) execute function public.log_status_event();
create trigger tasks_log_created after insert on public.tasks
  for each row execute function public.log_status_event();
create trigger tasks_log_status after update of status on public.tasks
  for each row when (old.status is distinct from new.status) execute function public.log_status_event();

create trigger gates_log_created after insert on public.gates
  for each row execute function public.log_gate_event();
create trigger gates_log_decided after update of decision on public.gates
  for each row when (old.decision is null and new.decision is not null) execute function public.log_gate_event();

-- Append-only, including for the service role and superusers.
create trigger events_no_update before update or delete on public.events
  for each row execute function public.events_append_only();
create trigger events_no_truncate before truncate on public.events
  for each statement execute function public.events_append_only();

-- Milestone 3: notifications for opened gates and finished runs.
create trigger tasks_enqueue_gate_notification after update of status on public.tasks
  for each row when (new.type = 'gate' and new.status = 'waiting_human' and old.status is distinct from new.status)
  execute function public.enqueue_gate_notification();
create trigger runs_enqueue_notification after update of status on public.runs
  for each row when (new.status in ('done', 'failed') and old.status is distinct from new.status)
  execute function public.enqueue_run_notification();
