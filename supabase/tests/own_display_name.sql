-- Behaviour checks for a person setting their own name (migration own_display_name). Rolls back: success ends with
-- the error "ALL_TESTS_PASSED (7 groups)"; any other error names the failed check. It creates its own people only.
-- Run it after the migration, in the same transaction as the trial does, or against a database where it is applied.

-- Updates the signed-in person's own name, and says what happened: 'kept', 'NAME_INVALID', or the error's code.
create function pg_temp.set_name(who uuid, target uuid, new_name text) returns text language plpgsql as $$
declare n int;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', who, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  update public.profiles set display_name = new_name where id = target;
  get diagnostics n = row_count;
  execute 'reset role';
  return case when n = 1 then 'kept' else 'no row' end;
exception
  when check_violation then
    execute 'reset role';
    return case when sqlerrm like 'NAME_INVALID%' then 'NAME_INVALID' else 'check: ' || sqlerrm end;
  when others then
    execute 'reset role';
    return sqlstate;
end $$;

do $test$
declare
  ana uuid := gen_random_uuid();
  ben uuid := gen_random_uuid();
  cy uuid := gen_random_uuid();
  r text; n int; passed int := 0;
begin
  insert into auth.users (id, email, invited_at, email_confirmed_at, raw_user_meta_data) values
    (ana, 'ann.reddy-' || ana || '@example.test', now(), now(), '{}'::jsonb),
    (ben, 'b-' || ben || '@example.test', now(), now(), jsonb_build_object('full_name', 'Ben Iyer'));

  -- 1. A signed-in person sets their own name: kept, trimmed.
  r := pg_temp.set_name(ana, ana, '   Ann  Reddy   ');
  if r <> 'kept' then raise exception 'FAILED 1a: %', r; end if;
  if (select display_name from public.profiles where id = ana) <> 'Ann  Reddy' then
    raise exception 'FAILED 1b: the name is "%"', (select display_name from public.profiles where id = ana);
  end if;
  passed := passed + 1;

  -- 2. Refused: empty, only spaces, 81 characters, an email address. The name stays as it was.
  foreach r in array array['', '    ', repeat('a', 81), 'ann@example.com', 'Ann <ann@x.com>'] loop
    if pg_temp.set_name(ana, ana, r) <> 'NAME_INVALID' then raise exception 'FAILED 2a: "%" was not refused', left(r, 20); end if;
  end loop;
  if (select display_name from public.profiles where id = ana) <> 'Ann  Reddy' then raise exception 'FAILED 2b: a refused name changed it'; end if;
  passed := passed + 1;

  -- 3. 80 characters, and a name with an apostrophe and accents, are kept.
  r := pg_temp.set_name(ana, ana, repeat('b', 80));
  if r <> 'kept' or (select char_length(display_name) from public.profiles where id = ana) <> 80 then raise exception 'FAILED 3a: %', r; end if;
  r := pg_temp.set_name(ana, ana, 'Siobhán O''Brien-Núñez');
  if r <> 'kept' or (select display_name from public.profiles where id = ana) <> 'Siobhán O''Brien-Núñez' then raise exception 'FAILED 3b: %', r; end if;
  passed := passed + 1;

  -- 4. Nobody changes another person's name: no row is updated, and Ben's stays.
  r := pg_temp.set_name(ana, ben, 'Not Ben');
  if r <> 'no row' then raise exception 'FAILED 4a: %', r; end if;
  if (select display_name from public.profiles where id = ben) <> 'Ben Iyer' then raise exception 'FAILED 4b: Ben''s name changed'; end if;
  passed := passed + 1;

  -- 5. A signed-in person can no longer change any other column of their own row.
  perform set_config('request.jwt.claims', json_build_object('sub', ana, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    update public.profiles set created_at = now() - interval '1 year' where id = ana;
    raise exception 'FAILED 5a: created_at could be changed';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.profiles set id = gen_random_uuid() where id = ana;
    raise exception 'FAILED 5b: id could be changed';
  exception when insufficient_privilege then null;
  end;
  execute 'reset role';
  passed := passed + 1;

  -- 6. Sign-up is unchanged: a new account still gets a profile from its email address when it gives no name.
  insert into auth.users (id, email, invited_at, email_confirmed_at, raw_user_meta_data)
  values (cy, 'cy.lee-' || cy || '@example.test', now(), now(), '{}'::jsonb);
  if (select display_name from public.profiles where id = cy) is distinct from 'cy.lee-' || cy then
    raise exception 'FAILED 6: the profile is "%"', (select display_name from public.profiles where id = cy);
  end if;
  passed := passed + 1;

  -- 7. The database owner and the service role are not held to the rule (an account's name is emptied when it goes),
  --    and the service role still updates any column.
  update public.profiles set display_name = '' where id = cy;
  if (select display_name from public.profiles where id = cy) <> '' then raise exception 'FAILED 7a: the owner could not empty a name'; end if;
  execute 'set local role service_role';
  update public.profiles set display_name = 'someone@example.test', created_at = now() - interval '1 day' where id = cy;
  get diagnostics n = row_count;
  execute 'reset role';
  if n <> 1 or (select display_name from public.profiles where id = cy) <> 'someone@example.test' then raise exception 'FAILED 7b: the service role was held to it'; end if;
  passed := passed + 1;

  raise exception 'ALL_TESTS_PASSED (% groups)', passed;
end $test$;
