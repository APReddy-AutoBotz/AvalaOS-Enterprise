-- Board step 2: comments, history, sprints and labels. Rolls back; success ends with the error
-- "ALL_TESTS_PASSED (6 groups)"; any other error names the failed check.
do $test$
declare
  ana uuid := gen_random_uuid();   -- admin
  ben uuid := gen_random_uuid();   -- editor
  cara uuid := gen_random_uuid();  -- viewer
  dan uuid := gen_random_uuid();   -- outside the workspace
  ws uuid; proj uuid; other_proj uuid; item uuid; item2 uuid; c uuid; s1 uuid; s2 uuid; s_other uuid;
  n int; ok boolean; v text; passed int := 0;
begin
  insert into auth.users (id, email, invited_at, email_confirmed_at) values
    (ana, 'ana-' || ana || '@example.test', now(), now()), (ben, 'ben-' || ben || '@example.test', now(), now()),
    (cara, 'cara-' || cara || '@example.test', now(), now()), (dan, 'dan-' || dan || '@example.test', now(), now());
  delete from app_private.platform_owners;
  perform set_config('request.jwt.claims', json_build_object('sub', ana, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  ws := (public.create_organization('Board test', 'Finance') ->> 'workspaceId')::uuid;
  execute 'reset role';
  insert into public.workspace_members (workspace_id, user_id, role, can_approve) values (ws, ben, 'editor', false), (ws, cara, 'viewer', false);
  insert into public.delivery_projects (workspace_id, name, created_by) values (ws, 'Website', ana) returning id into proj;
  insert into public.delivery_projects (workspace_id, name, created_by) values (ws, 'Payroll', ana) returning id into other_proj;

  -- 1. History is written by the database: created, then one row per changed field; long text without its values.
  perform set_config('request.jwt.claims', json_build_object('sub', ben, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into public.delivery_work_items (workspace_id, project_id, item_type, title) values (ws, proj, 'story', 'Pay by card') returning id into item;
  insert into public.delivery_work_items (workspace_id, project_id, item_type, title) values (ws, proj, 'bug', 'Total twice') returning id into item2;
  update public.delivery_work_items set status = 'in_progress', owner_id = ana, description = 'A long text', sort_order = 5 where id = item;
  update public.delivery_work_items set sort_order = 9 where id = item;
  select count(*) into n from public.delivery_work_item_events where work_item_id = item and kind = 'created' and actor_id = ben;
  if n <> 1 then raise exception 'FAILED 1a: created event'; end if;
  select count(*) into n from public.delivery_work_item_events where work_item_id = item and kind = 'changed';
  if n <> 3 then raise exception 'FAILED 1b: % change rows (status, owner, description; not sort order)', n; end if;
  select count(*) into n from public.delivery_work_item_events where work_item_id = item and field = 'status' and old_value = 'todo' and new_value = 'in_progress' and actor_id = ben;
  if n <> 1 then raise exception 'FAILED 1c: status row'; end if;
  select count(*) into n from public.delivery_work_item_events where work_item_id = item and field = 'owner' and old_value is null and new_value = ana::text;
  if n <> 1 then raise exception 'FAILED 1d: owner row'; end if;
  select count(*) into n from public.delivery_work_item_events where work_item_id = item and field = 'description' and old_value is null and new_value is null;
  if n <> 1 then raise exception 'FAILED 1e: description kept its values'; end if;
  ok := false;
  begin insert into public.delivery_work_item_events (workspace_id, work_item_id, kind) values (ws, item, 'created'); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAILED 1f: a member wrote the history'; end if;
  begin update public.delivery_work_item_events set new_value = 'x' where work_item_id = item; exception when insufficient_privilege then null; end;
  begin delete from public.delivery_work_item_events where work_item_id = item; exception when insufficient_privilege then null; end;
  execute 'reset role';
  select count(*) into n from public.delivery_work_item_events where work_item_id = item;
  if n <> 4 then raise exception 'FAILED 1g: history changed by a member (% rows)', n; end if;
  if exists (select 1 from public.delivery_work_item_events where new_value = 'x') then raise exception 'FAILED 1h'; end if;
  passed := passed + 1;

  -- 2. Every member comments, viewers too, only as themselves; only the author edits; only the text changes.
  perform set_config('request.jwt.claims', json_build_object('sub', cara, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into public.delivery_work_item_comments (workspace_id, work_item_id, body) values (ws, item, 'Which cards?') returning id into c;
  if (select author_id from public.delivery_work_item_comments where id = c) <> cara then raise exception 'FAILED 2a: author'; end if;
  ok := false;
  begin insert into public.delivery_work_item_comments (workspace_id, work_item_id, author_id, body) values (ws, item, ben, 'As Ben'); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAILED 2b: commented as someone else'; end if;
  ok := false;
  begin insert into public.delivery_work_item_comments (workspace_id, work_item_id, body) values (ws, item, '   '); exception when check_violation then ok := true; end;
  if not ok then raise exception 'FAILED 2c: empty comment'; end if;
  update public.delivery_work_item_comments set body = 'Which cards, Visa only?', work_item_id = item2, created_at = now() - interval '1 day' where id = c;
  select count(*) into n from public.delivery_work_item_comments where id = c and body = 'Which cards, Visa only?' and work_item_id = item and edited_at is not null and created_at > now() - interval '1 hour';
  if n <> 1 then raise exception 'FAILED 2d: edit'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', ben, 'role', 'authenticated')::text, true);
  update public.delivery_work_item_comments set body = 'Changed by Ben' where id = c;
  delete from public.delivery_work_item_comments where id = c;
  execute 'reset role';
  if (select body from public.delivery_work_item_comments where id = c) <> 'Which cards, Visa only?' then raise exception 'FAILED 2e: an editor changed or deleted another person''s comment'; end if;
  passed := passed + 1;

  -- 3. The author or an admin deletes a comment; someone outside the workspace sees nothing.
  perform set_config('request.jwt.claims', json_build_object('sub', dan, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.delivery_work_item_comments where work_item_id = item;
  if n <> 0 then raise exception 'FAILED 3a: outsider reads comments'; end if;
  select count(*) into n from public.delivery_work_item_events where work_item_id = item;
  if n <> 0 then raise exception 'FAILED 3b: outsider reads history'; end if;
  ok := false;
  begin insert into public.delivery_work_item_comments (workspace_id, work_item_id, body) values (ws, item, 'Hello'); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAILED 3c: outsider commented'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', ana, 'role', 'authenticated')::text, true);
  delete from public.delivery_work_item_comments where id = c;
  execute 'reset role';
  if exists (select 1 from public.delivery_work_item_comments where id = c) then raise exception 'FAILED 3d: admin could not delete'; end if;
  passed := passed + 1;

  -- 4. Sprints: editors plan them; one active sprint per project; an item's sprint is of its own project.
  perform set_config('request.jwt.claims', json_build_object('sub', cara, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  ok := false;
  begin insert into public.delivery_sprints (workspace_id, project_id, name) values (ws, proj, 'Sprint 1'); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAILED 4a: a viewer planned a sprint'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', ben, 'role', 'authenticated')::text, true);
  insert into public.delivery_sprints (workspace_id, project_id, name, state) values (ws, proj, 'Sprint 1', 'active') returning id into s1;
  insert into public.delivery_sprints (workspace_id, project_id, name) values (ws, proj, 'Sprint 2') returning id into s2;
  insert into public.delivery_sprints (workspace_id, project_id, name) values (ws, other_proj, 'Payroll 1') returning id into s_other;
  if (select started_at from public.delivery_sprints where id = s1) is null then raise exception 'FAILED 4b: start not stamped'; end if;
  ok := false;
  begin update public.delivery_sprints set state = 'active' where id = s2; exception when unique_violation then ok := true; end;
  if not ok then raise exception 'FAILED 4c: two active sprints'; end if;
  ok := false;
  begin update public.delivery_work_items set sprint_id = s_other where id = item; exception when foreign_key_violation then ok := true; end;
  if not ok then raise exception 'FAILED 4d: sprint of another project'; end if;
  update public.delivery_sprints set project_id = other_proj where id = s2;
  if (select project_id from public.delivery_sprints where id = s2) <> proj then raise exception 'FAILED 4e: sprint moved project'; end if;
  update public.delivery_work_items set sprint_id = s1 where id in (item, item2);
  select count(*) into n from public.delivery_work_item_events where work_item_id = item and field = 'sprint' and new_value = s1::text;
  if n <> 1 then raise exception 'FAILED 4f: sprint change not in history'; end if;
  execute 'reset role';
  passed := passed + 1;

  -- 5. Completing a sprint: unfinished work moves on, done work stays; only editors; no reopening;
  --    deleting a sprint sends its work to the backlog.
  update public.delivery_work_items set status = 'done' where id = item2;
  perform set_config('request.jwt.claims', json_build_object('sub', cara, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  ok := false;
  begin perform public.close_sprint(s1, s2); exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FAILED 5a: a viewer completed a sprint'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', ben, 'role', 'authenticated')::text, true);
  ok := false;
  begin perform public.close_sprint(s1, s_other); exception when invalid_parameter_value then ok := true; end;
  if not ok then raise exception 'FAILED 5b: moved work to another project''s sprint'; end if;
  ok := false;
  begin perform public.close_sprint(s2, null); exception when invalid_parameter_value then ok := true; end;
  if not ok then raise exception 'FAILED 5c: completed a sprint that was not active'; end if;
  n := public.close_sprint(s1, s2);
  if n <> 1 then raise exception 'FAILED 5d: moved %', n; end if;
  if (select sprint_id from public.delivery_work_items where id = item) <> s2 then raise exception 'FAILED 5e: open work not moved'; end if;
  if (select sprint_id from public.delivery_work_items where id = item2) <> s1 then raise exception 'FAILED 5f: done work moved'; end if;
  if (select state || (closed_at is not null)::text from public.delivery_sprints where id = s1) <> 'closedtrue' then raise exception 'FAILED 5g: not closed'; end if;
  ok := false;
  begin update public.delivery_sprints set state = 'active' where id = s1; exception when invalid_parameter_value then ok := true; end;
  if not ok then raise exception 'FAILED 5h: reopened'; end if;
  delete from public.delivery_sprints where id = s2;
  if (select sprint_id is null and project_id = proj from public.delivery_work_items where id = item) is not true then raise exception 'FAILED 5i: delete did not return work to the backlog'; end if;
  execute 'reset role';
  passed := passed + 1;

  -- 6. Labels as in Jira: up to 20, no spaces or commas, up to 40 characters; changes are in the history.
  perform set_config('request.jwt.claims', json_build_object('sub', ben, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  update public.delivery_work_items set labels = array['payments', 'q4-release'] where id = item;
  select new_value into v from public.delivery_work_item_events where work_item_id = item and field = 'labels';
  if v <> 'payments q4-release' then raise exception 'FAILED 6a: labels history %', v; end if;
  foreach v in array array['two words', 'a,b', '', repeat('x', 41)] loop
    ok := false;
    begin update public.delivery_work_items set labels = array[v] where id = item; exception when check_violation then ok := true; end;
    if not ok then raise exception 'FAILED 6b: label "%" accepted', v; end if;
  end loop;
  ok := false;
  begin update public.delivery_work_items set labels = (select array_agg('l' || g) from generate_series(1, 21) g) where id = item; exception when check_violation then ok := true; end;
  if not ok then raise exception 'FAILED 6c: 21 labels'; end if;
  execute 'reset role';
  passed := passed + 1;

  raise exception 'ALL_TESTS_PASSED (% groups)', passed;
end $test$;
