-- Behaviour checks for package B's discovery sessions (migration discovery_sessions). Rolls back: success ends
-- with the error "ALL_TESTS_PASSED (10 groups)"; any other error names the failed check. It creates its own
-- people, organisation and processes. Run it after the migration, in the same transaction as the trial does,
-- or against a database where the migration is applied.

create function pg_temp.as_user(u uuid) returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.as_owner() returns void language plpgsql as $$ begin execute 'reset role'; end $$;

do $test$
declare
  admin_u uuid := gen_random_uuid();
  editor_u uuid := gen_random_uuid();
  viewer_u uuid := gen_random_uuid();
  outsider_u uuid := gen_random_uuid();
  gone_u uuid := gen_random_uuid(); s3 uuid; s4 uuid; s5 uuid; q uuid; v3 int; v4 int; k3 text; k4 text;
  ws uuid; ws2 uuid; p uuid; p2 uuid; p3 uuid; s uuid; s2 uuid; rev uuid; n int; v int; who uuid; started uuid; st text; fin timestamptz;
  kept jsonb := '{"waiting": [{"words": "By email, on Mondays", "question": "How do invoices arrive, and when?"}], "used": {"calls": 2, "tokens": 5400, "readings": 1}}';
  step jsonb := '{"op": "add", "path": "/steps/0", "value": {"id": "s-1", "name": "Receive invoice", "description": "", "roleIds": [], "systemIds": [], "taskType": "receive", "inputs": [], "outputs": [], "ruleIds": [], "exceptionIds": [], "status": "user-confirmed", "sources": []}}';
  passed int := 0;
begin
  insert into auth.users (id, email, invited_at, email_confirmed_at) values
    (admin_u, 'a-' || admin_u || '@example.test', now(), now()), (editor_u, 'e-' || editor_u || '@example.test', now(), now()),
    (viewer_u, 'v-' || viewer_u || '@example.test', now(), now()), (outsider_u, 'o-' || outsider_u || '@example.test', now(), now()),
    (gone_u, 'g-' || gone_u || '@example.test', now(), now());
  delete from app_private.platform_owners;
  perform pg_temp.as_user(admin_u);
  ws := (public.create_organization('Discovery test', 'AP') ->> 'workspaceId')::uuid;
  insert into public.processes (workspace_id, name) values (ws, 'Invoices') returning id into p;
  insert into public.processes (workspace_id, name) values (ws, 'Payments') returning id into p2;
  insert into public.processes (workspace_id, name) values (ws, 'Refunds') returning id into p3;
  perform pg_temp.as_user(outsider_u);
  ws2 := (public.create_organization('Other', 'X') ->> 'workspaceId')::uuid;
  perform pg_temp.as_owner();
  insert into public.workspace_members (workspace_id, user_id, role, can_approve) values (ws, editor_u, 'editor', false), (ws, viewer_u, 'viewer', false), (ws, gone_u, 'editor', false);

  -- 1. An editor starts a session; the database records who and when, whatever the page sends, at version 1.
  perform pg_temp.as_user(editor_u);
  insert into public.discovery_sessions (workspace_id, process_id, state, version, started_by, started_at, updated_by)
    values (ws, p, kept, 9, admin_u, '2020-01-01', admin_u) returning id into s;
  select version, started_by, updated_by, status into v, started, who, st from public.discovery_sessions where id = s;
  if v <> 1 or started is distinct from editor_u or who is distinct from editor_u or st <> 'open' then
    raise exception 'FAILED 1a: version % started by % written by % status %', v, started, who, st;
  end if;
  select count(*) into n from public.discovery_sessions where id = s and started_at > now() - interval '1 minute';
  if n <> 1 then raise exception 'FAILED 1b: the start time is the page''s'; end if;
  begin
    insert into public.discovery_sessions (workspace_id, process_id, status) values (ws, p2, 'finished');
    raise exception 'FAILED 1c: a session started finished';
  exception when raise_exception then
    if sqlerrm not like 'BAD_INPUT%' then raise; end if;
  end;
  passed := passed + 1;

  -- 2. Members read; only editors and admins write. A viewer reads the session and changes nothing.
  perform pg_temp.as_user(viewer_u);
  select count(*) into n from public.discovery_sessions where id = s and state -> 'used' ->> 'tokens' = '5400';
  if n <> 1 then raise exception 'FAILED 2a: a viewer cannot read the session'; end if;
  update public.discovery_sessions set state = '{}' where id = s;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAILED 2b: a viewer changed the session'; end if;
  begin
    insert into public.discovery_sessions (workspace_id, process_id) values (ws, p2);
    raise exception 'FAILED 2c: a viewer started a session';
  exception when insufficient_privilege then null;
  end;
  perform pg_temp.as_user(admin_u);
  update public.discovery_sessions set state = state || '{"skipped": ["k1"]}' where id = s;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAILED 2d: an admin could not write the session'; end if;
  passed := passed + 1;

  -- 3. A write names the version it read. On the current one it goes through, counts one more and is stamped;
  --    one that names an older version is refused, and so is one that only matches an older version.
  perform pg_temp.as_user(editor_u);
  update public.discovery_sessions set state = state || '{"read": ["n:1"]}', version = 2 where id = s;
  select version, updated_by into v, who from public.discovery_sessions where id = s;
  if v <> 3 or who is distinct from editor_u then raise exception 'FAILED 3a: version % by %', v, who; end if;
  begin
    update public.discovery_sessions set state = '{}', version = 2 where id = s;
    raise exception 'FAILED 3b: a write on an older version went through';
  exception when raise_exception then
    if sqlerrm not like 'EDIT_CONFLICT: the session is at version 3, not 2%' then raise; end if;
  end;
  update public.discovery_sessions set state = '{}' where id = s and version = 2;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAILED 3c: a write matching an older version went through'; end if;
  select version into v from public.discovery_sessions where id = s and state ? 'read';
  if v is distinct from 3 then raise exception 'FAILED 3d: the session changed: version %', v; end if;
  -- What started it, and where it belongs, stay the database's.
  update public.discovery_sessions set started_by = admin_u, process_id = p2, started_at = '2020-01-01' where id = s;
  select started_by into started from public.discovery_sessions where id = s and process_id = p and started_at > now() - interval '1 minute';
  if started is distinct from editor_u then raise exception 'FAILED 3e: who started it, or its process, changed'; end if;
  passed := passed + 1;

  -- 4. At most one open session per process; another process has its own.
  begin
    insert into public.discovery_sessions (workspace_id, process_id) values (ws, p);
    raise exception 'FAILED 4a: a second open session for one process';
  exception when unique_violation then null;
  end;
  insert into public.discovery_sessions (workspace_id, process_id) values (ws, p2) returning id into s2;
  passed := passed + 1;

  -- 5. A finished session is kept as it was: the database stamps when; it cannot be reopened or changed. A new
  --    session can then be started on the process.
  update public.discovery_sessions set status = 'finished', finished_at = '2020-01-01' where id = s;
  select status, finished_at into st, fin from public.discovery_sessions where id = s;
  if st <> 'finished' or fin is null or fin < now() - interval '1 minute' then raise exception 'FAILED 5a: % at %', st, fin; end if;
  begin
    update public.discovery_sessions set status = 'open' where id = s;
    raise exception 'FAILED 5b: a finished session was reopened';
  exception when raise_exception then
    if sqlerrm not like 'FINISHED:%' then raise; end if;
  end;
  begin
    update public.discovery_sessions set state = '{}' where id = s;
    raise exception 'FAILED 5c: a finished session was changed';
  exception when raise_exception then
    if sqlerrm not like 'FINISHED:%' then raise; end if;
  end;
  insert into public.discovery_sessions (workspace_id, process_id) values (ws, p);
  select count(*) into n from public.discovery_sessions where process_id = p;
  if n <> 2 then raise exception 'FAILED 5d: % sessions on the process', n; end if;
  passed := passed + 1;

  -- 6. The size limit (256 KB as text), and the state is always an object.
  begin
    update public.discovery_sessions set state = jsonb_build_object('waiting', repeat('x', 262145)) where id = s2;
    raise exception 'FAILED 6a: a state over 256 KB was kept';
  exception when check_violation then null;
  end;
  update public.discovery_sessions set state = jsonb_build_object('waiting', repeat('x', 262000)) where id = s2;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAILED 6b: a state under 256 KB was refused'; end if;
  begin
    update public.discovery_sessions set state = '[]' where id = s2;
    raise exception 'FAILED 6c: a state that is not an object was kept';
  exception when check_violation then null;
  end;
  passed := passed + 1;

  -- 7. Nobody deletes a session by hand, an admin included.
  foreach who in array array[editor_u, admin_u] loop
    perform pg_temp.as_user(who);
    begin
      delete from public.discovery_sessions where id = s;
      raise exception 'FAILED 7: a session was deleted by hand';
    exception when insufficient_privilege then null;
    end;
  end loop;
  passed := passed + 1;

  -- 8. Members of another workspace see nothing, cannot start a session on this workspace's process, and
  --    cannot file one under their own workspace.
  perform pg_temp.as_user(outsider_u);
  select count(*) into n from public.discovery_sessions;
  if n <> 0 then raise exception 'FAILED 8a: another workspace reads a session'; end if;
  update public.discovery_sessions set state = '{}' where id = s2;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAILED 8b: another workspace changed a session'; end if;
  begin
    insert into public.discovery_sessions (workspace_id, process_id) values (ws, p3);
    raise exception 'FAILED 8c: another workspace started a session';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.discovery_sessions (workspace_id, process_id) values (ws2, p3);
    raise exception 'FAILED 8d: a session was filed under another workspace';
  exception when foreign_key_violation then null;
  end;
  passed := passed + 1;

  -- 9. Every write the released site makes on a process still succeeds beside a session; deleting the process
  --    removes its sessions and leaves another process's; deleting the workspace removes the rest.
  perform pg_temp.as_user(editor_u);
  rev := (public.model_start_draft(p) ->> 'revisionId')::uuid;
  perform public.model_save_patch(rev, 0, jsonb_build_array(step), 'user', 'Added a step');
  update public.processes set name = 'Supplier invoices' where id = p;
  insert into public.process_sources (workspace_id, process_id, source_key, title, format, kind, segments)
    values (ws, p, 'own-1', 'Described in own words, 24 Nov 2026', 'txt', 'Own words', '[{"text": "Invoices arrive by email."}]');
  insert into public.process_sources (workspace_id, process_id, source_key, title, format, kind, segments)
    values (ws, p, 'ans-1', 'Discovery answers, 24 Nov 2026', 'txt', 'Discovery answers', '[{"text": "By email, on Mondays", "locator": {"heading": "Answer to: How do invoices arrive, and when?", "lineStart": 1}}]');
  update public.process_sources set archived_at = now() where process_id = p and source_key = 'own-1';
  insert into public.process_source_looks (process_id, workspace_id, look) values (p, ws, '{"calls": 1}');
  select count(*) into n from public.process_sources where process_id = p;
  if n <> 2 then raise exception 'FAILED 9a: % sources', n; end if;
  perform pg_temp.as_owner();
  delete from public.processes where id = p;
  select count(*) into n from public.discovery_sessions where process_id = p;
  if n <> 0 then raise exception 'FAILED 9b: a session outlived its process'; end if;
  select count(*) into n from public.discovery_sessions where process_id = p2;
  if n <> 1 then raise exception 'FAILED 9c: another process''s session went'; end if;
  delete from public.workspaces where id = ws;
  select count(*) into n from public.discovery_sessions where workspace_id = ws;
  if n <> 0 then raise exception 'FAILED 9d: a session outlived its workspace'; end if;
  passed := passed + 1;

  -- 10. An account can always be deleted (found in review, 24 November 2026). A person who started and last wrote
  --     an open session and a finished one is deleted: the deletion succeeds, both rows stay, who started and who
  --     wrote are cleared, and the state, status and version are as they were. A person's own update that clears
  --     who started a session leaves it as it was.
  perform pg_temp.as_owner();
  insert into public.processes (workspace_id, name) values (ws2, 'Claims') returning id into p;
  insert into public.processes (workspace_id, name) values (ws2, 'Returns') returning id into p2;
  insert into public.processes (workspace_id, name) values (ws2, 'Credits') returning id into q;
  insert into public.workspace_members (workspace_id, user_id, role, can_approve) values (ws2, gone_u, 'editor', false), (ws2, editor_u, 'editor', false);
  perform pg_temp.as_user(gone_u);
  insert into public.discovery_sessions (workspace_id, process_id, state) values (ws2, p, kept) returning id into s3;
  update public.discovery_sessions set state = state || '{"read": ["n:1"]}' where id = s3;
  insert into public.discovery_sessions (workspace_id, process_id, state) values (ws2, p2, kept) returning id into s4;
  update public.discovery_sessions set status = 'finished' where id = s4;
  perform pg_temp.as_user(editor_u);
  insert into public.discovery_sessions (workspace_id, process_id) values (ws2, q) returning id into s5;
  perform pg_temp.as_owner();
  select version, state::text into v3, k3 from public.discovery_sessions where id = s3;
  select version, state::text into v4, k4 from public.discovery_sessions where id = s4;
  delete from auth.users where id = gone_u;
  select count(*) into n from public.discovery_sessions
    where (id = s3 and status = 'open' and version = v3 and state::text = k3 or id = s4 and status = 'finished' and version = v4 and state::text = k4)
      and started_by is null and updated_by is null;
  if n <> 2 then raise exception 'FAILED 10a: after the account was deleted, % of 2 sessions are as they were with no one named', n; end if;
  perform pg_temp.as_user(editor_u);
  update public.discovery_sessions set started_by = null where id = s5;
  select started_by into started from public.discovery_sessions where id = s5;
  if started is distinct from editor_u then raise exception 'FAILED 10b: a person cleared who started a session'; end if;
  perform pg_temp.as_owner();
  update public.discovery_sessions set started_by = null, state = '{}' where id = s3;
  select version into v from public.discovery_sessions where id = s3;
  if v <> v3 + 1 then raise exception 'FAILED 10c: a direct update with more than the clean-up was not a normal write'; end if;
  -- The same from inside another trigger (depth 2, as the link's clean-up arrives): more than clearing the two
  -- names is still a normal write, counted and stamped.
  create temp table poke (id uuid);
  create function pg_temp.poke_session() returns trigger language plpgsql as $f$
  begin update public.discovery_sessions set updated_by = null, state = '{"poked": true}' where id = new.id; return new; end $f$;
  create trigger poke after insert on poke for each row execute function pg_temp.poke_session();
  insert into poke values (s3);
  select count(*) into n from public.discovery_sessions where id = s3 and version = v3 + 2 and state ? 'poked';
  if n <> 1 then raise exception 'FAILED 10d: an update from a trigger that did more than the clean-up went through as it was'; end if;
  -- And naming someone, rather than clearing a name, is never the clean-up: who started it is put back.
  create temp table name_someone (id uuid, who uuid);
  create function pg_temp.name_someone() returns trigger language plpgsql as $f$
  begin update public.discovery_sessions set started_by = new.who where id = new.id; return new; end $f$;
  create trigger name_someone after insert on name_someone for each row execute function pg_temp.name_someone();
  insert into name_someone values (s3, editor_u);
  select count(*) into n from public.discovery_sessions where id = s3 and started_by is null and version = v3 + 3;
  if n <> 1 then raise exception 'FAILED 10e: an update from a trigger that named who started a session went through'; end if;
  create function pg_temp.name_writer() returns trigger language plpgsql as $f$
  begin update public.discovery_sessions set updated_by = new.who where id = new.id; return new; end $f$;
  drop trigger name_someone on name_someone;
  create trigger name_writer after insert on name_someone for each row execute function pg_temp.name_writer();
  insert into name_someone values (s3, viewer_u);
  select count(*) into n from public.discovery_sessions where id = s3 and updated_by is distinct from viewer_u and version = v3 + 4;
  if n <> 1 then raise exception 'FAILED 10f: an update from a trigger that named who wrote last went through'; end if;
  passed := passed + 1;

  raise exception 'ALL_TESTS_PASSED (% groups)', passed;
end $test$;
