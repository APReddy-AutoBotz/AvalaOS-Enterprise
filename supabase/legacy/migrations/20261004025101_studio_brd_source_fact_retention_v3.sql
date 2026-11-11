-- BRD source-fact retention prompt v3. Historical attempts retain their stored
-- v1/v2 identities and canonical hashes; only newly requested ordinary BRD
-- attempts select v3. The existing one-use v2 quality window stays pinned to v2.
DO $studio_brd_prompt_v3_preflight$
DECLARE marker public.hosted_pilot_environment_identity;
  studio_control public.studio_artifact_runtime_control;
  enterprise_control public.enterprise_intelligence_runtime_control;
BEGIN
  LOCK TABLE public.hosted_pilot_environment_identity IN SHARE ROW EXCLUSIVE MODE;
  SELECT * INTO STRICT marker FROM public.hosted_pilot_environment_identity WHERE singleton FOR UPDATE;
  SELECT * INTO studio_control FROM public.studio_artifact_runtime_control WHERE singleton FOR SHARE;
  SELECT * INTO enterprise_control FROM public.enterprise_intelligence_runtime_control WHERE singleton FOR SHARE;
  IF marker.product_key<>'avalaos-core'
    OR marker.environment_class<>'hosted_nonproduction_pilot'
    OR marker.schema_contract<>'hosted-pilot-2026-08'
    OR marker.migration_tip<>'20261003150800'
    OR marker.production_authorized OR marker.customer_data_authorized OR marker.real_provider_calls_authorized
    OR studio_control.singleton IS NULL OR enterprise_control.singleton IS NULL
    OR studio_control.provider_enabled OR enterprise_control.provider_enabled THEN
    RAISE EXCEPTION 'STUDIO_BRD_PROMPT_V3_REQUIRES_PROVIDERS_OFF';
  END IF;
END
$studio_brd_prompt_v3_preflight$;

ALTER TABLE public.studio_artifact_generation_attempts
  DROP CONSTRAINT studio_generation_provider_plan_check,
  ADD CONSTRAINT studio_generation_provider_plan_check CHECK(
    (provider_plan_state='legacy_unverified' AND provider_route_id IS NULL AND provider_config_id IS NULL AND provider_name IS NULL AND provider_model IS NULL AND prompt_key IS NULL AND prompt_version IS NULL AND provider_plan_hash IS NULL)
    OR(provider_plan_state='bound' AND provider_route_id IS NOT NULL AND provider_config_id IS NOT NULL
      AND provider_name IN('openai','azure_openai','anthropic','gemini','groq','openai_compatible')
      AND length(btrim(provider_model)) BETWEEN 1 AND 200
      AND prompt_key IS NOT NULL AND prompt_version IS NOT NULL AND provider_plan_hash IS NOT NULL
      AND prompt_key='studio-multisource-generation'
      AND prompt_version IN('studio-pr-b-1','studio-pr-b-2','studio-pr-b-3')
      AND provider_plan_hash~'^[0-9a-f]{64}$')
  );

DO $studio_brd_prompt_v3_request_forward$
DECLARE request_function regprocedure:='public.studio_artifact_generation_request_v2(jsonb)'::regprocedure;
  definition text;
  prior_selection text:='prompt_version:=CASE artifact.artifact_type WHEN ''brd'' THEN ''studio-pr-b-2'' ELSE ''studio-pr-b-1'' END;';
  next_selection text:='prompt_version:=CASE artifact.artifact_type WHEN ''brd'' THEN ''studio-pr-b-3'' ELSE ''studio-pr-b-1'' END;';
BEGIN
  SELECT replace(pg_get_functiondef(request_function),chr(13)||chr(10),chr(10)) INTO STRICT definition;
  IF position(next_selection IN definition)>0
    OR length(definition)-length(replace(definition,prior_selection,''))<>length(prior_selection) THEN
    RAISE EXCEPTION 'STUDIO_BRD_PROMPT_V3_REQUEST_DRIFT';
  END IF;
  EXECUTE replace(definition,prior_selection,next_selection);
  SELECT replace(pg_get_functiondef(request_function),chr(13)||chr(10),chr(10)) INTO STRICT definition;
  IF position(next_selection IN definition)=0 OR position(prior_selection IN definition)>0 THEN
    RAISE EXCEPTION 'STUDIO_BRD_PROMPT_V3_REQUEST_FORWARD_FAILED';
  END IF;
END
$studio_brd_prompt_v3_request_forward$;

DO $studio_brd_prompt_v3_claim_forward$
DECLARE claim_function regprocedure:='public.studio_artifact_generation_claim_v2(uuid,uuid,integer)'::regprocedure;
  definition text;
  prior_versions text:='attempt.prompt_version NOT IN(''studio-pr-b-1'',''studio-pr-b-2'')';
  next_versions text:='attempt.prompt_version NOT IN(''studio-pr-b-1'',''studio-pr-b-2'',''studio-pr-b-3'')';
  prior_brd_guard text:='OR(attempt.prompt_version=''studio-pr-b-2'' AND artifact.artifact_type<>''brd'')';
  next_brd_guard text:='OR(attempt.prompt_version IN(''studio-pr-b-2'',''studio-pr-b-3'') AND artifact.artifact_type<>''brd'')';
BEGIN
  SELECT replace(pg_get_functiondef(claim_function),chr(13)||chr(10),chr(10)) INTO STRICT definition;
  IF position(next_versions IN definition)>0 OR position(next_brd_guard IN definition)>0
    OR length(definition)-length(replace(definition,prior_versions,''))<>length(prior_versions)
    OR length(definition)-length(replace(definition,prior_brd_guard,''))<>length(prior_brd_guard) THEN
    RAISE EXCEPTION 'STUDIO_BRD_PROMPT_V3_CLAIM_DRIFT';
  END IF;
  definition:=replace(definition,prior_versions,next_versions);
  definition:=replace(definition,prior_brd_guard,next_brd_guard);
  EXECUTE definition;
  SELECT replace(pg_get_functiondef(claim_function),chr(13)||chr(10),chr(10)) INTO STRICT definition;
  IF position(next_versions IN definition)=0 OR position(next_brd_guard IN definition)=0
    OR position(prior_versions IN definition)>0 OR position(prior_brd_guard IN definition)>0 THEN
    RAISE EXCEPTION 'STUDIO_BRD_PROMPT_V3_CLAIM_FORWARD_FAILED';
  END IF;
END
$studio_brd_prompt_v3_claim_forward$;

-- Advance reusable hosted-pilot identity consumers. Frozen controlled-human
-- history remains readable. The bounded v2 quality activation stays pinned to
-- its v2 release tip and therefore rejects a new activation at this v3 head;
-- already consumed v2 window/debit history remains unchanged and readable.
DO $studio_brd_prompt_v3_identity_forward$
DECLARE marker public.hosted_pilot_environment_identity;marker_constraint text;exercise_constraint text;
  activation_definition text;bootstrap_definition text;assert_marker_definition text;
  old_activation text:='marker.migration_tip<>''20261003150800''';
  new_activation text:='marker.migration_tip<>''20261004025101''';
  old_bootstrap text:='marker.migration_tip=''20261003150800''';
  new_bootstrap text:='marker.migration_tip=''20261004025101''';
  old_assert text:='marker.migration_tip = ''20261003150800''';
  new_assert text:='marker.migration_tip = ''20261004025101''';
BEGIN
  LOCK TABLE public.hosted_pilot_environment_identity IN SHARE ROW EXCLUSIVE MODE;
  SELECT * INTO STRICT marker FROM public.hosted_pilot_environment_identity WHERE singleton FOR UPDATE;
  SELECT pg_get_expr(conbin,conrelid,false) INTO STRICT marker_constraint FROM pg_constraint
    WHERE conrelid='public.hosted_pilot_environment_identity'::regclass AND conname='hosted_pilot_environment_identity_migration_tip_check';
  SELECT pg_get_expr(conbin,conrelid,false) INTO STRICT exercise_constraint FROM pg_constraint
    WHERE conrelid='public.pr_c_controlled_human_exercises'::regclass AND conname='pr_c_controlled_human_exercises_migration_tip_check';
  SELECT replace(pg_get_functiondef('public.synthetic_ai_campaign_activate_final_continuation(uuid,uuid,uuid,bigint,text,text,uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,integer)'::regprocedure),chr(13)||chr(10),chr(10))
    INTO STRICT activation_definition;
  SELECT replace(pg_get_functiondef('public.synthetic_ai_campaign_bootstrap(uuid,uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,uuid,timestamptz)'::regprocedure),chr(13)||chr(10),chr(10))
    INTO STRICT bootstrap_definition;
  SELECT replace(pg_get_functiondef('public.pr_c_controlled_human_assert_marker()'::regprocedure),chr(13)||chr(10),chr(10))
    INTO STRICT assert_marker_definition;
  IF marker.migration_tip<>'20261003150800' OR marker_constraint<>'(migration_tip = ''20261003150800''::text)'
    OR exercise_constraint<>'(migration_tip = ANY (ARRAY[''20260904120000''::text, ''20260924113000''::text, ''20260926053818''::text, ''20260928060000''::text, ''20261003015246''::text, ''20261003055918''::text, ''20261003123459''::text, ''20261003150800''::text]))'
    OR (length(activation_definition)-length(replace(activation_definition,old_activation,'')))/length(old_activation)<>1
    OR (length(bootstrap_definition)-length(replace(bootstrap_definition,old_bootstrap,'')))/length(old_bootstrap)<>1
    OR (length(assert_marker_definition)-length(replace(assert_marker_definition,old_assert,'')))/length(old_assert)<>1
    OR EXISTS(SELECT 1 FROM public.pr_c_controlled_human_exercises WHERE lifecycle<>'deprovisioned') THEN
    RAISE EXCEPTION 'STUDIO_BRD_PROMPT_V3_IDENTITY_SOURCE_MISMATCH';
  END IF;
  EXECUTE replace(activation_definition,old_activation,new_activation);
  EXECUTE replace(bootstrap_definition,old_bootstrap,new_bootstrap);
  EXECUTE replace(assert_marker_definition,old_assert,new_assert);
  ALTER TABLE public.pr_c_controlled_human_exercises DROP CONSTRAINT pr_c_controlled_human_exercises_migration_tip_check;
  ALTER TABLE public.pr_c_controlled_human_exercises ADD CONSTRAINT pr_c_controlled_human_exercises_migration_tip_check
    CHECK(migration_tip IN('20260904120000','20260924113000','20260926053818','20260928060000','20261003015246','20261003055918','20261003123459','20261003150800','20261004025101'));
  ALTER TABLE public.hosted_pilot_environment_identity DROP CONSTRAINT hosted_pilot_environment_identity_migration_tip_check;
  UPDATE public.hosted_pilot_environment_identity SET migration_tip='20261004025101' WHERE singleton;
  ALTER TABLE public.hosted_pilot_environment_identity ADD CONSTRAINT hosted_pilot_environment_identity_migration_tip_check
    CHECK(migration_tip='20261004025101');
END
$studio_brd_prompt_v3_identity_forward$;

-- Rollback/read-only fallback: keep both provider runtimes off. Preserve every
-- v1/v2/v3 attempt, version, allowance and debit; correct forward only.
