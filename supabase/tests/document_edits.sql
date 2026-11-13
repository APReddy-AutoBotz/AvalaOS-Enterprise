-- Behaviour checks for document edits (WP3.4). Rolls back; success ends with the error
-- "ALL_TESTS_PASSED (3 groups)"; any other error names the failed check.

do $test$
declare
  admin_u uuid := gen_random_uuid();
  viewer_u uuid := gen_random_uuid();
  outsider_u uuid := gen_random_uuid();
  ws uuid; ws2 uuid; p uuid; p2 uuid; n int; passed int := 0;
begin
  insert into auth.users (id, email, invited_at, email_confirmed_at) values
    (admin_u, 'a-' || admin_u || '@example.test', now(), now()), (viewer_u, 'v-' || viewer_u || '@example.test', now(), now()), (outsider_u, 'o-' || outsider_u || '@example.test', now(), now());
  -- Organizations are the platform owner's to create; with no owner listed, as in a new deployment, the test user may.
  delete from app_private.platform_owners;
  perform set_config('request.jwt.claims', json_build_object('sub', admin_u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  ws := (public.create_organization('Edits test', 'AP') ->> 'workspaceId')::uuid;
  insert into public.processes (workspace_id, name) values (ws, 'Invoices') returning id into p;
  execute 'reset role';
  insert into public.workspace_members (workspace_id, user_id, role, can_approve) values (ws, viewer_u, 'viewer', false);
  perform set_config('request.jwt.claims', json_build_object('sub', outsider_u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  ws2 := (public.create_organization('Other', 'X') ->> 'workspaceId')::uuid;
  insert into public.processes (workspace_id, name) values (ws2, 'Theirs') returning id into p2;
  execute 'reset role';

  -- 1. An editor saves, changes and removes an edit; one edit per section.
  perform set_config('request.jwt.claims', json_build_object('sub', admin_u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into public.document_edits (workspace_id, process_id, doc_type, section_key, html, base_hash) values (ws, p, 'pdd', 's-1-1', '<p>Mine</p>', 'abc');
  update public.document_edits set html = '<p>Mine again</p>', updated_at = now() where process_id = p and section_key = 's-1-1';
  begin
    insert into public.document_edits (workspace_id, process_id, doc_type, section_key, html, base_hash) values (ws, p, 'pdd', 's-1-1', '<p>Twice</p>', 'abc');
    raise exception 'FAILED 1a: two edits for one section';
  exception when unique_violation then null;
  end;
  delete from public.document_edits where process_id = p and section_key = 's-1-1';
  select count(*) into n from public.document_edits where process_id = p;
  if n <> 0 then raise exception 'FAILED 1b: edit not removed'; end if;
  insert into public.document_edits (workspace_id, process_id, doc_type, section_key, html, base_hash) values (ws, p, 'brd', 's-2', '<p>Context</p>', 'def');
  execute 'reset role';
  passed := passed + 1;

  -- 2. A viewer reads but cannot write or remove.
  perform set_config('request.jwt.claims', json_build_object('sub', viewer_u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.document_edits where process_id = p;
  if n <> 1 then raise exception 'FAILED 2a: viewer cannot read edits'; end if;
  delete from public.document_edits where process_id = p;
  begin
    insert into public.document_edits (workspace_id, process_id, doc_type, section_key, html, base_hash) values (ws, p, 'pdd', 's-3', '<p>x</p>', 'x');
    raise exception 'FAILED 2b: viewer inserted an edit';
  exception when insufficient_privilege then null;
  end;
  execute 'reset role';
  select count(*) into n from public.document_edits where process_id = p;
  if n <> 1 then raise exception 'FAILED 2c: viewer removed an edit'; end if;
  passed := passed + 1;

  -- 3. Someone outside sees nothing and cannot write into this process.
  perform set_config('request.jwt.claims', json_build_object('sub', outsider_u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.document_edits where process_id = p;
  if n <> 0 then raise exception 'FAILED 3a: outsider read edits'; end if;
  begin
    insert into public.document_edits (workspace_id, process_id, doc_type, section_key, html, base_hash) values (ws, p, 'pdd', 's-4', '<p>x</p>', 'x');
    raise exception 'FAILED 3b: outsider inserted an edit';
  exception when insufficient_privilege then null;
  end;
  execute 'reset role';
  passed := passed + 1;

  raise exception 'ALL_TESTS_PASSED (% groups)', passed;
end
$test$;
