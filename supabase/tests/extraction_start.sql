-- Behaviour checks for the limit on starting readings (migration extraction_start_limit). Rolls back: success
-- ends with the error "ALL_TESTS_PASSED (7 groups)"; any other error names the failed check. It creates its own
-- people, organisation and processes, and writes runs only for them. Run it after the migration, in the same
-- transaction as the trial does, or against a database where the migration is applied.

create function pg_temp.start(ws uuid, p uuid, who uuid, per_hour int default 6) returns jsonb language sql as $$
  select public.extraction_start(ws, p, who, encode(sha256(convert_to(gen_random_uuid()::text, 'UTF8')), 'hex'),
    jsonb_build_object('processName', 'Test', 'sources', '[]'::jsonb), per_hour, 420)
$$;
-- A run written directly, as journey-extract's stages leave it: its state, when it started and when it last moved.
create function pg_temp.run(ws uuid, p uuid, who uuid, run_status text, started interval, moved interval) returns uuid language sql as $$
  insert into public.extraction_runs (kind, workspace_id, process_id, created_by, token_hash, status, created_at, updated_at)
  values ('process', ws, p, who, encode(sha256(convert_to(gen_random_uuid()::text, 'UTF8')), 'hex'), run_status, now() - started, now() - moved)
  returning id
$$;

do $test$
declare
  ana uuid := gen_random_uuid();
  ben uuid := gen_random_uuid();
  ws uuid; ws2 uuid; p1 uuid; p2 uuid; p3 uuid; p4 uuid; px uuid;
  r jsonb; first_run uuid; old_run uuid; n int; i int; passed int := 0; msg text;
begin
  insert into auth.users (id, email, invited_at, email_confirmed_at) values
    (ana, 'a-' || ana || '@example.test', now(), now()), (ben, 'b-' || ben || '@example.test', now(), now());
  delete from app_private.platform_owners;
  perform set_config('request.jwt.claims', json_build_object('sub', ana, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  ws := (public.create_organization('Reading limit test', 'AP') ->> 'workspaceId')::uuid;
  insert into public.processes (workspace_id, name) values (ws, 'One') returning id into p1;
  insert into public.processes (workspace_id, name) values (ws, 'Two') returning id into p2;
  insert into public.processes (workspace_id, name) values (ws, 'Three') returning id into p3;
  insert into public.processes (workspace_id, name) values (ws, 'Four') returning id into p4;
  perform set_config('request.jwt.claims', json_build_object('sub', ben, 'role', 'authenticated')::text, true);
  ws2 := (public.create_organization('Other test', 'X') ->> 'workspaceId')::uuid;
  insert into public.processes (workspace_id, name) values (ws2, 'Elsewhere') returning id into px;
  execute 'reset role';

  -- 1. A start is admitted and writes the run: a process reading by that person, queued, with the input given.
  r := pg_temp.start(ws, p1, ana);
  if (r ->> 'admitted')::boolean is not true or r ->> 'run_id' is null then raise exception 'FAILED 1a: %', r; end if;
  first_run := (r ->> 'run_id')::uuid;
  select count(*) into n from public.extraction_runs
   where id = first_run and kind = 'process' and workspace_id = ws and process_id = p1 and created_by = ana and status = 'queued'
     and token_hash ~ '^[0-9a-f]{64}$' and input ->> 'processName' = 'Test';
  if n <> 1 then raise exception 'FAILED 1b: the run was not written as asked'; end if;
  passed := passed + 1;

  -- 2. One at a time per process: a second start while it is under way is refused, names the reading under way,
  --    and writes nothing, whoever asks.
  r := pg_temp.start(ws, p1, ana);
  if r <> jsonb_build_object('admitted', false, 'reason', 'in_progress', 'run_id', first_run) then raise exception 'FAILED 2a: %', r; end if;
  r := pg_temp.start(ws, p1, ben);
  if r ->> 'reason' is distinct from 'in_progress' or (r ->> 'run_id')::uuid <> first_run then raise exception 'FAILED 2b: %', r; end if;
  if (select count(*) from public.extraction_runs where process_id = p1) <> 1 then raise exception 'FAILED 2c: a refused start wrote a run'; end if;
  -- Another process of the same person is not held back by it.
  r := pg_temp.start(ws, p2, ana);
  if (r ->> 'admitted')::boolean is not true then raise exception 'FAILED 2d: %', r; end if;
  passed := passed + 1;

  -- 3. What does not block: a reading done, one failed, and one stopped from outside (not moved for longer than
  --    the stall time, 420 seconds here). A reading that moved just now still blocks.
  perform pg_temp.run(ws, p3, ben, 'done', interval '20 minutes', interval '18 minutes');
  perform pg_temp.run(ws, p3, ben, 'failed', interval '15 minutes', interval '14 minutes');
  old_run := pg_temp.run(ws, p3, ben, 'merging', interval '12 minutes', interval '8 minutes');
  r := pg_temp.start(ws, p3, ana);
  if (r ->> 'admitted')::boolean is not true then raise exception 'FAILED 3a: %', r; end if;
  old_run := pg_temp.run(ws, p4, ben, 'reviewing', interval '12 minutes', interval '6 minutes');
  r := pg_temp.start(ws, p4, ana);
  if r ->> 'reason' is distinct from 'in_progress' or (r ->> 'run_id')::uuid <> old_run then raise exception 'FAILED 3b: %', r; end if;
  passed := passed + 1;

  -- 4. Six an hour per person, in any workspace, counted from the runs themselves, done or failed alike: Ana has
  --    started three (groups 1 to 3); with three more written for her, the seventh is refused with the seconds
  --    until the oldest counted start leaves the hour, and writes nothing. A start 61 minutes ago does not count.
  perform pg_temp.run(ws2, px, ana, 'failed', interval '61 minutes', interval '60 minutes');
  perform pg_temp.run(ws2, px, ana, 'done', interval '50 minutes', interval '48 minutes');
  perform pg_temp.run(ws, p4, ana, 'failed', interval '40 minutes', interval '39 minutes');
  perform pg_temp.run(ws, p4, ana, 'done', interval '30 minutes', interval '28 minutes');
  update public.extraction_runs set status = 'done' where process_id = p1;
  select count(*) into n from public.extraction_runs where kind = 'process' and created_by = ana and created_at > now() - interval '1 hour';
  if n <> 6 then raise exception 'FAILED 4a: % counted, not 6', n; end if;
  select count(*) into n from public.extraction_runs;
  r := pg_temp.start(ws, p1, ana);
  if r ->> 'reason' is distinct from 'per_hour' or (r ->> 'retry_after')::int <> ceil(extract(epoch from interval '10 minutes'))::int then
    raise exception 'FAILED 4b: %', r;
  end if;
  if (select count(*) from public.extraction_runs) <> n then raise exception 'FAILED 4c: a refused start wrote a run'; end if;
  -- Ben is not held back by Ana's hour; with a limit of 7 Ana is admitted.
  r := pg_temp.start(ws, p1, ben);
  if (r ->> 'admitted')::boolean is not true then raise exception 'FAILED 4d: %', r; end if;
  update public.extraction_runs set status = 'done' where id = (r ->> 'run_id')::uuid;
  r := pg_temp.start(ws, p1, ana, 7);
  if (r ->> 'admitted')::boolean is not true then raise exception 'FAILED 4e: %', r; end if;
  passed := passed + 1;

  -- 5. The extraction check's runs (kind eval) are not counted and do not block.
  for i in 1 .. 8 loop
    insert into public.extraction_runs (kind, case_id, created_by, token_hash) values ('eval', 'ap-invoice', ben, encode(sha256(convert_to(i::text, 'UTF8')), 'hex'));
  end loop;
  r := pg_temp.start(ws, p2, ben);
  if r ->> 'reason' is distinct from 'in_progress' then raise exception 'FAILED 5a: %', r; end if;
  update public.extraction_runs set status = 'done' where kind = 'process' and process_id = p2;
  r := pg_temp.start(ws, p2, ben);
  if (r ->> 'admitted')::boolean is not true then raise exception 'FAILED 5b: %', r; end if;
  passed := passed + 1;

  -- 6. Only the service role may call it.
  if has_function_privilege('anon', 'public.extraction_start(uuid,uuid,uuid,text,jsonb,int,int)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.extraction_start(uuid,uuid,uuid,text,jsonb,int,int)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.extraction_start(uuid,uuid,uuid,text,jsonb,int,int)', 'EXECUTE') then
    raise exception 'FAILED 6a: who may call extraction_start';
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', ana, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin perform pg_temp.start(ws, p3, ana); raise exception 'FAILED 6b: a signed-in person called it'; exception when insufficient_privilege then null; end;
  execute 'reset role';
  passed := passed + 1;

  -- 7. Bad arguments are refused before anything is locked or written: a process of another workspace, a limit
  --    out of range, a missing person.
  select count(*) into n from public.extraction_runs;
  begin perform pg_temp.start(ws, px, ana); raise exception 'FAILED 7a'; exception when sqlstate 'PT404' then get stacked diagnostics msg = message_text; end;
  if msg <> 'NOT_FOUND: process' then raise exception 'FAILED 7a: %', msg; end if;
  begin perform pg_temp.start(ws, p3, ana, 0); raise exception 'FAILED 7b'; exception when invalid_parameter_value then null; end;
  begin perform public.extraction_start(ws, p3, ana, encode(sha256('x'), 'hex'), '{}', 6, 30); raise exception 'FAILED 7c'; exception when invalid_parameter_value then null; end;
  begin perform pg_temp.start(ws, p3, null); raise exception 'FAILED 7d'; exception when invalid_parameter_value then null; end;
  if (select count(*) from public.extraction_runs) <> n then raise exception 'FAILED 7e: a refused start wrote a run'; end if;
  passed := passed + 1;

  raise exception 'ALL_TESTS_PASSED (% groups)', passed;
end $test$;
