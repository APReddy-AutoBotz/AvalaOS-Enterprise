-- Behaviour checks for confirming proposals to the board (WP4.3). Rolls back; success ends with the
-- error "ALL_TESTS_PASSED (4 groups)"; any other error names the failed check.

do $test$
declare
  admin_u uuid := gen_random_uuid();
  viewer_u uuid := gen_random_uuid();
  ws uuid; p uuid; proj uuid; r jsonb; n int; epic_item uuid; story_parent uuid; passed int := 0;
  batch uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, invited_at, email_confirmed_at) values (admin_u, 'a-' || admin_u || '@example.test', now(), now()), (viewer_u, 'v-' || viewer_u || '@example.test', now(), now());
  -- Organizations are the platform owner's to create; with no owner listed, as in a new deployment, the test user may.
  delete from app_private.platform_owners;
  perform set_config('request.jwt.claims', json_build_object('sub', admin_u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  ws := (public.create_organization('Board test', 'AP') ->> 'workspaceId')::uuid;
  insert into public.processes (workspace_id, name) values (ws, 'Invoices') returning id into p;
  insert into public.delivery_projects (workspace_id, name) values (ws, 'AP automation') returning id into proj;
  insert into public.requirements (workspace_id, process_id, code, requirement_type, statement, derivation_key) values (ws, p, 'FR-002', 'functional', 'The solution shall post invoice in SAP.', 'step:s2');
  insert into public.work_item_proposals (workspace_id, process_id, batch_id, item_type, title, derivation_key, parent_key, state, requirement_codes, acceptance_criteria, sort_order) values
    (ws, p, batch, 'story', 'Post invoice', 'story:step:s2', 'epic:rpa:sap', 'selected', '{FR-002}', '["a","b"]', 2),
    (ws, p, batch, 'epic', 'RPA in SAP', 'epic:rpa:sap', null, 'selected', '{FR-002}', '["a","b"]', 1),
    (ws, p, batch, 'task', 'Access to SAP', 'access:sap', null, 'proposed', '{}', '["a","b"]', 3);
  execute 'reset role';
  insert into public.workspace_members (workspace_id, user_id, role, can_approve) values (ws, viewer_u, 'viewer', false);

  -- 1. Confirm two selected items: two board items, the story under the epic, requirements kept.
  perform set_config('request.jwt.claims', json_build_object('sub', admin_u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  r := public.confirm_proposals(p, proj, array['story:step:s2', 'epic:rpa:sap']);
  if (r ->> 'created')::int <> 2 then raise exception 'FAILED 1a: created %', r; end if;
  select id into epic_item from public.delivery_work_items where title = 'RPA in SAP';
  select parent_id into story_parent from public.delivery_work_items where title = 'Post invoice';
  if story_parent is distinct from epic_item then raise exception 'FAILED 1b: story not under its epic'; end if;
  select count(*) into n from public.delivery_work_items where project_id = proj and status = 'todo' and details -> 'requirements' ? 'FR-002';
  if n <> 2 then raise exception 'FAILED 1c: items not in To Do with their requirements'; end if;
  if (select details -> 'snapshot' ->> 'FR-002' from public.delivery_work_items where title = 'Post invoice') is distinct from 'The solution shall post invoice in SAP.' then raise exception 'FAILED 1e: requirement wording not recorded'; end if;
  select count(*) into n from public.work_item_proposals where process_id = p and state = 'confirmed' and confirmed_work_item_id is not null;
  if n <> 2 then raise exception 'FAILED 1d: proposals not marked confirmed'; end if;
  passed := passed + 1;

  -- 2. A double submit or replay creates nothing.
  r := public.confirm_proposals(p, proj, array['story:step:s2', 'epic:rpa:sap']);
  if (r ->> 'created')::int <> 0 or (r ->> 'skipped')::int <> 2 then raise exception 'FAILED 2a: replay %', r; end if;
  select count(*) into n from public.delivery_work_items where project_id = proj;
  if n <> 2 then raise exception 'FAILED 2b: duplicates created'; end if;
  passed := passed + 1;

  -- 3. An item that is not selected is refused, and nothing in that call is created.
  begin
    perform public.confirm_proposals(p, proj, array['access:sap']);
    raise exception 'FAILED 3a: unselected item confirmed';
  exception when sqlstate 'PT409' then null;
  end;
  select count(*) into n from public.delivery_work_items where project_id = proj;
  if n <> 2 then raise exception 'FAILED 3b: unselected item created'; end if;
  execute 'reset role';
  passed := passed + 1;

  -- 4. A viewer cannot confirm.
  perform set_config('request.jwt.claims', json_build_object('sub', viewer_u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform public.confirm_proposals(p, proj, array['access:sap']);
    raise exception 'FAILED 4: viewer confirmed';
  exception when sqlstate 'PT403' then null;
  end;
  execute 'reset role';
  passed := passed + 1;

  raise exception 'ALL_TESTS_PASSED (% groups)', passed;
end
$test$;
