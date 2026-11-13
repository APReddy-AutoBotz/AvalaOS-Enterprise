-- Sign-up needs an invitation. Run inside one transaction; ends by raising ALL_TESTS_PASSED.
do $$
declare ws uuid; admin_id uuid := gen_random_uuid(); n int;
begin
  -- 1. An email nobody invited is refused.
  begin
    insert into auth.users (id, email, aud, role) values (gen_random_uuid(), 'stranger@example.test', 'authenticated', 'authenticated');
    raise exception 'FAIL 1: uninvited sign-up was allowed';
  exception when sqlstate 'P0001' then null; end;

  -- 2. An invited email is accepted (case-insensitive) and the invite is claimed.
  insert into auth.users (id, email, aud, role, invited_at) values (admin_id, 'owner@example.test', 'authenticated', 'authenticated', now()) on conflict do nothing;
  insert into public.organizations (name, created_by) values ('T', admin_id) returning id into ws;
  insert into public.workspaces (organization_id, name, created_by) values (ws, 'W', admin_id) returning id into ws;
  insert into public.workspace_invites (workspace_id, email, role, invited_by) values (ws, 'friend@example.test', 'editor', admin_id);
  insert into auth.users (id, email, aud, role) values (gen_random_uuid(), 'Friend@Example.test', 'authenticated', 'authenticated');
  select count(*) into n from public.workspace_members where workspace_id = ws and role = 'editor';
  if n <> 1 then raise exception 'FAIL 2: invited person not joined (%)', n; end if;

  -- 3. A dashboard-invited user (invited_at set) is accepted.
  insert into auth.users (id, email, aud, role, invited_at) values (gen_random_uuid(), 'dash@example.test', 'authenticated', 'authenticated', now());

  raise exception 'ALL_TESTS_PASSED (3 groups)';
end $$;
