-- The limit on starting readings (plan (a) of claude/reading-limit-email-link-and-screens-plans-26-nov.md,
-- approved by the owner on 26 November 2026). Additive only: one index and one new function; nothing the
-- released site or the released server functions use changes, so they keep working until the release, when
-- journey-extract starts calling it.
--
-- journey-extract's `create` keeps every check it makes today (sign-in, the editor role, the sources, the size,
-- the key, the allowance), then calls `extraction_start` instead of writing the run itself. The function holds
-- both rules and writes the run in one step:
--   1. one reading at a time per process: a reading of the process that is not done or failed and changed
--      within `stall_seconds` (journey-extract passes STALL_MS, after which a run counts as stopped from outside
--      and is ended at its next look) refuses the start, and the answer names it, so the page follows it;
--   2. at most `per_person_hour` readings an hour per person, in any workspace, counted over the last 60 minutes
--      from the runs themselves (`created_by`, `created_at`), whether each then succeeded or failed. The answer
--      says how many seconds until the oldest counted start leaves the hour.
-- Only process readings count; the extraction check's runs (kind 'eval') are made in SQL and never come here.
--
-- Two starts at the same moment: the function takes a lock on the person, then on the process, always in that
-- order, for the rest of its transaction, so the second waits for the first's run to be written and is then
-- refused by it. The locks are held for milliseconds.
--
-- Only the service role may call it, as with ai_call_admit. To undo: drop the function and the index.

create index extraction_runs_created_by_idx on public.extraction_runs (created_by, created_at);

create function public.extraction_start(
  target_workspace uuid,
  target_process uuid,
  target_person uuid,
  run_token_hash text,
  run_input jsonb,
  per_person_hour int,
  stall_seconds int
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  open_run uuid;
  n int;
  oldest timestamptz;
  new_run uuid;
begin
  if target_workspace is null or target_process is null or target_person is null or run_token_hash is null or run_input is null then
    raise exception 'extraction_start needs a workspace, a process, a person, a token hash and the input' using errcode = 'invalid_parameter_value';
  end if;
  if per_person_hour is null or per_person_hour < 1 or per_person_hour > 100 or stall_seconds is null or stall_seconds < 60 or stall_seconds > 3600 then
    raise exception 'extraction_start needs a limit of 1 to 100 an hour and a stall time of 60 to 3600 seconds' using errcode = 'invalid_parameter_value';
  end if;
  if not exists (select 1 from public.processes where id = target_process and workspace_id = target_workspace) then
    raise exception 'NOT_FOUND: process' using errcode = 'PT404';
  end if;

  -- Person first, then process: every caller takes them in this order, so two starts never wait on each other.
  perform pg_advisory_xact_lock(hashtext('extraction_start:person'), hashtext(target_person::text));
  perform pg_advisory_xact_lock(hashtext('extraction_start:process'), hashtext(target_process::text));

  select r.id into open_run from public.extraction_runs r
   where r.kind = 'process' and r.process_id = target_process and r.status not in ('done', 'failed')
     and r.updated_at > now() - make_interval(secs => stall_seconds)
   order by r.created_at desc limit 1;
  if open_run is not null then
    return jsonb_build_object('admitted', false, 'reason', 'in_progress', 'run_id', open_run);
  end if;

  select count(*), min(r.created_at) into n, oldest from public.extraction_runs r
   where r.kind = 'process' and r.created_by = target_person and r.created_at > now() - interval '1 hour';
  if n >= per_person_hour then
    return jsonb_build_object('admitted', false, 'reason', 'per_hour',
      'retry_after', greatest(1, ceil(extract(epoch from (oldest + interval '1 hour' - now()))))::int);
  end if;

  insert into public.extraction_runs (kind, workspace_id, process_id, created_by, token_hash, input)
  values ('process', target_workspace, target_process, target_person, run_token_hash, run_input)
  returning id into new_run;
  return jsonb_build_object('admitted', true, 'run_id', new_run);
end $$;

revoke all on function public.extraction_start(uuid, uuid, uuid, text, jsonb, int, int) from public, anon, authenticated;
grant execute on function public.extraction_start(uuid, uuid, uuid, text, jsonb, int, int) to service_role;
