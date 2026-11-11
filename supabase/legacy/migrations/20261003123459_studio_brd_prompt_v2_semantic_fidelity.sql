-- BRD semantic-fidelity prompt v2. Historical attempts retain their stored v1
-- identity and canonical hashes; only newly requested BRD attempts select v2.
DO $studio_brd_prompt_v2_preflight$
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
    OR marker.migration_tip<>'20261003055918'
    OR marker.production_authorized OR marker.customer_data_authorized OR marker.real_provider_calls_authorized
    OR studio_control.singleton IS NULL OR enterprise_control.singleton IS NULL
    OR studio_control.provider_enabled OR enterprise_control.provider_enabled THEN
    RAISE EXCEPTION 'STUDIO_BRD_PROMPT_V2_REQUIRES_PROVIDERS_OFF';
  END IF;
END
$studio_brd_prompt_v2_preflight$;

ALTER TABLE public.studio_artifact_generation_attempts
  DROP CONSTRAINT studio_generation_provider_plan_check,
  ADD CONSTRAINT studio_generation_provider_plan_check CHECK(
    (provider_plan_state='legacy_unverified' AND provider_route_id IS NULL AND provider_config_id IS NULL AND provider_name IS NULL AND provider_model IS NULL AND prompt_key IS NULL AND prompt_version IS NULL AND provider_plan_hash IS NULL)
    OR(provider_plan_state='bound' AND provider_route_id IS NOT NULL AND provider_config_id IS NOT NULL
      AND provider_name IN('openai','azure_openai','anthropic','gemini','groq','openai_compatible')
      AND length(btrim(provider_model)) BETWEEN 1 AND 200
      AND prompt_key IS NOT NULL AND prompt_version IS NOT NULL AND provider_plan_hash IS NOT NULL
      AND prompt_key='studio-multisource-generation'
      AND prompt_version IN('studio-pr-b-1','studio-pr-b-2')
      AND provider_plan_hash~'^[0-9a-f]{64}$')
  );

DO $studio_brd_prompt_v2_request_forward$
DECLARE request_function regprocedure:='public.studio_artifact_generation_request_v2(jsonb)'::regprocedure;
  definition text;
  prior_declaration text:='result jsonb;plan jsonb;audit_id uuid:=gen_random_uuid();';
  next_declaration text:='result jsonb;plan jsonb;prompt_version text;audit_id uuid:=gen_random_uuid();';
  prior_hash text:='provider_plan_hash:=public.enterprise_sha256_jsonb(jsonb_build_object(''routeId'',route.id,''routeVersion'',route.version,''providerConfigId'',config.id,';
  next_hash text:='prompt_version:=CASE artifact.artifact_type WHEN ''brd'' THEN ''studio-pr-b-2'' ELSE ''studio-pr-b-1'' END;'||chr(10)||' provider_plan_hash:=public.enterprise_sha256_jsonb(jsonb_build_object(''routeId'',route.id,''routeVersion'',route.version,''providerConfigId'',config.id,';
  prior_hash_version text:='''promptVersion'',''studio-pr-b-1'',''maximumOutputTokens'',4000';
  next_hash_version text:='''promptVersion'',prompt_version,''maximumOutputTokens'',4000';
  prior_insert_version text:='''studio-multisource-generation'',''studio-pr-b-1'',provider_plan_hash';
  next_insert_version text:='''studio-multisource-generation'',prompt_version,provider_plan_hash';
BEGIN
  SELECT pg_get_functiondef(request_function) INTO STRICT definition;
  definition:=replace(definition,chr(13)||chr(10),chr(10));
  IF position(next_declaration IN definition)>0
    OR length(definition)-length(replace(definition,prior_declaration,''))<>length(prior_declaration)
    OR length(definition)-length(replace(definition,prior_hash,''))<>length(prior_hash)
    OR length(definition)-length(replace(definition,prior_hash_version,''))<>length(prior_hash_version)
    OR length(definition)-length(replace(definition,prior_insert_version,''))<>length(prior_insert_version) THEN
    RAISE EXCEPTION 'STUDIO_BRD_PROMPT_V2_REQUEST_DRIFT';
  END IF;
  definition:=replace(definition,prior_declaration,next_declaration);
  definition:=replace(definition,prior_hash,next_hash);
  definition:=replace(definition,prior_hash_version,next_hash_version);
  definition:=replace(definition,prior_insert_version,next_insert_version);
  EXECUTE definition;
  SELECT pg_get_functiondef(request_function) INTO STRICT definition;
  definition:=replace(definition,chr(13)||chr(10),chr(10));
  IF position(next_declaration IN definition)=0 OR position(next_hash IN definition)=0
    OR position(next_hash_version IN definition)=0 OR position(next_insert_version IN definition)=0
    OR position(prior_declaration IN definition)>0 OR position(prior_hash_version IN definition)>0
    OR position(prior_insert_version IN definition)>0 THEN
    RAISE EXCEPTION 'STUDIO_BRD_PROMPT_V2_REQUEST_FORWARD_FAILED';
  END IF;
END
$studio_brd_prompt_v2_request_forward$;

DO $studio_brd_prompt_v2_claim_forward$
DECLARE claim_function regprocedure:='public.studio_artifact_generation_claim_v2(uuid,uuid,integer)'::regprocedure;
  definition text;
  prior_declaration text:='transfer_released_before_effect boolean:=false;result jsonb;';
  next_declaration text:='transfer_released_before_effect boolean:=false;provider_route public.enterprise_ai_capability_routes;provider_config public.ai_provider_configs;computed_provider_plan_hash text;claim_plan jsonb;result jsonb;';
  claim_guard_anchor text:=' IF NOT public.studio_pr_b_lock_source_package_current(source_package.id,attempt.org_id,attempt.workspace_id) THEN RAISE EXCEPTION ''SOURCE_PACKAGE_STALE'';END IF;'||chr(10);
  claim_guard text:=$guard$ IF attempt.provider_plan_state<>'bound'
    OR attempt.prompt_key IS DISTINCT FROM 'studio-multisource-generation'
    OR attempt.prompt_version IS NULL OR attempt.prompt_version NOT IN('studio-pr-b-1','studio-pr-b-2')
    OR attempt.provider_plan_hash IS NULL
    OR(attempt.prompt_version='studio-pr-b-2' AND artifact.artifact_type<>'brd') THEN
  RAISE EXCEPTION 'PROVIDER_ROUTE_UNAVAILABLE';
 END IF;
 claim_plan:=jsonb_build_object('artifactType',artifact.artifact_type,'providerRouteId',attempt.provider_route_id,
  'providerConfigId',attempt.provider_config_id,'provider',attempt.provider_name,'model',attempt.provider_model,
  'capability','studio.document.generate','promptKey',attempt.prompt_key,'promptVersion',attempt.prompt_version,
  'maximumOutputTokens',4000,'providerPlanHash',attempt.provider_plan_hash);
$guard$;
  provider_guard text:=$provider_guard$ SELECT * INTO provider_route FROM public.enterprise_ai_capability_routes
  WHERE id=attempt.provider_route_id AND org_id=attempt.org_id AND workspace_id=attempt.workspace_id FOR SHARE;
 SELECT * INTO provider_config FROM public.ai_provider_configs
  WHERE id=attempt.provider_config_id AND org_id=attempt.org_id FOR SHARE;
 IF provider_route.id IS NULL OR provider_config.id IS NULL
    OR provider_route.provider_config_id IS DISTINCT FROM provider_config.id
    OR provider_route.capability IS DISTINCT FROM 'studio.document.generate'
    OR provider_config.provider IS DISTINCT FROM attempt.provider_name
    OR provider_route.model IS DISTINCT FROM attempt.provider_model THEN
  RAISE EXCEPTION 'PROVIDER_ROUTE_UNAVAILABLE';
 END IF;
 computed_provider_plan_hash:=public.enterprise_sha256_jsonb(jsonb_build_object(
  'routeId',provider_route.id,'routeVersion',provider_route.version,'providerConfigId',provider_config.id,
  'provider',provider_config.provider,'model',provider_route.model,'capability','studio.document.generate',
  'promptKey',attempt.prompt_key,'promptVersion',attempt.prompt_version,'maximumOutputTokens',4000));
 IF attempt.provider_plan_hash IS DISTINCT FROM computed_provider_plan_hash THEN RAISE EXCEPTION 'PROVIDER_ROUTE_UNAVAILABLE';END IF;
 claim_plan:=claim_plan||jsonb_build_object('providerRouteVersion',provider_route.version);
$provider_guard$;
  generating_replay_anchor text:=' ELSIF attempt.state=''generating'' THEN'||chr(10)||'  IF attempt.execution_token=p_execution_token AND attempt.execution_lease_expires_at>statement_timestamp() THEN'||chr(10);
  state_classification_anchor text:=' ELSE RAISE EXCEPTION ''VERSION_CONFLICT'';END IF;'||chr(10);
  prior_reconcile_replay text:='''leaseExpiresAt'',attempt.execution_lease_expires_at,''providerAllowed'',false,''reconcileOnly'',true,''responseHash'',staged.response_hash);';
  next_reconcile_replay text:='''leaseExpiresAt'',attempt.execution_lease_expires_at,''providerAllowed'',false,''reconcileOnly'',true,''responseHash'',staged.response_hash)||claim_plan;';
  prior_provider_replay text:='''leaseExpiresAt'',attempt.execution_lease_expires_at,''providerAllowed'',true,''reconcileOnly'',false,''providerEffectKey'',attempt.provider_effect_key);';
  next_provider_replay text:='''leaseExpiresAt'',attempt.execution_lease_expires_at,''providerAllowed'',true,''reconcileOnly'',false,''providerEffectKey'',attempt.provider_effect_key)||claim_plan;';
  prior_result text:='''expectedApprovedVersionId'',attempt.expected_approved_version_id);';
  next_result text:='''expectedApprovedVersionId'',attempt.expected_approved_version_id)||claim_plan;';
BEGIN
  SELECT pg_get_functiondef(claim_function) INTO STRICT definition;
  definition:=replace(definition,chr(13)||chr(10),chr(10));
  IF position(next_declaration IN definition)>0 OR position(claim_guard IN definition)>0
    OR length(definition)-length(replace(definition,prior_declaration,''))<>length(prior_declaration)
    OR length(definition)-length(replace(definition,claim_guard_anchor,''))<>length(claim_guard_anchor)
    OR length(definition)-length(replace(definition,generating_replay_anchor,''))<>length(generating_replay_anchor)
    OR length(definition)-length(replace(definition,state_classification_anchor,''))<>length(state_classification_anchor)
    OR length(definition)-length(replace(definition,prior_reconcile_replay,''))<>length(prior_reconcile_replay)
    OR length(definition)-length(replace(definition,prior_provider_replay,''))<>length(prior_provider_replay)
    OR length(definition)-length(replace(definition,prior_result,''))<>length(prior_result) THEN
    RAISE EXCEPTION 'STUDIO_BRD_PROMPT_V2_CLAIM_DRIFT';
  END IF;
  definition:=replace(definition,prior_declaration,next_declaration);
  definition:=replace(definition,claim_guard_anchor,claim_guard_anchor||claim_guard);
  definition:=replace(definition,generating_replay_anchor,generating_replay_anchor||provider_guard);
  definition:=replace(definition,state_classification_anchor,state_classification_anchor||' IF NOT reconcile_only THEN'||chr(10)||provider_guard||' END IF;'||chr(10));
  definition:=replace(definition,prior_reconcile_replay,next_reconcile_replay);
  definition:=replace(definition,prior_provider_replay,next_provider_replay);
  definition:=replace(definition,prior_result,next_result);
  EXECUTE definition;
  SELECT pg_get_functiondef(claim_function) INTO STRICT definition;
  definition:=replace(definition,chr(13)||chr(10),chr(10));
  IF position(next_declaration IN definition)=0 OR position(claim_guard IN definition)=0
    OR (length(definition)-length(replace(definition,provider_guard,'')))/length(provider_guard)<>2
    OR position(next_reconcile_replay IN definition)=0 OR position(next_provider_replay IN definition)=0
    OR position(next_result IN definition)=0 OR position(prior_declaration IN definition)>0
    OR position(prior_reconcile_replay IN definition)>0 OR position(prior_provider_replay IN definition)>0
    OR position(prior_result IN definition)>0 THEN
    RAISE EXCEPTION 'STUDIO_BRD_PROMPT_V2_CLAIM_FORWARD_FAILED';
  END IF;
END
$studio_brd_prompt_v2_claim_forward$;

-- Advance only the current hosted-pilot identity. Historical controlled-human
-- exercise tips remain valid frozen history.
DO $studio_brd_prompt_v2_identity_forward$
DECLARE marker public.hosted_pilot_environment_identity;marker_constraint text;exercise_constraint text;
  activation_definition text;bootstrap_definition text;assert_marker_definition text;
  old_activation text:='marker.migration_tip<>''20261003055918''';
  new_activation text:='marker.migration_tip<>''20261003123459''';
  old_bootstrap text:='marker.migration_tip=''20261003055918''';
  new_bootstrap text:='marker.migration_tip=''20261003123459''';
  old_assert text:='marker.migration_tip = ''20261003055918''';
  new_assert text:='marker.migration_tip = ''20261003123459''';
BEGIN
  LOCK TABLE public.hosted_pilot_environment_identity IN SHARE ROW EXCLUSIVE MODE;
  SELECT * INTO STRICT marker FROM public.hosted_pilot_environment_identity WHERE singleton FOR UPDATE;
  SELECT pg_get_expr(conbin,conrelid,false) INTO STRICT marker_constraint FROM pg_constraint
    WHERE conrelid='public.hosted_pilot_environment_identity'::regclass
      AND conname='hosted_pilot_environment_identity_migration_tip_check';
  SELECT pg_get_expr(conbin,conrelid,false) INTO STRICT exercise_constraint FROM pg_constraint
    WHERE conrelid='public.pr_c_controlled_human_exercises'::regclass
      AND conname='pr_c_controlled_human_exercises_migration_tip_check';
  SELECT pg_get_functiondef('public.synthetic_ai_campaign_activate_final_continuation(uuid,uuid,uuid,bigint,text,text,uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,integer)'::regprocedure)
    INTO STRICT activation_definition;
  SELECT pg_get_functiondef('public.synthetic_ai_campaign_bootstrap(uuid,uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,uuid,timestamptz)'::regprocedure)
    INTO STRICT bootstrap_definition;
  SELECT pg_get_functiondef('public.pr_c_controlled_human_assert_marker()'::regprocedure)
    INTO STRICT assert_marker_definition;
  IF marker.migration_tip<>'20261003055918'
    OR marker_constraint<>'(migration_tip = ''20261003055918''::text)'
    OR exercise_constraint<>'(migration_tip = ANY (ARRAY[''20260904120000''::text, ''20260924113000''::text, ''20260926053818''::text, ''20260928060000''::text, ''20261003015246''::text, ''20261003055918''::text]))'
    OR (length(activation_definition)-length(replace(activation_definition,old_activation,'')))/length(old_activation)<>1
    OR position(new_activation IN activation_definition)>0
    OR (length(bootstrap_definition)-length(replace(bootstrap_definition,old_bootstrap,'')))/length(old_bootstrap)<>1
    OR position(new_bootstrap IN bootstrap_definition)>0
    OR (length(assert_marker_definition)-length(replace(assert_marker_definition,old_assert,'')))/length(old_assert)<>1
    OR position(new_assert IN assert_marker_definition)>0 THEN
    RAISE EXCEPTION 'STUDIO_BRD_PROMPT_V2_IDENTITY_SOURCE_MISMATCH';
  END IF;
  EXECUTE replace(activation_definition,old_activation,new_activation);
  EXECUTE replace(bootstrap_definition,old_bootstrap,new_bootstrap);
  EXECUTE replace(assert_marker_definition,old_assert,new_assert);
  ALTER TABLE public.pr_c_controlled_human_exercises
    DROP CONSTRAINT pr_c_controlled_human_exercises_migration_tip_check;
  ALTER TABLE public.pr_c_controlled_human_exercises
    ADD CONSTRAINT pr_c_controlled_human_exercises_migration_tip_check
    CHECK(migration_tip IN('20260904120000','20260924113000','20260926053818','20260928060000','20261003015246','20261003055918','20261003123459'));
  ALTER TABLE public.hosted_pilot_environment_identity
    DROP CONSTRAINT hosted_pilot_environment_identity_migration_tip_check;
  UPDATE public.hosted_pilot_environment_identity SET migration_tip='20261003123459' WHERE singleton;
  ALTER TABLE public.hosted_pilot_environment_identity
    ADD CONSTRAINT hosted_pilot_environment_identity_migration_tip_check
    CHECK(migration_tip='20261003123459');
END
$studio_brd_prompt_v2_identity_forward$;
