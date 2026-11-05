create type public.task_status as enum ('pending', 'running', 'waiting_human', 'done', 'failed', 'cancelled');
create type public.task_type as enum ('agent', 'gate', 'system');
create type public.run_status as enum ('pending', 'running', 'paused', 'done', 'failed', 'cancelled');
create type public.gate_decision as enum ('approve', 'modify', 'dismiss', 'answer');
create type public.actor_type as enum ('system', 'worker', 'agent', 'human');
