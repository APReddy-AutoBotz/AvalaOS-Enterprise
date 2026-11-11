-- Behaviour checks for process sources (WP1.7). Rolls back; success ends with the error
-- "ALL_TESTS_PASSED (4 groups)"; any other error names the failed check.

do $test$
declare
  admin_u uuid := gen_random_uuid();
  viewer_u uuid := gen_random_uuid();
  outsider_u uuid := gen_random_uuid();
  ws uuid; ws2 uuid; p uuid; p2 uuid; s uuid; n int; passed int := 0;
  segs jsonb := '[{"id":"sop:1","sourceId":"sop","kind":"paragraph","text":"Check mandatory fields.","locator":{"section":"6.2"}}]';
begin
  insert into auth.users (id, email) values
    (admin_u, 'a-' || admin_u || '@example.test'), (viewer_u, 'v-' || viewer_u || '@example.test'), (outsider_u, 'o-' || outsider_u || '@example.test');

  perform set_config('request.jwt.claims', json_build_object('sub', admin_u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  ws := (public.create_organization('Sources test', 'AP') ->> 'workspaceId')::uuid;
  insert into public.processes (workspace_id, name) values (ws, 'Invoices') returning id into p;
  execute 'reset role';
  insert into public.workspace_members (workspace_id, user_id, role, can_approve) values (ws, viewer_u, 'viewer', false);
  perform set_config('request.jwt.claims', json_build_object('sub', outsider_u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  ws2 := (public.create_organization('Other', 'X') ->> 'workspaceId')::uuid;
  insert into public.processes (workspace_id, name) values (ws2, 'Theirs') returning id into p2;
  execute 'reset role';

  -- 1. An editor adds a source; keys are unique per process.
  perform set_config('request.jwt.claims', json_build_object('sub', admin_u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into public.process_sources (workspace_id, process_id, source_key, title, format, segments)
    values (ws, p, 'sop', 'SOP', 'docx', segs) returning id into s;
  begin
    insert into public.process_sources (workspace_id, process_id, source_key, title, format, segments) values (ws, p, 'sop', 'Again', 'docx', segs);
    raise exception 'TEST FAIL 1: duplicate key accepted';
  exception when unique_violation then null;
  end;
  -- A source cannot claim another workspace's process.
  begin
    insert into public.process_sources (workspace_id, process_id, source_key, title, format, segments) values (ws, p2, 'x', 'X', 'txt', segs);
    raise exception 'TEST FAIL 1b: process from another workspace accepted';
  exception when foreign_key_violation then null;
  end;
  passed := passed + 1;

  -- 2. Content cannot change; title and archiving can.
  update public.process_sources set title = 'SOP FIN-AP-004', archived_at = now() where id = s;
  begin
    update public.process_sources set segments = '[]' where id = s;
    raise exception 'TEST FAIL 2: segments changed';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.process_sources where id = s;
    raise exception 'TEST FAIL 2b: deleted';
  exception when insufficient_privilege then null;
  end;
  execute 'reset role';
  passed := passed + 1;

  -- 3. A viewer reads but cannot add.
  perform set_config('request.jwt.claims', json_build_object('sub', viewer_u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.process_sources where process_id = p;
  if n <> 1 then raise exception 'TEST FAIL 3: viewer sees % sources', n; end if;
  begin
    insert into public.process_sources (workspace_id, process_id, source_key, title, format, segments, created_by) values (ws, p, 'v', 'V', 'txt', segs, viewer_u);
    raise exception 'TEST FAIL 3b: viewer inserted';
  exception when insufficient_privilege then null;
  end;
  execute 'reset role';
  passed := passed + 1;

  -- 4. An outsider sees nothing and cannot add to the process.
  perform set_config('request.jwt.claims', json_build_object('sub', outsider_u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.process_sources where process_id = p;
  if n <> 0 then raise exception 'TEST FAIL 4: outsider sees % sources', n; end if;
  begin
    insert into public.process_sources (workspace_id, process_id, source_key, title, format, segments) values (ws, p, 'o', 'O', 'txt', segs);
    raise exception 'TEST FAIL 4b: outsider inserted';
  exception when insufficient_privilege then null;
  end;
  execute 'reset role';
  passed := passed + 1;

  raise exception 'ALL_TESTS_PASSED (% groups)', passed;
end
$test$;
