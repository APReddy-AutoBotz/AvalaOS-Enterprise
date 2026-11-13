-- Behaviour checks for people and roles. Rolls back; success ends with the error
-- "ALL_TESTS_PASSED (8 groups)"; any other error names the failed check.

do $test$
declare
  admin_u uuid := gen_random_uuid();
  dev_u uuid := gen_random_uuid();
  late_u uuid := gen_random_uuid();
  outsider_u uuid := gen_random_uuid();
  ws uuid; proj uuid; item uuid; n int; r jsonb; passed int := 0;
  late_email text := 'late-' || gen_random_uuid() || '@example.test';
begin
  -- Made as the dashboard makes them (invited_at, confirmed), since sign-up is by invitation.
  insert into auth.users (id, email, invited_at, email_confirmed_at) values
    (admin_u, 'a-' || admin_u || '@example.test', now(), now()), (dev_u, 'd-' || dev_u || '@example.test', now(), now()), (outsider_u, 'o-' || outsider_u || '@example.test', now(), now());
  perform set_config('request.jwt.claims', json_build_object('sub', admin_u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  ws := (public.create_organization('People test', 'AP') ->> 'workspaceId')::uuid;

  -- 1. An admin adds someone who already has an account; they join at once and it is recorded.
  r := public.invite_member(ws, upper('d-' || dev_u || '@example.test'), 'editor', 'developer', false);
  if r ->> 'state' <> 'member' then raise exception 'FAILED 1a: %', r; end if;
  select count(*) into n from public.workspace_members where workspace_id = ws and user_id = dev_u and job = 'developer' and role = 'editor';
  if n <> 1 then raise exception 'FAILED 1b: developer not added'; end if;
  begin
    perform public.invite_member(ws, 'd-' || dev_u || '@example.test', 'editor', 'developer', false);
    raise exception 'FAILED 1c: added the same person twice';
  exception when unique_violation then null; end;
  passed := passed + 1;

  -- 2. Someone without an account gets an invitation that is claimed when they sign up.
  r := public.invite_member(ws, ' ' || upper(late_email) || ' ', 'viewer', 'approver', true);
  if r ->> 'state' <> 'invited' then raise exception 'FAILED 2a: %', r; end if;
  begin perform public.invite_member(ws, 'not-an-email', 'viewer'); raise exception 'FAILED 2b: accepted a bad email';
  exception when invalid_parameter_value then null; end;
  execute 'reset role';
  insert into auth.users (id, email, email_confirmed_at) values (late_u, late_email, now());
  select count(*) into n from public.workspace_members where workspace_id = ws and user_id = late_u and role = 'viewer' and can_approve and job = 'approver';
  if n <> 1 then raise exception 'FAILED 2c: invitation not claimed'; end if;
  select count(*) into n from public.workspace_invites where workspace_id = ws;
  if n <> 0 then raise exception 'FAILED 2d: invitation not cleared'; end if;
  passed := passed + 1;

  -- 3. A non-admin cannot add, change or remove people, or read the audit trail.
  perform set_config('request.jwt.claims', json_build_object('sub', dev_u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin perform public.invite_member(ws, 'x@example.test', 'admin'); raise exception 'FAILED 3a: developer invited someone';
  exception when insufficient_privilege then null; end;
  begin perform public.change_member(ws, dev_u, 'admin'); raise exception 'FAILED 3b: developer made themselves admin';
  exception when insufficient_privilege then null; end;
  begin perform public.remove_member(ws, admin_u); raise exception 'FAILED 3c: developer removed the admin';
  exception when insufficient_privilege then null; end;
  begin perform public.workspace_audit_log(ws); raise exception 'FAILED 3d: developer read the audit trail';
  exception when insufficient_privilege then null; end;
  begin insert into public.workspace_members (workspace_id, user_id, role) values (ws, outsider_u, 'admin'); raise exception 'FAILED 3e: direct insert worked';
  exception when insufficient_privilege then null; end;
  r := public.list_people(ws);
  if jsonb_array_length(r -> 'members') <> 3 then raise exception 'FAILED 3f: member list wrong'; end if;
  if (r -> 'members' -> 0 ->> 'email') is not null then raise exception 'FAILED 3g: email shown to a non-admin'; end if;
  passed := passed + 1;

  -- 4. An admin changes a role; the last admin cannot be demoted or removed.
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', admin_u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.change_member(ws, dev_u, 'editor', 'solution_architect', false);
  select count(*) into n from public.workspace_members where workspace_id = ws and user_id = dev_u and job = 'solution_architect';
  if n <> 1 then raise exception 'FAILED 4a: role not changed'; end if;
  begin perform public.change_member(ws, admin_u, 'editor', 'developer'); raise exception 'FAILED 4b: demoted the last admin';
  exception when check_violation then null; end;
  begin perform public.remove_member(ws, admin_u); raise exception 'FAILED 4c: removed the last admin';
  exception when check_violation then null; end;
  perform public.change_member(ws, dev_u, 'admin');
  perform public.change_member(ws, admin_u, 'editor', 'business_analyst', false);
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', dev_u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.change_member(ws, admin_u, 'admin');
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', admin_u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  passed := passed + 1;

  -- 5. A work item can only be owned by a member; removing a member leaves their items unassigned.
  insert into public.delivery_projects (workspace_id, name) values (ws, 'Board') returning id into proj;
  insert into public.delivery_work_items (workspace_id, project_id, item_type, title, owner_id) values (ws, proj, 'task', 'Mine', dev_u) returning id into item;
  begin update public.delivery_work_items set owner_id = outsider_u where id = item; raise exception 'FAILED 5a: owner outside the workspace';
  exception when check_violation then null; end;
  perform public.remove_member(ws, dev_u);
  select count(*) into n from public.delivery_work_items where id = item and owner_id is null;
  if n <> 1 then raise exception 'FAILED 5b: item still owned by a removed member'; end if;
  passed := passed + 1;

  -- 6. A cancelled invitation is gone and recorded.
  perform public.invite_member(ws, 'later@example.test', 'viewer');
  perform public.cancel_invite(ws, 'LATER@example.test');
  select count(*) into n from public.workspace_invites where workspace_id = ws;
  if n <> 0 then raise exception 'FAILED 6: invitation not cancelled'; end if;
  passed := passed + 1;

  -- 7. The audit trail lists what happened, newest first.
  r := public.workspace_audit_log(ws);
  select count(*) into n from jsonb_array_elements(r) e where e ->> 'kind' in ('joined', 'invited', 'role_changed', 'removed', 'invite_cancelled');
  if n < 6 then raise exception 'FAILED 7a: audit has % entries', n; end if;
  if (r -> 0 ->> 'kind') <> 'invite_cancelled' then raise exception 'FAILED 7b: not newest first: %', r -> 0; end if;
  passed := passed + 1;

  -- 8. Someone outside the workspace sees nothing.
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', outsider_u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin perform public.list_people(ws); raise exception 'FAILED 8a: outsider listed people';
  exception when sqlstate 'PT404' then null; end;
  select count(*) into n from public.workspace_audit;
  if n <> 0 then raise exception 'FAILED 8b: outsider reads audit rows'; end if;
  passed := passed + 1;

  execute 'reset role';
  raise exception 'ALL_TESTS_PASSED (% groups)', passed;
end $test$;
