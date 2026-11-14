-- Behaviour checks for the baseline schema: tenancy isolation, revision immutability,
-- "unassigned is valid" on the board, and "a proposal reaches the board once".
--
-- Run the whole block against a database that has the migrations applied.
-- It creates its own users and data and always rolls back: success ends with the
-- error "ALL_TESTS_PASSED (9 groups)"; any other error names the failed check.

do $test$
declare
  u1 uuid := gen_random_uuid();
  u2 uuid := gen_random_uuid();
  org jsonb; ws uuid; p uuid; r1 uuid; r2 uuid; proj uuid; prop uuid; wi uuid; n int; passed int := 0;
begin
  -- 1. Sign-up creates a profile.
  insert into auth.users (id, email, raw_user_meta_data, invited_at, email_confirmed_at) values
    (u1, 'u1-' || u1 || '@example.test', '{"full_name":"Test One"}', now(), now()),
    (u2, 'u2-' || u2 || '@example.test', '{}', now(), now());
  -- Organizations are the platform owner's to create; with no owner listed, as in a new deployment, the test user may.
  delete from app_private.platform_owners;
  select count(*) into n from public.profiles where id in (u1, u2);
  if n <> 2 then raise exception 'TEST FAIL 1: profiles not created (%)', n; end if;
  if (select display_name from public.profiles where id = u1) <> 'Test One' then raise exception 'TEST FAIL 1b: display name'; end if;
  passed := passed + 1;

  -- 2. A signed-in user creates an organization and workspace and can use them.
  perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  org := public.create_organization('  Acme  ', 'Ops');
  ws := (org ->> 'workspaceId')::uuid;
  select count(*) into n from public.workspaces where id = ws and name = 'Ops';
  if n <> 1 then raise exception 'TEST FAIL 2: creator cannot see workspace'; end if;
  select count(*) into n from public.organizations where name = 'Acme';
  if n <> 1 then raise exception 'TEST FAIL 2b: creator cannot see organization'; end if;
  insert into public.processes (workspace_id, name) values (ws, 'Invoice exceptions') returning id into p;
  passed := passed + 1;

  -- 3. Users cannot write model revisions directly.
  begin
    insert into public.process_model_revisions (workspace_id, process_id, rev_no) values (ws, p, 1);
    raise exception 'TEST FAIL 3: user wrote a model revision directly';
  exception when insufficient_privilege then null;
  end;
  passed := passed + 1;

  -- 4. Another user sees nothing and cannot write into the workspace.
  perform set_config('request.jwt.claims', json_build_object('sub', u2, 'role', 'authenticated')::text, true);
  select count(*) into n from public.processes;
  if n <> 0 then raise exception 'TEST FAIL 4: other user sees % processes', n; end if;
  select count(*) into n from public.workspaces;
  if n <> 0 then raise exception 'TEST FAIL 4b: other user sees workspaces'; end if;
  select count(*) into n from public.profiles where id = u1;
  if n <> 0 then raise exception 'TEST FAIL 4c: other user sees a stranger profile'; end if;
  begin
    insert into public.processes (workspace_id, name) values (ws, 'Intruder');
    raise exception 'TEST FAIL 4d: other user inserted a process';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.workspace_members (workspace_id, user_id, role) values (ws, u2, 'admin');
    raise exception 'TEST FAIL 4e: other user added themselves to a workspace';
  exception when insufficient_privilege then null;
  end;
  update public.processes set name = 'Hacked' where id = p;
  passed := passed + 1;

  -- 5. The anonymous role has no access.
  execute 'reset role';
  execute 'set local role anon';
  begin
    select count(*) into n from public.processes;
    raise exception 'TEST FAIL 5: anon read processes';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.create_organization('X', 'Y');
    raise exception 'TEST FAIL 5b: anon called create_organization';
  exception when insufficient_privilege then null;
  end;
  execute 'reset role';
  if (select name from public.processes where id = p) <> 'Invoice exceptions' then raise exception 'TEST FAIL 4f: other user renamed a process'; end if;
  passed := passed + 1;

  -- 6. One working draft; approved revisions are immutable; approved -> superseded only.
  insert into public.process_model_revisions (workspace_id, process_id, rev_no, created_by) values (ws, p, 1, u1) returning id into r1;
  begin
    insert into public.process_model_revisions (workspace_id, process_id, rev_no, created_by) values (ws, p, 2, u1);
    raise exception 'TEST FAIL 6: two working drafts';
  exception when unique_violation then null;
  end;
  update public.process_model_revisions set model = '{"steps":[]}' where id = r1;
  update public.process_model_revisions set state = 'approved', approved_by = u1, approved_at = now() where id = r1;
  begin
    update public.process_model_revisions set model = '{"steps":[1]}' where id = r1;
    raise exception 'TEST FAIL 6b: approved revision changed';
  exception when object_not_in_prerequisite_state then null;
  end;
  begin
    delete from public.process_model_revisions where id = r1;
    raise exception 'TEST FAIL 6c: approved revision deleted';
  exception when object_not_in_prerequisite_state then null;
  end;
  insert into public.process_model_revisions (workspace_id, process_id, rev_no, based_on, created_by) values (ws, p, 2, r1, u1) returning id into r2;
  update public.process_model_revisions set state = 'superseded' where id = r1;
  if (select model from public.process_model_revisions where id = r1) <> '{"steps":[]}'::jsonb then raise exception 'TEST FAIL 6d: superseding changed content'; end if;
  begin
    update public.process_model_revisions set state = 'working', approved_at = null, approved_by = null where id = r1;
    raise exception 'TEST FAIL 6e: superseded revision reopened';
  exception when object_not_in_prerequisite_state then null;
  end;
  passed := passed + 1;

  -- 7. Delivery: unassigned is valid; a proposal reaches the board once; status persists.
  perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into public.delivery_projects (workspace_id, name) values (ws, 'Automation backlog') returning id into proj;
  insert into public.work_item_proposals (workspace_id, process_id, batch_id, item_type, title) values (ws, p, gen_random_uuid(), 'story', 'Post matched invoice through the API') returning id into prop;
  insert into public.delivery_work_items (workspace_id, project_id, item_type, title, origin_proposal_id) values (ws, proj, 'story', 'Post matched invoice through the API', prop) returning id into wi;
  if (select owner_id is null and estimate_hours is null and start_date is null and due_date is null and status = 'todo' from public.delivery_work_items where id = wi) is not true then raise exception 'TEST FAIL 7: unassigned defaults'; end if;
  begin
    insert into public.delivery_work_items (workspace_id, project_id, title, origin_proposal_id) values (ws, proj, 'Duplicate', prop);
    raise exception 'TEST FAIL 7b: proposal reached the board twice';
  exception when unique_violation then null;
  end;
  begin
    insert into public.delivery_work_items (workspace_id, project_id, title, start_date, due_date) values (ws, proj, 'Bad dates', '2026-12-10', '2026-12-01');
    raise exception 'TEST FAIL 7c: due before start accepted';
  exception when check_violation then null;
  end;
  update public.work_item_proposals set state = 'confirmed', confirmed_work_item_id = wi where id = prop;
  update public.delivery_work_items set status = 'in_progress' where id = wi;
  if (select status from public.delivery_work_items where id = wi) <> 'in_progress' then raise exception 'TEST FAIL 7d: status update'; end if;
  begin
    insert into public.delivery_work_items (workspace_id, project_id, title) values (ws, gen_random_uuid(), 'Orphan');
    raise exception 'TEST FAIL 7e: work item without a project in the workspace';
  exception when foreign_key_violation then null;
  end;
  passed := passed + 1;

  -- 8. Deleting a process as the server role cascades, including approved revisions.
  execute 'reset role';
  delete from public.processes where id = p;
  select count(*) into n from public.process_model_revisions where process_id = p;
  if n <> 0 then raise exception 'TEST FAIL 8: cascade left % revisions', n; end if;
  if (select process_id from public.delivery_work_items where id = wi) is not null then raise exception 'TEST FAIL 8b: work item kept a dangling process'; end if;
  passed := passed + 1;

  -- 9. AI usage: server writes, members read, others and users cannot write or call the budget function.
  insert into public.ai_usage (workspace_id, user_id, task, model, status, input_tokens, output_tokens) values (ws, u1, 'participants', 'm', 'ok', 100, 20);
  if public.ai_tokens_used_this_month(ws) <> 120 then raise exception 'TEST FAIL 9: monthly token sum'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.ai_usage where workspace_id = ws;
  if n <> 1 then raise exception 'TEST FAIL 9b: member cannot read usage'; end if;
  begin
    insert into public.ai_usage (workspace_id, task, model, status) values (ws, 't', 'm', 'ok');
    raise exception 'TEST FAIL 9c: user wrote usage';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.ai_tokens_used_this_month(ws);
    raise exception 'TEST FAIL 9d: user called the budget function';
  exception when insufficient_privilege then null;
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', u2, 'role', 'authenticated')::text, true);
  select count(*) into n from public.ai_usage;
  if n <> 0 then raise exception 'TEST FAIL 9e: other user sees usage'; end if;
  execute 'reset role';
  passed := passed + 1;

  raise exception 'ALL_TESTS_PASSED (% groups); rolling back test data', passed;
end $test$;
