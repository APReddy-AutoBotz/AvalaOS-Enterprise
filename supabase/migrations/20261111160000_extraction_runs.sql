-- WP1.5: extraction runs. Extraction is several AI calls; edge functions have a short wall-clock
-- limit, so a run proceeds in stages, each one invocation of journey-extract:
--   start                -> one "pass" invocation per source and pass (facts, steps)
--   all passes stored    -> two "merge" invocations (flow, facts)
--   both merges stored   -> one "assemble" invocation, which writes the result
-- extraction_put_part stores a stage's output and says, exactly once, when the next stage is due.
-- Each run has a random token; stage calls must present it (only its sha256 is stored).

create extension if not exists pg_net with schema extensions;

create table public.extraction_runs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('process', 'eval')),
  workspace_id uuid references public.workspaces (id) on delete cascade,
  process_id uuid references public.processes (id) on delete cascade,
  case_id text,
  ref text,
  status text not null default 'queued' check (status in ('queued', 'running', 'merging', 'assembling', 'done', 'failed')),
  token_hash text not null check (token_hash ~ '^[0-9a-f]{64}$'),
  source_ids text[] not null default '{}',
  input jsonb not null default '{}'::jsonb,
  result jsonb,
  error text,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((kind = 'process') = (workspace_id is not null and process_id is not null)),
  check ((kind = 'eval') = (case_id is not null))
);
create index extraction_runs_workspace_idx on public.extraction_runs (workspace_id);
create index extraction_runs_process_idx on public.extraction_runs (process_id);
create trigger extraction_runs_touch before update on public.extraction_runs for each row execute function app_private.touch_updated_at();

create table public.extraction_run_parts (
  run_id uuid not null references public.extraction_runs (id) on delete cascade,
  part text not null check (part ~ '^(pass|merge):[A-Za-z0-9._:-]{1,80}$'),
  output jsonb not null,
  created_at timestamptz not null default now(),
  primary key (run_id, part)
);

alter table public.extraction_runs enable row level security;
alter table public.extraction_run_parts enable row level security;

-- Members can follow their workspace's runs. Only the server writes; eval runs are not visible to users.
create policy extraction_runs_select on public.extraction_runs for select to authenticated
  using (kind = 'process' and app_private.is_workspace_member(workspace_id));

revoke all on public.extraction_runs, public.extraction_run_parts from anon;
revoke insert, update, delete, truncate on public.extraction_runs from authenticated;
revoke all on public.extraction_run_parts from authenticated;
-- Users see status and results, never the token hash or the full input.
revoke select on public.extraction_runs from authenticated;
grant select (id, kind, workspace_id, process_id, status, result, error, input_tokens, output_tokens, created_by, created_at, updated_at)
  on public.extraction_runs to authenticated;

create function public.extraction_put_part(target_run uuid, part_name text, part_output jsonb, used_input bigint, used_output bigint)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  r public.extraction_runs;
  n int;
  inserted boolean;
begin
  select * into r from public.extraction_runs where id = target_run for update;
  if not found then raise exception 'NOT_FOUND: run' using errcode = 'PT404'; end if;
  if r.status in ('done', 'failed') then return null; end if;

  insert into public.extraction_run_parts (run_id, part, output) values (target_run, part_name, part_output)
  on conflict do nothing;
  inserted := found;
  if not inserted then return null; end if;
  update public.extraction_runs
     set input_tokens = input_tokens + greatest(used_input, 0), output_tokens = output_tokens + greatest(used_output, 0)
   where id = target_run;

  if r.status = 'running' then
    select count(*) into n from public.extraction_run_parts where run_id = target_run and part like 'pass:%';
    if n >= 2 * coalesce(array_length(r.source_ids, 1), 0) then
      update public.extraction_runs set status = 'merging' where id = target_run;
      return 'merge';
    end if;
  elsif r.status = 'merging' then
    select count(*) into n from public.extraction_run_parts where run_id = target_run and part like 'merge:%';
    if n >= 2 then
      update public.extraction_runs set status = 'assembling' where id = target_run;
      return 'assemble';
    end if;
  end if;
  return null;
end $$;

revoke execute on function public.extraction_put_part(uuid, text, jsonb, bigint, bigint) from public, anon, authenticated;
grant execute on function public.extraction_put_part(uuid, text, jsonb, bigint, bigint) to service_role;
