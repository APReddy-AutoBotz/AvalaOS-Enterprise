-- One-use BRD prompt-v3 quality validation chained to the consumed prompt-v2
-- window. Installation and activation create no provider authority while either
-- runtime is enabled. Historical v2 rows and their debit bindings stay intact.
DO $precondition$
DECLARE marker public.hosted_pilot_environment_identity;
  enterprise_control public.enterprise_intelligence_runtime_control;
  studio_control public.studio_artifact_runtime_control;
BEGIN
  LOCK TABLE public.hosted_pilot_environment_identity IN SHARE ROW EXCLUSIVE MODE;
  SELECT * INTO STRICT marker FROM public.hosted_pilot_environment_identity WHERE singleton FOR UPDATE;
  SELECT * INTO STRICT enterprise_control FROM public.enterprise_intelligence_runtime_control WHERE singleton FOR SHARE;
  SELECT * INTO STRICT studio_control FROM public.studio_artifact_runtime_control WHERE singleton FOR SHARE;
  IF marker.product_key<>'avalaos-core'
    OR marker.environment_class<>'hosted_nonproduction_pilot'
    OR marker.schema_contract<>'hosted-pilot-2026-08'
    OR marker.migration_tip<>'20261004025101'
    OR marker.production_authorized OR marker.customer_data_authorized OR marker.real_provider_calls_authorized
    OR enterprise_control.provider_enabled OR studio_control.provider_enabled
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_attribute
      WHERE attrelid='public.synthetic_ai_brd_v2_quality_validation_windows'::regclass
        AND attname='prior_quality_window_id' AND NOT attisdropped)
    OR EXISTS(SELECT 1 FROM public.pr_c_controlled_human_exercises WHERE lifecycle<>'deprovisioned')
  THEN RAISE EXCEPTION 'SYNTHETIC_AI_BRD_V3_QUALITY_MIGRATION_PRECONDITION_FAILED';END IF;
END
$precondition$;

DO $drop_narrow_constraints$
DECLARE table_id regclass:='public.synthetic_ai_brd_v2_quality_validation_windows'::regclass;
  constraint_name text;column_name text;
BEGIN
  SELECT conname INTO STRICT constraint_name FROM pg_catalog.pg_constraint
    WHERE conrelid=table_id AND contype='u'
      AND conkey=ARRAY[(SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid=table_id AND attname='campaign_id')]::smallint[];
  EXECUTE format('ALTER TABLE public.synthetic_ai_brd_v2_quality_validation_windows DROP CONSTRAINT %I',constraint_name);
  FOREACH column_name IN ARRAY ARRAY['prompt_version','baseline_debit_count','baseline_aggregate_usd_nanos','maximum_aggregate_usd_nanos'] LOOP
    SELECT conname INTO STRICT constraint_name FROM pg_catalog.pg_constraint
      WHERE conrelid=table_id AND contype='c'
        AND conkey=ARRAY[(SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid=table_id AND attname=column_name)]::smallint[];
    EXECUTE format('ALTER TABLE public.synthetic_ai_brd_v2_quality_validation_windows DROP CONSTRAINT %I',constraint_name);
  END LOOP;
  SELECT conname INTO STRICT constraint_name FROM pg_catalog.pg_constraint
    WHERE conrelid=table_id AND contype='c'
      AND pg_catalog.pg_get_expr(conbin,conrelid,false) LIKE '%maximum_additional_effects%'
      AND pg_catalog.pg_get_expr(conbin,conrelid,false) LIKE '%activation_provider_last_validated_at%';
  EXECUTE format('ALTER TABLE public.synthetic_ai_brd_v2_quality_validation_windows DROP CONSTRAINT %I',constraint_name);
END
$drop_narrow_constraints$;

ALTER TABLE public.synthetic_ai_brd_v2_quality_validation_windows
  ALTER COLUMN prior_final_continuation_id DROP NOT NULL,
  ALTER COLUMN prompt_version DROP DEFAULT,
  ALTER COLUMN baseline_debit_count DROP DEFAULT,
  ALTER COLUMN baseline_aggregate_usd_nanos DROP DEFAULT,
  ADD COLUMN prior_quality_window_id uuid,
  ADD CONSTRAINT synthetic_ai_brd_quality_campaign_prompt_key UNIQUE(campaign_id,prompt_version),
  ADD CONSTRAINT synthetic_ai_brd_quality_id_campaign_key UNIQUE(id,campaign_id),
  ADD CONSTRAINT synthetic_ai_brd_quality_prior_quality_key UNIQUE(prior_quality_window_id),
  ADD CONSTRAINT synthetic_ai_brd_quality_prior_quality_fk
    FOREIGN KEY(prior_quality_window_id,campaign_id)
    REFERENCES public.synthetic_ai_brd_v2_quality_validation_windows(id,campaign_id) ON DELETE RESTRICT,
  ADD CONSTRAINT synthetic_ai_brd_quality_not_self_check CHECK(prior_quality_window_id IS NULL OR prior_quality_window_id<>id),
  ADD CONSTRAINT synthetic_ai_brd_quality_prompt_check CHECK(prompt_version IN('studio-pr-b-2','studio-pr-b-3')),
  ADD CONSTRAINT synthetic_ai_brd_quality_baseline_debit_check CHECK(baseline_debit_count IN(8,9)),
  ADD CONSTRAINT synthetic_ai_brd_quality_baseline_aggregate_check CHECK(baseline_aggregate_usd_nanos IN(4640993600,5112452800)),
  ADD CONSTRAINT synthetic_ai_brd_quality_maximum_aggregate_check CHECK(maximum_aggregate_usd_nanos IN(5112452800,5583912000,6055371200)),
  ADD CONSTRAINT synthetic_ai_brd_quality_lineage_check CHECK(
    (prompt_version='studio-pr-b-2' AND prior_final_continuation_id IS NOT NULL AND prior_quality_window_id IS NULL
      AND baseline_debit_count=8 AND baseline_aggregate_usd_nanos=4640993600)
    OR(prompt_version='studio-pr-b-3' AND prior_final_continuation_id IS NULL AND prior_quality_window_id IS NOT NULL
      AND baseline_debit_count=9 AND baseline_aggregate_usd_nanos=5112452800)),
  ADD CONSTRAINT synthetic_ai_brd_quality_branch_limit_check CHECK(
    (validation_required AND maximum_additional_effects=2
      AND maximum_aggregate_usd_nanos=baseline_aggregate_usd_nanos+2*fixed_debit_usd_nanos)
    OR(NOT validation_required AND activation_provider_last_validated_at IS NOT NULL
      AND maximum_additional_effects=1
      AND maximum_aggregate_usd_nanos=baseline_aggregate_usd_nanos+fixed_debit_usd_nanos
      AND expires_at<=activation_provider_last_validated_at+interval '24 hours'));

CREATE FUNCTION public.synthetic_ai_campaign_activate_brd_v3_quality_validation(
  p_actor uuid,p_org uuid,p_workspace uuid,p_authorization_version bigint,
  p_target_fingerprint text,p_project_ref text,p_campaign uuid,p_prior_quality_window uuid,
  p_provider_config uuid,p_key_ref uuid,p_assess_route uuid,p_studio_route uuid,
  p_generation_actor uuid,p_generation_authorization_version bigint,
  p_source_package uuid,p_source_package_hash text,p_artifact uuid,p_template_version uuid,
  p_expected_current_version uuid,p_expected_approved_version uuid,
  p_release_sha text,p_source_attestation_digest text,p_window_seconds integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  target public.synthetic_admin_targets;campaign public.synthetic_ai_campaign_authorities;
  prior_quality public.synthetic_ai_brd_v2_quality_validation_windows;
  existing public.synthetic_ai_brd_v2_quality_validation_windows;
  inserted public.synthetic_ai_brd_v2_quality_validation_windows;
  package public.studio_artifact_source_packages;artifact public.studio_artifact_aggregates;
  current_version public.studio_artifact_versions;approved_version public.studio_artifact_versions;
  system_template public.studio_system_template_versions;tenant_template public.studio_tenant_template_versions;
  provider_config public.ai_provider_configs;studio_route public.enterprise_ai_capability_routes;
  marker public.hosted_pilot_environment_identity;enterprise_control public.enterprise_intelligence_runtime_control;
  studio_control public.studio_artifact_runtime_control;request_host text;template_kind_value text;
  template_version_value text;template_hash_value text;digest_value text;result_value jsonb;
  created_value timestamptz:=statement_timestamp();expires_value timestamptz;validation_required_value boolean;
  debit_count integer;consumed_count integer;debit_spend bigint;operation_counts jsonb;
BEGIN
  IF p_actor IS NULL OR p_org IS NULL OR p_workspace IS NULL OR p_campaign IS NULL OR p_prior_quality_window IS NULL
    OR p_provider_config IS NULL OR p_key_ref IS NULL OR p_assess_route IS NULL OR p_studio_route IS NULL
    OR p_generation_actor IS NULL OR p_generation_authorization_version IS NULL OR p_generation_authorization_version<=0
    OR p_source_package IS NULL OR p_artifact IS NULL OR p_template_version IS NULL
    OR p_expected_current_version IS NULL OR p_expected_approved_version IS NULL
    OR p_target_fingerprint!~'^sha256:[0-9a-f]{64}$' OR p_project_ref!~'^[a-z0-9]{20}$'
    OR p_source_package_hash!~'^[0-9a-f]{64}$' OR p_release_sha!~'^[0-9a-f]{40}$'
    OR p_source_attestation_digest!~'^sha256:[0-9a-f]{64}$' OR p_window_seconds NOT BETWEEN 1 AND 86400
  THEN RAISE EXCEPTION 'SYNTHETIC_AI_BRD_V3_QUALITY_INVALID';END IF;
  PERFORM public.pr1b_assert_command_authority(p_actor,p_org,p_workspace,'org.admin',p_authorization_version);
  PERFORM public.studio_assert_actor(p_generation_actor,p_org,p_workspace,'studio.artifacts.generate',p_generation_authorization_version);
  target:=public.synthetic_admin_assert_target(p_actor,p_org,p_workspace,p_authorization_version,p_target_fingerprint);
  request_host:=public.synthetic_ai_campaign_request_host();
  IF request_host IS DISTINCT FROM p_project_ref||'.supabase.co'
    OR target.org_id IS DISTINCT FROM p_org OR target.workspace_id IS DISTINCT FROM p_workspace
    OR target.operator_actor_id IS DISTINCT FROM p_actor OR NOT target.enabled OR NOT target.synthetic_only
    OR target.production_authorized OR target.customer_data_authorized OR target.real_provider_calls_authorized
  THEN RAISE EXCEPTION 'SYNTHETIC_AI_BRD_V3_QUALITY_NOT_AUTHORIZED';END IF;
  SELECT * INTO STRICT marker FROM public.hosted_pilot_environment_identity WHERE singleton FOR SHARE;
  SELECT * INTO STRICT enterprise_control FROM public.enterprise_intelligence_runtime_control WHERE singleton FOR SHARE;
  SELECT * INTO STRICT studio_control FROM public.studio_artifact_runtime_control WHERE singleton FOR SHARE;
  IF marker.migration_tip<>'20261004112232' OR marker.production_authorized OR marker.customer_data_authorized
    OR marker.real_provider_calls_authorized OR enterprise_control.provider_enabled OR studio_control.provider_enabled
  THEN RAISE EXCEPTION 'SYNTHETIC_AI_BRD_V3_QUALITY_RUNTIME_NOT_OFF';END IF;

  SELECT * INTO campaign FROM public.synthetic_ai_campaign_authorities authority
    WHERE authority.id=p_campaign AND authority.target_id=target.id AND authority.target_fingerprint=p_target_fingerprint
      AND authority.project_ref=p_project_ref AND authority.server_host=request_host AND authority.org_id=p_org
      AND authority.workspace_id=p_workspace AND authority.operator_actor_id=p_actor
      AND authority.provider_config_id=p_provider_config AND authority.key_ref_id=p_key_ref
      AND authority.assess_route_id=p_assess_route AND authority.studio_route_id=p_studio_route FOR UPDATE;
  SELECT * INTO prior_quality FROM public.synthetic_ai_brd_v2_quality_validation_windows row
    WHERE row.id=p_prior_quality_window AND row.campaign_id=p_campaign AND row.prompt_version='studio-pr-b-2' FOR SHARE;
  SELECT * INTO package FROM public.studio_artifact_source_packages row
    WHERE row.id=p_source_package AND row.artifact_id=p_artifact AND row.org_id=p_org AND row.workspace_id=p_workspace FOR SHARE;
  SELECT * INTO artifact FROM public.studio_artifact_aggregates row
    WHERE row.id=p_artifact AND row.org_id=p_org AND row.workspace_id=p_workspace FOR SHARE;
  SELECT * INTO current_version FROM public.studio_artifact_versions row
    WHERE row.id=p_expected_current_version AND row.artifact_id=p_artifact AND row.org_id=p_org AND row.workspace_id=p_workspace FOR SHARE;
  SELECT * INTO approved_version FROM public.studio_artifact_versions row
    WHERE row.id=p_expected_approved_version AND row.artifact_id=p_artifact AND row.org_id=p_org AND row.workspace_id=p_workspace FOR SHARE;
  SELECT * INTO provider_config FROM public.ai_provider_configs config
    WHERE config.id=p_provider_config AND config.org_id=p_org FOR SHARE;
  SELECT * INTO studio_route FROM public.enterprise_ai_capability_routes route
    WHERE route.id=p_studio_route AND route.org_id=p_org AND route.workspace_id=p_workspace FOR SHARE;
  SELECT * INTO existing FROM public.synthetic_ai_brd_v2_quality_validation_windows row
    WHERE row.campaign_id=p_campaign AND row.prompt_version='studio-pr-b-3';

  IF current_version.template_kind='system' THEN
    SELECT * INTO system_template FROM public.studio_system_template_versions template WHERE template.id=p_template_version FOR SHARE;
    template_kind_value:='system';template_version_value:=system_template.template_version;template_hash_value:=system_template.template_hash;
  ELSIF current_version.template_kind='tenant' THEN
    SELECT * INTO tenant_template FROM public.studio_tenant_template_versions template
      WHERE template.id=p_template_version AND template.org_id=p_org AND template.workspace_id=p_workspace FOR SHARE;
    template_kind_value:='tenant';template_version_value:=tenant_template.version::text;template_hash_value:=tenant_template.template_hash;
  END IF;

  IF existing.id IS NOT NULL THEN
    IF existing.prior_quality_window_id IS DISTINCT FROM p_prior_quality_window
      OR existing.activated_by IS DISTINCT FROM p_actor OR existing.authorization_version IS DISTINCT FROM p_authorization_version
      OR existing.generation_actor_id IS DISTINCT FROM p_generation_actor
      OR existing.generation_authorization_version IS DISTINCT FROM p_generation_authorization_version
      OR existing.target_fingerprint IS DISTINCT FROM p_target_fingerprint OR existing.project_ref IS DISTINCT FROM p_project_ref
      OR existing.provider_config_id IS DISTINCT FROM p_provider_config OR existing.key_ref_id IS DISTINCT FROM p_key_ref
      OR existing.assess_route_id IS DISTINCT FROM p_assess_route OR existing.studio_route_id IS DISTINCT FROM p_studio_route
      OR existing.source_package_id IS DISTINCT FROM p_source_package OR existing.source_package_hash IS DISTINCT FROM p_source_package_hash
      OR existing.artifact_id IS DISTINCT FROM p_artifact OR existing.template_version_id IS DISTINCT FROM p_template_version
      OR existing.expected_current_version_id IS DISTINCT FROM p_expected_current_version
      OR existing.expected_approved_version_id IS DISTINCT FROM p_expected_approved_version
      OR existing.release_sha IS DISTINCT FROM p_release_sha OR existing.source_attestation_digest IS DISTINCT FROM p_source_attestation_digest
      OR existing.requested_window_seconds IS DISTINCT FROM p_window_seconds
    THEN RAISE EXCEPTION 'SYNTHETIC_AI_BRD_V3_QUALITY_REPLAY_MISMATCH';END IF;
    RETURN existing.result;
  END IF;

  SELECT count(*)::integer,count(*) FILTER(WHERE consumed_at IS NOT NULL)::integer,
    COALESCE(sum(debit_usd_nanos),0)::bigint INTO debit_count,consumed_count,debit_spend
  FROM public.synthetic_ai_campaign_effect_debits WHERE campaign_id=p_campaign;
  SELECT jsonb_object_agg(operation,n) INTO operation_counts
  FROM(SELECT operation,count(*)::integer n FROM public.synthetic_ai_campaign_effect_debits
    WHERE campaign_id=p_campaign GROUP BY operation) counts;
  IF campaign.id IS NULL OR NOT campaign.enabled OR campaign.disabled_at IS NOT NULL OR campaign.expires_at>=created_value
    OR campaign.provider<>'openai' OR campaign.endpoint<>'https://api.openai.com'
    OR campaign.model<>'gpt-4.1-mini-2025-04-14' OR campaign.campaign_cap_usd_nanos<>10000000000
    OR campaign.carried_usd_nanos<>869320000 OR campaign.fixed_debit_usd_nanos<>471459200
    OR prior_quality.id IS NULL OR prior_quality.prior_final_continuation_id IS NULL OR prior_quality.prior_quality_window_id IS NOT NULL
    OR prior_quality.baseline_debit_count<>8 OR prior_quality.baseline_aggregate_usd_nanos<>4640993600
    OR prior_quality.fixed_debit_usd_nanos<>471459200 OR prior_quality.maximum_additional_effects<>1
    OR prior_quality.maximum_aggregate_usd_nanos<>5112452800 OR prior_quality.validation_required
    OR prior_quality.activated_by IS DISTINCT FROM p_actor OR prior_quality.authorization_version IS DISTINCT FROM p_authorization_version
    OR prior_quality.generation_actor_id IS DISTINCT FROM p_generation_actor
    OR prior_quality.generation_authorization_version IS DISTINCT FROM p_generation_authorization_version
    OR prior_quality.target_fingerprint IS DISTINCT FROM p_target_fingerprint OR prior_quality.project_ref IS DISTINCT FROM p_project_ref
    OR prior_quality.org_id IS DISTINCT FROM p_org OR prior_quality.workspace_id IS DISTINCT FROM p_workspace
    OR prior_quality.provider_config_id IS DISTINCT FROM p_provider_config OR prior_quality.key_ref_id IS DISTINCT FROM p_key_ref
    OR prior_quality.assess_route_id IS DISTINCT FROM p_assess_route OR prior_quality.studio_route_id IS DISTINCT FROM p_studio_route
    OR prior_quality.source_package_id IS DISTINCT FROM p_source_package OR prior_quality.source_package_hash IS DISTINCT FROM p_source_package_hash
    OR prior_quality.artifact_id IS DISTINCT FROM p_artifact OR prior_quality.template_version_id IS DISTINCT FROM p_template_version
    OR package.id IS NULL OR package.package_hash IS DISTINCT FROM p_source_package_hash
    OR package.source_mode<>'assess_handoff' OR package.lineage_classification<>'assessed' OR package.planning_only
    OR artifact.id IS NULL OR artifact.artifact_type<>'brd' OR artifact.source_package_id IS DISTINCT FROM package.id
    OR artifact.source_package_hash IS DISTINCT FROM package.package_hash OR artifact.source_mode<>'assess_handoff'
    OR artifact.lineage_classification<>'assessed' OR artifact.planning_only OR artifact.lifecycle<>'draft'
    OR artifact.current_version_id IS DISTINCT FROM p_expected_current_version
    OR artifact.current_approved_version_id IS DISTINCT FROM p_expected_approved_version
    OR artifact.aggregate_version<>prior_quality.baseline_aggregate_version+2
    OR current_version.id IS NULL OR approved_version.id IS NULL OR current_version.id=approved_version.id
    OR current_version.version<>3 OR current_version.lifecycle<>'draft' OR approved_version.version<>2 OR approved_version.lifecycle<>'approved'
    OR current_version.source_package_id IS DISTINCT FROM package.id OR current_version.source_package_hash IS DISTINCT FROM package.package_hash
    OR approved_version.id IS DISTINCT FROM prior_quality.expected_approved_version_id
    OR current_version.template_kind IS DISTINCT FROM template_kind_value
    OR COALESCE(current_version.template_id,current_version.tenant_template_version_id) IS DISTINCT FROM p_template_version
    OR current_version.template_version IS DISTINCT FROM template_version_value OR current_version.template_hash IS DISTINCT FROM template_hash_value
    OR system_template.id IS NULL AND tenant_template.id IS NULL
    OR system_template.id IS NOT NULL AND(system_template.artifact_type<>'brd' OR system_template.superseded_at IS NOT NULL)
    OR tenant_template.id IS NOT NULL AND tenant_template.status<>'approved'
    OR NOT EXISTS(SELECT 1 FROM public.studio_artifact_generation_attempts attempt
      JOIN public.studio_artifact_versions version ON version.generation_attempt_id=attempt.id
      JOIN public.synthetic_ai_campaign_effect_debits debit ON debit.studio_attempt_id=attempt.id
      WHERE version.id=current_version.id AND attempt.state='completed' AND NOT attempt.stale_completion
        AND attempt.prompt_key='studio-multisource-generation' AND attempt.prompt_version='studio-pr-b-2'
        AND attempt.expected_aggregate_version=prior_quality.baseline_aggregate_version+1
        AND attempt.artifact_id=p_artifact AND attempt.source_package_id=p_source_package
        AND attempt.source_package_hash=p_source_package_hash AND attempt.requested_by=p_generation_actor
        AND attempt.requester_authorization_version=p_generation_authorization_version
        AND debit.campaign_id=p_campaign AND debit.brd_v2_quality_window_id=prior_quality.id
        AND debit.operation='studio.document.generate' AND debit.consumed_at IS NOT NULL)
    OR EXISTS(SELECT 1 FROM public.studio_artifact_generation_attempts attempt
      WHERE attempt.artifact_id=p_artifact AND attempt.state IN('requested','claimed','generating','response_staged','reconciling','cancel_requested'))
    OR debit_count<>9 OR consumed_count<>9 OR debit_spend<>4243132800
    OR campaign.carried_usd_nanos+debit_spend<>5112452800
    OR operation_counts IS DISTINCT FROM jsonb_build_object('assess.evidence.extract',1,'provider.validate',3,'studio.document.generate',5)
    OR (SELECT count(*) FROM public.synthetic_ai_campaign_effect_debits debit
      WHERE debit.brd_v2_quality_window_id=prior_quality.id AND debit.consumed_at IS NOT NULL)<>1
    OR EXISTS(SELECT 1 FROM public.enterprise_ai_budget_reservations reservation
      WHERE reservation.org_id=p_org AND reservation.workspace_id=p_workspace AND reservation.provider_config_id=p_provider_config
        AND(reservation.state IN('reserved','uncertain') OR reservation.studio_transfer_pending OR reservation.assess_mapping_transfer_pending))
    OR provider_config.id IS NULL OR provider_config.provider<>'openai' OR provider_config.key_ref_id IS DISTINCT FROM p_key_ref
    OR provider_config.endpoint_url<>'https://api.openai.com' OR provider_config.default_model<>'gpt-4.1-mini-2025-04-14'
    OR provider_config.model_allowlist IS DISTINCT FROM ARRAY['gpt-4.1-mini-2025-04-14']::text[]
    OR provider_config.status<>'active' OR provider_config.deleted_at IS NOT NULL
    OR studio_route.id IS NULL OR studio_route.provider_config_id IS DISTINCT FROM p_provider_config
    OR studio_route.version IS DISTINCT FROM prior_quality.studio_route_version
    OR studio_route.capability<>'studio.document.generate' OR studio_route.model<>'gpt-4.1-mini-2025-04-14'
    OR NOT studio_route.enabled OR studio_route.deleted_at IS NOT NULL OR cardinality(studio_route.allowed_roles)=0
    OR NOT EXISTS(SELECT 1 FROM public.enterprise_ai_capability_routes route
      WHERE route.id=p_assess_route AND route.org_id=p_org AND route.workspace_id=p_workspace
        AND route.provider_config_id=p_provider_config AND route.capability='assess.evidence.extract'
        AND route.model='gpt-4.1-mini-2025-04-14' AND route.enabled AND route.deleted_at IS NULL)
    OR NOT EXISTS(SELECT 1 FROM public.ai_provider_key_refs key_ref
      WHERE key_ref.id=p_key_ref AND key_ref.org_id=p_org AND key_ref.provider='openai'
        AND key_ref.resolver_type='server_reference' AND key_ref.status='active' AND key_ref.deleted_at IS NULL
        AND(key_ref.expires_at IS NULL OR key_ref.expires_at>created_value))
  THEN RAISE EXCEPTION 'SYNTHETIC_AI_BRD_V3_QUALITY_HISTORY_UNSAFE';END IF;

  validation_required_value:=provider_config.last_validated_at IS NULL
    OR provider_config.last_validated_at>created_value
    OR provider_config.last_validated_at<created_value-interval '24 hours';
  IF validation_required_value THEN expires_value:=created_value+make_interval(secs=>p_window_seconds);
  ELSE expires_value:=least(created_value+make_interval(secs=>p_window_seconds),provider_config.last_validated_at+interval '24 hours');END IF;
  IF expires_value<=created_value THEN RAISE EXCEPTION 'SYNTHETIC_AI_BRD_V3_QUALITY_PROVIDER_STALE';END IF;
  digest_value:='sha256:'||encode(public.digest(convert_to(concat_ws('|','synthetic-ai-brd-v3-quality-validation-v1',
    campaign.id::text,prior_quality.id::text,p_actor::text,p_org::text,p_workspace::text,p_authorization_version::text,
    p_generation_actor::text,p_generation_authorization_version::text,p_target_fingerprint,p_project_ref,p_provider_config::text,
    p_key_ref::text,p_assess_route::text,p_studio_route::text,studio_route.version::text,p_source_package::text,
    p_source_package_hash,p_artifact::text,p_template_version::text,template_kind_value,template_version_value,template_hash_value,
    artifact.aggregate_version::text,current_version.id::text,current_version.content_hash,approved_version.id::text,
    approved_version.content_hash,'studio-multisource-generation','studio-pr-b-3',validation_required_value::text,
    COALESCE(provider_config.last_validated_at::text,''),p_release_sha,p_source_attestation_digest,p_window_seconds::text,created_value::text),'UTF8'),'sha256'),'hex');
  result_value:=jsonb_build_object('status','activated','campaignId',campaign.id,'expiresAt',expires_value,
    'validationRequired',validation_required_value,'baselineAggregateUsdNanos',5112452800,
    'maximumAdditionalEffects',CASE WHEN validation_required_value THEN 2 ELSE 1 END,
    'maximumAggregateUsdNanos',CASE WHEN validation_required_value THEN 6055371200 ELSE 5583912000 END,
    'promptKey','studio-multisource-generation','promptVersion','studio-pr-b-3',
    'releaseSha',p_release_sha,'sourceAttestationDigest',p_source_attestation_digest,'bindingDigest',digest_value);
  INSERT INTO public.synthetic_ai_brd_v2_quality_validation_windows(campaign_id,prior_quality_window_id,
    activated_by,authorization_version,generation_actor_id,generation_authorization_version,target_fingerprint,project_ref,
    org_id,workspace_id,provider_config_id,key_ref_id,assess_route_id,studio_route_id,studio_route_version,
    source_package_id,artifact_id,source_package_hash,template_kind,template_version_id,template_version,template_hash,
    baseline_aggregate_version,expected_current_version_id,expected_current_version_hash,
    expected_approved_version_id,expected_approved_version_hash,prompt_key,prompt_version,
    activation_provider_last_validated_at,validation_required,baseline_debit_count,baseline_aggregate_usd_nanos,
    maximum_additional_effects,maximum_aggregate_usd_nanos,release_sha,source_attestation_digest,binding_digest,result,
    requested_window_seconds,created_at,expires_at)
  VALUES(campaign.id,prior_quality.id,p_actor,p_authorization_version,p_generation_actor,p_generation_authorization_version,
    p_target_fingerprint,p_project_ref,p_org,p_workspace,p_provider_config,p_key_ref,p_assess_route,p_studio_route,studio_route.version,
    package.id,artifact.id,package.package_hash,template_kind_value,p_template_version,template_version_value,template_hash_value,
    artifact.aggregate_version,current_version.id,current_version.content_hash,approved_version.id,approved_version.content_hash,
    'studio-multisource-generation','studio-pr-b-3',provider_config.last_validated_at,validation_required_value,9,5112452800,
    CASE WHEN validation_required_value THEN 2 ELSE 1 END,
    CASE WHEN validation_required_value THEN 6055371200 ELSE 5583912000 END,p_release_sha,p_source_attestation_digest,
    digest_value,result_value,p_window_seconds,created_value,expires_value) RETURNING * INTO inserted;
  RETURN inserted.result;
END
$$;

-- Only the newest unsuperseded window can authorize effects. Once a successor
-- exists its predecessor never becomes active again, even after the successor
-- expires.
CREATE OR REPLACE FUNCTION public.synthetic_ai_campaign_active_until(p_campaign uuid)
RETURNS timestamptz LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT CASE
    WHEN NOT authority.enabled OR authority.disabled_at IS NOT NULL THEN NULL
    WHEN authority.expires_at>statement_timestamp() THEN authority.expires_at
    WHEN (SELECT count(*) FROM public.synthetic_ai_campaign_renewals renewal
            WHERE renewal.campaign_id=authority.id AND renewal.expires_at>statement_timestamp())
       + (SELECT count(*) FROM public.synthetic_ai_campaign_final_continuations final
            WHERE final.campaign_id=authority.id AND final.expires_at>statement_timestamp()
              AND NOT EXISTS(SELECT 1 FROM public.synthetic_ai_brd_v2_quality_validation_windows quality
                WHERE quality.prior_final_continuation_id=final.id))
       + (SELECT count(*) FROM public.synthetic_ai_brd_v2_quality_validation_windows quality
            WHERE quality.campaign_id=authority.id AND quality.expires_at>statement_timestamp()
              AND NOT EXISTS(SELECT 1 FROM public.synthetic_ai_brd_v2_quality_validation_windows successor
                WHERE successor.prior_quality_window_id=quality.id))<>1 THEN NULL
    ELSE COALESCE(
      (SELECT renewal.expires_at FROM public.synthetic_ai_campaign_renewals renewal
        WHERE renewal.campaign_id=authority.id AND renewal.expires_at>statement_timestamp()),
      (SELECT final.expires_at FROM public.synthetic_ai_campaign_final_continuations final
        WHERE final.campaign_id=authority.id AND final.expires_at>statement_timestamp()
          AND NOT EXISTS(SELECT 1 FROM public.synthetic_ai_brd_v2_quality_validation_windows quality
            WHERE quality.prior_final_continuation_id=final.id)),
      (SELECT quality.expires_at FROM public.synthetic_ai_brd_v2_quality_validation_windows quality
        WHERE quality.campaign_id=authority.id AND quality.expires_at>statement_timestamp()
          AND NOT EXISTS(SELECT 1 FROM public.synthetic_ai_brd_v2_quality_validation_windows successor
            WHERE successor.prior_quality_window_id=quality.id)))
  END
  FROM public.synthetic_ai_campaign_authorities authority WHERE authority.id=p_campaign;
$$;

DO $reserve_leaf_forward$
DECLARE fn regprocedure:='public.synthetic_ai_campaign_reserve_effect(uuid,uuid,uuid,bigint,text,text,uuid,uuid,uuid,bigint,uuid,uuid,uuid,text,text,text,text,text,integer)'::regprocedure;
  definition text;old text;replacement text;
BEGIN
  SELECT replace(pg_get_functiondef(fn),chr(13)||chr(10),chr(10)) INTO STRICT definition;
  old:=' SELECT * INTO quality_window FROM public.synthetic_ai_brd_v2_quality_validation_windows active'||chr(10)||
    '  WHERE active.campaign_id=campaign.id AND active.expires_at>statement_timestamp() FOR SHARE;'||chr(10);
  replacement:=' SELECT * INTO quality_window FROM public.synthetic_ai_brd_v2_quality_validation_windows active'||chr(10)||
    '  WHERE active.campaign_id=campaign.id AND active.expires_at>statement_timestamp()'||chr(10)||
    '   AND NOT EXISTS(SELECT 1 FROM public.synthetic_ai_brd_v2_quality_validation_windows successor'||chr(10)||
    '    WHERE successor.prior_quality_window_id=active.id) FOR SHARE;'||chr(10);
  IF length(definition)-length(replace(definition,old,''))<>length(old) THEN
    RAISE EXCEPTION 'SYNTHETIC_AI_BRD_V3_QUALITY_RESERVE_LEAF_DRIFT';
  END IF;
  EXECUTE replace(definition,old,replacement);
END
$reserve_leaf_forward$;

DO $consume_leaf_forward$
DECLARE fn regprocedure:='public.synthetic_ai_campaign_consume_effect(uuid,uuid,uuid,uuid,bigint,text,text,uuid,uuid,uuid,bigint,uuid,uuid,uuid,text,text,text,text,text,integer)'::regprocedure;
  definition text;old text;replacement text;
BEGIN
  SELECT replace(pg_get_functiondef(fn),chr(13)||chr(10),chr(10)) INTO STRICT definition;
  old:='  SELECT * INTO quality_window FROM public.synthetic_ai_brd_v2_quality_validation_windows active'||chr(10)||
    '   WHERE active.campaign_id=campaign.id AND active.expires_at>statement_timestamp() FOR SHARE;'||chr(10);
  replacement:='  SELECT * INTO quality_window FROM public.synthetic_ai_brd_v2_quality_validation_windows active'||chr(10)||
    '   WHERE active.campaign_id=campaign.id AND active.expires_at>statement_timestamp()'||chr(10)||
    '    AND NOT EXISTS(SELECT 1 FROM public.synthetic_ai_brd_v2_quality_validation_windows successor'||chr(10)||
    '     WHERE successor.prior_quality_window_id=active.id) FOR SHARE;'||chr(10);
  IF length(definition)-length(replace(definition,old,''))<>length(old) THEN
    RAISE EXCEPTION 'SYNTHETIC_AI_BRD_V3_QUALITY_CONSUME_LEAF_DRIFT';
  END IF;
  EXECUTE replace(definition,old,replacement);
END
$consume_leaf_forward$;

-- Advance only reusable current hosted-pilot identity consumers. The v2
-- activation remains pinned to 20261003150800 and cannot create a new v2 row.
DO $identity_forward$
DECLARE marker public.hosted_pilot_environment_identity;marker_constraint text;exercise_constraint text;
  activation_definition text;bootstrap_definition text;assert_marker_definition text;
  old_activation text:='marker.migration_tip<>''20261004025101''';
  new_activation text:='marker.migration_tip<>''20261004112232''';
  old_bootstrap text:='marker.migration_tip=''20261004025101''';
  new_bootstrap text:='marker.migration_tip=''20261004112232''';
  old_assert text:='marker.migration_tip = ''20261004025101''';
  new_assert text:='marker.migration_tip = ''20261004112232''';
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
  IF marker.migration_tip<>'20261004025101' OR marker_constraint<>'(migration_tip = ''20261004025101''::text)'
    OR exercise_constraint<>'(migration_tip = ANY (ARRAY[''20260904120000''::text, ''20260924113000''::text, ''20260926053818''::text, ''20260928060000''::text, ''20261003015246''::text, ''20261003055918''::text, ''20261003123459''::text, ''20261003150800''::text, ''20261004025101''::text]))'
    OR (length(activation_definition)-length(replace(activation_definition,old_activation,'')))/length(old_activation)<>1
    OR (length(bootstrap_definition)-length(replace(bootstrap_definition,old_bootstrap,'')))/length(old_bootstrap)<>1
    OR (length(assert_marker_definition)-length(replace(assert_marker_definition,old_assert,'')))/length(old_assert)<>1
    OR EXISTS(SELECT 1 FROM public.pr_c_controlled_human_exercises WHERE lifecycle<>'deprovisioned')
  THEN RAISE EXCEPTION 'SYNTHETIC_AI_BRD_V3_QUALITY_IDENTITY_SOURCE_MISMATCH';END IF;
  EXECUTE replace(activation_definition,old_activation,new_activation);
  EXECUTE replace(bootstrap_definition,old_bootstrap,new_bootstrap);
  EXECUTE replace(assert_marker_definition,old_assert,new_assert);
  ALTER TABLE public.pr_c_controlled_human_exercises DROP CONSTRAINT pr_c_controlled_human_exercises_migration_tip_check;
  ALTER TABLE public.pr_c_controlled_human_exercises ADD CONSTRAINT pr_c_controlled_human_exercises_migration_tip_check
    CHECK(migration_tip IN('20260904120000','20260924113000','20260926053818','20260928060000','20261003015246','20261003055918','20261003123459','20261003150800','20261004025101','20261004112232'));
  ALTER TABLE public.hosted_pilot_environment_identity DROP CONSTRAINT hosted_pilot_environment_identity_migration_tip_check;
  UPDATE public.hosted_pilot_environment_identity SET migration_tip='20261004112232' WHERE singleton;
  ALTER TABLE public.hosted_pilot_environment_identity ADD CONSTRAINT hosted_pilot_environment_identity_migration_tip_check
    CHECK(migration_tip='20261004112232');
END
$identity_forward$;

REVOKE ALL ON FUNCTION
  public.synthetic_ai_campaign_activate_brd_v3_quality_validation(uuid,uuid,uuid,bigint,text,text,uuid,uuid,uuid,uuid,uuid,uuid,uuid,bigint,uuid,text,uuid,uuid,uuid,uuid,text,text,integer)
FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION
  public.synthetic_ai_campaign_activate_brd_v3_quality_validation(uuid,uuid,uuid,bigint,text,text,uuid,uuid,uuid,uuid,uuid,uuid,uuid,bigint,uuid,text,uuid,uuid,uuid,uuid,text,text,integer)
TO service_role;

COMMENT ON TABLE public.synthetic_ai_brd_v2_quality_validation_windows IS
  'Immutable one-use BRD quality allowances. Prompt-v2 rows chain from final continuations; a prompt-v3 row may chain once from the exact consumed prompt-v2 row.';
COMMENT ON COLUMN public.synthetic_ai_brd_v2_quality_validation_windows.prior_quality_window_id IS
  'Prompt-v3 predecessor binding. A successor permanently supersedes its predecessor for active authority without changing history.';
COMMENT ON COLUMN public.synthetic_ai_campaign_effect_debits.brd_v2_quality_window_id IS
  'Immutable binding to a one-use BRD quality-validation window. The historical column name is retained for v2 and v3 rows.';

-- Rollback/read-only fallback: keep both provider runtimes off or disable the
-- campaign. Retain all windows, debits, attempts, versions and audit history;
-- never reopen a predecessor or destructively remove this extension.
