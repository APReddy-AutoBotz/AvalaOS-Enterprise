-- The per-minute AI limit (docs/next-plan.md, section 3e, "Before the first account that is not the owner's").
-- Additive only: one new table and one new function; nothing the released site or the released server
-- functions use changes.
--
-- journey-ai asks `ai_call_admit` before every call to a provider that a signed-in person starts (the trusted
-- server, the Ask Avala measure, never asks). The function counts the calls started in the last minute by the
-- person, in any workspace, and, when asked (the platform key only), by the whole workspace. Under both limits
-- it records this start and answers "admitted"; otherwise it answers which limit was reached and how many
-- seconds until the oldest counted start leaves the window, and records nothing.
--
-- Two calls at the same moment: the function takes a lock on the person and, when it counts the workspace, on
-- the workspace, always in that order, for the rest of its transaction, so the second waits for the first to be
-- recorded and the limit cannot be passed by calls sent together. The lock is held for milliseconds.
--
-- It counts calls started, not tokens: the monthly allowance is still the token limit, checked when a call
-- starts, and the hard spend limit set at OpenAI stays the backstop.
--
-- Rows hold only the workspace, the person and the time; a row older than an hour is deleted on the next call
-- by that person or in that workspace. Nobody reaches the table through the public API, and only the service
-- role may call the function, as with ai_tokens_used_this_month.

create table app_private.ai_call_starts (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  started_at timestamptz not null default now()
);

create index ai_call_starts_user_idx on app_private.ai_call_starts (user_id, started_at);
create index ai_call_starts_workspace_idx on app_private.ai_call_starts (workspace_id, started_at);

alter table app_private.ai_call_starts enable row level security;
revoke all on app_private.ai_call_starts from public, anon, authenticated;

create function public.ai_call_admit(
  target_workspace uuid,
  target_person uuid,
  per_person int,
  per_workspace int,
  count_workspace boolean,
  window_seconds int default 60
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  since timestamptz := now() - make_interval(secs => window_seconds);
  oldest timestamptz;
  n int;
begin
  if target_workspace is null or target_person is null then
    raise exception 'ai_call_admit needs a workspace and a person' using errcode = 'invalid_parameter_value';
  end if;
  if per_person is null or per_person < 1 or per_workspace is null or per_workspace < 1
     or window_seconds is null or window_seconds < 1 or window_seconds > 3600 then
    raise exception 'ai_call_admit needs limits of at least 1 and a window of 1 to 3600 seconds' using errcode = 'invalid_parameter_value';
  end if;

  -- Person first, then workspace: every caller takes them in this order, so two calls never wait on each other.
  perform pg_advisory_xact_lock(hashtext('ai_call_admit:person'), hashtext(target_person::text));
  if count_workspace then
    perform pg_advisory_xact_lock(hashtext('ai_call_admit:workspace'), hashtext(target_workspace::text));
  end if;

  select count(*), min(started_at) into n, oldest
  from app_private.ai_call_starts where user_id = target_person and started_at > since;
  if n >= per_person then
    return jsonb_build_object('admitted', false, 'scope', 'person',
      'retry_after', greatest(1, ceil(extract(epoch from (oldest + make_interval(secs => window_seconds) - now()))))::int);
  end if;

  if count_workspace then
    select count(*), min(started_at) into n, oldest
    from app_private.ai_call_starts where workspace_id = target_workspace and started_at > since;
    if n >= per_workspace then
      return jsonb_build_object('admitted', false, 'scope', 'workspace',
        'retry_after', greatest(1, ceil(extract(epoch from (oldest + make_interval(secs => window_seconds) - now()))))::int);
    end if;
  end if;

  insert into app_private.ai_call_starts (workspace_id, user_id) values (target_workspace, target_person);
  delete from app_private.ai_call_starts
  where (workspace_id = target_workspace or user_id = target_person) and started_at < now() - interval '1 hour';
  return jsonb_build_object('admitted', true);
end $$;

revoke all on function public.ai_call_admit(uuid, uuid, int, int, boolean, int) from public, anon, authenticated;
grant execute on function public.ai_call_admit(uuid, uuid, int, int, boolean, int) to service_role;
