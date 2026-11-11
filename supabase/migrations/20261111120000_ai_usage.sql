-- WP0.4 AI gateway: one row per provider call, written by the journey-ai edge function with the
-- service key. Members can read their workspace's usage. Monthly budget is checked per workspace.

create table public.ai_usage (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  task text not null,
  model text not null,
  provider text not null default 'openai',
  status text not null check (status in ('ok', 'provider_error', 'invalid_output', 'truncated', 'refused')),
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  attempts smallint not null default 1 check (attempts >= 1),
  error_code text,
  duration_ms integer,
  created_at timestamptz not null default now()
);

create index ai_usage_workspace_created_idx on public.ai_usage (workspace_id, created_at);
create index ai_usage_user_idx on public.ai_usage (user_id);

alter table public.ai_usage enable row level security;

create policy ai_usage_select_members on public.ai_usage
  for select to authenticated
  using (app_private.is_workspace_member(workspace_id));

revoke all on public.ai_usage from anon;
revoke insert, update, delete, truncate on public.ai_usage from authenticated;

create or replace function public.ai_tokens_used_this_month(target_workspace uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(input_tokens + output_tokens), 0)::bigint
  from public.ai_usage
  where workspace_id = target_workspace
    and created_at >= date_trunc('month', now());
$$;

revoke all on function public.ai_tokens_used_this_month(uuid) from public, anon, authenticated;
grant execute on function public.ai_tokens_used_this_month(uuid) to service_role;

-- New objects should not be reachable by anon unless granted explicitly.
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke execute on functions from anon, public;
