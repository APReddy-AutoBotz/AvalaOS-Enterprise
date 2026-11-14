-- Behaviour checks for Process Model persistence (WP1.2): JSON Patch, drafts, optimistic
-- concurrency, approval, immutability and permissions.
--
-- Run the whole block against a database with the migrations applied. It creates its own users and
-- data and always rolls back: success ends with the error "ALL_TESTS_PASSED (8 groups)"; any other
-- error names the failed check.
--
-- Group 7 replays patches produced by domain/processModel/patch.ts and compares the stored model
-- with the model the domain code produced. Regenerate them if patch.ts changes how it diffs.

do $test$
declare
  admin_u uuid := gen_random_uuid();
  editor_u uuid := gen_random_uuid();
  viewer_u uuid := gen_random_uuid();
  outsider_u uuid := gen_random_uuid();
  ws uuid; p uuid; p2 uuid; r jsonb; rev1 uuid; rev2 uuid; n int; passed int := 0;
  m jsonb; patch jsonb; i int;
  parity_patches jsonb := '[[{"op": "add", "path": "/steps/0", "value": {"id": "s-1", "name": "Receive invoice", "description": "", "roleIds": [], "systemIds": [], "taskType": "receive", "inputs": [], "outputs": [], "ruleIds": [], "exceptionIds": [], "status": "user-confirmed", "sources": []}}], [{"op": "add", "path": "/steps/1", "value": {"id": "s-2", "name": "Check vendor", "description": "", "roleIds": [], "systemIds": [], "taskType": "user", "inputs": [], "outputs": [], "ruleIds": [], "exceptionIds": [], "status": "user-confirmed", "sources": []}}, {"op": "add", "path": "/flows/0", "value": {"id": "f-1", "from": "s-1", "to": "s-2"}}], [{"op": "add", "path": "/steps/2", "value": {"id": "s-3", "name": "Post invoice", "description": "", "roleIds": [], "systemIds": [], "taskType": "user", "inputs": [], "outputs": [], "ruleIds": [], "exceptionIds": [], "status": "user-confirmed", "sources": []}}, {"op": "add", "path": "/flows/1", "value": {"id": "f-2", "from": "s-2", "to": "s-3"}}], [{"op": "add", "path": "/steps/3", "value": {"id": "s-4", "name": "Check duplicate", "description": "", "roleIds": [], "systemIds": [], "taskType": "business_rule", "inputs": [], "outputs": [], "ruleIds": [], "exceptionIds": [], "status": "user-confirmed", "sources": []}}, {"op": "replace", "path": "/flows", "value": [{"id": "f-2", "from": "s-2", "to": "s-3"}, {"id": "f-1", "from": "s-1", "to": "s-4"}, {"id": "f-3", "from": "s-4", "to": "s-2"}]}], [{"op": "replace", "path": "/meta/owner/value", "value": "AP manager"}, {"op": "replace", "path": "/meta/owner/status", "value": "user-confirmed"}], [{"op": "replace", "path": "/steps/1/name", "value": "Check vendor ~ GSTIN / bank"}], [{"op": "replace", "path": "/flows/0/id", "value": "f-3"}, {"op": "replace", "path": "/flows/0/from", "value": "s-4"}, {"op": "replace", "path": "/flows/0/to", "value": "s-2"}, {"op": "replace", "path": "/flows/1/to", "value": "s-3"}, {"op": "replace", "path": "/flows/2/id", "value": "f-2"}, {"op": "replace", "path": "/flows/2/from", "value": "s-3"}, {"op": "replace", "path": "/flows/2/to", "value": "s-4"}], [{"op": "add", "path": "/flows/3", "value": {"id": "f-4", "from": "s-1", "to": "s-2", "label": "Skip"}}], [{"op": "remove", "path": "/steps/0"}, {"op": "replace", "path": "/flows", "value": [{"id": "f-3", "from": "s-4", "to": "s-2"}, {"id": "f-2", "from": "s-3", "to": "s-4"}]}], [{"op": "remove", "path": "/flows/0"}]]'::jsonb;
  parity_expected jsonb := '{"schemaVersion": 1, "meta": {"name": "Parity check", "objective": {"value": null, "status": "unknown", "sources": []}, "owner": {"value": "AP manager", "status": "user-confirmed", "sources": []}, "scopeIn": [], "scopeOut": [], "metrics": []}, "roles": [], "systems": [], "events": [], "steps": [{"id": "s-2", "name": "Check vendor ~ GSTIN / bank", "description": "", "roleIds": [], "systemIds": [], "taskType": "user", "inputs": [], "outputs": [], "ruleIds": [], "exceptionIds": [], "status": "user-confirmed", "sources": []}, {"id": "s-3", "name": "Post invoice", "description": "", "roleIds": [], "systemIds": [], "taskType": "user", "inputs": [], "outputs": [], "ruleIds": [], "exceptionIds": [], "status": "user-confirmed", "sources": []}, {"id": "s-4", "name": "Check duplicate", "description": "", "roleIds": [], "systemIds": [], "taskType": "business_rule", "inputs": [], "outputs": [], "ruleIds": [], "exceptionIds": [], "status": "user-confirmed", "sources": []}], "gateways": [], "flows": [{"id": "f-2", "from": "s-3", "to": "s-4"}], "rules": [], "exceptions": [], "dataObjects": [], "painPoints": [], "controls": [], "risks": [], "openQuestions": [], "conflicts": []}'::jsonb;

begin
  insert into auth.users (id, email, invited_at, email_confirmed_at) values
    (admin_u, 'a-' || admin_u || '@example.test', now(), now()), (editor_u, 'e-' || editor_u || '@example.test', now(), now()),
    (viewer_u, 'v-' || viewer_u || '@example.test', now(), now()), (outsider_u, 'o-' || outsider_u || '@example.test', now(), now());
  -- Organizations are the platform owner's to create; with no owner listed, as in a new deployment, the test user may.
  delete from app_private.platform_owners;

  perform set_config('request.jwt.claims', json_build_object('sub', admin_u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  ws := (public.create_organization('Persistence test', 'AP') ->> 'workspaceId')::uuid;
  insert into public.processes (workspace_id, name) values (ws, 'Vendor invoice processing') returning id into p;
  insert into public.processes (workspace_id, name) values (ws, 'Parity check') returning id into p2;
  execute 'reset role';
  insert into public.workspace_members (workspace_id, user_id, role, can_approve) values
    (ws, editor_u, 'editor', false), (ws, viewer_u, 'viewer', false);

  -- 1. JSON Patch in SQL: add, remove, replace, test, escaping, append, bad paths.
  m := app_private.jsonb_apply_patch('{"a":[1,2],"x/y":{"~k":1}}'::jsonb, '[
    {"op":"add","path":"/a/-","value":3},
    {"op":"add","path":"/a/0","value":0},
    {"op":"remove","path":"/a/1"},
    {"op":"replace","path":"/x~1y/~0k","value":2},
    {"op":"add","path":"/new","value":{"b":null}},
    {"op":"test","path":"/a","value":[0,2,3]}]'::jsonb);
  if m <> '{"a":[0,2,3],"x/y":{"~k":2},"new":{"b":null}}'::jsonb then raise exception 'TEST FAIL 1: apply result %', m; end if;
  begin
    perform app_private.jsonb_apply_patch('{"a":[1]}'::jsonb, '[{"op":"remove","path":"/a/5"}]'::jsonb);
    raise exception 'TEST FAIL 1b: removed a missing index';
  exception when sqlstate 'PT422' then null;
  end;
  begin
    perform app_private.jsonb_apply_patch('{"a":[1]}'::jsonb, '[{"op":"replace","path":"/a/-1","value":0}]'::jsonb);
    raise exception 'TEST FAIL 1c: accepted a negative index';
  exception when sqlstate 'PT422' then null;
  end;
  begin
    perform app_private.jsonb_apply_patch('{"a":1}'::jsonb, '[{"op":"test","path":"/a","value":2}]'::jsonb);
    raise exception 'TEST FAIL 1d: failed test op passed';
  exception when sqlstate 'PT409' then null;
  end;
  begin
    perform app_private.jsonb_apply_patch('{"a":1}'::jsonb, '[{"op":"move","from":"/a","path":"/b"}]'::jsonb);
    raise exception 'TEST FAIL 1e: unsupported op accepted';
  exception when sqlstate 'PT422' then null;
  end;
  passed := passed + 1;

  -- 2. Starting a draft creates an empty model with only the process name; starting again returns the same draft.
  perform set_config('request.jwt.claims', json_build_object('sub', editor_u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  r := public.model_start_draft(p);
  rev1 := (r ->> 'revisionId')::uuid;
  if (r ->> 'created')::boolean is not true or (r ->> 'seq')::int <> 0 or (r ->> 'revNo')::int <> 1 then raise exception 'TEST FAIL 2: first draft %', r; end if;
  if r -> 'model' -> 'meta' ->> 'name' <> 'Vendor invoice processing' or jsonb_array_length(r -> 'model' -> 'steps') <> 0
     or r -> 'model' -> 'meta' -> 'owner' ->> 'status' <> 'unknown' then raise exception 'TEST FAIL 2b: empty model %', r -> 'model'; end if;
  r := public.model_start_draft(p);
  if (r ->> 'revisionId')::uuid <> rev1 or (r ->> 'created')::boolean then raise exception 'TEST FAIL 2c: second draft created'; end if;
  passed := passed + 1;

  -- 3. Saving a patch advances the sequence and logs the edit; a stale sequence is a conflict and changes nothing.
  r := public.model_save_patch(rev1, 0, '[{"op":"replace","path":"/meta/owner","value":{"value":"AP manager","status":"user-confirmed","sources":[]}}]'::jsonb, 'user', 'Set owner');
  if (r ->> 'seq')::int <> 1 then raise exception 'TEST FAIL 3: seq %', r; end if;
  begin
    perform public.model_save_patch(rev1, 0, '[{"op":"replace","path":"/meta/name","value":"Other"}]'::jsonb);
    raise exception 'TEST FAIL 3b: stale save accepted';
  exception when sqlstate 'PT409' then null;
  end;
  select count(*) into n from public.process_model_edits where revision_id = rev1;
  if n <> 1 then raise exception 'TEST FAIL 3c: % edits logged', n; end if;
  if (select model -> 'meta' ->> 'name' from public.process_model_revisions where id = rev1) <> 'Vendor invoice processing' then raise exception 'TEST FAIL 3d: conflicting save changed the model'; end if;
  if (select model_hash from public.process_model_revisions where id = rev1) <> (r ->> 'modelHash') then raise exception 'TEST FAIL 3e: hash not stored'; end if;
  passed := passed + 1;

  -- 4. A patch that breaks the model's shape, or a bad path, is refused and changes nothing.
  begin
    perform public.model_save_patch(rev1, 1, '[{"op":"remove","path":"/steps"}]'::jsonb);
    raise exception 'TEST FAIL 4: shape-breaking patch accepted';
  exception when sqlstate 'PT422' then null;
  end;
  begin
    perform public.model_save_patch(rev1, 1, '[{"op":"replace","path":"/steps/0/name","value":"x"}]'::jsonb);
    raise exception 'TEST FAIL 4b: patch on a missing path accepted';
  exception when sqlstate 'PT422' then null;
  end;
  begin
    perform public.model_save_patch(rev1, 1, '[]'::jsonb);
    raise exception 'TEST FAIL 4c: empty patch accepted';
  exception when sqlstate 'PT422' then null;
  end;
  if (select edit_seq from public.process_model_revisions where id = rev1) <> 1 then raise exception 'TEST FAIL 4d: refused patches moved the sequence'; end if;
  passed := passed + 1;

  -- 5. Permissions: viewers and outsiders cannot edit; editors cannot approve; direct writes are refused.
  perform set_config('request.jwt.claims', json_build_object('sub', viewer_u, 'role', 'authenticated')::text, true);
  begin
    perform public.model_save_patch(rev1, 1, '[{"op":"replace","path":"/meta/name","value":"V"}]'::jsonb);
    raise exception 'TEST FAIL 5: viewer saved';
  exception when sqlstate 'PT403' then null;
  end;
  if public.model_history(p) -> 'revisions' -> 0 ->> 'id' <> rev1::text then raise exception 'TEST FAIL 5b: viewer cannot read history'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', outsider_u, 'role', 'authenticated')::text, true);
  begin
    perform public.model_save_patch(rev1, 1, '[{"op":"replace","path":"/meta/name","value":"O"}]'::jsonb);
    raise exception 'TEST FAIL 5c: outsider saved';
  exception when sqlstate 'PT404' then null;
  end;
  begin
    perform public.model_start_draft(p);
    raise exception 'TEST FAIL 5d: outsider started a draft';
  exception when sqlstate 'PT404' then null;
  end;
  if jsonb_array_length(public.model_history(p) -> 'revisions') <> 0 then raise exception 'TEST FAIL 5e: outsider sees history'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', editor_u, 'role', 'authenticated')::text, true);
  begin
    perform public.model_approve(rev1, 1);
    raise exception 'TEST FAIL 5f: editor without approval rights approved';
  exception when sqlstate 'PT403' then null;
  end;
  begin
    update public.process_model_revisions set model = '{}'::jsonb where id = rev1;
    get diagnostics n = row_count;
    if n > 0 then raise exception 'TEST FAIL 5g: direct update changed a revision'; end if;
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.process_model_edits (workspace_id, process_id, revision_id, seq, patch, origin) values (ws, p, rev1, 99, '[]', 'user');
    raise exception 'TEST FAIL 5h: direct edit insert';
  exception when insufficient_privilege then null;
  end;
  passed := passed + 1;

  -- 6. Approval: approved revisions are frozen; a new draft copies the approved model; approving again supersedes.
  perform set_config('request.jwt.claims', json_build_object('sub', admin_u, 'role', 'authenticated')::text, true);
  begin
    perform public.model_approve(rev1, 0);
    raise exception 'TEST FAIL 6: approved a stale draft';
  exception when sqlstate 'PT409' then null;
  end;
  r := public.model_approve(rev1, 1);
  begin
    perform public.model_save_patch(rev1, 1, '[{"op":"replace","path":"/meta/name","value":"After approval"}]'::jsonb);
    raise exception 'TEST FAIL 6b: edited an approved revision';
  exception when sqlstate 'PT409' then null;
  end;
  r := public.model_start_draft(p);
  rev2 := (r ->> 'revisionId')::uuid;
  if (r ->> 'revNo')::int <> 2 or r -> 'model' -> 'meta' -> 'owner' ->> 'value' <> 'AP manager' then raise exception 'TEST FAIL 6c: new draft %', r; end if;
  if (select based_on from public.process_model_revisions where id = rev2) <> rev1 then raise exception 'TEST FAIL 6d: based_on'; end if;
  perform public.model_save_patch(rev2, 0, '[{"op":"replace","path":"/meta/name","value":"Vendor invoice processing (India)"}]'::jsonb);
  if (select model -> 'meta' ->> 'name' from public.process_model_revisions where id = rev1) <> 'Vendor invoice processing' then raise exception 'TEST FAIL 6e: editing the draft changed the approved revision'; end if;
  perform public.model_approve(rev2, 1);
  if (select state from public.process_model_revisions where id = rev1) <> 'superseded' or (select state from public.process_model_revisions where id = rev2) <> 'approved' then raise exception 'TEST FAIL 6f: states after second approval'; end if;
  select count(*) into n from public.process_model_revisions where process_id = p and state = 'working';
  if n <> 0 then raise exception 'TEST FAIL 6g: % working drafts after approval', n; end if;
  r := public.model_history(p);
  if jsonb_array_length(r -> 'revisions') <> 2 or jsonb_array_length(r -> 'edits') <> 2 or (r -> 'revisions' -> 0 ->> 'revNo')::int <> 2 then raise exception 'TEST FAIL 6h: history %', r; end if;
  passed := passed + 1;

  -- 7. Patches from the domain code give the same model in SQL as in TypeScript.
  r := public.model_start_draft(p2);
  rev1 := (r ->> 'revisionId')::uuid;
  for i in 0 .. jsonb_array_length(parity_patches) - 1 loop
    perform public.model_save_patch(rev1, i, parity_patches -> i, 'user', 'parity');
  end loop;
  m := (select model from public.process_model_revisions where id = rev1);
  if m <> parity_expected then raise exception 'TEST FAIL 7: SQL result differs from TypeScript: %', m; end if;
  passed := passed + 1;

  -- 8. Deleting a process removes its revisions and edits, including approved ones.
  execute 'reset role';
  delete from public.processes where id = p;
  select count(*) into n from public.process_model_edits where process_id = p;
  if n <> 0 then raise exception 'TEST FAIL 8: % edits left', n; end if;
  passed := passed + 1;

  raise exception 'ALL_TESTS_PASSED (% groups); rolling back test data', passed;
end $test$;
