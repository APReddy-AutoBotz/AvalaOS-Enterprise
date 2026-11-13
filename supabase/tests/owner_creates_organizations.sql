-- Only the platform owner creates organizations. Rolls back; success ends with the error
-- "ALL_TESTS_PASSED (4 groups)"; any other error names the failed check.
do $test$
declare
  owner_u uuid := gen_random_uuid();
  member_u uuid := gen_random_uuid();
  r jsonb; ok boolean; n int; had_owners boolean;
begin
  -- Users made as the dashboard makes them, since sign-up is by invitation.
  insert into auth.users (id, email, invited_at, email_confirmed_at) values
    (owner_u, 'owner-' || owner_u || '@example.test', now(), now()),
    (member_u, 'member-' || member_u || '@example.test', now(), now());
  select exists (select 1 from app_private.platform_owners) into had_owners;
  delete from app_private.platform_owners;

  -- 1. With no owner listed (a new deployment), anyone signed in may create the first organization.
  perform set_config('request.jwt.claims', json_build_object('sub', member_u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  if not public.can_create_organization() then raise exception 'FAILED 1a: bootstrap refused'; end if;
  execute 'reset role';

  -- 2. Once an owner is listed, only the owner may.
  insert into app_private.platform_owners (user_id) values (owner_u);
  perform set_config('request.jwt.claims', json_build_object('sub', member_u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  if public.can_create_organization() then raise exception 'FAILED 2a: a non-owner may create'; end if;
  begin
    perform public.create_organization('Not mine', 'W');
    raise exception 'FAILED 2b: a non-owner created an organization';
  exception when insufficient_privilege then null; end;
  execute 'reset role';
  select count(*) into n from public.organizations where name = 'Not mine' and created_by = member_u;
  if n <> 0 then raise exception 'FAILED 2c: organization row left behind'; end if;

  -- 3. The owner may, and becomes admin and approver of the first workspace.
  perform set_config('request.jwt.claims', json_build_object('sub', owner_u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  if not public.can_create_organization() then raise exception 'FAILED 3a: owner refused'; end if;
  r := public.create_organization('Owner org', 'Finance');
  execute 'reset role';
  select count(*) into n from public.workspace_members where workspace_id = (r ->> 'workspaceId')::uuid and user_id = owner_u and role = 'admin' and can_approve;
  if n <> 1 then raise exception 'FAILED 3b: owner not admin of the new workspace'; end if;

  -- 4. The list is not reachable through the API.
  execute 'set local role authenticated';
  begin
    perform 1 from app_private.platform_owners;
    raise exception 'FAILED 4: owner list readable';
  exception when insufficient_privilege then null; end;
  execute 'reset role';

  raise exception 'ALL_TESTS_PASSED (4 groups)';
end $test$;
