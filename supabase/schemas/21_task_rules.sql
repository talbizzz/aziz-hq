-- Milestone 2, contract C1: task dependency validation and the task status state machine.

create function public.tasks_validate_deps() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  dep uuid;
begin
  if tg_op = 'UPDATE' then
    if new.depends_on is distinct from old.depends_on then
      raise exception 'depends_on is immutable' using errcode = 'invalid_parameter_value';
    end if;
    return new;
  end if;

  foreach dep in array new.depends_on loop
    if dep = new.id then
      raise exception 'task cannot depend on itself' using errcode = 'invalid_parameter_value';
    end if;
    if not exists (select 1 from public.tasks where id = dep) then
      raise exception 'unknown dependency %', dep using errcode = 'invalid_parameter_value';
    end if;
    if not exists (select 1 from public.tasks where id = dep and run_id = new.run_id) then
      raise exception 'dependency in another run %', dep using errcode = 'invalid_parameter_value';
    end if;
  end loop;
  return new;
end $$;

-- A task can only depend on tasks that already exist and depends_on never changes, so cycles cannot occur.
create trigger tasks_validate_deps
  before insert or update of depends_on on public.tasks
  for each row execute function public.tasks_validate_deps();

create function public.tasks_status_transition() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = new.status then
    return new;
  end if;

  if not (
    (old.status = 'pending' and new.status in ('running', 'cancelled'))
    or (old.status = 'pending' and new.status = 'waiting_human' and new.type = 'gate')
    or (old.status = 'running' and new.status in ('done', 'failed', 'pending', 'cancelled'))
    or (old.status = 'waiting_human' and new.status in ('done', 'cancelled'))
  ) then
    raise exception 'invalid task status transition: % -> %', old.status, new.status using errcode = 'check_violation';
  end if;

  if new.status <> 'running' then
    new.lease_until := null;
  end if;
  if new.status = 'pending' then
    new.claimed_by := null;
  end if;
  return new;
end $$;

create trigger tasks_status_transition
  before update of status on public.tasks
  for each row execute function public.tasks_status_transition();
