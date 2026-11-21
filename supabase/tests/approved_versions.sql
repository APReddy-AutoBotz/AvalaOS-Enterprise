-- Behaviour checks for package 14, an approved document is final (migration approved_versions). Rolls back:
-- success ends with the error "ALL_TESTS_PASSED (13 groups)"; any other error names the failed check. It
-- creates its own people, organisation and processes. Run it after the migration, in the same transaction
-- as the trial does, or against a database where the migration is applied.

create function pg_temp.as_user(u uuid) returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.as_owner() returns void language plpgsql as $$ begin execute 'reset role'; end $$;

-- A kept set of format 1 with `n` sections of about 2 KB each in a PDD (domain/docs/keep.ts's shape). The text is
-- made of hashes, which compress far less than real prose: the stored size measured is an upper bound.
create function pg_temp.kept(n int, words text default 'Kept text.') returns jsonb language sql as $$
  select jsonb_build_object('format', 1, 'testPack', null, 'documents', jsonb_build_object('pdd', jsonb_build_object(
    'type', 'pdd', 'title', 'Process definition', 'subtitle', 'Invoices', 'control', '[]'::jsonb, 'openItems', '[]'::jsonb,
    'sections', (select jsonb_agg(jsonb_build_object('id', 's-' || i, 'number', i::text, 'title', 'Section ' || i, 'level', 1,
                   'blocks', jsonb_build_array(jsonb_build_object('kind', 'paragraph', 'text', words || ' ' || (select string_agg(md5(i || '-' || j), ' ') from generate_series(1, 60) j)))))
                 from generate_series(1, n) i))))
$$;
create function pg_temp.prints(n int) returns jsonb language sql as $$
  select jsonb_build_object('pdd', (select jsonb_agg(jsonb_build_object('id', 's-' || i, 'title', 'Section ' || i, 'fp', md5(i::text))) from generate_series(1, n) i))
$$;
create function pg_temp.look(org text) returns jsonb language sql as $$
  select jsonb_build_object('organisation', org, 'font', 'Calibri', 'accent', '002C4B', 'logo', null, 'template', null)
$$;

do $test$
declare
  approver_u uuid := gen_random_uuid();
  editor_u uuid := gen_random_uuid();
  viewer_u uuid := gen_random_uuid();
  outsider_u uuid := gen_random_uuid();
  ws uuid; ws2 uuid; p uuid; p2 uuid; p3 uuid; rev1 uuid; rev2 uuid; v1 uuid; r jsonb; n int; passed int := 0;
  big jsonb; big_look jsonb; t0 timestamptz; ms numeric; sizes text; msg text; st record;
  step jsonb := '{"op": "add", "path": "/steps/0", "value": {"id": "s-1", "name": "Receive invoice", "description": "", "roleIds": [], "systemIds": [], "taskType": "receive", "inputs": [], "outputs": [], "ruleIds": [], "exceptionIds": [], "status": "user-confirmed", "sources": []}}';
  rename jsonb := '[{"op": "replace", "path": "/steps/0/name", "value": "Receive the invoice"}]';
  chosen jsonb := '[{"kind": "step", "stepId": "s-1", "approach": "human", "rationale": "Kept with people.", "by": "Priya", "byId": "00000000-0000-0000-0000-000000000001", "at": "2026-11-21T10:00:00Z"}]';
begin
  insert into auth.users (id, email, invited_at, email_confirmed_at) values
    (approver_u, 'a-' || approver_u || '@example.test', now(), now()), (editor_u, 'e-' || editor_u || '@example.test', now(), now()),
    (viewer_u, 'v-' || viewer_u || '@example.test', now(), now()), (outsider_u, 'o-' || outsider_u || '@example.test', now(), now());
  delete from app_private.platform_owners;
  perform pg_temp.as_user(approver_u);
  ws := (public.create_organization('Versions test', 'AP') ->> 'workspaceId')::uuid;
  insert into public.processes (workspace_id, name) values (ws, 'Invoices') returning id into p;
  insert into public.processes (workspace_id, name) values (ws, 'Approved before copies') returning id into p2;
  insert into public.processes (workspace_id, name) values (ws, 'Kept together') returning id into p3;
  perform pg_temp.as_user(outsider_u);
  ws2 := (public.create_organization('Other', 'X') ->> 'workspaceId')::uuid;
  perform pg_temp.as_owner();
  -- The organisation's creator is an admin; give the approver the right to approve, the editor none.
  update public.workspace_members set can_approve = true where workspace_id = ws and user_id = approver_u;
  insert into public.workspace_members (workspace_id, user_id, role, can_approve) values (ws, editor_u, 'editor', false), (ws, viewer_u, 'viewer', false);

  -- A record with one step, as a working draft.
  perform pg_temp.as_user(editor_u);
  rev1 := (public.model_start_draft(p) ->> 'revisionId')::uuid;
  perform public.model_save_patch(rev1, 0, jsonb_build_array(step), 'user', 'Added a step');

  -- 1. model_approve is one path with approve_version (change a): both call the shared body, and the released
  --    site's refusals read exactly as before, in the same order.
  perform pg_temp.as_owner();
  if position('app_private.approve_revision(target_revision, expected_seq)' in (select prosrc from pg_proc where oid = 'public.model_approve(uuid,bigint)'::regprocedure)) = 0
     or position('app_private.approve_revision(target_revision, expected_seq)' in (select prosrc from pg_proc where proname = 'approve_version')) = 0 then
    raise exception 'FAILED 1a: model_approve and approve_version do not share approve_revision';
  end if;
  if (select count(*) from pg_proc where proname = 'approve_version' and prosrc like '%edit_seq <> expected_seq%') <> 0 then
    raise exception 'FAILED 1b: approve_version carries its own copy of the draft checks';
  end if;
  perform pg_temp.as_user(outsider_u);
  begin perform public.model_approve(rev1, 1); raise exception 'FAILED 1c'; exception when sqlstate 'PT404' then get stacked diagnostics msg = message_text; end;
  if msg <> 'NOT_FOUND: revision' then raise exception 'FAILED 1c: %', msg; end if;
  perform pg_temp.as_user(editor_u);
  begin perform public.model_approve(rev1, 1); raise exception 'FAILED 1d'; exception when sqlstate 'PT403' then get stacked diagnostics msg = message_text; end;
  if msg <> 'FORBIDDEN: approving needs approval rights' then raise exception 'FAILED 1d: %', msg; end if;
  perform pg_temp.as_user(approver_u);
  begin perform public.model_approve(gen_random_uuid(), 1); raise exception 'FAILED 1e'; exception when sqlstate 'PT404' then get stacked diagnostics msg = message_text; end;
  if msg <> 'NOT_FOUND: revision' then raise exception 'FAILED 1e: %', msg; end if;
  begin perform public.model_approve(rev1, 0); raise exception 'FAILED 1f'; exception when sqlstate 'PT409' then get stacked diagnostics msg = message_text; end;
  if msg <> 'EDIT_CONFLICT: the draft is at edit 1, not 0' then raise exception 'FAILED 1f: %', msg; end if;
  passed := passed + 1;

  -- 2. Only an approver keeps a version. Approving the working draft and keeping its documents are one
  --    step: the record is approved by the caller at the database's time, and version 1 points at it. A
  --    version the size of the largest live process (about 1.4 MB as JSON) with a logo and a Word template
  --    is accepted (change g, the database's side).
  big := pg_temp.kept(620);
  big_look := jsonb_build_object('organisation', 'Versions test', 'font', 'Calibri', 'accent', '002C4B',
    'logo', 'data:image/png;base64,' || (select string_agg(md5(i::text), '') from generate_series(1, 12400) i), 'template', jsonb_build_object('name', 'Company.dotx', 'stylesXml', repeat('<w:style w:type="paragraph"/>', 20600)));
  perform pg_temp.as_user(editor_u);
  begin perform public.approve_version(p, rev1, 1, 0, null, big, pg_temp.prints(620), big_look, null, '{}'); raise exception 'FAILED 2a'; exception when sqlstate 'PT403' then null; end;
  perform pg_temp.as_user(viewer_u);
  begin perform public.approve_version(p, rev1, 1, 0, null, big, pg_temp.prints(620), big_look, null, '{}'); raise exception 'FAILED 2b'; exception when sqlstate 'PT403' then null; end;
  perform pg_temp.as_user(outsider_u);
  begin perform public.approve_version(p, rev1, 1, 0, null, big, pg_temp.prints(620), big_look, null, '{}'); raise exception 'FAILED 2c'; exception when sqlstate 'PT404' then null; end;
  perform pg_temp.as_user(approver_u);
  t0 := clock_timestamp();
  r := public.approve_version(p, rev1, 1, 0, null, big, pg_temp.prints(620), big_look, null, '{"build": "test"}');
  ms := round(extract(epoch from clock_timestamp() - t0) * 1000);
  v1 := (r ->> 'versionId')::uuid;
  select count(*) into n from public.approved_versions v join public.process_model_revisions x on x.id = v.model_revision_id
   where v.id = v1 and v.number = 1 and v.reason is null and v.approved_by = approver_u and v.approved_at = now()
     and x.id = rev1 and x.state = 'approved' and x.approved_by = approver_u and v.model_hash = x.model_hash and v.kept_by is null;
  if n <> 1 then raise exception 'FAILED 2d: version 1 does not hold the approval'; end if;
  perform pg_temp.as_owner();
  select format('documents %s KB as text, %s KB stored; look %s KB as text, %s KB stored; %s ms',
                octet_length(v.documents::text) / 1024, pg_column_size(v.documents) / 1024, octet_length(l.look::text) / 1024, pg_column_size(l.look) / 1024, ms)
    into sizes from public.approved_versions v join public.document_looks l on l.workspace_id = v.workspace_id and l.fingerprint = v.look_fingerprint where v.id = v1;
  raise notice 'SIZE %', sizes;
  passed := passed + 1;

  -- 3. The reason: none for version 1; from version 2 required, at least three words. Without a draft of the
  --    record (only a section edit since), the version points at the same approved revision.
  perform pg_temp.as_user(approver_u);
  begin perform public.approve_version(p, null, null, 1, null, pg_temp.kept(3), pg_temp.prints(3), pg_temp.look(''), null, '{}'); raise exception 'FAILED 3a'; exception when sqlstate 'PT422' then null; end;
  begin perform public.approve_version(p, null, null, 1, 'Fixed it', pg_temp.kept(3), pg_temp.prints(3), pg_temp.look(''), null, '{}'); raise exception 'FAILED 3b'; exception when sqlstate 'PT422' then null; end;
  r := public.approve_version(p, null, null, 1, 'The approver limit changed.', pg_temp.kept(3, 'Second.'), pg_temp.prints(3), pg_temp.look(''), '{"sections": [{"doc": "pdd", "id": "s-1", "title": "Section 1", "kind": "changed"}], "documents": [], "look": ["organisation"]}', '{}');
  if (r ->> 'number')::int <> 2 or (r ->> 'revisionId')::uuid <> rev1 then raise exception 'FAILED 3c: %', r; end if;
  perform pg_temp.as_user(approver_u);
  rev2 := (public.model_start_draft(p3) ->> 'revisionId')::uuid;
  perform public.model_save_patch(rev2, 0, jsonb_build_array(step), 'user', 'Added a step');
  begin perform public.approve_version(p3, rev2, 1, 0, 'A reason for one.', pg_temp.kept(2), pg_temp.prints(2), pg_temp.look(''), null, '{}'); raise exception 'FAILED 3d'; exception when sqlstate 'PT422' then null; end;
  passed := passed + 1;

  -- 4. Two approvals at once: the second, made from the same view (expected version 2 is gone), is refused and
  --    approves nothing; numbers are unique per process even for the owner.
  perform pg_temp.as_user(editor_u);
  rev2 := (public.model_start_draft(p) ->> 'revisionId')::uuid;
  perform public.model_save_patch(rev2, 0, rename, 'user', 'Renamed');
  perform pg_temp.as_user(approver_u);
  r := public.approve_version(p, rev2, 1, 2, 'The step was renamed.', pg_temp.kept(3, 'Third.'), pg_temp.prints(3), pg_temp.look(''), null, '{}');
  if (r ->> 'number')::int <> 3 then raise exception 'FAILED 4a: %', r; end if;
  begin perform public.approve_version(p, null, null, 2, 'Approved at the same time.', pg_temp.kept(3), pg_temp.prints(3), pg_temp.look(''), null, '{}'); raise exception 'FAILED 4b'; exception when sqlstate 'PT409' then get stacked diagnostics msg = message_text; end;
  if msg not like 'VERSION_CONFLICT: approved version 3 exists%' then raise exception 'FAILED 4b: %', msg; end if;
  perform pg_temp.as_owner();
  begin
    insert into public.approved_versions (workspace_id, process_id, number, model_revision_id, model_hash, format, documents, fingerprints, look_fingerprint, reason, approved_by, approved_at)
    select workspace_id, process_id, 3, model_revision_id, model_hash, format, documents, fingerprints, look_fingerprint, 'Same number again.', approved_by, approved_at from public.approved_versions where id = v1;
    raise exception 'FAILED 4c: two versions share a number';
  exception when unique_violation then null;
  end;
  passed := passed + 1;

  -- 5. A version, a kept look and a change-record row are never changed or deleted: not by the approver, not
  --    by anyone signed in, and not directly by the owner of the database either.
  perform pg_temp.as_user(approver_u);
  begin update public.approved_versions set reason = 'Rewritten' where id = v1; raise exception 'FAILED 5a'; exception when insufficient_privilege then null; end;
  begin delete from public.approved_versions where id = v1; raise exception 'FAILED 5b'; exception when insufficient_privilege then null; end;
  begin insert into public.document_looks (workspace_id, fingerprint, look) values (ws, repeat('0', 64), '{}'); raise exception 'FAILED 5c'; exception when insufficient_privilege then null; end;
  begin update public.draft_changes set actor = null; raise exception 'FAILED 5d'; exception when insufficient_privilege then null; end;
  perform pg_temp.as_owner();
  begin update public.approved_versions set reason = 'Rewritten' where id = v1; raise exception 'FAILED 5e'; exception when sqlstate '55000' then null; end;
  begin delete from public.approved_versions where id = v1; raise exception 'FAILED 5f'; exception when sqlstate '55000' then null; end;
  begin update public.document_looks set look = '{}' where workspace_id = ws; raise exception 'FAILED 5g'; exception when sqlstate '55000' then null; end;
  begin delete from public.document_looks where workspace_id = ws; raise exception 'FAILED 5h'; exception when sqlstate '55000' then null; end;
  passed := passed + 1;

  -- 6. Approval and the version fail together: a refused version leaves the draft unapproved.
  perform pg_temp.as_user(editor_u);
  rev2 := (public.model_start_draft(p) ->> 'revisionId')::uuid;
  perform public.model_save_patch(rev2, 0, '[{"op": "replace", "path": "/steps/0/name", "value": "Receive and log the invoice"}]', 'user', 'Renamed again');
  perform pg_temp.as_user(approver_u);
  begin perform public.approve_version(p, rev2, 1, 3, 'Renamed once more.', '{"format": 2, "documents": {}}', '{}', pg_temp.look(''), null, '{}'); raise exception 'FAILED 6a'; exception when sqlstate 'PT422' then null; end;
  begin perform public.approve_version(p, rev2, 1, 1, 'Renamed once more.', pg_temp.kept(3), pg_temp.prints(3), pg_temp.look(''), null, '{}'); raise exception 'FAILED 6b'; exception when sqlstate 'PT409' then null; end;
  select count(*) into n from public.process_model_revisions where id = rev2 and state = 'working' and approved_at is null;
  if n <> 1 then raise exception 'FAILED 6c: the draft was approved without its version'; end if;
  begin perform public.approve_version(p, null, null, 3, 'Without the draft.', pg_temp.kept(3), pg_temp.prints(3), pg_temp.look(''), null, '{}'); raise exception 'FAILED 6d'; exception when sqlstate 'PT409' then get stacked diagnostics msg = message_text; end;
  if msg not like 'DRAFT_EXISTS%' then raise exception 'FAILED 6d: %', msg; end if;
  passed := passed + 1;

  -- 7. The look is kept once per workspace: four versions above used two looks.
  perform pg_temp.as_owner();
  select count(*) into n from public.document_looks where workspace_id = ws;
  if n <> 2 or (select count(distinct look_fingerprint) from public.approved_versions where workspace_id = ws) <> 2 then raise exception 'FAILED 7: % looks', n; end if;
  if (select fingerprint from public.document_looks where workspace_id = ws and look = pg_temp.look('')) <> encode(sha256(convert_to(pg_temp.look('')::text, 'UTF8')), 'hex') then raise exception 'FAILED 7b: fingerprint'; end if;
  passed := passed + 1;

  -- 8. Every write the released site makes still succeeds and leaves its row in the change record, with who.
  --    A save that changes nothing writes no row. Requirements saved in bulk leave one row per save.
  perform pg_temp.as_user(editor_u);
  -- Section edits (saveDocumentEdit: upsert; removeDocumentEdit: delete).
  insert into public.document_edits (workspace_id, process_id, doc_type, section_key, html, base_hash) values (ws, p, 'pdd', 's-2-4', '<p>One.</p>', 'h1')
    on conflict (process_id, doc_type, section_key) do update set html = excluded.html, base_hash = excluded.base_hash;
  insert into public.document_edits (workspace_id, process_id, doc_type, section_key, html, base_hash) values (ws, p, 'pdd', 's-2-4', '<p>One.</p>', 'h1')
    on conflict (process_id, doc_type, section_key) do update set html = excluded.html, base_hash = excluded.base_hash, updated_at = now();
  insert into public.document_edits (workspace_id, process_id, doc_type, section_key, html, base_hash) values (ws, p, 'pdd', 's-2-4', '<p>Two.</p>', 'h1')
    on conflict (process_id, doc_type, section_key) do update set html = excluded.html, base_hash = excluded.base_hash;
  delete from public.document_edits where process_id = p and doc_type = 'pdd' and section_key = 's-2-4';
  -- Testers' edits.
  insert into public.test_case_edits (workspace_id, process_id, case_code, fields, base_hash) values (ws, p, 'FR-001.1', '{"expected": "Logged"}', 'b')
    on conflict (process_id, case_code) do update set fields = excluded.fields, set_aside = excluded.set_aside, base_hash = excluded.base_hash;
  insert into public.test_case_edits (workspace_id, process_id, case_code, fields, base_hash, set_aside) values (ws, p, 'FR-001.1', '{"expected": "Logged"}', 'b', true)
    on conflict (process_id, case_code) do update set fields = excluded.fields, set_aside = excluded.set_aside, base_hash = excluded.base_hash;
  delete from public.test_case_edits where process_id = p and case_code = 'FR-001.1';
  -- Requirements, the whole register at once as the Documents page saves it; then the same again; then a person's edit.
  insert into public.requirements (workspace_id, process_id, code, requirement_type, statement, origin, derivation_key, state, user_edited, sort_order)
    select ws, p, 'FR-00' || i, 'functional', 'The system does step ' || i || '.', 'derived', 'k' || i, 'active', false, i from generate_series(1, 3) i
    on conflict (process_id, code) do update set statement = excluded.statement, user_edited = excluded.user_edited, sort_order = excluded.sort_order;
  insert into public.requirements (workspace_id, process_id, code, requirement_type, statement, origin, derivation_key, state, user_edited, sort_order)
    select ws, p, 'FR-00' || i, 'functional', 'The system does step ' || i || '.', 'derived', 'k' || i, 'active', false, i from generate_series(1, 3) i
    on conflict (process_id, code) do update set statement = excluded.statement, user_edited = excluded.user_edited, sort_order = excluded.sort_order;
  insert into public.requirements (workspace_id, process_id, code, requirement_type, statement, origin, derivation_key, state, user_edited, sort_order)
    values (ws, p, 'FR-002', 'functional', 'The system logs the invoice.', 'derived', 'k2', 'active', true, 2)
    on conflict (process_id, code) do update set statement = excluded.statement, user_edited = excluded.user_edited, sort_order = excluded.sort_order;
  -- A source added, then archived.
  insert into public.process_sources (workspace_id, process_id, source_key, title, format, segments) values (ws, p, 'doc-9', 'SOP', 'txt', '[{"text": "x"}]');
  update public.process_sources set archived_at = now() where process_id = p and source_key = 'doc-9';
  -- People's choices: a step's approach, then the computed result saved again with the same choices, then the rate.
  insert into public.assessments (workspace_id, process_id, model_revision_id, model_hash, rules_version, result, overrides, is_stale)
    values (ws, p, rev2, 'h', 'r1', '{}', chosen, false)
    on conflict (model_revision_id) do update set result = excluded.result, overrides = excluded.overrides, is_stale = false;
  insert into public.assessments (workspace_id, process_id, model_revision_id, model_hash, rules_version, result, overrides, is_stale)
    values (ws, p, rev2, 'h', 'r1', '{"recomputed": true}', jsonb_set(chosen, '{0,at}', '"2026-11-22T09:00:00Z"'), false)
    on conflict (model_revision_id) do update set result = excluded.result, overrides = excluded.overrides, is_stale = false;
  insert into public.assessments (workspace_id, process_id, model_revision_id, model_hash, rules_version, result, overrides, is_stale)
    values (ws, p, rev2, 'h', 'r1', '{}', chosen || '[{"kind": "rate", "amount": 40, "currency": "EUR", "enteredBy": "Priya", "at": "x"}]', false)
    on conflict (model_revision_id) do update set result = excluded.result, overrides = excluded.overrides, is_stale = false;
  -- The record itself (its own history, already kept).
  perform public.model_save_patch(rev2, 1, '[{"op": "replace", "path": "/steps/0/name", "value": "Receive, log and file the invoice"}]', 'user', 'Renamed a third time');
  -- Settings, made by an admin (the approver is the organisation's admin): the same assessment settings twice, then the look and the layout.
  perform pg_temp.as_user(approver_u);
  insert into public.workspace_settings (workspace_id, assessment) values (ws, '{"hoursPerFte": 1500}') on conflict (workspace_id) do update set assessment = excluded.assessment;
  insert into public.workspace_settings (workspace_id, assessment) values (ws, '{"hoursPerFte": 1500}') on conflict (workspace_id) do update set assessment = excluded.assessment, updated_at = now();
  insert into public.document_settings (workspace_id, settings) values (ws, '{"branding": {"organisation": "Acme"}, "layouts": {}}') on conflict (workspace_id) do update set settings = excluded.settings;
  insert into public.document_settings (workspace_id, settings) values (ws, '{"branding": {"organisation": "Acme"}, "layouts": {"pdd": {"sections": {"2": {"title": "Ours"}}, "custom": []}}}') on conflict (workspace_id) do update set settings = excluded.settings;
  perform pg_temp.as_owner();
  select string_agg(format('%s/%s/%s/%s:%s', kind, change, origin, item_count, items::text), ' ' order by id) into msg from public.draft_changes where workspace_id = ws;
  if msg is distinct from concat_ws(' ',
       'section_edit/added/person/1:["pdd:s-2-4"]', 'section_edit/changed/person/1:["pdd:s-2-4"]', 'section_edit/removed/person/1:["pdd:s-2-4"]',
       'test_edit/added/person/1:["FR-001.1"]', 'test_edit/changed/person/1:["FR-001.1"]', 'test_edit/removed/person/1:["FR-001.1"]',
       'requirement/added/follows/3:["FR-001", "FR-002", "FR-003"]', 'requirement/changed/person/1:["FR-002"]',
       'source/added/person/1:["doc-9"]', 'source/removed/person/1:["doc-9"]',
       'choice/changed/person/1:["s-1"]', 'rate/changed/person/1:[null]',
       'assessment_settings/changed/person/1:[null]', 'look/changed/person/1:[null]', 'layout/changed/person/1:[null]') then
    raise exception 'FAILED 8a: the change record reads %', msg;
  end if;
  if exists (select 1 from public.draft_changes where workspace_id = ws and kind not in ('assessment_settings', 'look', 'layout') and actor is distinct from editor_u)
     or exists (select 1 from public.draft_changes where workspace_id = ws and kind in ('assessment_settings', 'look', 'layout') and (actor is distinct from approver_u or process_id is not null)) then
    raise exception 'FAILED 8b: who is not recorded';
  end if;
  passed := passed + 1;

  -- 9. A failure inside the change record never refuses a person's save (change e): with the record's own
  --    insert made to fail, every save above still succeeds and leaves nothing.
  alter table public.draft_changes add constraint test_refuses_every_row check (false) not valid;
  select count(*) into n from public.draft_changes;
  perform pg_temp.as_user(editor_u);
  insert into public.document_edits (workspace_id, process_id, doc_type, section_key, html, base_hash) values (ws, p, 'frd', 's-1', '<p>Saved anyway.</p>', 'h');
  update public.requirements set statement = 'The system logs and files the invoice.', user_edited = true where process_id = p and code = 'FR-002';
  insert into public.test_case_edits (workspace_id, process_id, case_code, fields) values (ws, p, 'FR-003.1', '{"expected": "Filed"}');
  update public.assessments set overrides = '[]' where model_revision_id = rev2;
  perform pg_temp.as_owner();
  if (select count(*) from public.document_edits where process_id = p and section_key = 's-1') <> 1
     or (select statement from public.requirements where process_id = p and code = 'FR-002') <> 'The system logs and files the invoice.'
     or (select count(*) from public.test_case_edits where process_id = p) <> 1 or (select overrides from public.assessments where model_revision_id = rev2) <> '[]' then
    raise exception 'FAILED 9a: a save was refused or lost';
  end if;
  if (select count(*) from public.draft_changes) <> n then raise exception 'FAILED 9b: a row was written past the failing check'; end if;
  alter table public.draft_changes drop constraint test_refuses_every_row;
  passed := passed + 1;

  -- 10. What the tag reads, in one call for the list: version 3 with the record edited since; a process approved
  --     before copies were kept; a workspace-wide change named apart.
  perform pg_temp.as_user(viewer_u);
  select * into st from public.version_states(ws) s where s.process_id = p;
  if st.latest_number <> 3 or not st.process_changed or not st.approved_has_version or st.workspace_changes <> array['assessment_settings', 'layout', 'look'] then
    raise exception 'FAILED 10a: %', row_to_json(st);
  end if;
  perform pg_temp.as_user(approver_u);
  rev2 := (public.model_start_draft(p2) ->> 'revisionId')::uuid;
  perform public.model_save_patch(rev2, 0, jsonb_build_array(step), 'user', 'Added a step');
  perform public.model_approve(rev2, 1);
  select * into st from public.version_states(ws, p2) s;
  if st.latest_number is not null or st.approved_rev_no <> 1 or st.approved_has_version or st.process_changed then raise exception 'FAILED 10b: %', row_to_json(st); end if;
  if (select count(*) from public.version_states(ws)) <> 3 then raise exception 'FAILED 10c'; end if;
  passed := passed + 1;

  -- 11. "Keep it as it reads now": records the old approval and who kept it, and when; only once per revision.
  perform pg_temp.as_user(editor_u);
  begin perform public.keep_version_as_reads_now(p2, 0, null, pg_temp.kept(2), pg_temp.prints(2), pg_temp.look(''), null, '{}'); raise exception 'FAILED 11a'; exception when sqlstate 'PT403' then null; end;
  perform pg_temp.as_user(approver_u);
  r := public.keep_version_as_reads_now(p2, 0, null, pg_temp.kept(2), pg_temp.prints(2), pg_temp.look(''), null, '{}');
  select count(*) into n from public.approved_versions v join public.process_model_revisions x on x.id = v.model_revision_id
   where v.id = (r ->> 'versionId')::uuid and v.number = 1 and v.approved_at = x.approved_at and v.approved_by = x.approved_by and v.kept_by = approver_u and v.kept_at = now();
  if n <> 1 then raise exception 'FAILED 11b: both facts are not recorded'; end if;
  begin perform public.keep_version_as_reads_now(p2, 1, 'Kept a second time.', pg_temp.kept(2), pg_temp.prints(2), pg_temp.look(''), null, '{}'); raise exception 'FAILED 11c'; exception when sqlstate 'PT409' then null; end;
  passed := passed + 1;

  -- 12. Members of another workspace see none of it.
  perform pg_temp.as_user(outsider_u);
  if (select count(*) from public.approved_versions) + (select count(*) from public.document_looks) + (select count(*) from public.draft_changes where workspace_id = ws) + (select count(*) from public.version_states(ws)) <> 0 then
    raise exception 'FAILED 12: another workspace''s member reads versions, looks, changes or states';
  end if;
  passed := passed + 1;

  -- 13. Deleting the process (the owner, in the dashboard) removes its versions and its change record; deleting
  --     the workspace removes the rest, the looks included.
  perform pg_temp.as_owner();
  delete from public.processes where id = p;
  if exists (select 1 from public.approved_versions where process_id = p) or exists (select 1 from public.draft_changes where process_id = p) then raise exception 'FAILED 13a'; end if;
  if not exists (select 1 from public.approved_versions where process_id = p2) then raise exception 'FAILED 13b: another process lost its version'; end if;
  delete from public.workspaces where id = ws;
  if exists (select 1 from public.approved_versions where workspace_id = ws) or exists (select 1 from public.document_looks where workspace_id = ws) or exists (select 1 from public.draft_changes where workspace_id = ws) then raise exception 'FAILED 13c'; end if;
  passed := passed + 1;

  raise exception 'ALL_TESTS_PASSED (% groups) %', passed, sizes;
end $test$;
