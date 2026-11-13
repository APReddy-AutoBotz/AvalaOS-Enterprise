-- Weekday "Needs you" emails. Rolls back; success ends with the error "ALL_TESTS_PASSED (6 groups)";
-- any other error names the failed check.
do $test$
declare
  ana uuid := gen_random_uuid();
  ben uuid := gen_random_uuid();
  ws uuid; proc uuid; n int; r jsonb; t uuid; ok boolean; passed int := 0;
begin
  insert into auth.users (id, email, invited_at, email_confirmed_at) values
    (ana, 'ana-' || ana || '@example.test', now(), now()), (ben, 'ben-' || ben || '@example.test', now(), now());
  delete from app_private.platform_owners;
  perform set_config('request.jwt.claims', json_build_object('sub', ana, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  ws := (public.create_organization('Digest test', 'Finance') ->> 'workspaceId')::uuid;
  execute 'reset role';
  insert into public.workspace_members (workspace_id, user_id, role, can_approve) values (ws, ben, 'editor', false);
  insert into public.processes (workspace_id, name, created_by, analyst_id) values (ws, 'Pay suppliers', ana, ana) returning id into proc;
  insert into public.process_model_revisions (workspace_id, process_id, rev_no, state, model, edit_seq, created_by)
    values (ws, proc, 1, 'working', jsonb_build_object('openQuestions', jsonb_build_array(
      jsonb_build_object('id', 'q1', 'status', 'open'), jsonb_build_object('id', 'q2', 'status', 'open'), jsonb_build_object('id', 'q3', 'status', 'closed'))), 2, ana);

  -- 1. A person turns the email off and on for themselves only; nobody writes the table directly.
  perform set_config('request.jwt.claims', json_build_object('sub', ben, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  if public.set_needs_email(false) <> false then raise exception 'FAILED 1a'; end if;
  select count(*) into n from public.notification_settings where user_id = ben and not needs_email;
  if n <> 1 then raise exception 'FAILED 1b: own row not readable'; end if;
  select count(*) into n from public.notification_settings where user_id <> ben;
  if n <> 0 then raise exception 'FAILED 1c: another person''s row readable'; end if;
  begin update public.notification_settings set needs_email = true where user_id = ben; exception when insufficient_privilege then null; end;
  execute 'reset role';
  if (select needs_email from public.notification_settings where user_id = ben) then raise exception 'FAILED 1d: direct write changed the setting'; end if;
  passed := passed + 1;

  -- 2. Only the server reads the digest input, records it, checks the secret or unsubscribes.
  perform set_config('request.jwt.claims', json_build_object('sub', ana, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin perform public.needs_digest_input(); raise exception 'FAILED 2a: input readable by a member'; exception when insufficient_privilege then null; end;
  begin perform public.needs_digest_record('[]'::jsonb); raise exception 'FAILED 2b'; exception when insufficient_privilege then null; end;
  begin perform public.needs_digest_secret_ok('x'); raise exception 'FAILED 2c'; exception when insufficient_privilege then null; end;
  begin perform public.unsubscribe_needs_email(gen_random_uuid()); raise exception 'FAILED 2d'; exception when insufficient_privilege then null; end;
  begin perform 1 from app_private.needs_digest_state; raise exception 'FAILED 2e'; exception when insufficient_privilege then null; end;
  execute 'reset role';
  passed := passed + 1;

  -- 3. The input has each member with their address and choice (on unless they turned it off) and each process's state.
  r := public.needs_digest_input();
  select count(*) into n from jsonb_array_elements(r -> 'people') p
    where (p ->> 'workspaceId')::uuid = ws and p ->> 'userId' = ana::text and p ->> 'email' like 'ana-%' and (p ->> 'emailOn')::boolean and p ->> 'access' = 'admin' and (p ->> 'token') is not null;
  if n <> 1 then raise exception 'FAILED 3a: person %', r -> 'people'; end if;
  select count(*) into n from jsonb_array_elements(r -> 'people') p where p ->> 'userId' = ben::text and not (p ->> 'emailOn')::boolean;
  if n <> 1 then raise exception 'FAILED 3b: Ben''s choice'; end if;
  select count(*) into n from jsonb_array_elements(r -> 'processes') p
    where p ->> 'id' = proc::text and p ->> 'status' = 'draft' and (p ->> 'openQuestions')::int = 2 and (p ->> 'proposalsWaiting')::int = 0 and p ->> 'analystId' = ana::text;
  if n <> 1 then raise exception 'FAILED 3c: process %', r -> 'processes'; end if;
  passed := passed + 1;

  -- 4. What each member has is recorded and comes back next time; a person outside the workspace is not recorded.
  n := public.needs_digest_record(jsonb_build_array(
    jsonb_build_object('userId', ana, 'workspaceId', ws, 'keys', jsonb_build_array(proc || ':analyst:documents'), 'sent', true),
    jsonb_build_object('userId', gen_random_uuid(), 'workspaceId', ws, 'keys', jsonb_build_array('x'), 'sent', true)));
  if n <> 1 then raise exception 'FAILED 4a: % recorded', n; end if;
  r := public.needs_digest_input();
  select count(*) into n from jsonb_array_elements(r -> 'seen') s where s ->> 'userId' = ana::text and s -> 'keys' ? (proc || ':analyst:documents');
  if n <> 1 then raise exception 'FAILED 4b: seen %', r -> 'seen'; end if;
  perform public.needs_digest_record(jsonb_build_array(jsonb_build_object('userId', ana, 'workspaceId', ws, 'keys', '[]'::jsonb, 'sent', false)));
  if (select last_sent_at from app_private.needs_digest_state where user_id = ana and workspace_id = ws) is null then raise exception 'FAILED 4c: last sent forgotten'; end if;
  passed := passed + 1;

  -- 5. The link turns the email off for its owner only; an unknown token changes nothing.
  select unsubscribe_token into t from public.notification_settings where user_id = ana;
  if public.unsubscribe_needs_email(gen_random_uuid()) then raise exception 'FAILED 5a: unknown token matched'; end if;
  if not public.unsubscribe_needs_email(t) then raise exception 'FAILED 5b'; end if;
  if (select needs_email from public.notification_settings where user_id = ana) then raise exception 'FAILED 5c: still on'; end if;
  passed := passed + 1;

  -- 6. Only the schedule's secret is accepted, and the schedule runs on weekdays.
  select public.needs_digest_secret_ok((select decrypted_secret from vault.decrypted_secrets where name = 'needs_digest_secret')) into ok;
  if not ok then raise exception 'FAILED 6a: secret refused'; end if;
  if public.needs_digest_secret_ok(repeat('0', 64)) or public.needs_digest_secret_ok(null) then raise exception 'FAILED 6b: wrong secret accepted'; end if;
  select count(*) into n from cron.job where jobname = 'avala-needs-digest' and schedule = '30 3 * * 1-5' and command like '%needs_digest_url%';
  if n <> 1 then raise exception 'FAILED 6c: schedule'; end if;
  passed := passed + 1;

  raise exception 'ALL_TESTS_PASSED (% groups)', passed;
end $test$;
