-- Behaviour checks for the people named on a process. Rolls back; success ends with the error
-- "ALL_TESTS_PASSED (4 groups)"; any other error names the failed check.

do $test$
declare
  admin_u uuid := gen_random_uuid();
  ba_u uuid := gen_random_uuid();
  viewer_u uuid := gen_random_uuid();
  outsider_u uuid := gen_random_uuid();
  ws uuid; proc uuid; n int; passed int := 0;
begin
  insert into auth.users (id, email) values
    (admin_u, 'a-' || admin_u || '@example.test'), (ba_u, 'b-' || ba_u || '@example.test'),
    (viewer_u, 'v-' || viewer_u || '@example.test'), (outsider_u, 'o-' || outsider_u || '@example.test');
  perform set_config('request.jwt.claims', json_build_object('sub', admin_u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  ws := (public.create_organization('Process people test', 'AP') ->> 'workspaceId')::uuid;
  perform public.invite_member(ws, 'b-' || ba_u || '@example.test', 'editor', 'business_analyst', false);
  perform public.invite_member(ws, 'v-' || viewer_u || '@example.test', 'viewer');
  insert into public.processes (workspace_id, name) values (ws, 'Vendor invoices') returning id into proc;

  -- 1. An editor names the analyst, architect and approver from the workspace's members.
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', ba_u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  update public.processes set analyst_id = ba_u, architect_id = admin_u, approver_id = admin_u where id = proc;
  select count(*) into n from public.processes where id = proc and analyst_id = ba_u and architect_id = admin_u and approver_id = admin_u;
  if n <> 1 then raise exception 'FAILED 1: names not saved'; end if;
  passed := passed + 1;

  -- 2. Someone outside the workspace cannot be named.
  begin update public.processes set analyst_id = outsider_u where id = proc; raise exception 'FAILED 2: named an outsider';
  exception when check_violation then null; end;
  passed := passed + 1;

  -- 3. A viewer cannot change the names.
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', viewer_u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  update public.processes set analyst_id = null where id = proc;
  execute 'reset role';
  select count(*) into n from public.processes where id = proc and analyst_id = ba_u;
  if n <> 1 then raise exception 'FAILED 3: a viewer changed the names'; end if;
  passed := passed + 1;

  -- 4. Removing a person clears their names.
  perform set_config('request.jwt.claims', json_build_object('sub', admin_u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.remove_member(ws, ba_u);
  execute 'reset role';
  select count(*) into n from public.processes where id = proc and analyst_id is null and architect_id = admin_u;
  if n <> 1 then raise exception 'FAILED 4: removed member still named'; end if;
  passed := passed + 1;

  raise exception 'ALL_TESTS_PASSED (% groups)', passed;
end $test$;
