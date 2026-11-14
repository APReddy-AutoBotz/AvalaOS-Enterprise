-- The parts an organisation uses. Rolls back; success ends with the error "ALL_TESTS_PASSED (4 groups)";
-- any other error names the failed check.
do $test$
declare
  owner_u uuid := gen_random_uuid();
  ana uuid := gen_random_uuid();
  dan uuid := gen_random_uuid();
  org uuid; other_org uuid; ws uuid; m text[]; ok boolean; n int;
begin
  insert into auth.users (id, email, invited_at, email_confirmed_at) values
    (owner_u, 'owner-' || owner_u || '@example.test', now(), now()), (ana, 'ana-' || ana || '@example.test', now(), now()),
    (dan, 'dan-' || dan || '@example.test', now(), now());
  delete from app_private.platform_owners;
  insert into app_private.platform_owners (user_id) values (owner_u);
  -- An organisation the owner set up, where Ana is an admin and made it herself (created_by), as a customer would.
  insert into public.organizations (name, created_by) values ('Acme', ana) returning id into org;
  insert into public.workspaces (organization_id, name, created_by) values (org, 'General', ana) returning id into ws;
  insert into public.workspace_members (workspace_id, user_id, role, can_approve) values (ws, ana, 'admin', true), (ws, owner_u, 'admin', false);
  insert into public.organizations (name, created_by) values ('Elsewhere', dan) returning id into other_org;

  -- 1. Every organisation starts with the full journey, and its members read what it uses.
  perform set_config('request.jwt.claims', json_build_object('sub', ana, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select modules into m from public.organizations where id = org;
  if m <> '{assess,documents,board}' then raise exception 'FAILED 1a: %', m; end if;
  -- 2. Nobody but the owner changes it, the organisation's own creator included; its name still can be.
  ok := false;
  begin update public.organizations set modules = '{board}' where id = org; exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAILED 2a: the creator changed the parts directly'; end if;
  ok := false;
  begin perform public.set_organization_modules(org, '{board}'); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAILED 2b: a customer admin set the parts'; end if;
  update public.organizations set name = 'Acme Ltd' where id = org;
  execute 'reset role';
  if (select name || array_to_string(modules, ',') from public.organizations where id = org) <> 'Acme Ltdassess,documents,board' then raise exception 'FAILED 2c'; end if;

  -- 3. The owner sets one of the four set-ups, in the fixed order; nothing else is accepted.
  perform set_config('request.jwt.claims', json_build_object('sub', owner_u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  m := public.set_organization_modules(org, '{documents,assess}');
  if m <> '{assess,documents}' then raise exception 'FAILED 3a: %', m; end if;
  m := public.set_organization_modules(org, '{board}');
  if m <> '{board}' then raise exception 'FAILED 3b'; end if;
  foreach m slice 1 in array array[['documents', 'documents'], ['assess', 'board']] loop
    ok := false;
    begin perform public.set_organization_modules(org, m); exception when check_violation then ok := true; end;
    if not ok then raise exception 'FAILED 3c: % accepted', m; end if;
  end loop;
  ok := false;
  begin perform public.set_organization_modules(org, '{assess,billing}'); exception when invalid_parameter_value then ok := true; end;
  if not ok then raise exception 'FAILED 3d: an unknown part'; end if;
  ok := false;
  begin perform public.set_organization_modules(org, '{}'); exception when check_violation then ok := true; end;
  if not ok then raise exception 'FAILED 3e: nothing at all'; end if;
  -- 4. Only an organisation the owner belongs to; switching a part off deletes nothing.
  ok := false;
  begin perform public.set_organization_modules(other_org, '{board}'); exception when no_data_found then ok := true; end;
  if not ok then raise exception 'FAILED 4a: another organisation'; end if;
  execute 'reset role';
  insert into public.processes (workspace_id, name, created_by) values (ws, 'Kept', ana);
  perform set_config('request.jwt.claims', json_build_object('sub', owner_u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.set_organization_modules(org, '{assess}');
  perform public.set_organization_modules(org, '{board}');
  execute 'reset role';
  select count(*) into n from public.processes where workspace_id = ws and name = 'Kept';
  if n <> 1 then raise exception 'FAILED 4b: switching off deleted work'; end if;

  raise exception 'ALL_TESTS_PASSED (4 groups)';
end $test$;
