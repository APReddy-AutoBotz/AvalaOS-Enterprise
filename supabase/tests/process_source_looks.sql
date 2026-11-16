-- What was looked up in a process's sources, kept for everyone (package 4 of docs/next-plan.md). Rolls back;
-- success ends with the error "ALL_TESTS_PASSED (5 groups)"; any other error names the failed check.
do $test$
declare
  admin_u uuid := gen_random_uuid();
  editor_u uuid := gen_random_uuid();
  viewer_u uuid := gen_random_uuid();
  outsider_u uuid := gen_random_uuid();
  ws uuid; ws2 uuid; p uuid; p2 uuid; n int; v int; who uuid; passed int := 0;
begin
  insert into auth.users (id, email, invited_at, email_confirmed_at) values
    (admin_u, 'a-' || admin_u || '@example.test', now(), now()), (editor_u, 'e-' || editor_u || '@example.test', now(), now()),
    (viewer_u, 'v-' || viewer_u || '@example.test', now(), now()), (outsider_u, 'o-' || outsider_u || '@example.test', now(), now());
  delete from app_private.platform_owners;
  perform set_config('request.jwt.claims', json_build_object('sub', admin_u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  ws := (public.create_organization('Look test', 'AP') ->> 'workspaceId')::uuid;
  insert into public.processes (workspace_id, name) values (ws, 'Invoices') returning id into p;
  insert into public.processes (workspace_id, name) values (ws, 'Payments') returning id into p2;
  execute 'reset role';
  insert into public.workspace_members (workspace_id, user_id, role, can_approve) values (ws, editor_u, 'editor', false), (ws, viewer_u, 'viewer', false);
  perform set_config('request.jwt.claims', json_build_object('sub', outsider_u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  ws2 := (public.create_organization('Other', 'X') ->> 'workspaceId')::uuid;
  execute 'reset role';

  -- 1. An editor writes a process's look; the database records who and when, and starts at version 1.
  perform set_config('request.jwt.claims', json_build_object('sub', editor_u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into public.process_source_looks (process_id, workspace_id, look, dismissed, version, updated_by)
    values (p, ws, '{"sources":"s1","looked":["q1"],"found":[],"questions":1,"passages":3,"tokens":900,"calls":1}', '[]', 7, admin_u);
  select version, updated_by into v, who from public.process_source_looks where process_id = p;
  if v <> 1 or who is distinct from editor_u then raise exception 'FAILED 1: version % by %', v, who; end if;
  execute 'reset role';
  passed := passed + 1;

  -- 2. A write counts one more version, so a page holding an older copy is refused (it reads again and adds its step).
  perform set_config('request.jwt.claims', json_build_object('sub', admin_u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  update public.process_source_looks set look = look || '{"calls":2}', version = 1 where process_id = p and version = 1;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAILED 2a: a write on the current version was refused'; end if;
  update public.process_source_looks set dismissed = '["answer:q1:x"]' where process_id = p and version = 1;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAILED 2b: a write on an older version went through'; end if;
  select version, updated_by into v, who from public.process_source_looks where process_id = p;
  if v <> 2 or who is distinct from admin_u then raise exception 'FAILED 2c: version % by %', v, who; end if;
  begin
    insert into public.process_source_looks (process_id, workspace_id) values (p, ws);
    raise exception 'FAILED 2d: a second row for one process';
  exception when unique_violation then null;
  end;
  execute 'reset role';
  passed := passed + 1;

  -- 3. A viewer reads the look but cannot write it.
  perform set_config('request.jwt.claims', json_build_object('sub', viewer_u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.process_source_looks where process_id = p and look ->> 'calls' = '2';
  if n <> 1 then raise exception 'FAILED 3a: a viewer cannot read the look'; end if;
  update public.process_source_looks set dismissed = '["x"]' where process_id = p;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAILED 3b: a viewer changed the look'; end if;
  begin
    insert into public.process_source_looks (process_id, workspace_id) values (p2, ws);
    raise exception 'FAILED 3c: a viewer added a look';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.process_source_looks where process_id = p;
    raise exception 'FAILED 3d: a look was deleted by hand';
  exception when insufficient_privilege then null;
  end;
  execute 'reset role';
  passed := passed + 1;

  -- 4. Another workspace sees nothing and cannot write a look onto this workspace's process.
  perform set_config('request.jwt.claims', json_build_object('sub', outsider_u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.process_source_looks;
  if n <> 0 then raise exception 'FAILED 4a: another workspace reads a look'; end if;
  begin
    insert into public.process_source_looks (process_id, workspace_id) values (p2, ws);
    raise exception 'FAILED 4b: another workspace added a look';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.process_source_looks (process_id, workspace_id) values (p2, ws2);
    raise exception 'FAILED 4c: a look was filed under another workspace';
  exception when foreign_key_violation then null;
  end;
  execute 'reset role';
  passed := passed + 1;

  -- 5. The look goes with its process.
  delete from public.processes where id = p;
  select count(*) into n from public.process_source_looks where process_id = p;
  if n <> 0 then raise exception 'FAILED 5: the look outlived its process'; end if;
  passed := passed + 1;

  raise exception 'ALL_TESTS_PASSED (% groups)', passed;
end $test$;
