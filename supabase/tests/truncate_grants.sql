-- Behaviour checks for the migration revoke_truncate: signed-in people hold TRUNCATE on no table. Rolls back:
-- success ends with the error "ALL_TESTS_PASSED (3 groups)"; any other error names the failed check. Run it as
-- postgres (the role migrations run as), after the migration, in the same transaction as the trial does, or
-- against a database where the migration is applied.
--
-- It reads rights only (has_table_privilege, the default privileges) and never tries to empty a table: a
-- TRUNCATE attempt locks the whole table while it runs, and on a database without the migration it would
-- empty it until the roll-back.

do $test$
declare
  passed int := 0;
  t text;
  p text;
  n int;
  listed text[] := array['assessments', 'delivery_projects', 'delivery_sprints', 'delivery_work_item_comments',
    'delivery_work_items', 'document_revisions', 'documents', 'flow_diagrams', 'organizations', 'process_model_edits',
    'process_model_revisions', 'processes', 'profiles', 'proposal_requirements', 'requirements', 'work_item_proposals',
    'work_item_requirements', 'workspace_ai_settings', 'workspace_audit', 'workspace_invites', 'workspace_members', 'workspaces'];
begin
  if current_user <> 'postgres' then raise exception 'FAILED 0: run as postgres, not %', current_user; end if;

  -- 1. Neither authenticated nor anon holds TRUNCATE on the 22 tables, nor on any other table in public.
  --    service_role keeps it on the 22.
  foreach t in array listed loop
    if to_regclass('public.' || t) is null then raise exception 'FAILED 1a: public.% is missing', t; end if;
    if has_table_privilege('authenticated', 'public.' || t, 'TRUNCATE') then raise exception 'FAILED 1b: authenticated may truncate public.%', t; end if;
    if has_table_privilege('anon', 'public.' || t, 'TRUNCATE') then raise exception 'FAILED 1c: anon may truncate public.%', t; end if;
    if not has_table_privilege('service_role', 'public.' || t, 'TRUNCATE') then raise exception 'FAILED 1d: service_role lost TRUNCATE on public.%', t; end if;
  end loop;
  select count(*) into n from pg_class c join pg_namespace s on s.oid = c.relnamespace
   where s.nspname = 'public' and c.relkind in ('r', 'p')
     and (has_table_privilege('authenticated', c.oid, 'TRUNCATE') or has_table_privilege('anon', c.oid, 'TRUNCATE'));
  if n <> 0 then raise exception 'FAILED 1e: % tables in public still give TRUNCATE to authenticated or anon', n; end if;
  passed := passed + 1;

  -- 2. Nothing else changed: on processes and workspaces authenticated still holds what the API uses, and on
  --    every one of the 22 the two other default rights are still there.
  foreach t in array array['processes', 'workspaces'] loop
    foreach p in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
      if not has_table_privilege('authenticated', 'public.' || t, p) then raise exception 'FAILED 2a: authenticated lost % on public.%', p, t; end if;
    end loop;
  end loop;
  foreach t in array listed loop
    if not has_table_privilege('authenticated', 'public.' || t, 'REFERENCES') or not has_table_privilege('authenticated', 'public.' || t, 'TRIGGER') then
      raise exception 'FAILED 2b: authenticated lost another right on public.%', t;
    end if;
  end loop;
  passed := passed + 1;

  -- 3. A new table made by postgres gives authenticated no TRUNCATE, and still everything else the default gave.
  if exists (select 1 from pg_default_acl d, aclexplode(d.defaclacl) a
              where d.defaclrole = 'postgres'::regrole and d.defaclnamespace = 'public'::regnamespace and d.defaclobjtype = 'r'
                and a.grantee = 'authenticated'::regrole and a.privilege_type = 'TRUNCATE') then
    raise exception 'FAILED 3a: the default privileges for tables made by postgres still give TRUNCATE';
  end if;
  create table public.truncate_grants_probe (id int);
  if has_table_privilege('authenticated', 'public.truncate_grants_probe', 'TRUNCATE') then raise exception 'FAILED 3b: a new table gives TRUNCATE'; end if;
  foreach p in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'REFERENCES', 'TRIGGER'] loop
    if not has_table_privilege('authenticated', 'public.truncate_grants_probe', p) then raise exception 'FAILED 3c: a new table no longer gives %', p; end if;
  end loop;
  if not has_table_privilege('service_role', 'public.truncate_grants_probe', 'TRUNCATE') then raise exception 'FAILED 3d: service_role lost TRUNCATE on a new table'; end if;
  drop table public.truncate_grants_probe;
  passed := passed + 1;

  raise exception 'ALL_TESTS_PASSED (% groups)', passed;
end $test$;
