-- Walkthrough requests (docs/next-plan.md, section 3d, package 11). Rolls back; success ends with the error
-- "ALL_TESTS_PASSED (6 groups)"; any other error names the failed check.
do $test$
declare
  owner_u uuid := gen_random_uuid();
  other_u uuid := gen_random_uuid();
  r jsonb; id1 uuid; n int; passed int := 0; failed boolean;
begin
  insert into auth.users (id, email, invited_at, email_confirmed_at) values
    (owner_u, 'own-' || owner_u || '@example.test', now(), now()), (other_u, 'oth-' || other_u || '@example.test', now(), now());
  delete from app_private.platform_owners;
  insert into app_private.platform_owners (user_id) values (owner_u);
  delete from public.walkthrough_requests;

  -- 1. The server function's role adds a request; it is counted for a notice email.
  execute 'set local role service_role';
  r := public.submit_walkthrough_request('Asha Rao', 'Asha@Example.com', 'Kaveri', 'Supplier invoices', '6-20');
  execute 'reset role';
  if (r ->> 'ok')::boolean is not true or r ->> 'notice' <> 'each' then raise exception 'FAILED 1a: %', r; end if;
  id1 := (r ->> 'id')::uuid;
  select count(*) into n from public.walkthrough_requests where id = id1 and email = 'asha@example.com' and status = 'new';
  if n <> 1 then raise exception 'FAILED 1b: the request was not stored as sent'; end if;
  passed := passed + 1;

  -- 2. The public and a signed-in person who is not the owner can neither read, write nor call the functions.
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  execute 'set local role anon';
  begin perform count(*) from public.walkthrough_requests; raise exception 'FAILED 2a: the public read the table'; exception when insufficient_privilege then null; end;
  begin insert into public.walkthrough_requests (name, email, company) values ('x', 'x@example.com', 'x'); raise exception 'FAILED 2b: the public wrote'; exception when insufficient_privilege then null; end;
  begin perform public.submit_walkthrough_request('x', 'x@example.com', 'x', null, null); raise exception 'FAILED 2c: the public called submit'; exception when insufficient_privilege then null; end;
  begin perform public.list_walkthrough_requests(); raise exception 'FAILED 2d: the public listed'; exception when insufficient_privilege then null; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', other_u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin perform count(*) from public.walkthrough_requests; raise exception 'FAILED 2e: a signed-in person read the table'; exception when insufficient_privilege then null; end;
  begin perform public.submit_walkthrough_request('x', 'x@example.com', 'x', null, null); raise exception 'FAILED 2f: a signed-in person called submit'; exception when insufficient_privilege then null; end;
  failed := false;
  begin perform public.list_walkthrough_requests(); exception when insufficient_privilege then failed := true; end;
  if not failed then raise exception 'FAILED 2g: a person who is not the owner listed the requests'; end if;
  failed := false;
  begin perform public.set_walkthrough_request_status(id1, 'closed'); exception when insufficient_privilege then failed := true; end;
  if not failed then raise exception 'FAILED 2h: a person who is not the owner set the status'; end if;
  failed := false;
  begin perform public.delete_walkthrough_request(id1); exception when insufficient_privilege then failed := true; end;
  if not failed then raise exception 'FAILED 2i: a person who is not the owner deleted'; end if;
  execute 'reset role';
  passed := passed + 1;

  -- 3. While the owners' list is empty nobody reads the requests (no "anyone on a new deployment" here).
  delete from app_private.platform_owners;
  perform set_config('request.jwt.claims', json_build_object('sub', other_u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  failed := false;
  begin perform public.list_walkthrough_requests(); exception when insufficient_privilege then failed := true; end;
  if not failed then raise exception 'FAILED 3: anyone read the requests while no owner was listed'; end if;
  execute 'reset role';
  insert into app_private.platform_owners (user_id) values (owner_u);
  passed := passed + 1;

  -- 4. The owner lists, sets the status (which counts as contact), notes a reply, and deletes.
  update public.walkthrough_requests set last_contact_at = now() - interval '30 days' where id = id1;
  perform set_config('request.jwt.claims', json_build_object('sub', owner_u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  r := public.list_walkthrough_requests();
  if jsonb_array_length(r) <> 1 or r -> 0 ->> 'company' <> 'Kaveri' then raise exception 'FAILED 4a: %', r; end if;
  perform public.set_walkthrough_request_status(id1, 'answered');
  begin perform public.set_walkthrough_request_status(id1, 'lost'); raise exception 'FAILED 4b: an unknown status'; exception when invalid_parameter_value then null; end;
  execute 'reset role';
  select count(*) into n from public.walkthrough_requests where id = id1 and status = 'answered' and last_contact_at > now() - interval '1 minute';
  if n <> 1 then raise exception 'FAILED 4c: setting the status did not count as contact'; end if;
  update public.walkthrough_requests set last_contact_at = now() - interval '30 days' where id = id1;
  perform set_config('request.jwt.claims', json_build_object('sub', owner_u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.note_walkthrough_reply(id1);
  execute 'reset role';
  select count(*) into n from public.walkthrough_requests where id = id1 and last_contact_at > now() - interval '1 minute';
  if n <> 1 then raise exception 'FAILED 4d: "Reply by email" did not count as contact'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', owner_u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.delete_walkthrough_request(id1);
  execute 'reset role';
  if exists (select 1 from public.walkthrough_requests where id = id1) then raise exception 'FAILED 4e: not deleted'; end if;
  passed := passed + 1;

  -- 5. The limits: 3 an hour from one address, 20 an hour in total, 50 in any 24 hours; notices: 10, then one "more", then none.
  execute 'set local role service_role';
  for i in 1..3 loop r := public.submit_walkthrough_request('Same', 'same@example.com', 'Co', null, null); end loop;
  -- The same address in other capitals and with spaces around it is the same address.
  r := public.submit_walkthrough_request('Same', '  SAME@Example.com ', 'Co', null, null);
  if r ->> 'reason' <> 'too_many' then raise exception 'FAILED 5a: a 4th request from one address in an hour: %', r; end if;
  for i in 1..17 loop r := public.submit_walkthrough_request('P' || i, 'p' || i || '@example.com', 'Co', null, null); end loop;
  if (r ->> 'ok')::boolean is not true then raise exception 'FAILED 5b: the 20th request of the hour was refused: %', r; end if;
  r := public.submit_walkthrough_request('Q', 'q@example.com', 'Co', null, null);
  if r ->> 'reason' <> 'too_many' then raise exception 'FAILED 5c: a 21st request in an hour: %', r; end if;
  execute 'reset role';
  select count(*) into n from public.walkthrough_requests where notice = 'each';
  if n <> 10 then raise exception 'FAILED 5d: % notices, not 10', n; end if;
  select count(*) into n from public.walkthrough_requests where notice = 'more';
  if n <> 1 then raise exception 'FAILED 5e: % "more" emails, not 1', n; end if;
  -- The day: move the hour's requests back two hours, then add up to 50 in 24 hours.
  update public.walkthrough_requests set created_at = now() - interval '2 hours';
  execute 'set local role service_role';
  for i in 1..20 loop r := public.submit_walkthrough_request('R' || i, 'r' || i || '@example.com', 'Co', null, null); end loop;
  execute 'reset role';
  update public.walkthrough_requests set created_at = now() - interval '3 hours' where created_at > now() - interval '1 hour';
  execute 'set local role service_role';
  for i in 1..10 loop r := public.submit_walkthrough_request('S' || i, 's' || i || '@example.com', 'Co', null, null); end loop;
  if (r ->> 'ok')::boolean is not true then raise exception 'FAILED 5f: the 50th request of the day was refused: %', r; end if;
  r := public.submit_walkthrough_request('T', 't@example.com', 'Co', null, null);
  if r ->> 'reason' <> 'too_many' then raise exception 'FAILED 5g: a 51st request in 24 hours: %', r; end if;
  execute 'reset role';
  passed := passed + 1;

  -- 6. Twelve months after the last contact a request is deleted; one contacted since stays. A line break is refused.
  delete from public.walkthrough_requests;
  insert into public.walkthrough_requests (name, email, company, last_contact_at) values
    ('Old', 'old@example.com', 'Co', now() - interval '13 months'), ('Kept', 'kept@example.com', 'Co', now() - interval '11 months');
  n := app_private.delete_old_walkthrough_requests();
  if n <> 1 or not exists (select 1 from public.walkthrough_requests where name = 'Kept') then raise exception 'FAILED 6a: % deleted', n; end if;
  begin
    insert into public.walkthrough_requests (name, email, company) values (E'Asha\nBcc: x@evil.test', 'a@example.com', 'Co');
    raise exception 'FAILED 6b: a name with a line break was stored';
  exception when check_violation then null;
  end;
  if not exists (select 1 from cron.job where jobname = 'avala-walkthrough-requests-retention') then raise exception 'FAILED 6c: no daily job'; end if;
  passed := passed + 1;

  raise exception 'ALL_TESTS_PASSED (% groups)', passed;
end $test$;
