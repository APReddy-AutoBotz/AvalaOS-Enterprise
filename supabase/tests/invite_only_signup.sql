-- Sign-up needs an invitation. Run inside one transaction; ends by raising ALL_TESTS_PASSED.
do $$
declare ws uuid; admin_id uuid := gen_random_uuid(); late_id uuid := gen_random_uuid(); n int;
begin
  -- 1. An email nobody invited is refused.
  begin
    insert into auth.users (id, email, aud, role) values (gen_random_uuid(), 'stranger@example.test', 'authenticated', 'authenticated');
    raise exception 'FAIL 1: uninvited sign-up was allowed';
  exception when sqlstate 'P0001' then null; end;

  -- 2. An invited email with a confirmed address (as from Google) is accepted, case-insensitively, and joins at once.
  insert into auth.users (id, email, aud, role, invited_at) values (admin_id, 'owner@example.test', 'authenticated', 'authenticated', now()) on conflict do nothing;
  insert into public.organizations (name, created_by) values ('T', admin_id) returning id into ws;
  insert into public.workspaces (organization_id, name, created_by) values (ws, 'W', admin_id) returning id into ws;
  insert into public.workspace_invites (workspace_id, email, role, invited_by) values (ws, 'friend@example.test', 'editor', admin_id);
  insert into auth.users (id, email, aud, role, email_confirmed_at) values (gen_random_uuid(), 'Friend@Example.test', 'authenticated', 'authenticated', now());
  select count(*) into n from public.workspace_members where workspace_id = ws and role = 'editor';
  if n <> 1 then raise exception 'FAIL 2: invited person not joined (%)', n; end if;

  -- 3. An account whose address is not confirmed yet (a password sign-up, or an unverified Microsoft address)
  --    is created but joins nothing, and the invitation stays open, until the address is confirmed.
  insert into public.workspace_invites (workspace_id, email, role, invited_by) values (ws, 'later@example.test', 'viewer', admin_id);
  insert into auth.users (id, email, aud, role) values (late_id, 'later@example.test', 'authenticated', 'authenticated');
  select count(*) into n from public.workspace_members where workspace_id = ws and user_id = late_id;
  if n <> 0 then raise exception 'FAIL 3a: joined before the address was confirmed'; end if;
  select count(*) into n from public.workspace_invites where workspace_id = ws and email = 'later@example.test';
  if n <> 1 then raise exception 'FAIL 3b: invitation used up before confirmation'; end if;
  update auth.users set email_confirmed_at = now() where id = late_id;
  select count(*) into n from public.workspace_members where workspace_id = ws and user_id = late_id and role = 'viewer';
  if n <> 1 then raise exception 'FAIL 3c: not joined once the address was confirmed'; end if;
  select count(*) into n from public.workspace_invites where workspace_id = ws and email = 'later@example.test';
  if n <> 0 then raise exception 'FAIL 3d: invitation not cleared'; end if;
  -- Confirming again (or any later update) adds nothing twice.
  update auth.users set email_confirmed_at = now() where id = late_id;
  select count(*) into n from public.workspace_audit where workspace_id = ws and subject_user = late_id and kind = 'joined';
  if n <> 1 then raise exception 'FAIL 3e: joined recorded % times', n; end if;

  -- 4. A dashboard-invited user (invited_at set) is accepted.
  insert into auth.users (id, email, aud, role, invited_at) values (gen_random_uuid(), 'dash@example.test', 'authenticated', 'authenticated', now());

  raise exception 'ALL_TESTS_PASSED (4 groups)';
end $$;
