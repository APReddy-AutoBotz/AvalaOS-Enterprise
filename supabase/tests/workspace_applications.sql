-- The workspace's applications list. Rolls back; success ends with the error
-- "ALL_TESTS_PASSED (4 groups)"; any other error names the failed check.
do $test$
declare
  ana uuid := gen_random_uuid();   -- admin
  ben uuid := gen_random_uuid();   -- editor
  cara uuid := gen_random_uuid();  -- viewer
  dan uuid := gen_random_uuid();   -- outside the workspace
  ws uuid; ws2 uuid; app uuid; n int; ok boolean; who uuid; passed int := 0;
begin
  insert into auth.users (id, email, invited_at, email_confirmed_at) values
    (ana, 'ana-' || ana || '@example.test', now(), now()), (ben, 'ben-' || ben || '@example.test', now(), now()),
    (cara, 'cara-' || cara || '@example.test', now(), now()), (dan, 'dan-' || dan || '@example.test', now(), now());
  delete from app_private.platform_owners;
  perform set_config('request.jwt.claims', json_build_object('sub', ana, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  ws := (public.create_organization('Apps test', 'Finance') ->> 'workspaceId')::uuid;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', dan, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  ws2 := (public.create_organization('Other client', 'Finance') ->> 'workspaceId')::uuid;
  execute 'reset role';
  insert into public.workspace_members (workspace_id, user_id, role, can_approve) values (ws, ben, 'editor', false), (ws, cara, 'viewer', false);

  -- 1. An editor adds and changes an application; the writer is recorded, not taken from the request.
  perform set_config('request.jwt.claims', json_build_object('sub', ben, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into public.workspace_applications (workspace_id, name, aliases, kind, access, ui_allowed, updated_by)
    values (ws, '  SAP S/4HANA ', array['SAP', 'S4'], 'erp', '[{"method":"api","name":"API_SUPPLIERINVOICE_PROCESS_SRV","operations":["post invoice"],"access":"confirmed"}]', false, ana)
    returning id, updated_by into app, who;
  if who <> ben then raise exception 'FAILED 1a: writer taken from the request'; end if;
  select count(*) into n from public.workspace_applications where id = app and name = 'SAP S/4HANA';
  if n <> 1 then raise exception 'FAILED 1b: name not trimmed'; end if;
  update public.workspace_applications set remote = true, workspace_id = ws2 where id = app;
  select count(*) into n from public.workspace_applications where id = app and workspace_id = ws and remote;
  if n <> 1 then raise exception 'FAILED 1c: the row left its workspace or the change was lost'; end if;
  execute 'reset role';
  passed := passed + 1;

  -- 2. One name per workspace, ignoring case and spaces; bad values are refused.
  perform set_config('request.jwt.claims', json_build_object('sub', ben, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  ok := false;
  begin insert into public.workspace_applications (workspace_id, name) values (ws, 'sap s/4hana'); exception when unique_violation then ok := true; end;
  if not ok then raise exception 'FAILED 2a: duplicate name accepted'; end if;
  ok := false;
  begin insert into public.workspace_applications (workspace_id, name, kind) values (ws, 'Excel', 'database'); exception when check_violation then ok := true; end;
  if not ok then raise exception 'FAILED 2b: unknown kind accepted'; end if;
  ok := false;
  begin insert into public.workspace_applications (workspace_id, name, aliases) values (ws, 'Excel', array['  ']); exception when check_violation then ok := true; end;
  if not ok then raise exception 'FAILED 2c: empty other name accepted'; end if;
  ok := false;
  begin insert into public.workspace_applications (workspace_id, name, access) values (ws, 'Excel', '{"method":"file"}'); exception when check_violation then ok := true; end;
  if not ok then raise exception 'FAILED 2d: access that is not a list accepted'; end if;
  execute 'reset role';
  passed := passed + 1;

  -- 3. A viewer reads but cannot write or delete; someone outside sees nothing.
  perform set_config('request.jwt.claims', json_build_object('sub', cara, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.workspace_applications where workspace_id = ws;
  if n <> 1 then raise exception 'FAILED 3a: viewer cannot read'; end if;
  ok := false;
  begin insert into public.workspace_applications (workspace_id, name) values (ws, 'Excel'); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAILED 3b: viewer added an application'; end if;
  update public.workspace_applications set notes = 'x' where id = app;
  delete from public.workspace_applications where id = app;
  execute 'reset role';
  select count(*) into n from public.workspace_applications where id = app and notes = '';
  if n <> 1 then raise exception 'FAILED 3c: viewer changed or deleted it'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', dan, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.workspace_applications where workspace_id = ws;
  if n <> 0 then raise exception 'FAILED 3d: outsider reads another workspace'; end if;
  ok := false;
  begin insert into public.workspace_applications (workspace_id, name) values (ws, 'Excel'); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAILED 3e: outsider added to another workspace'; end if;
  -- The same name in another workspace is fine: each client has its own list.
  insert into public.workspace_applications (workspace_id, name) values (ws2, 'SAP S/4HANA');
  execute 'reset role';
  passed := passed + 1;

  -- 4. An editor deletes; anonymous callers have no access at all.
  perform set_config('request.jwt.claims', json_build_object('sub', ben, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  delete from public.workspace_applications where id = app;
  select count(*) into n from public.workspace_applications where id = app;
  if n <> 0 then raise exception 'FAILED 4a: editor could not delete'; end if;
  execute 'reset role';
  execute 'set local role anon';
  ok := false;
  begin perform 1 from public.workspace_applications; exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAILED 4b: anonymous access'; end if;
  execute 'reset role';
  passed := passed + 1;

  raise exception 'ALL_TESTS_PASSED (% groups)', passed;
end $test$;
