-- One-use BRD prompt-v2 quality validation on the original synthetic campaign.
-- Installation creates no provider authority. Activation is a later, service-only
-- action while both provider runtimes are off.
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
    OR marker.migration_tip<>'20261003123459'
    OR marker.production_authorized OR marker.customer_data_authorized OR marker.real_provider_calls_authorized
    OR enterprise_control.provider_enabled OR studio_control.provider_enabled
    OR pg_catalog.to_regclass('public.synthetic_ai_brd_v2_quality_validation_windows') IS NOT NULL
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_attribute
      WHERE attrelid='public.synthetic_ai_campaign_effect_debits'::regclass
        AND attname='brd_v2_quality_window_id' AND NOT attisdropped)
    OR EXISTS(SELECT 1 FROM public.pr_c_controlled_human_exercises WHERE lifecycle<>'deprovisioned')
  THEN RAISE EXCEPTION 'SYNTHETIC_AI_BRD_V2_QUALITY_MIGRATION_PRECONDITION_FAILED';END IF;
END
$precondition$;

CREATE TABLE public.synthetic_ai_brd_v2_quality_validation_windows(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL UNIQUE REFERENCES public.synthetic_ai_campaign_authorities(id) ON DELETE RESTRICT,
  prior_final_continuation_id uuid NOT NULL UNIQUE REFERENCES public.synthetic_ai_campaign_final_continuations(id) ON DELETE RESTRICT,
  activated_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  authorization_version bigint NOT NULL CHECK(authorization_version>0),
  generation_actor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  generation_authorization_version bigint NOT NULL CHECK(generation_authorization_version>0),
  target_fingerprint text NOT NULL CHECK(target_fingerprint~'^sha256:[0-9a-f]{64}$'),
  project_ref text NOT NULL CHECK(project_ref~'^[a-z0-9]{20}$'),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL,
  provider_config_id uuid NOT NULL,
  key_ref_id uuid NOT NULL,
  assess_route_id uuid NOT NULL,
  studio_route_id uuid NOT NULL,
  studio_route_version bigint NOT NULL CHECK(studio_route_version>0),
  source_package_id uuid NOT NULL,
  artifact_id uuid NOT NULL,
  source_package_hash text NOT NULL CHECK(source_package_hash~'^[0-9a-f]{64}$'),
  template_kind text NOT NULL CHECK(template_kind IN('system','tenant')),
  template_version_id uuid NOT NULL,
  template_version text NOT NULL CHECK(length(btrim(template_version)) BETWEEN 1 AND 120),
  template_hash text NOT NULL CHECK(template_hash~'^[0-9a-f]{64}$'),
  baseline_aggregate_version bigint NOT NULL CHECK(baseline_aggregate_version>=1),
  expected_current_version_id uuid NOT NULL,
  expected_current_version_hash text NOT NULL CHECK(expected_current_version_hash~'^[0-9a-f]{64}$'),
  expected_approved_version_id uuid NOT NULL,
  expected_approved_version_hash text NOT NULL CHECK(expected_approved_version_hash~'^[0-9a-f]{64}$'),
  prompt_key text NOT NULL DEFAULT 'studio-multisource-generation' CHECK(prompt_key='studio-multisource-generation'),
  prompt_version text NOT NULL DEFAULT 'studio-pr-b-2' CHECK(prompt_version='studio-pr-b-2'),
  activation_provider_last_validated_at timestamptz,
  validation_required boolean NOT NULL,
  baseline_debit_count integer NOT NULL DEFAULT 8 CHECK(baseline_debit_count=8),
  baseline_aggregate_usd_nanos bigint NOT NULL DEFAULT 4640993600 CHECK(baseline_aggregate_usd_nanos=4640993600),
  fixed_debit_usd_nanos bigint NOT NULL DEFAULT 471459200 CHECK(fixed_debit_usd_nanos=471459200),
  maximum_additional_effects integer NOT NULL CHECK(maximum_additional_effects IN(1,2)),
  maximum_aggregate_usd_nanos bigint NOT NULL CHECK(maximum_aggregate_usd_nanos IN(5112452800,5583912000)),
  release_sha text NOT NULL CHECK(release_sha~'^[0-9a-f]{40}$'),
  source_attestation_digest text NOT NULL CHECK(source_attestation_digest~'^sha256:[0-9a-f]{64}$'),
  binding_digest text NOT NULL UNIQUE CHECK(binding_digest~'^sha256:[0-9a-f]{64}$'),
  result jsonb NOT NULL CHECK(jsonb_typeof(result)='object'),
  requested_window_seconds integer NOT NULL CHECK(requested_window_seconds BETWEEN 1 AND 86400),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  expires_at timestamptz NOT NULL,
  CHECK(expires_at>created_at AND expires_at<=created_at+interval '24 hours'),
  CHECK((validation_required AND maximum_additional_effects=2 AND maximum_aggregate_usd_nanos=5583912000)
     OR(NOT validation_required AND activation_provider_last_validated_at IS NOT NULL
       AND maximum_additional_effects=1 AND maximum_aggregate_usd_nanos=5112452800
       AND expires_at<=activation_provider_last_validated_at+interval '24 hours')),
  FOREIGN KEY(workspace_id,org_id) REFERENCES public.workspaces(id,org_id) ON DELETE RESTRICT,
  FOREIGN KEY(provider_config_id,org_id) REFERENCES public.ai_provider_configs(id,org_id) ON DELETE RESTRICT,
  FOREIGN KEY(key_ref_id,org_id) REFERENCES public.ai_provider_key_refs(id,org_id) ON DELETE RESTRICT,
  FOREIGN KEY(assess_route_id,org_id,workspace_id) REFERENCES public.enterprise_ai_capability_routes(id,org_id,workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY(studio_route_id,org_id,workspace_id) REFERENCES public.enterprise_ai_capability_routes(id,org_id,workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY(source_package_id,artifact_id,org_id,workspace_id)
    REFERENCES public.studio_artifact_source_packages(id,artifact_id,org_id,workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY(artifact_id,org_id,workspace_id)
    REFERENCES public.studio_artifact_aggregates(id,org_id,workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY(expected_current_version_id,artifact_id,org_id,workspace_id)
    REFERENCES public.studio_artifact_versions(id,artifact_id,org_id,workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY(expected_approved_version_id,artifact_id,org_id,workspace_id)
    REFERENCES public.studio_artifact_versions(id,artifact_id,org_id,workspace_id) ON DELETE RESTRICT
);

ALTER TABLE public.synthetic_ai_campaign_effect_debits
  ADD COLUMN brd_v2_quality_window_id uuid
  REFERENCES public.synthetic_ai_brd_v2_quality_validation_windows(id) ON DELETE RESTRICT,
  ADD CONSTRAINT synthetic_ai_campaign_debit_window_exclusive_check
  CHECK(num_nonnulls(renewal_id,final_continuation_id,brd_v2_quality_window_id)<=1);
CREATE INDEX synthetic_ai_campaign_debit_brd_v2_quality_window_idx
  ON public.synthetic_ai_campaign_effect_debits(brd_v2_quality_window_id,id)
  WHERE brd_v2_quality_window_id IS NOT NULL;

CREATE TRIGGER synthetic_ai_brd_v2_quality_window_immutable
  BEFORE UPDATE OR DELETE ON public.synthetic_ai_brd_v2_quality_validation_windows
  FOR EACH ROW EXECUTE FUNCTION public.synthetic_ai_final_continuation_immutable_guard();
ALTER TABLE public.synthetic_ai_brd_v2_quality_validation_windows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.synthetic_ai_brd_v2_quality_validation_windows FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.synthetic_ai_brd_v2_quality_validation_windows FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.synthetic_ai_brd_v2_quality_validation_windows TO service_role;

CREATE FUNCTION public.synthetic_ai_campaign_activate_brd_v2_quality_validation(
  p_actor uuid,p_org uuid,p_workspace uuid,p_authorization_version bigint,
  p_target_fingerprint text,p_project_ref text,p_campaign uuid,p_prior_final_continuation uuid,
  p_provider_config uuid,p_key_ref uuid,p_assess_route uuid,p_studio_route uuid,
  p_generation_actor uuid,p_generation_authorization_version bigint,
  p_source_package uuid,p_source_package_hash text,p_artifact uuid,p_template_version uuid,
  p_expected_current_version uuid,p_expected_approved_version uuid,
  p_release_sha text,p_source_attestation_digest text,p_window_seconds integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  target public.synthetic_admin_targets;campaign public.synthetic_ai_campaign_authorities;
  final_continuation public.synthetic_ai_campaign_final_continuations;
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
  IF p_actor IS NULL OR p_org IS NULL OR p_workspace IS NULL OR p_campaign IS NULL OR p_prior_final_continuation IS NULL
    OR p_provider_config IS NULL OR p_key_ref IS NULL OR p_assess_route IS NULL OR p_studio_route IS NULL
    OR p_generation_actor IS NULL OR p_generation_authorization_version IS NULL OR p_generation_authorization_version<=0
    OR p_source_package IS NULL OR p_artifact IS NULL OR p_template_version IS NULL
    OR p_expected_current_version IS NULL OR p_expected_approved_version IS NULL
    OR p_target_fingerprint!~'^sha256:[0-9a-f]{64}$' OR p_project_ref!~'^[a-z0-9]{20}$'
    OR p_source_package_hash!~'^[0-9a-f]{64}$' OR p_release_sha!~'^[0-9a-f]{40}$'
    OR p_source_attestation_digest!~'^sha256:[0-9a-f]{64}$' OR p_window_seconds NOT BETWEEN 1 AND 86400
  THEN RAISE EXCEPTION 'SYNTHETIC_AI_BRD_V2_QUALITY_INVALID';END IF;
  PERFORM public.pr1b_assert_command_authority(p_actor,p_org,p_workspace,'org.admin',p_authorization_version);
  PERFORM public.studio_assert_actor(p_generation_actor,p_org,p_workspace,'studio.artifacts.generate',p_generation_authorization_version);
  target:=public.synthetic_admin_assert_target(p_actor,p_org,p_workspace,p_authorization_version,p_target_fingerprint);
  request_host:=public.synthetic_ai_campaign_request_host();
  IF request_host IS DISTINCT FROM p_project_ref||'.supabase.co'
    OR target.org_id IS DISTINCT FROM p_org OR target.workspace_id IS DISTINCT FROM p_workspace
    OR target.operator_actor_id IS DISTINCT FROM p_actor OR NOT target.enabled OR NOT target.synthetic_only
    OR target.production_authorized OR target.customer_data_authorized OR target.real_provider_calls_authorized
  THEN RAISE EXCEPTION 'SYNTHETIC_AI_BRD_V2_QUALITY_NOT_AUTHORIZED';END IF;
  SELECT * INTO STRICT marker FROM public.hosted_pilot_environment_identity WHERE singleton FOR SHARE;
  SELECT * INTO STRICT enterprise_control FROM public.enterprise_intelligence_runtime_control WHERE singleton FOR SHARE;
  SELECT * INTO STRICT studio_control FROM public.studio_artifact_runtime_control WHERE singleton FOR SHARE;
  IF marker.migration_tip<>'20261003150800' OR marker.production_authorized OR marker.customer_data_authorized
    OR marker.real_provider_calls_authorized OR enterprise_control.provider_enabled OR studio_control.provider_enabled
  THEN RAISE EXCEPTION 'SYNTHETIC_AI_BRD_V2_QUALITY_RUNTIME_NOT_OFF';END IF;

  SELECT * INTO campaign FROM public.synthetic_ai_campaign_authorities authority
    WHERE authority.id=p_campaign AND authority.target_id=target.id AND authority.target_fingerprint=p_target_fingerprint
      AND authority.project_ref=p_project_ref AND authority.server_host=request_host AND authority.org_id=p_org
      AND authority.workspace_id=p_workspace AND authority.operator_actor_id=p_actor
      AND authority.provider_config_id=p_provider_config AND authority.key_ref_id=p_key_ref
      AND authority.assess_route_id=p_assess_route AND authority.studio_route_id=p_studio_route FOR UPDATE;
  SELECT * INTO final_continuation FROM public.synthetic_ai_campaign_final_continuations row
    WHERE row.id=p_prior_final_continuation AND row.campaign_id=p_campaign FOR SHARE;
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
  SELECT * INTO existing FROM public.synthetic_ai_brd_v2_quality_validation_windows row WHERE row.campaign_id=p_campaign;

  IF current_version.template_kind='system' THEN
    SELECT * INTO system_template FROM public.studio_system_template_versions template WHERE template.id=p_template_version FOR SHARE;
    template_kind_value:='system';template_version_value:=system_template.template_version;template_hash_value:=system_template.template_hash;
  ELSIF current_version.template_kind='tenant' THEN
    SELECT * INTO tenant_template FROM public.studio_tenant_template_versions template
      WHERE template.id=p_template_version AND template.org_id=p_org AND template.workspace_id=p_workspace FOR SHARE;
    template_kind_value:='tenant';template_version_value:=tenant_template.version::text;template_hash_value:=tenant_template.template_hash;
  END IF;

  IF existing.id IS NOT NULL THEN
    IF existing.prior_final_continuation_id IS DISTINCT FROM p_prior_final_continuation
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
    THEN RAISE EXCEPTION 'SYNTHETIC_AI_BRD_V2_QUALITY_REPLAY_MISMATCH';END IF;
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
    OR final_continuation.id IS NULL
    OR final_continuation.maximum_additional_effects<>2 OR final_continuation.maximum_aggregate_usd_nanos<>4640993600
    OR package.id IS NULL OR package.package_hash IS DISTINCT FROM p_source_package_hash
    OR package.source_mode<>'assess_handoff' OR package.lineage_classification<>'assessed' OR package.planning_only
    OR artifact.id IS NULL OR artifact.artifact_type<>'brd' OR artifact.source_package_id IS DISTINCT FROM package.id
    OR artifact.source_package_hash IS DISTINCT FROM package.package_hash OR artifact.source_mode<>'assess_handoff'
    OR artifact.lineage_classification<>'assessed' OR artifact.planning_only OR artifact.lifecycle<>'approved'
    OR artifact.current_version_id IS DISTINCT FROM p_expected_current_version
    OR artifact.current_approved_version_id IS DISTINCT FROM p_expected_approved_version
    OR current_version.id IS NULL OR approved_version.id IS NULL OR current_version.id IS DISTINCT FROM approved_version.id
    OR current_version.version<>2 OR approved_version.version<>2 OR current_version.lifecycle<>'approved' OR approved_version.lifecycle<>'approved'
    OR current_version.source_package_id IS DISTINCT FROM package.id OR current_version.source_package_hash IS DISTINCT FROM package.package_hash
    OR current_version.template_kind IS DISTINCT FROM template_kind_value
    OR COALESCE(current_version.template_id,current_version.tenant_template_version_id) IS DISTINCT FROM p_template_version
    OR current_version.template_version IS DISTINCT FROM template_version_value OR current_version.template_hash IS DISTINCT FROM template_hash_value
    OR system_template.id IS NULL AND tenant_template.id IS NULL
    OR system_template.id IS NOT NULL AND(system_template.artifact_type<>'brd' OR system_template.superseded_at IS NOT NULL)
    OR tenant_template.id IS NOT NULL AND tenant_template.status<>'approved'
    OR EXISTS(SELECT 1 FROM public.studio_artifact_generation_attempts attempt
      WHERE attempt.artifact_id=p_artifact AND attempt.state IN('requested','claimed','generating','response_staged','reconciling','cancel_requested'))
    OR debit_count<>8 OR consumed_count<>8 OR debit_spend<>3771673600
    OR campaign.carried_usd_nanos+debit_spend<>4640993600
    OR operation_counts IS DISTINCT FROM jsonb_build_object('assess.evidence.extract',1,'provider.validate',3,'studio.document.generate',4)
    OR (SELECT count(*) FROM public.synthetic_ai_campaign_effect_debits debit
      WHERE debit.campaign_id=p_campaign AND debit.final_continuation_id=p_prior_final_continuation)<>2
    OR EXISTS(SELECT 1 FROM public.enterprise_ai_budget_reservations reservation
      WHERE reservation.org_id=p_org AND reservation.workspace_id=p_workspace AND reservation.provider_config_id=p_provider_config
        AND(reservation.state IN('reserved','uncertain') OR reservation.studio_transfer_pending OR reservation.assess_mapping_transfer_pending))
    OR provider_config.id IS NULL OR provider_config.provider<>'openai' OR provider_config.key_ref_id IS DISTINCT FROM p_key_ref
    OR provider_config.endpoint_url<>'https://api.openai.com' OR provider_config.default_model<>'gpt-4.1-mini-2025-04-14'
    OR provider_config.model_allowlist IS DISTINCT FROM ARRAY['gpt-4.1-mini-2025-04-14']::text[]
    OR provider_config.status<>'active' OR provider_config.deleted_at IS NOT NULL
    OR studio_route.id IS NULL OR studio_route.provider_config_id IS DISTINCT FROM p_provider_config
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
  THEN RAISE EXCEPTION 'SYNTHETIC_AI_BRD_V2_QUALITY_HISTORY_UNSAFE';END IF;

  validation_required_value:=provider_config.last_validated_at IS NULL
    OR provider_config.last_validated_at>created_value
    OR provider_config.last_validated_at<created_value-interval '24 hours';
  IF validation_required_value THEN expires_value:=created_value+make_interval(secs=>p_window_seconds);
  ELSE expires_value:=least(created_value+make_interval(secs=>p_window_seconds),provider_config.last_validated_at+interval '24 hours');END IF;
  IF expires_value<=created_value THEN RAISE EXCEPTION 'SYNTHETIC_AI_BRD_V2_QUALITY_PROVIDER_STALE';END IF;
  digest_value:='sha256:'||encode(public.digest(convert_to(concat_ws('|','synthetic-ai-brd-v2-quality-validation-v1',
    campaign.id::text,final_continuation.id::text,p_actor::text,p_org::text,p_workspace::text,p_authorization_version::text,
    p_generation_actor::text,p_generation_authorization_version::text,p_target_fingerprint,p_project_ref,p_provider_config::text,
    p_key_ref::text,p_assess_route::text,p_studio_route::text,studio_route.version::text,p_source_package::text,
    p_source_package_hash,p_artifact::text,p_template_version::text,template_kind_value,template_version_value,template_hash_value,
    artifact.aggregate_version::text,current_version.id::text,current_version.content_hash,approved_version.id::text,
    approved_version.content_hash,'studio-multisource-generation','studio-pr-b-2',validation_required_value::text,
    COALESCE(provider_config.last_validated_at::text,''),p_release_sha,p_source_attestation_digest,p_window_seconds::text,created_value::text),'UTF8'),'sha256'),'hex');
  result_value:=jsonb_build_object('status','activated','campaignId',campaign.id,'expiresAt',expires_value,
    'validationRequired',validation_required_value,'baselineAggregateUsdNanos',4640993600,
    'maximumAdditionalEffects',CASE WHEN validation_required_value THEN 2 ELSE 1 END,
    'maximumAggregateUsdNanos',CASE WHEN validation_required_value THEN 5583912000 ELSE 5112452800 END,
    'promptKey','studio-multisource-generation','promptVersion','studio-pr-b-2',
    'releaseSha',p_release_sha,'sourceAttestationDigest',p_source_attestation_digest,'bindingDigest',digest_value);
  INSERT INTO public.synthetic_ai_brd_v2_quality_validation_windows(campaign_id,prior_final_continuation_id,
    activated_by,authorization_version,generation_actor_id,generation_authorization_version,target_fingerprint,project_ref,
    org_id,workspace_id,provider_config_id,key_ref_id,assess_route_id,studio_route_id,studio_route_version,
    source_package_id,artifact_id,source_package_hash,template_kind,template_version_id,template_version,template_hash,
    baseline_aggregate_version,expected_current_version_id,expected_current_version_hash,
    expected_approved_version_id,expected_approved_version_hash,activation_provider_last_validated_at,validation_required,
    maximum_additional_effects,maximum_aggregate_usd_nanos,release_sha,source_attestation_digest,binding_digest,result,
    requested_window_seconds,created_at,expires_at)
  VALUES(campaign.id,final_continuation.id,p_actor,p_authorization_version,p_generation_actor,p_generation_authorization_version,
    p_target_fingerprint,p_project_ref,p_org,p_workspace,p_provider_config,p_key_ref,p_assess_route,p_studio_route,studio_route.version,
    package.id,artifact.id,package.package_hash,template_kind_value,p_template_version,template_version_value,template_hash_value,
    artifact.aggregate_version,current_version.id,current_version.content_hash,approved_version.id,approved_version.content_hash,
    provider_config.last_validated_at,validation_required_value,CASE WHEN validation_required_value THEN 2 ELSE 1 END,
    CASE WHEN validation_required_value THEN 5583912000 ELSE 5112452800 END,p_release_sha,p_source_attestation_digest,
    digest_value,result_value,p_window_seconds,created_value,expires_value) RETURNING * INTO inserted;
  RETURN inserted.result;
END
$$;

-- A campaign has exactly one active authority window. The fully consumed
-- predecessor remains immutable; this successor is additive and one-use.
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
            WHERE quality.campaign_id=authority.id AND quality.expires_at>statement_timestamp())<>1 THEN NULL
    ELSE COALESCE(
      (SELECT renewal.expires_at FROM public.synthetic_ai_campaign_renewals renewal
        WHERE renewal.campaign_id=authority.id AND renewal.expires_at>statement_timestamp()),
      (SELECT final.expires_at FROM public.synthetic_ai_campaign_final_continuations final
        WHERE final.campaign_id=authority.id AND final.expires_at>statement_timestamp()
          AND NOT EXISTS(SELECT 1 FROM public.synthetic_ai_brd_v2_quality_validation_windows quality
            WHERE quality.prior_final_continuation_id=final.id)),
      (SELECT quality.expires_at FROM public.synthetic_ai_brd_v2_quality_validation_windows quality
        WHERE quality.campaign_id=authority.id AND quality.expires_at>statement_timestamp()))
  END
  FROM public.synthetic_ai_campaign_authorities authority WHERE authority.id=p_campaign;
$$;

DO $reserve_forward$
DECLARE fn regprocedure:='public.synthetic_ai_campaign_reserve_effect(uuid,uuid,uuid,bigint,text,text,uuid,uuid,uuid,bigint,uuid,uuid,uuid,text,text,text,text,text,integer)'::regprocedure;
  definition text;old text;replacement text;
BEGIN
  SELECT replace(pg_get_functiondef(fn),chr(13)||chr(10),chr(10)) INTO STRICT definition;
  old:=' prior public.synthetic_ai_campaign_effect_debits;renewal public.synthetic_ai_campaign_renewals;final_continuation public.synthetic_ai_campaign_final_continuations;spent bigint;renewal_count integer;slot_count integer;validation_count integer;generation_count integer;request_host text;';
  replacement:=' prior public.synthetic_ai_campaign_effect_debits;renewal public.synthetic_ai_campaign_renewals;final_continuation public.synthetic_ai_campaign_final_continuations;quality_window public.synthetic_ai_brd_v2_quality_validation_windows;quality_attempt public.studio_artifact_generation_attempts;quality_artifact public.studio_artifact_aggregates;quality_route public.enterprise_ai_capability_routes;quality_config public.ai_provider_configs;computed_plan_hash text;spent bigint;renewal_count integer;slot_count integer;validation_count integer;generation_count integer;request_host text;';
  IF length(definition)-length(replace(definition,old,''))<>length(old) THEN RAISE EXCEPTION 'SYNTHETIC_AI_BRD_V2_QUALITY_RESERVE_DECLARATION_DRIFT';END IF;
  definition:=replace(definition,old,replacement);
  old:=' AND authority.provider=p_provider AND authority.endpoint=p_endpoint AND authority.model=p_model AND authority.enabled FOR UPDATE;'||chr(10);
  replacement:=old||' SELECT * INTO quality_window FROM public.synthetic_ai_brd_v2_quality_validation_windows active'||chr(10)||
    '  WHERE active.campaign_id=campaign.id AND active.expires_at>statement_timestamp() FOR SHARE;'||chr(10);
  IF length(definition)-length(replace(definition,old,''))<>length(old) THEN RAISE EXCEPTION 'SYNTHETIC_AI_BRD_V2_QUALITY_RESERVE_WINDOW_LOOKUP_DRIFT';END IF;
  definition:=replace(definition,old,replacement);
  old:='   OR prior.endpoint IS DISTINCT FROM p_endpoint OR prior.model IS DISTINCT FROM p_model'||chr(10);
  replacement:=old||'   OR(quality_window.id IS NOT NULL AND prior.brd_v2_quality_window_id IS DISTINCT FROM quality_window.id)'||chr(10);
  IF length(definition)-length(replace(definition,old,''))<>length(old) THEN RAISE EXCEPTION 'SYNTHETIC_AI_BRD_V2_QUALITY_RESERVE_REPLAY_DRIFT';END IF;
  definition:=replace(definition,old,replacement);
  old:='  IF final_continuation.id IS NOT NULL THEN'||chr(10);
  replacement:=$quality$  IF quality_window.id IS NOT NULL THEN
   SELECT count(*)::integer,count(*) FILTER(WHERE operation='provider.validate')::integer,
    count(*) FILTER(WHERE operation='studio.document.generate')::integer
    INTO renewal_count,validation_count,generation_count FROM public.synthetic_ai_campaign_effect_debits debit
    WHERE debit.brd_v2_quality_window_id=quality_window.id;
   IF renewal.id IS NOT NULL OR final_continuation.id IS NOT NULL OR renewal_count>=quality_window.maximum_additional_effects
   THEN RAISE EXCEPTION 'SYNTHETIC_AI_CAMPAIGN_EFFECT_LIMIT_REACHED';END IF;
   SELECT * INTO quality_config FROM public.ai_provider_configs config
     WHERE config.id=quality_window.provider_config_id AND config.org_id=quality_window.org_id FOR SHARE;
   IF kind='studio' AND p_operation='studio.document.generate' THEN
    SELECT * INTO quality_attempt FROM public.studio_artifact_generation_attempts attempt
      WHERE attempt.id=p_effect AND attempt.org_id=quality_window.org_id AND attempt.workspace_id=quality_window.workspace_id FOR SHARE;
    SELECT * INTO quality_artifact FROM public.studio_artifact_aggregates artifact
      WHERE artifact.id=quality_window.artifact_id AND artifact.org_id=quality_window.org_id AND artifact.workspace_id=quality_window.workspace_id FOR SHARE;
    SELECT * INTO quality_route FROM public.enterprise_ai_capability_routes route
      WHERE route.id=quality_window.studio_route_id AND route.org_id=quality_window.org_id AND route.workspace_id=quality_window.workspace_id FOR SHARE;
    computed_plan_hash:=public.enterprise_sha256_jsonb(jsonb_build_object('routeId',quality_route.id,'routeVersion',quality_route.version,
      'providerConfigId',quality_config.id,'provider',quality_config.provider,'model',quality_route.model,
      'capability','studio.document.generate','promptKey',quality_window.prompt_key,'promptVersion',quality_window.prompt_version,
      'maximumOutputTokens',4000));
   END IF;
   IF NOT (
    (quality_window.validation_required AND kind='enterprise' AND p_operation='provider.validate' AND p_route IS NULL
      AND p_actor=quality_window.activated_by AND validation_count=0 AND generation_count=0
      AND quality_config.id=quality_window.provider_config_id AND quality_config.key_ref_id=quality_window.key_ref_id
      AND quality_config.provider='openai' AND quality_config.endpoint_url='https://api.openai.com'
      AND quality_config.default_model='gpt-4.1-mini-2025-04-14' AND quality_config.status='active' AND quality_config.deleted_at IS NULL
      AND(quality_config.last_validated_at IS NULL OR quality_config.last_validated_at>statement_timestamp()
        OR quality_config.last_validated_at<statement_timestamp()-interval '24 hours'))
    OR(kind='studio' AND p_operation='studio.document.generate' AND p_route=quality_window.studio_route_id
      AND p_actor=quality_window.generation_actor_id AND p_authorization_version=quality_window.generation_authorization_version
      AND generation_count=0 AND p_maximum_output_tokens=4000
      AND((NOT quality_window.validation_required AND validation_count=0
          AND quality_config.last_validated_at IS NOT DISTINCT FROM quality_window.activation_provider_last_validated_at)
        OR(quality_window.validation_required AND validation_count=1
          AND EXISTS(SELECT 1 FROM public.synthetic_ai_campaign_effect_debits validation
            JOIN public.enterprise_ai_command_receipts receipt ON receipt.id=validation.receipt_id
            WHERE validation.brd_v2_quality_window_id=quality_window.id AND validation.operation='provider.validate'
              AND validation.authority_kind='enterprise' AND validation.consumed_at IS NOT NULL
              AND receipt.status='committed' AND receipt.completed_at IS NOT NULL
              AND quality_config.last_validated_at>=validation.consumed_at
              AND quality_config.last_validated_at<=statement_timestamp())))
      AND quality_attempt.id IS NOT NULL AND quality_attempt.created_at>=quality_window.created_at
      AND quality_attempt.requested_by=quality_window.generation_actor_id
      AND quality_attempt.requester_authorization_version=quality_window.generation_authorization_version
      AND quality_attempt.artifact_id=quality_window.artifact_id
      AND quality_attempt.source_package_id=quality_window.source_package_id
      AND quality_attempt.source_package_hash=quality_window.source_package_hash
      AND quality_attempt.template_kind=quality_window.template_kind
      AND COALESCE(quality_attempt.template_id,quality_attempt.tenant_template_version_id)=quality_window.template_version_id
      AND quality_attempt.template_version=quality_window.template_version AND quality_attempt.template_hash=quality_window.template_hash
      AND quality_attempt.expected_aggregate_version=quality_window.baseline_aggregate_version+1
      AND quality_attempt.expected_current_version_id=quality_window.expected_current_version_id
      AND quality_attempt.expected_approved_version_id=quality_window.expected_approved_version_id
      AND quality_attempt.provider_plan_state='bound' AND quality_attempt.provider_route_id=quality_window.studio_route_id
      AND quality_attempt.provider_config_id=quality_window.provider_config_id AND quality_attempt.provider_name='openai'
      AND quality_attempt.provider_model='gpt-4.1-mini-2025-04-14'
      AND quality_attempt.prompt_key=quality_window.prompt_key AND quality_attempt.prompt_version=quality_window.prompt_version
      AND quality_attempt.provider_plan_hash=computed_plan_hash
      AND quality_route.id IS NOT NULL AND quality_route.version=quality_window.studio_route_version
      AND quality_route.provider_config_id=quality_window.provider_config_id AND quality_route.enabled AND quality_route.deleted_at IS NULL
      AND quality_config.id IS NOT NULL AND quality_config.key_ref_id=quality_window.key_ref_id
      AND quality_config.provider='openai' AND quality_config.endpoint_url='https://api.openai.com'
      AND quality_config.default_model='gpt-4.1-mini-2025-04-14' AND quality_config.status='active' AND quality_config.deleted_at IS NULL
      AND quality_artifact.id IS NOT NULL AND quality_artifact.source_package_id=quality_window.source_package_id
      AND quality_artifact.source_package_hash=quality_window.source_package_hash
      AND quality_artifact.aggregate_version=quality_window.baseline_aggregate_version+1
      AND quality_artifact.current_version_id=quality_window.expected_current_version_id
      AND quality_artifact.current_approved_version_id=quality_window.expected_approved_version_id))
   THEN RAISE EXCEPTION 'SYNTHETIC_AI_CAMPAIGN_EFFECT_SLOT_NOT_AUTHORIZED';END IF;
  ELSIF final_continuation.id IS NOT NULL THEN
$quality$;
  IF length(definition)-length(replace(definition,old,''))<>length(old) THEN RAISE EXCEPTION 'SYNTHETIC_AI_BRD_V2_QUALITY_RESERVE_SLOT_DRIFT';END IF;
  definition:=replace(definition,old,replacement);
  old:='  SELECT * INTO final_continuation FROM public.synthetic_ai_campaign_final_continuations active'||chr(10)||
    '   WHERE active.campaign_id=campaign.id AND active.expires_at>statement_timestamp() FOR SHARE;'||chr(10);
  replacement:='  SELECT * INTO final_continuation FROM public.synthetic_ai_campaign_final_continuations active'||chr(10)||
    '   WHERE active.campaign_id=campaign.id AND active.expires_at>statement_timestamp()'||chr(10)||
    '    AND NOT EXISTS(SELECT 1 FROM public.synthetic_ai_brd_v2_quality_validation_windows quality'||chr(10)||
    '      WHERE quality.prior_final_continuation_id=active.id) FOR SHARE;'||chr(10);
  IF length(definition)-length(replace(definition,old,''))<>length(old) THEN RAISE EXCEPTION 'SYNTHETIC_AI_BRD_V2_QUALITY_RESERVE_SPENT_PREDECESSOR_DRIFT';END IF;
  definition:=replace(definition,old,replacement);
  old:='  OR(final_continuation.id IS NOT NULL AND campaign.carried_usd_nanos+spent+campaign.fixed_debit_usd_nanos>final_continuation.maximum_aggregate_usd_nanos)'||chr(10);
  replacement:=old||'  OR(quality_window.id IS NOT NULL AND campaign.carried_usd_nanos+spent+campaign.fixed_debit_usd_nanos>quality_window.maximum_aggregate_usd_nanos)'||chr(10);
  IF length(definition)-length(replace(definition,old,''))<>length(old) THEN RAISE EXCEPTION 'SYNTHETIC_AI_BRD_V2_QUALITY_RESERVE_CAP_DRIFT';END IF;
  definition:=replace(definition,old,replacement);
  old:='  campaign_id,renewal_id,final_continuation_id,receipt_id,effect_id,authority_kind,assess_mapping_run_id,studio_receipt_id,studio_attempt_id,';
  replacement:='  campaign_id,renewal_id,final_continuation_id,brd_v2_quality_window_id,receipt_id,effect_id,authority_kind,assess_mapping_run_id,studio_receipt_id,studio_attempt_id,';
  IF length(definition)-length(replace(definition,old,''))<>length(old) THEN RAISE EXCEPTION 'SYNTHETIC_AI_BRD_V2_QUALITY_RESERVE_INSERT_DRIFT';END IF;
  definition:=replace(definition,old,replacement);
  old:=' VALUES(campaign.id,renewal.id,final_continuation.id,CASE WHEN kind IN(''enterprise'',''assess_mapping'') THEN p_receipt END,p_effect,kind,';
  replacement:=' VALUES(campaign.id,renewal.id,final_continuation.id,quality_window.id,CASE WHEN kind IN(''enterprise'',''assess_mapping'') THEN p_receipt END,p_effect,kind,';
  IF length(definition)-length(replace(definition,old,''))<>length(old) THEN RAISE EXCEPTION 'SYNTHETIC_AI_BRD_V2_QUALITY_RESERVE_VALUES_DRIFT';END IF;
  EXECUTE replace(definition,old,replacement);
END
$reserve_forward$;

DO $consume_forward$
DECLARE fn regprocedure:='public.synthetic_ai_campaign_consume_effect(uuid,uuid,uuid,uuid,bigint,text,text,uuid,uuid,uuid,bigint,uuid,uuid,uuid,text,text,text,text,text,integer)'::regprocedure;
  definition text;old text;replacement text;
BEGIN
  SELECT replace(pg_get_functiondef(fn),chr(13)||chr(10),chr(10)) INTO STRICT definition;
  old:=' debit public.synthetic_ai_campaign_effect_debits;renewal public.synthetic_ai_campaign_renewals;final_continuation public.synthetic_ai_campaign_final_continuations;request_host text;';
  replacement:=' debit public.synthetic_ai_campaign_effect_debits;renewal public.synthetic_ai_campaign_renewals;final_continuation public.synthetic_ai_campaign_final_continuations;quality_window public.synthetic_ai_brd_v2_quality_validation_windows;quality_attempt public.studio_artifact_generation_attempts;quality_artifact public.studio_artifact_aggregates;quality_route public.enterprise_ai_capability_routes;quality_config public.ai_provider_configs;computed_plan_hash text;request_host text;';
  IF length(definition)-length(replace(definition,old,''))<>length(old) THEN RAISE EXCEPTION 'SYNTHETIC_AI_BRD_V2_QUALITY_CONSUME_DECLARATION_DRIFT';END IF;
  definition:=replace(definition,old,replacement);
  old:='  SELECT * INTO final_continuation FROM public.synthetic_ai_campaign_final_continuations active'||chr(10)||
    '   WHERE active.campaign_id=campaign.id AND active.expires_at>statement_timestamp() FOR SHARE;'||chr(10);
  replacement:='  SELECT * INTO final_continuation FROM public.synthetic_ai_campaign_final_continuations active'||chr(10)||
    '   WHERE active.campaign_id=campaign.id AND active.expires_at>statement_timestamp()'||chr(10)||
    '    AND NOT EXISTS(SELECT 1 FROM public.synthetic_ai_brd_v2_quality_validation_windows quality'||chr(10)||
    '      WHERE quality.prior_final_continuation_id=active.id) FOR SHARE;'||chr(10)||
    '  SELECT * INTO quality_window FROM public.synthetic_ai_brd_v2_quality_validation_windows active'||chr(10)||
    '   WHERE active.campaign_id=campaign.id AND active.expires_at>statement_timestamp() FOR SHARE;'||chr(10)||
    '  SELECT * INTO quality_config FROM public.ai_provider_configs config'||chr(10)||
    '   WHERE config.id=quality_window.provider_config_id AND config.org_id=quality_window.org_id FOR SHARE;'||chr(10)||
    '  IF debit.operation=''studio.document.generate'' THEN'||chr(10)||
    '   SELECT * INTO quality_attempt FROM public.studio_artifact_generation_attempts attempt'||chr(10)||
    '    WHERE attempt.id=debit.studio_attempt_id AND attempt.org_id=quality_window.org_id AND attempt.workspace_id=quality_window.workspace_id FOR SHARE;'||chr(10)||
    '   SELECT * INTO quality_artifact FROM public.studio_artifact_aggregates artifact'||chr(10)||
    '    WHERE artifact.id=quality_window.artifact_id AND artifact.org_id=quality_window.org_id AND artifact.workspace_id=quality_window.workspace_id FOR SHARE;'||chr(10)||
    '   SELECT * INTO quality_route FROM public.enterprise_ai_capability_routes route'||chr(10)||
    '    WHERE route.id=quality_window.studio_route_id AND route.org_id=quality_window.org_id AND route.workspace_id=quality_window.workspace_id FOR SHARE;'||chr(10)||
    '   computed_plan_hash:=public.enterprise_sha256_jsonb(jsonb_build_object(''routeId'',quality_route.id,''routeVersion'',quality_route.version,'||chr(10)||
    '    ''providerConfigId'',quality_config.id,''provider'',quality_config.provider,''model'',quality_route.model,'||chr(10)||
    '    ''capability'',''studio.document.generate'',''promptKey'',quality_window.prompt_key,''promptVersion'',quality_window.prompt_version,'||chr(10)||
    '    ''maximumOutputTokens'',4000));'||chr(10)||
    '  END IF;'||chr(10);
  IF length(definition)-length(replace(definition,old,''))<>length(old) THEN RAISE EXCEPTION 'SYNTHETIC_AI_BRD_V2_QUALITY_CONSUME_WINDOW_DRIFT';END IF;
  definition:=replace(definition,old,replacement);
  old:='  OR debit.authority_kind IS DISTINCT FROM kind'||chr(10);
  replacement:='  OR(quality_window.id IS NOT NULL AND debit.operation=''provider.validate'' AND('||chr(10)||
    '    NOT quality_window.validation_required OR quality_config.last_validated_at BETWEEN statement_timestamp()-interval ''24 hours'' AND statement_timestamp()))'||chr(10)||old;
  IF length(definition)-length(replace(definition,old,''))<>length(old) THEN RAISE EXCEPTION 'SYNTHETIC_AI_BRD_V2_QUALITY_CONSUME_FRESHNESS_DRIFT';END IF;
  definition:=replace(definition,old,replacement);
  old:='  OR debit.authority_kind IS DISTINCT FROM kind'||chr(10);
  replacement:='  OR(quality_window.id IS NOT NULL AND debit.operation=''studio.document.generate'' AND('||chr(10)||
    '    quality_attempt.id IS NULL OR quality_attempt.created_at<quality_window.created_at'||chr(10)||
    '    OR quality_attempt.requested_by IS DISTINCT FROM quality_window.generation_actor_id'||chr(10)||
    '    OR quality_attempt.requester_authorization_version IS DISTINCT FROM quality_window.generation_authorization_version'||chr(10)||
    '    OR quality_attempt.artifact_id IS DISTINCT FROM quality_window.artifact_id'||chr(10)||
    '    OR quality_attempt.source_package_id IS DISTINCT FROM quality_window.source_package_id'||chr(10)||
    '    OR quality_attempt.source_package_hash IS DISTINCT FROM quality_window.source_package_hash'||chr(10)||
    '    OR quality_attempt.template_kind IS DISTINCT FROM quality_window.template_kind'||chr(10)||
    '    OR COALESCE(quality_attempt.template_id,quality_attempt.tenant_template_version_id) IS DISTINCT FROM quality_window.template_version_id'||chr(10)||
    '    OR quality_attempt.template_version IS DISTINCT FROM quality_window.template_version'||chr(10)||
    '    OR quality_attempt.template_hash IS DISTINCT FROM quality_window.template_hash'||chr(10)||
    '    OR quality_attempt.expected_aggregate_version IS DISTINCT FROM quality_window.baseline_aggregate_version+1'||chr(10)||
    '    OR quality_attempt.expected_current_version_id IS DISTINCT FROM quality_window.expected_current_version_id'||chr(10)||
    '    OR quality_attempt.expected_approved_version_id IS DISTINCT FROM quality_window.expected_approved_version_id'||chr(10)||
    '    OR quality_attempt.prompt_key IS DISTINCT FROM quality_window.prompt_key'||chr(10)||
    '    OR quality_attempt.prompt_version IS DISTINCT FROM quality_window.prompt_version'||chr(10)||
    '    OR quality_attempt.provider_plan_hash IS DISTINCT FROM computed_plan_hash'||chr(10)||
    '    OR quality_route.id IS NULL OR quality_route.version IS DISTINCT FROM quality_window.studio_route_version'||chr(10)||
    '    OR quality_route.provider_config_id IS DISTINCT FROM quality_window.provider_config_id OR NOT quality_route.enabled OR quality_route.deleted_at IS NOT NULL'||chr(10)||
    '    OR(NOT quality_window.validation_required AND quality_config.last_validated_at IS DISTINCT FROM quality_window.activation_provider_last_validated_at)'||chr(10)||
    '    OR(quality_window.validation_required AND NOT EXISTS(SELECT 1 FROM public.synthetic_ai_campaign_effect_debits validation'||chr(10)||
    '      JOIN public.enterprise_ai_command_receipts receipt ON receipt.id=validation.receipt_id'||chr(10)||
    '      WHERE validation.brd_v2_quality_window_id=quality_window.id AND validation.operation=''provider.validate'''||chr(10)||
    '       AND validation.authority_kind=''enterprise'' AND validation.consumed_at IS NOT NULL'||chr(10)||
    '       AND receipt.status=''committed'' AND receipt.completed_at IS NOT NULL'||chr(10)||
    '       AND quality_config.last_validated_at>=validation.consumed_at'||chr(10)||
    '       AND quality_config.last_validated_at<=statement_timestamp()))'||chr(10)||
    '    OR quality_artifact.id IS NULL OR quality_artifact.aggregate_version IS DISTINCT FROM quality_window.baseline_aggregate_version+1'||chr(10)||
    '    OR quality_artifact.current_version_id IS DISTINCT FROM quality_window.expected_current_version_id'||chr(10)||
    '    OR quality_artifact.current_approved_version_id IS DISTINCT FROM quality_window.expected_approved_version_id))'||chr(10)||old;
  IF length(definition)-length(replace(definition,old,''))<>length(old) THEN RAISE EXCEPTION 'SYNTHETIC_AI_BRD_V2_QUALITY_CONSUME_PLAN_DRIFT';END IF;
  definition:=replace(definition,old,replacement);
  old:='    OR(final_continuation.id IS NOT NULL AND renewal.id IS NULL AND debit.final_continuation_id IS NOT DISTINCT FROM final_continuation.id AND debit.renewal_id IS NULL'||chr(10)||
    '      AND debit.reserved_at>=final_continuation.created_at AND debit.reserved_at<final_continuation.expires_at)))';
  replacement:='    OR(final_continuation.id IS NOT NULL AND renewal.id IS NULL AND quality_window.id IS NULL AND debit.final_continuation_id IS NOT DISTINCT FROM final_continuation.id AND debit.renewal_id IS NULL AND debit.brd_v2_quality_window_id IS NULL'||chr(10)||
    '      AND debit.reserved_at>=final_continuation.created_at AND debit.reserved_at<final_continuation.expires_at)'||chr(10)||
    '    OR(quality_window.id IS NOT NULL AND renewal.id IS NULL AND final_continuation.id IS NULL AND debit.brd_v2_quality_window_id IS NOT DISTINCT FROM quality_window.id'||chr(10)||
    '      AND debit.renewal_id IS NULL AND debit.final_continuation_id IS NULL'||chr(10)||
    '      AND debit.reserved_at>=quality_window.created_at AND debit.reserved_at<quality_window.expires_at)))';
  IF length(definition)-length(replace(definition,old,''))<>length(old) THEN RAISE EXCEPTION 'SYNTHETIC_AI_BRD_V2_QUALITY_CONSUME_PERMIT_DRIFT';END IF;
  EXECUTE replace(definition,old,replacement);
END
$consume_forward$;

-- Advance only current hosted-pilot identity consumers. Frozen historical tips
-- remain accepted by the controlled-human history constraint.
DO $identity_forward$
DECLARE marker public.hosted_pilot_environment_identity;marker_constraint text;exercise_constraint text;
  activation_definition text;bootstrap_definition text;assert_marker_definition text;
  old_activation text:='marker.migration_tip<>''20261003123459''';
  new_activation text:='marker.migration_tip<>''20261003150800''';
  old_bootstrap text:='marker.migration_tip=''20261003123459''';
  new_bootstrap text:='marker.migration_tip=''20261003150800''';
  old_assert text:='marker.migration_tip = ''20261003123459''';
  new_assert text:='marker.migration_tip = ''20261003150800''';
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
  IF marker.migration_tip<>'20261003123459' OR marker_constraint<>'(migration_tip = ''20261003123459''::text)'
    OR exercise_constraint<>'(migration_tip = ANY (ARRAY[''20260904120000''::text, ''20260924113000''::text, ''20260926053818''::text, ''20260928060000''::text, ''20261003015246''::text, ''20261003055918''::text, ''20261003123459''::text]))'
    OR (length(activation_definition)-length(replace(activation_definition,old_activation,'')))/length(old_activation)<>1
    OR (length(bootstrap_definition)-length(replace(bootstrap_definition,old_bootstrap,'')))/length(old_bootstrap)<>1
    OR (length(assert_marker_definition)-length(replace(assert_marker_definition,old_assert,'')))/length(old_assert)<>1
    OR EXISTS(SELECT 1 FROM public.pr_c_controlled_human_exercises WHERE lifecycle<>'deprovisioned')
  THEN RAISE EXCEPTION 'SYNTHETIC_AI_BRD_V2_QUALITY_IDENTITY_SOURCE_MISMATCH';END IF;
  EXECUTE replace(activation_definition,old_activation,new_activation);
  EXECUTE replace(bootstrap_definition,old_bootstrap,new_bootstrap);
  EXECUTE replace(assert_marker_definition,old_assert,new_assert);
  ALTER TABLE public.pr_c_controlled_human_exercises DROP CONSTRAINT pr_c_controlled_human_exercises_migration_tip_check;
  ALTER TABLE public.pr_c_controlled_human_exercises ADD CONSTRAINT pr_c_controlled_human_exercises_migration_tip_check
    CHECK(migration_tip IN('20260904120000','20260924113000','20260926053818','20260928060000','20261003015246','20261003055918','20261003123459','20261003150800'));
  ALTER TABLE public.hosted_pilot_environment_identity DROP CONSTRAINT hosted_pilot_environment_identity_migration_tip_check;
  UPDATE public.hosted_pilot_environment_identity SET migration_tip='20261003150800' WHERE singleton;
  ALTER TABLE public.hosted_pilot_environment_identity ADD CONSTRAINT hosted_pilot_environment_identity_migration_tip_check
    CHECK(migration_tip='20261003150800');
END
$identity_forward$;

REVOKE ALL ON FUNCTION
  public.synthetic_ai_campaign_activate_brd_v2_quality_validation(uuid,uuid,uuid,bigint,text,text,uuid,uuid,uuid,uuid,uuid,uuid,uuid,bigint,uuid,text,uuid,uuid,uuid,uuid,text,text,integer)
FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION
  public.synthetic_ai_campaign_activate_brd_v2_quality_validation(uuid,uuid,uuid,bigint,text,text,uuid,uuid,uuid,uuid,uuid,uuid,uuid,bigint,uuid,text,uuid,uuid,uuid,uuid,text,text,integer)
TO service_role;

COMMENT ON TABLE public.synthetic_ai_brd_v2_quality_validation_windows IS
  'Immutable one-use allowance for one prompt-v2 BRD generation, with one provider validation only when activation proves existing freshness insufficient.';
COMMENT ON COLUMN public.synthetic_ai_campaign_effect_debits.brd_v2_quality_window_id IS
  'Immutable binding to the one-use BRD-v2 quality-validation allowance. Null on all earlier campaign debits.';

-- Rollback/read-only fallback: leave both provider runtimes off or disable the
-- existing campaign. Retain the window, debits, attempts, versions and audit
-- history; do not reopen old windows or destructively remove this schema.
