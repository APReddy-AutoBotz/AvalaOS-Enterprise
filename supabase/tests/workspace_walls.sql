-- Behaviour checks for the walls between workspaces (package 13 part C). Rolls back; success ends with
-- the error "ALL_TESTS_PASSED (7 groups)"; any other error names the failed check.

do $test$
declare
  u uuid := gen_random_uuid();
  org1 uuid; org2 uuid; ws1 uuid; ws2 uuid; p1 uuid; p2 uuid; proj1 uuid; proj2 uuid;
  rev1 uuid; rev1b uuid; rev2 uuid; doc1 uuid; prop1 uuid; prop1b uuid; prop2 uuid;
  epic1 uuid; story1 uuid; item2 uuid; n int; passed int := 0; batch uuid := gen_random_uuid();
  x uuid;
begin
  insert into auth.users (id, email, invited_at, email_confirmed_at) values (u, 'w-' || u || '@example.test', now(), now());
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  insert into public.organizations (name, created_by) values ('Walls one', u) returning id into org1;
  insert into public.organizations (name, created_by) values ('Walls two', u) returning id into org2;
  insert into public.workspaces (organization_id, name, created_by) values (org1, 'W1', u) returning id into ws1;
  insert into public.workspaces (organization_id, name, created_by) values (org2, 'W2', u) returning id into ws2;
  insert into public.workspace_members (workspace_id, user_id, role) values (ws1, u, 'admin'), (ws2, u, 'admin');
  insert into public.processes (workspace_id, name) values (ws1, 'P1') returning id into p1;
  insert into public.processes (workspace_id, name) values (ws2, 'P2') returning id into p2;
  insert into public.delivery_projects (workspace_id, name) values (ws1, 'B1') returning id into proj1;
  insert into public.delivery_projects (workspace_id, name) values (ws2, 'B2') returning id into proj2;
  insert into public.process_model_revisions (workspace_id, process_id, rev_no, state, approved_at, approved_by) values (ws1, p1, 1, 'superseded', now(), u) returning id into rev1;
  insert into public.process_model_revisions (workspace_id, process_id, rev_no, state, approved_at, approved_by) values (ws2, p2, 1, 'superseded', now(), u) returning id into rev2;
  insert into public.documents (workspace_id, process_id, doc_type) values (ws1, p1, 'pdd') returning id into doc1;
  insert into public.work_item_proposals (workspace_id, process_id, batch_id, item_type, title) values (ws1, p1, batch, 'epic', 'E1') returning id into prop1;
  insert into public.work_item_proposals (workspace_id, process_id, batch_id, item_type, title) values (ws2, p2, batch, 'epic', 'E2') returning id into prop2;
  insert into public.delivery_work_items (workspace_id, project_id, item_type, title) values (ws2, proj2, 'epic', 'I2') returning id into item2;

  -- 1. Links within one workspace work, including a parent and its child saved in one statement (an import).
  epic1 := gen_random_uuid(); story1 := gen_random_uuid();
  insert into public.delivery_work_items (id, workspace_id, project_id, parent_id, item_type, title, process_id, origin_proposal_id) values
    (story1, ws1, proj1, epic1, 'story', 'S1', p1, null),
    (epic1, ws1, proj1, null, 'epic', 'E1', p1, prop1);
  insert into public.work_item_proposals (workspace_id, process_id, batch_id, parent_id, item_type, title, state, confirmed_work_item_id) values (ws1, p1, batch, prop1, 'story', 'S1', 'confirmed', story1) returning id into prop1b;
  insert into public.process_model_revisions (workspace_id, process_id, rev_no, state, approved_at, approved_by, based_on) values (ws1, p1, 2, 'superseded', now(), u, rev1) returning id into rev1b;
  insert into public.document_revisions (workspace_id, document_id, rev_no, template_version, model_revision_id) values (ws1, doc1, 1, 't', rev1b);
  insert into public.extraction_runs (kind, workspace_id, process_id, token_hash) values ('process', ws1, p1, repeat('a', 64));
  passed := passed + 1;

  -- 2. Each of the eight links to a row of another workspace is refused, on insert and on update.
  begin insert into public.delivery_work_items (workspace_id, project_id, parent_id, item_type, title) values (ws1, proj1, item2, 'story', 'x');
    raise exception 'FAILED 2a: item under another workspace''s item'; exception when foreign_key_violation then null; end;
  begin update public.delivery_work_items set parent_id = item2 where id = story1;
    raise exception 'FAILED 2b: item moved under another workspace''s item'; exception when foreign_key_violation then null; end;
  begin update public.delivery_work_items set process_id = p2 where id = story1;
    raise exception 'FAILED 2c: item pointed at another workspace''s process'; exception when foreign_key_violation then null; end;
  begin update public.delivery_work_items set origin_proposal_id = prop2 where id = story1;
    raise exception 'FAILED 2d: item pointed at another workspace''s proposal'; exception when foreign_key_violation then null; end;
  begin update public.work_item_proposals set parent_id = prop2 where id = prop1b;
    raise exception 'FAILED 2e: proposal under another workspace''s proposal'; exception when foreign_key_violation then null; end;
  begin update public.work_item_proposals set confirmed_work_item_id = item2 where id = prop1b;
    raise exception 'FAILED 2f: proposal confirmed as another workspace''s item'; exception when foreign_key_violation then null; end;
  begin update public.document_revisions set model_revision_id = rev2 where document_id = doc1;
    raise exception 'FAILED 2g: document revision of another workspace''s process revision'; exception when foreign_key_violation then null; end;
  begin insert into public.process_model_revisions (workspace_id, process_id, rev_no, state, approved_at, approved_by, based_on) values (ws1, p1, 3, 'superseded', now(), u, rev2);
    raise exception 'FAILED 2h: revision based on another workspace''s revision'; exception when foreign_key_violation then null; end;
  begin insert into public.extraction_runs (kind, workspace_id, process_id, token_hash) values ('process', ws1, p2, repeat('b', 64));
    raise exception 'FAILED 2i: reading run of another workspace''s process'; exception when foreign_key_violation then null; end;
  passed := passed + 1;

  -- 3. The other side cannot leave either: a process, proposal or revision that is linked to cannot move
  --    to another workspace while the link stands.
  begin update public.processes set workspace_id = ws2 where id = p1;
    raise exception 'FAILED 3a: a linked process moved to another workspace'; exception when foreign_key_violation then null; end;
  begin update public.work_item_proposals set workspace_id = ws2, process_id = p2 where id = prop1;
    raise exception 'FAILED 3b: a linked proposal moved to another workspace'; exception when foreign_key_violation then null; end;
  begin update public.delivery_work_items set workspace_id = ws2, project_id = proj2, parent_id = null, process_id = null, origin_proposal_id = null where id = story1;
    raise exception 'FAILED 3c: a linked item moved to another workspace'; exception when foreign_key_violation then null; end;
  passed := passed + 1;

  -- 4. A reading run that names a process names its workspace.
  begin insert into public.extraction_runs (kind, case_id, process_id, token_hash) values ('eval', 'ap-invoice', p2, repeat('c', 64));
    raise exception 'FAILED 4: a run named a process without its workspace'; exception when check_violation then null; end;
  passed := passed + 1;

  -- 5. Deleting behaves as before: a link to a deleted item, proposal or process is emptied, and the
  --    row that held it stays in its workspace; a proposal's children go with it.
  delete from public.work_item_proposals where id = prop1;
  select count(*) into n from public.work_item_proposals where id = prop1b;
  if n <> 0 then raise exception 'FAILED 5a: a child proposal outlived its parent'; end if;
  select origin_proposal_id into x from public.delivery_work_items where id = epic1;
  if x is not null then raise exception 'FAILED 5b: the item kept a deleted proposal'; end if;
  delete from public.delivery_work_items where id = epic1;
  select parent_id into x from public.delivery_work_items where id = story1;
  if x is not null or not found then raise exception 'FAILED 5c: the child item was lost or kept its deleted parent'; end if;
  if (select workspace_id from public.delivery_work_items where id = story1) is distinct from ws1 then raise exception 'FAILED 5d: the child item left its workspace'; end if;
  passed := passed + 1;

  -- 6. A workspace cannot be moved to another organisation by a signed-in person, its own admin
  --    included; renaming it still works.
  execute 'set local role authenticated';
  begin update public.workspaces set organization_id = org2 where id = ws1;
    raise exception 'FAILED 6a: an admin moved a workspace'; exception when insufficient_privilege then null; end;
  update public.workspaces set name = 'W1 renamed' where id = ws1;
  if not found then raise exception 'FAILED 6b: an admin could not rename the workspace'; end if;
  execute 'reset role';
  passed := passed + 1;

  -- 7. Directly in the database (no signed-in person) the owner can still move it.
  perform set_config('request.jwt.claims', '', true);
  update public.workspaces set organization_id = org1 where id = ws2;
  if (select organization_id from public.workspaces where id = ws2) is distinct from org1 then raise exception 'FAILED 7: the database could not move it'; end if;
  passed := passed + 1;

  raise exception 'ALL_TESTS_PASSED (% groups)', passed;
end
$test$;
