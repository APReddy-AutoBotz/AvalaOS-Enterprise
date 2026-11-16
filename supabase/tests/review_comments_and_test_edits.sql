-- Behaviour checks for review comments, testers' edits and agent-document edits (part F). Rolls back;
-- success ends with the error "ALL_TESTS_PASSED (6 groups)"; any other error names the failed check.

do $test$
declare
  admin_u uuid := gen_random_uuid();
  editor_u uuid := gen_random_uuid();
  viewer_u uuid := gen_random_uuid();
  outsider_u uuid := gen_random_uuid();
  ws uuid; ws2 uuid; p uuid; c uuid; c2 uuid; n int; passed int := 0;
  who uuid; t timestamptz;
begin
  insert into auth.users (id, email, invited_at, email_confirmed_at) values
    (admin_u, 'a-' || admin_u || '@example.test', now(), now()), (editor_u, 'e-' || editor_u || '@example.test', now(), now()),
    (viewer_u, 'v-' || viewer_u || '@example.test', now(), now()), (outsider_u, 'o-' || outsider_u || '@example.test', now(), now());
  delete from app_private.platform_owners;
  perform set_config('request.jwt.claims', json_build_object('sub', admin_u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  ws := (public.create_organization('Review test', 'AP') ->> 'workspaceId')::uuid;
  insert into public.processes (workspace_id, name) values (ws, 'Invoices') returning id into p;
  execute 'reset role';
  insert into public.workspace_members (workspace_id, user_id, role, can_approve) values (ws, editor_u, 'editor', false), (ws, viewer_u, 'viewer', true);
  perform set_config('request.jwt.claims', json_build_object('sub', outsider_u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  ws2 := (public.create_organization('Other', 'X') ->> 'workspaceId')::uuid;
  execute 'reset role';

  -- 1. A viewer (a reviewer) comments on a section and edits their own text; it is stamped as edited.
  perform set_config('request.jwt.claims', json_build_object('sub', viewer_u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into public.document_comments (workspace_id, process_id, doc_type, section_key, section_title, body)
    values (ws, p, 'pdd', 's-2-4', 'Detailed As-Is steps', 'Step 4 misses the call-back.') returning id into c;
  update public.document_comments set body = 'Step 4 misses the call-back to the vendor.' where id = c;
  select count(*) into n from public.document_comments where id = c and edited_at is not null and author_id = viewer_u;
  if n <> 1 then raise exception 'FAILED 1a: own comment not edited or not stamped'; end if;
  begin
    insert into public.document_comments (workspace_id, process_id, doc_type, section_key, section_title, body, resolved_at) values (ws, p, 'pdd', 's-1', 'Intro', 'x', now());
    raise exception 'FAILED 1b: a comment was born resolved';
  exception when insufficient_privilege then null;
  end;
  execute 'reset role';
  passed := passed + 1;

  -- 2. An editor resolves it but cannot change its text; the database records who resolved it.
  perform set_config('request.jwt.claims', json_build_object('sub', editor_u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    update public.document_comments set body = 'Changed by someone else' where id = c;
    raise exception 'FAILED 2a: an editor changed someone else''s text';
  exception when insufficient_privilege then null;
  end;
  update public.document_comments set resolved_at = '2000-01-01', resolved_by = admin_u where id = c;
  select resolved_by, resolved_at into who, t from public.document_comments where id = c;
  if who is distinct from editor_u or t < now() - interval '1 minute' then raise exception 'FAILED 2b: resolved by or when not recorded by the database'; end if;
  update public.document_comments set resolved_at = null where id = c;
  select count(*) into n from public.document_comments where id = c and resolved_at is null and resolved_by is null;
  if n <> 1 then raise exception 'FAILED 2c: reopening did not clear who resolved it'; end if;
  execute 'reset role';
  passed := passed + 1;

  -- 3. Another viewer's comment: a viewer cannot resolve or delete it; the author or an admin deletes.
  perform set_config('request.jwt.claims', json_build_object('sub', editor_u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into public.document_comments (workspace_id, process_id, doc_type, section_key, section_title, body) values (ws, p, 'agent', 's-8', 'Limits and controls', 'Limit?') returning id into c2;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', viewer_u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  update public.document_comments set resolved_at = now() where id = c2;
  delete from public.document_comments where id = c2;
  execute 'reset role';
  select count(*) into n from public.document_comments where id = c2 and resolved_at is null;
  if n <> 1 then raise exception 'FAILED 3a: a viewer resolved or deleted someone else''s comment'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', admin_u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  delete from public.document_comments where id = c2;
  execute 'reset role';
  select count(*) into n from public.document_comments where id = c2;
  if n <> 0 then raise exception 'FAILED 3b: an admin could not delete a comment'; end if;
  passed := passed + 1;

  -- 4. Testers' edits: an editor changes a derived case, sets one aside and adds one; one row per case.
  perform set_config('request.jwt.claims', json_build_object('sub', editor_u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into public.test_case_edits (workspace_id, process_id, case_code, fields, base_hash) values (ws, p, 'FR-003.1', '{"data":"Invoice 4711 with changed bank details"}', 'abc');
  insert into public.test_case_edits (workspace_id, process_id, case_code, set_aside) values (ws, p, 'FR-004.1', true);
  insert into public.test_case_edits (workspace_id, process_id, case_code, fields) values (ws, p, 'added:' || gen_random_uuid(), '{"title":"Duplicate invoice","requirement":"FR-003"}');
  begin
    insert into public.test_case_edits (workspace_id, process_id, case_code, fields) values (ws, p, 'FR-003.1', '{}');
    raise exception 'FAILED 4a: two edits for one case';
  exception when unique_violation then null;
  end;
  begin
    insert into public.test_case_edits (workspace_id, process_id, case_code) values (ws, p, 'not a case');
    raise exception 'FAILED 4b: a case number of the wrong form was stored';
  exception when check_violation then null;
  end;
  begin
    insert into public.test_case_edits (workspace_id, process_id, case_code, fields) values (ws, p, 'FR-009.1', '[1,2]');
    raise exception 'FAILED 4c: fields that are not an object were stored';
  exception when check_violation then null;
  end;
  execute 'reset role';
  passed := passed + 1;

  -- 5. A viewer reads testers' edits but cannot write them; someone outside sees nothing at all.
  perform set_config('request.jwt.claims', json_build_object('sub', viewer_u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.test_case_edits where process_id = p;
  if n <> 3 then raise exception 'FAILED 5a: a viewer cannot read testers'' edits'; end if;
  begin
    insert into public.test_case_edits (workspace_id, process_id, case_code) values (ws, p, 'FR-005.1');
    raise exception 'FAILED 5b: a viewer wrote a tester''s edit';
  exception when insufficient_privilege then null;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', outsider_u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.test_case_edits where process_id = p;
  if n <> 0 then raise exception 'FAILED 5c: an outsider read testers'' edits'; end if;
  select count(*) into n from public.document_comments where process_id = p;
  if n <> 0 then raise exception 'FAILED 5d: an outsider read comments'; end if;
  begin
    insert into public.document_comments (workspace_id, process_id, doc_type, section_key, section_title, body) values (ws, p, 'pdd', 's-1', 'Intro', 'x');
    raise exception 'FAILED 5e: an outsider commented';
  exception when insufficient_privilege then null;
  end;
  execute 'reset role';
  passed := passed + 1;

  -- 6. The agent document takes section edits; the test pack does not (its cases are edited instead).
  perform set_config('request.jwt.claims', json_build_object('sub', editor_u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into public.document_edits (workspace_id, process_id, doc_type, section_key, html, base_hash) values (ws, p, 'agent', 's-1', '<p>Ours</p>', 'abc');
  begin
    insert into public.document_edits (workspace_id, process_id, doc_type, section_key, html, base_hash) values (ws, p, 'tests', 's-1', '<p>x</p>', 'abc');
    raise exception 'FAILED 6a: a section edit on the test pack was stored';
  exception when check_violation then null;
  end;
  execute 'reset role';
  passed := passed + 1;

  raise exception 'ALL_TESTS_PASSED (% groups)', passed;
end
$test$;
