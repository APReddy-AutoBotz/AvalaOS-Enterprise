-- What the live store selects from a table granted column by column, run as a signed-in member (review, 25 November
-- 2026: a select naming `source_ids`, which `authenticated` may not read, failed only on the preview). Each list is
-- the store's own, as `GRANTED_SELECTS` in domain/store/grantedSelects.ts writes it (its test checks this file holds
-- each one), so a new column in a select fails here, in the trial, not on a preview. Rolls back: success ends with
-- the error "ALL_TESTS_PASSED (2 groups)"; any other error names the failed check. Needs no migration of its own.

create function pg_temp.as_user(u uuid) returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

do $test$
declare
  member_u uuid := gen_random_uuid();
  ws uuid; p uuid; n int;
  sel record;
  passed int := 0;
begin
  insert into auth.users (id, email, invited_at, email_confirmed_at) values (member_u, 'm-' || member_u || '@example.test', now(), now());
  delete from app_private.platform_owners;
  perform pg_temp.as_user(member_u);
  ws := (public.create_organization('Selects test', 'AP') ->> 'workspaceId')::uuid;
  insert into public.processes (workspace_id, name) values (ws, 'Invoices') returning id into p;
  execute 'reset role';
  insert into public.extraction_runs (kind, workspace_id, process_id, token_hash, status, source_ids)
    values ('process', ws, p, repeat('a', 64), 'done', '{}');

  -- 1. Each select the store makes runs for a signed-in member and finds the member's run.
  perform pg_temp.as_user(member_u);
  for sel in select * from (values
    ('extraction_runs', 'id, status, error, result, created_at, updated_at, input_tokens, output_tokens')
  ) as t(tbl, cols) loop
    begin
      execute format('select count(*) from (select %s from public.%I where process_id = $1) x', sel.cols, sel.tbl) into n using p;
    exception when insufficient_privilege then
      raise exception 'FAILED 1: the store''s select on % is refused for a signed-in member: %', sel.tbl, sqlerrm;
    end;
    if n <> 1 then raise exception 'FAILED 1: the store''s select on % found % rows', sel.tbl, n; end if;
  end loop;
  passed := passed + 1;

  -- 2. The grant is column by column: the columns kept from people stay refused (the fault this file catches).
  begin
    execute 'select source_ids from public.extraction_runs where process_id = $1' using p;
    raise exception 'FAILED 2: source_ids was readable';
  exception when insufficient_privilege then null;
  end;
  begin
    execute 'select token_hash from public.extraction_runs where process_id = $1' using p;
    raise exception 'FAILED 2: token_hash was readable';
  exception when insufficient_privilege then null;
  end;
  passed := passed + 1;

  raise exception 'ALL_TESTS_PASSED (% groups)', passed;
end $test$;
