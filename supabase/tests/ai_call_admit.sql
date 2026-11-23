-- The per-minute AI limit (migration ai_call_admit). Rolls back; success ends with the error
-- "ALL_TESTS_PASSED (8 groups)"; any other error names the failed check.
do $test$
declare
  a_u uuid := gen_random_uuid();
  b_u uuid := gen_random_uuid();
  c_u uuid := gen_random_uuid();
  d_u uuid := gen_random_uuid();
  ws uuid; ws2 uuid; r jsonb; n int; passed int := 0; failed boolean;
begin
  insert into auth.users (id, email, invited_at, email_confirmed_at) values
    (a_u, 'a-' || a_u || '@example.test', now(), now()), (b_u, 'b-' || b_u || '@example.test', now(), now()),
    (c_u, 'c-' || c_u || '@example.test', now(), now()), (d_u, 'd-' || d_u || '@example.test', now(), now());
  delete from app_private.platform_owners;
  perform set_config('request.jwt.claims', json_build_object('sub', a_u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  ws := (public.create_organization('Limit test', 'AP') ->> 'workspaceId')::uuid;
  ws2 := (public.create_organization('Limit test two', 'AP') ->> 'workspaceId')::uuid;
  execute 'reset role';

  -- 1. A person's first 30 calls in a minute are admitted and recorded; the 31st is refused, says it is the
  --    person's limit and when to try again, and is not recorded.
  execute 'set local role service_role';
  for i in 1..30 loop
    r := public.ai_call_admit(ws, a_u, 30, 90, true);
    if (r ->> 'admitted')::boolean is not true then raise exception 'FAILED 1a: call % refused: %', i, r; end if;
  end loop;
  r := public.ai_call_admit(ws, a_u, 30, 90, true);
  execute 'reset role';
  if (r ->> 'admitted')::boolean is not false or r ->> 'scope' <> 'person' then raise exception 'FAILED 1b: the 31st call: %', r; end if;
  if (r ->> 'retry_after')::int not between 1 and 60 then raise exception 'FAILED 1c: retry after %', r ->> 'retry_after'; end if;
  select count(*) into n from app_private.ai_call_starts where user_id = a_u;
  if n <> 30 then raise exception 'FAILED 1d: % starts recorded, not 30', n; end if;
  passed := passed + 1;

  -- 2. Another person in the same workspace is still admitted; the same person in another workspace is not
  --    (the person's limit is across workspaces).
  execute 'set local role service_role';
  r := public.ai_call_admit(ws, b_u, 30, 90, true);
  if (r ->> 'admitted')::boolean is not true then raise exception 'FAILED 2a: another person refused: %', r; end if;
  r := public.ai_call_admit(ws2, a_u, 30, 90, true);
  if (r ->> 'admitted')::boolean is not false or r ->> 'scope' <> 'person' then raise exception 'FAILED 2b: the person in another workspace: %', r; end if;
  execute 'reset role';
  passed := passed + 1;

  -- 3. The workspace's limit refuses at 90 only when it is asked to count the workspace (the platform key);
  --    on a workspace's own key (not asked) the person is admitted.
  insert into app_private.ai_call_starts (workspace_id, user_id) select ws, null from generate_series(1, 59);
  select count(*) into n from app_private.ai_call_starts where workspace_id = ws;
  if n <> 90 then raise exception 'FAILED 3a: % starts in the workspace, not 90', n; end if;
  execute 'set local role service_role';
  r := public.ai_call_admit(ws, c_u, 30, 90, true);
  if (r ->> 'admitted')::boolean is not false or r ->> 'scope' <> 'workspace' or (r ->> 'retry_after')::int not between 1 and 60 then raise exception 'FAILED 3b: the 91st in the workspace: %', r; end if;
  r := public.ai_call_admit(ws, c_u, 30, 90, false);
  if (r ->> 'admitted')::boolean is not true then raise exception 'FAILED 3c: on its own key the workspace limit applied: %', r; end if;
  execute 'reset role';
  passed := passed + 1;

  -- 4. Starts older than the minute are not counted, and the seconds to wait are until the oldest counted
  --    start leaves the minute.
  insert into app_private.ai_call_starts (workspace_id, user_id, started_at) select ws2, d_u, now() - interval '61 seconds' from generate_series(1, 30);
  execute 'set local role service_role';
  r := public.ai_call_admit(ws2, d_u, 30, 90, true);
  execute 'reset role';
  if (r ->> 'admitted')::boolean is not true then raise exception 'FAILED 4a: starts older than a minute counted: %', r; end if;
  delete from app_private.ai_call_starts where user_id = d_u;
  insert into app_private.ai_call_starts (workspace_id, user_id, started_at) select ws2, d_u, now() - interval '50 seconds' from generate_series(1, 30);
  execute 'set local role service_role';
  r := public.ai_call_admit(ws2, d_u, 30, 90, true);
  execute 'reset role';
  if (r ->> 'admitted')::boolean is not false or (r ->> 'retry_after')::int <> 10 then raise exception 'FAILED 4b: expected 10 seconds to wait: %', r; end if;
  passed := passed + 1;

  -- 5. Starts older than an hour are deleted on the next admitted call in that workspace or by that person.
  delete from app_private.ai_call_starts where user_id = d_u;
  insert into app_private.ai_call_starts (workspace_id, user_id, started_at) values
    (ws2, null, now() - interval '2 hours'), (ws, d_u, now() - interval '2 hours'), (ws2, null, now() - interval '30 minutes');
  execute 'set local role service_role';
  r := public.ai_call_admit(ws2, d_u, 30, 90, true);
  execute 'reset role';
  select count(*) into n from app_private.ai_call_starts where started_at < now() - interval '1 hour' and (workspace_id = ws2 or user_id = d_u);
  if n <> 0 then raise exception 'FAILED 5a: % starts older than an hour kept', n; end if;
  select count(*) into n from app_private.ai_call_starts where workspace_id = ws2 and started_at = now() - interval '30 minutes';
  if n <> 1 then raise exception 'FAILED 5b: a start within the hour was deleted'; end if;
  passed := passed + 1;

  -- 6. Only the service role calls the function; the public and signed-in people can neither call it nor read
  --    or write the table.
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  execute 'set local role anon';
  begin perform public.ai_call_admit(ws, a_u, 30, 90, true); raise exception 'FAILED 6a: the public called the function'; exception when insufficient_privilege then null; end;
  begin perform count(*) from app_private.ai_call_starts; raise exception 'FAILED 6b: the public read the table'; exception when insufficient_privilege then null; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', a_u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin perform public.ai_call_admit(ws, a_u, 1000, 1000, false); raise exception 'FAILED 6c: a signed-in person called the function'; exception when insufficient_privilege then null; end;
  begin perform count(*) from app_private.ai_call_starts; raise exception 'FAILED 6d: a signed-in person read the table'; exception when insufficient_privilege then null; end;
  begin delete from app_private.ai_call_starts; raise exception 'FAILED 6e: a signed-in person deleted starts'; exception when insufficient_privilege then null; end;
  execute 'reset role';
  passed := passed + 1;

  -- 7. The function holds the lock on the person and, when it counts the workspace, on the workspace until its
  --    transaction ends, so a second call at the same moment waits for the first to be recorded.
  if not exists (select 1 from pg_locks where locktype = 'advisory' and pid = pg_backend_pid() and granted
                 and classid = hashtext('ai_call_admit:person')::oid and objid = hashtext(d_u::text)::oid and objsubid = 2) then
    raise exception 'FAILED 7a: no lock held on the person';
  end if;
  if not exists (select 1 from pg_locks where locktype = 'advisory' and pid = pg_backend_pid() and granted
                 and classid = hashtext('ai_call_admit:workspace')::oid and objid = hashtext(ws2::text)::oid and objsubid = 2) then
    raise exception 'FAILED 7b: no lock held on the workspace';
  end if;
  passed := passed + 1;

  -- 8. Missing or impossible arguments are refused, not admitted.
  execute 'set local role service_role';
  failed := false;
  begin perform public.ai_call_admit(ws, null, 30, 90, true); exception when invalid_parameter_value then failed := true; end;
  if not failed then raise exception 'FAILED 8a: no person admitted'; end if;
  failed := false;
  begin perform public.ai_call_admit(ws, a_u, 0, 90, true); exception when invalid_parameter_value then failed := true; end;
  if not failed then raise exception 'FAILED 8b: a limit of 0 admitted'; end if;
  execute 'reset role';
  passed := passed + 1;

  raise exception 'ALL_TESTS_PASSED (% groups)', passed;
end $test$;
