-- Behaviour checks for document settings. Rolls back; success ends with the error
-- "ALL_TESTS_PASSED (3 groups)"; any other error names the failed check.

do $test$
declare
  admin_u uuid := gen_random_uuid();
  editor_u uuid := gen_random_uuid();
  outsider_u uuid := gen_random_uuid();
  ws uuid; n int; passed int := 0;
begin
  insert into auth.users (id, email) values
    (admin_u, 'a-' || admin_u || '@example.test'), (editor_u, 'e-' || editor_u || '@example.test'), (outsider_u, 'o-' || outsider_u || '@example.test');
  perform set_config('request.jwt.claims', json_build_object('sub', admin_u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  ws := (public.create_organization('Settings test', 'AP') ->> 'workspaceId')::uuid;
  execute 'reset role';
  insert into public.workspace_members (workspace_id, user_id, role, can_approve) values (ws, editor_u, 'editor', false);

  -- 1. An admin sets and changes the settings.
  perform set_config('request.jwt.claims', json_build_object('sub', admin_u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into public.document_settings (workspace_id, settings) values (ws, '{"organisation": "Acme"}');
  update public.document_settings set settings = '{"organisation": "Acme Corp"}', updated_at = now() where workspace_id = ws;
  select count(*) into n from public.document_settings where workspace_id = ws and settings ->> 'organisation' = 'Acme Corp';
  if n <> 1 then raise exception 'FAILED 1: admin could not set document settings'; end if;
  execute 'reset role';
  passed := passed + 1;

  -- 2. An editor reads them but cannot change them.
  perform set_config('request.jwt.claims', json_build_object('sub', editor_u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.document_settings where workspace_id = ws;
  if n <> 1 then raise exception 'FAILED 2a: editor cannot read settings'; end if;
  update public.document_settings set settings = '{"organisation": "Changed"}', updated_by = editor_u where workspace_id = ws;
  execute 'reset role';
  select count(*) into n from public.document_settings where workspace_id = ws and settings ->> 'organisation' = 'Acme Corp';
  if n <> 1 then raise exception 'FAILED 2b: editor changed settings'; end if;
  passed := passed + 1;

  -- 3. Someone outside the workspace sees nothing and cannot write.
  perform set_config('request.jwt.claims', json_build_object('sub', outsider_u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.document_settings where workspace_id = ws;
  if n <> 0 then raise exception 'FAILED 3a: outsider read settings'; end if;
  begin
    insert into public.document_settings (workspace_id, settings) values (gen_random_uuid(), '{}');
    raise exception 'FAILED 3b: outsider inserted settings';
  exception when insufficient_privilege or foreign_key_violation then null;
  end;
  execute 'reset role';
  passed := passed + 1;

  raise exception 'ALL_TESTS_PASSED (% groups)', passed;
end
$test$;
