-- Behaviour checks for the facts merge in parts (migration extraction_facts_parts). Run after the
-- migration, in the same transaction for a trial. Rolls back; success ends with the error
-- "ALL_TESTS_PASSED (5 groups)"; any other error names the failed check.

do $test$
declare
  r uuid; f uuid; nxt text; n int; passed int := 0; ok boolean;
  u uuid := gen_random_uuid(); org uuid; ws uuid; before bigint;
begin
  insert into public.extraction_runs (kind, case_id, token_hash, status, source_ids)
  values ('eval', 'ap-invoice', repeat('a', 64), 'merging', array['sop']) returning id into r;

  -- 1. The new names are allowed, and nothing else is.
  insert into public.extraction_run_parts (run_id, part, output) values (r, 'facts:rules-exceptions', '{}'), (r, 'failed:facts-rules', '{}');
  ok := false;
  begin
    insert into public.extraction_run_parts (run_id, part, output) values (r, 'other:x', '{}');
  exception when check_violation then ok := true;
  end;
  if not ok then raise exception 'FAILED 1: a part named other:x was accepted'; end if;
  delete from public.extraction_run_parts where run_id = r;
  passed := passed + 1;

  -- 2. While merging, facts parts and a split note move nothing on, and their tokens are counted.
  nxt := public.extraction_put_part(r, 'facts:rules-exceptions', '{"splitInto":["rules","exceptions"]}', 900, 12000);
  if nxt is not null then raise exception 'FAILED 2a: a split note moved the run on (%)', nxt; end if;
  nxt := public.extraction_put_part(r, 'facts:rules', '{"data":{"rules":[]}}', 500, 300);
  nxt := coalesce(nxt, public.extraction_put_part(r, 'facts:exceptions', '{"data":{"exceptions":[]}}', 500, 200));
  nxt := coalesce(nxt, public.extraction_put_part(r, 'merge:flow', '{}', 1000, 400));
  if nxt is not null then raise exception 'FAILED 2b: the run moved on before the facts were joined (%)', nxt; end if;
  select status into strict nxt from public.extraction_runs where id = r;
  if nxt <> 'merging' then raise exception 'FAILED 2c: the run is % before the facts were joined', nxt; end if;
  select input_tokens + output_tokens into n from public.extraction_runs where id = r;
  if n <> 900 + 12000 + 500 + 300 + 500 + 200 + 1000 + 400 then raise exception 'FAILED 2d: the totals are % (the split note''s tokens must count)', n; end if;
  passed := passed + 1;

  -- 3. The joined answer moves the run on once; a second join is ignored.
  nxt := public.extraction_put_part(r, 'merge:facts', '{"rules":[]}', 0, 0);
  if nxt is distinct from 'review' then raise exception 'FAILED 3a: the joined facts gave % instead of review', nxt; end if;
  nxt := public.extraction_put_part(r, 'merge:facts', '{"rules":[]}', 0, 0);
  if nxt is not null then raise exception 'FAILED 3b: a second join gave %', nxt; end if;
  select count(*) into n from public.extraction_run_parts where run_id = r and part = 'merge:facts';
  if n <> 1 then raise exception 'FAILED 3c: % joined answers stored', n; end if;
  passed := passed + 1;

  -- 4. A failed step's part adds its tokens and moves nothing on, in any status.
  insert into public.extraction_runs (kind, case_id, token_hash, status, source_ids)
  values ('eval', 'ap-invoice', repeat('b', 64), 'running', array['sop']) returning id into f;
  nxt := public.extraction_put_part(f, 'pass:facts:sop', '{}', 100, 50);
  nxt := coalesce(nxt, public.extraction_put_part(f, 'failed:pass-steps-sop', '{"code":"TRUNCATED"}', 2000, 12000));
  if nxt is not null then raise exception 'FAILED 4a: a failed part moved the run on (%)', nxt; end if;
  select input_tokens + output_tokens into n from public.extraction_runs where id = f;
  if n <> 100 + 50 + 2000 + 12000 then raise exception 'FAILED 4b: the totals are % (the cut-off answer''s tokens must count)', n; end if;
  update public.extraction_runs set status = 'reviewing' where id = f;
  nxt := public.extraction_put_part(f, 'failed:review', '{}', 10, 10);
  if nxt is not null then raise exception 'FAILED 4c: a failed part moved a reviewing run on (%)', nxt; end if;
  passed := passed + 1;

  -- 5. A cut-off call on the platform key, logged as the server logs it, counts against the allowance (7b).
  insert into auth.users (id, email, invited_at, email_confirmed_at) values (u, 'f-' || u || '@example.test', now(), now());
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  insert into public.organizations (name, created_by) values ('Facts parts', u) returning id into org;
  insert into public.workspaces (organization_id, name, created_by) values (org, 'FP', u) returning id into ws;
  before := public.ai_tokens_used_this_month(ws);
  insert into public.ai_usage (workspace_id, user_id, task, model, provider, key_source, status, input_tokens, output_tokens, attempts, error_code)
  values (ws, u, 'merge_facts_rules_exceptions', 'gpt-5.5', 'openai', 'platform', 'truncated', 900, 12000, 1, 'merge_facts_rules_exceptions: TRUNCATED Res');
  if public.ai_tokens_used_this_month(ws) - before <> 12900 then raise exception 'FAILED 5: a cut-off answer''s tokens are not in the allowance'; end if;
  passed := passed + 1;

  raise exception 'ALL_TESTS_PASSED (% groups)', passed;
end
$test$;
