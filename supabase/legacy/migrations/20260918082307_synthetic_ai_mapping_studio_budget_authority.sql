-- Correct the Assess mapping and Studio provider-effect authority identities.
-- This migration performs no provider call and does not enable either runtime.
DO $precondition$
DECLARE marker public.hosted_pilot_environment_identity;
BEGIN
  LOCK TABLE public.hosted_pilot_environment_identity IN SHARE ROW EXCLUSIVE MODE;
  SELECT * INTO STRICT marker FROM public.hosted_pilot_environment_identity WHERE singleton FOR UPDATE;
  IF marker.product_key<>'avalaos-core'
    OR marker.environment_class<>'hosted_nonproduction_pilot'
    OR marker.schema_contract<>'hosted-pilot-2026-08'
    OR marker.migration_tip<>'20260917173445'
    OR marker.production_authorized OR marker.customer_data_authorized OR marker.real_provider_calls_authorized
    OR pg_catalog.to_regprocedure('public.enterprise_assess_mapping_reserve_provider_budget_v1(uuid,uuid,uuid,bigint,uuid,uuid,uuid,bigint,uuid,uuid,text,text,text,integer,integer)') IS NOT NULL
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid='public.enterprise_ai_budget_reservations'::regclass
      AND attname='assess_mapping_run_id' AND NOT attisdropped)
  THEN RAISE EXCEPTION 'SYNTHETIC_AI_DOMAIN_BUDGET_MIGRATION_PRECONDITION_FAILED'; END IF;
END
$precondition$;

-- Keep the existing Enterprise and Studio rows byte-for-byte stable while
-- adding a third, mutually exclusive identity for Assess mapping runs.
ALTER TABLE public.enterprise_ai_budget_reservations
  DROP CONSTRAINT enterprise_ai_budget_authority_union_check,
  ADD COLUMN assess_mapping_run_id uuid,
  ADD COLUMN assess_mapping_transfer_count bigint NOT NULL DEFAULT 0 CHECK(assess_mapping_transfer_count BETWEEN 0 AND 1),
  ADD COLUMN assess_mapping_last_transfer_at timestamptz,
  ADD COLUMN assess_mapping_transfer_pending boolean NOT NULL DEFAULT false,
  DROP CONSTRAINT enterprise_ai_budget_reservations_authority_kind_check,
  ADD CONSTRAINT enterprise_ai_budget_reservations_authority_kind_check
    CHECK(authority_kind IN('enterprise','assess_mapping','studio')),
  ADD CONSTRAINT enterprise_ai_budget_assess_mapping_run_fkey
    FOREIGN KEY(assess_mapping_run_id) REFERENCES public.enterprise_assess_document_mapping_runs(id) ON DELETE RESTRICT,
  ADD CONSTRAINT enterprise_ai_budget_authority_union_check CHECK(
    (authority_kind='enterprise' AND receipt_id IS NOT NULL AND job_id IS NOT NULL
      AND assess_mapping_run_id IS NULL AND studio_receipt_id IS NULL AND studio_attempt_id IS NULL
      AND assess_mapping_transfer_count=0 AND assess_mapping_last_transfer_at IS NULL AND NOT assess_mapping_transfer_pending)
    OR(authority_kind='assess_mapping' AND receipt_id IS NOT NULL AND job_id IS NULL
      AND assess_mapping_run_id IS NOT NULL AND studio_receipt_id IS NULL AND studio_attempt_id IS NULL
      AND ((assess_mapping_transfer_count=0 AND assess_mapping_last_transfer_at IS NULL)
        OR(assess_mapping_transfer_count=1 AND assess_mapping_last_transfer_at IS NOT NULL)))
    OR(authority_kind='studio' AND receipt_id IS NULL AND job_id IS NULL
      AND assess_mapping_run_id IS NULL AND studio_receipt_id IS NOT NULL AND studio_attempt_id IS NOT NULL
      AND assess_mapping_transfer_count=0 AND assess_mapping_last_transfer_at IS NULL AND NOT assess_mapping_transfer_pending)
  );
CREATE UNIQUE INDEX enterprise_ai_budget_assess_mapping_run_unique
  ON public.enterprise_ai_budget_reservations(assess_mapping_run_id) WHERE assess_mapping_run_id IS NOT NULL;

-- Currency debits use the same explicit domain union. Existing rows keep their
-- Enterprise receipt identity and the immutable debit trigger unchanged.
ALTER TABLE public.synthetic_ai_campaign_effect_debits
  ALTER COLUMN receipt_id DROP NOT NULL,
  ADD COLUMN authority_kind text NOT NULL DEFAULT 'enterprise'
    CHECK(authority_kind IN('enterprise','assess_mapping','studio')),
  ADD COLUMN assess_mapping_run_id uuid,
  ADD COLUMN studio_receipt_id uuid,
  ADD COLUMN studio_attempt_id uuid,
  ADD CONSTRAINT synthetic_ai_campaign_debit_mapping_run_fkey
    FOREIGN KEY(assess_mapping_run_id) REFERENCES public.enterprise_assess_document_mapping_runs(id) ON DELETE RESTRICT,
  ADD CONSTRAINT synthetic_ai_campaign_debit_studio_receipt_fkey
    FOREIGN KEY(studio_receipt_id) REFERENCES public.studio_artifact_command_receipts(id) ON DELETE RESTRICT,
  ADD CONSTRAINT synthetic_ai_campaign_debit_studio_attempt_fkey
    FOREIGN KEY(studio_attempt_id) REFERENCES public.studio_artifact_generation_attempts(id) ON DELETE RESTRICT,
  ADD CONSTRAINT synthetic_ai_campaign_debit_authority_union_check CHECK(
    (authority_kind='enterprise' AND receipt_id IS NOT NULL AND assess_mapping_run_id IS NULL
      AND studio_receipt_id IS NULL AND studio_attempt_id IS NULL)
    OR(authority_kind='assess_mapping' AND receipt_id IS NOT NULL AND assess_mapping_run_id IS NOT NULL
      AND studio_receipt_id IS NULL AND studio_attempt_id IS NULL)
    OR(authority_kind='studio' AND receipt_id IS NULL AND assess_mapping_run_id IS NULL
      AND studio_receipt_id IS NOT NULL AND studio_attempt_id IS NOT NULL)
  );
CREATE UNIQUE INDEX synthetic_ai_campaign_debit_mapping_receipt_unique
  ON public.synthetic_ai_campaign_effect_debits(campaign_id,receipt_id)
  WHERE authority_kind='assess_mapping';
CREATE UNIQUE INDEX synthetic_ai_campaign_debit_mapping_run_unique
  ON public.synthetic_ai_campaign_effect_debits(campaign_id,assess_mapping_run_id)
  WHERE assess_mapping_run_id IS NOT NULL;
CREATE UNIQUE INDEX synthetic_ai_campaign_debit_studio_receipt_unique
  ON public.synthetic_ai_campaign_effect_debits(campaign_id,studio_receipt_id)
  WHERE studio_receipt_id IS NOT NULL;
CREATE UNIQUE INDEX synthetic_ai_campaign_debit_studio_attempt_unique
  ON public.synthetic_ai_campaign_effect_debits(campaign_id,studio_attempt_id)
  WHERE studio_attempt_id IS NOT NULL;

CREATE FUNCTION public.synthetic_ai_campaign_effect_binding_v2(
  p_actor uuid,p_org uuid,p_workspace uuid,p_authorization_version bigint,
  p_receipt uuid,p_effect uuid,p_execution_token uuid,p_execution_fence bigint,
  p_route uuid,p_provider_config uuid,p_key_ref uuid,p_provider text,p_endpoint text,p_model text,
  p_operation text,p_effect_request_hash text,p_maximum_output_tokens integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE enterprise_receipt public.enterprise_ai_command_receipts;job public.enterprise_ai_job_ledger;
  mapping_run public.enterprise_assess_document_mapping_runs;studio_receipt public.studio_artifact_command_receipts;
  attempt public.studio_artifact_generation_attempts;artifact public.studio_artifact_aggregates;
  source_package public.studio_artifact_source_packages;system_template public.studio_system_template_versions;
  tenant_template public.studio_tenant_template_versions;tenant_aggregate public.studio_tenant_template_aggregates;
  reservation public.enterprise_ai_budget_reservations;config public.ai_provider_configs;route public.enterprise_ai_capability_routes;
  kind text;command_hash text;
BEGIN
  IF p_effect IS NULL OR p_execution_token IS NULL OR p_execution_fence<1
    OR p_provider NOT IN('gemini','groq','openai','azure_openai','anthropic','openai_compatible')
    OR length(btrim(COALESCE(p_endpoint,''))) NOT BETWEEN 1 AND 500 OR p_endpoint!~'^https://'
    OR length(btrim(COALESCE(p_model,''))) NOT BETWEEN 1 AND 200
    OR length(btrim(COALESCE(p_operation,''))) NOT BETWEEN 1 AND 120
    OR p_effect_request_hash!~'^[0-9a-f]{64}$' OR p_maximum_output_tokens NOT BETWEEN 1 AND 64000
    OR(p_operation='provider.validate') IS DISTINCT FROM(p_route IS NULL)
  THEN RAISE EXCEPTION 'SYNTHETIC_AI_CAMPAIGN_BINDING_INVALID'; END IF;

  IF p_operation='studio.document.generate' THEN
    SELECT * INTO studio_receipt FROM public.studio_artifact_command_receipts
      WHERE id=p_receipt AND actor_id=p_actor AND org_id=p_org AND workspace_id=p_workspace FOR SHARE;
    SELECT * INTO attempt FROM public.studio_artifact_generation_attempts
      WHERE id=p_effect AND requested_by=p_actor AND org_id=p_org AND workspace_id=p_workspace FOR SHARE;
    SELECT * INTO artifact FROM public.studio_artifact_aggregates
      WHERE id=attempt.artifact_id AND org_id=p_org AND workspace_id=p_workspace FOR SHARE;
    SELECT * INTO source_package FROM public.studio_artifact_source_packages
      WHERE id=attempt.source_package_id AND artifact_id=attempt.artifact_id AND org_id=p_org AND workspace_id=p_workspace FOR SHARE;
    SELECT * INTO reservation FROM public.enterprise_ai_budget_reservations
      WHERE studio_receipt_id=p_receipt AND studio_attempt_id=p_effect FOR SHARE;
    IF studio_receipt.id IS NULL OR studio_receipt.status<>'committed'
      OR studio_receipt.command_type<>'studio.artifact.generation.request.v2'
      OR studio_receipt.resource_id IS DISTINCT FROM attempt.artifact_id
      OR studio_receipt.response->>'attemptId' IS DISTINCT FROM attempt.id::text
      OR attempt.id IS NULL OR attempt.state<>'generating'
      OR attempt.requester_authorization_version IS DISTINCT FROM p_authorization_version
      OR attempt.execution_token IS DISTINCT FROM p_execution_token OR attempt.execution_fence IS DISTINCT FROM p_execution_fence
      OR attempt.provider_route_id IS DISTINCT FROM p_route OR attempt.provider_config_id IS DISTINCT FROM p_provider_config
      OR attempt.provider_name IS DISTINCT FROM p_provider OR attempt.provider_model IS DISTINCT FROM p_model
      OR artifact.id IS NULL OR artifact.source_package_id IS DISTINCT FROM source_package.id
      OR artifact.source_package_hash IS DISTINCT FROM source_package.package_hash
      OR attempt.source_package_hash IS DISTINCT FROM source_package.package_hash
      OR artifact.aggregate_version IS DISTINCT FROM attempt.expected_aggregate_version
      OR artifact.current_version_id IS DISTINCT FROM attempt.expected_current_version_id
      OR artifact.current_approved_version_id IS DISTINCT FROM attempt.expected_approved_version_id
      OR NOT public.studio_pr_b_lock_source_package_current(source_package.id,p_org,p_workspace)
      OR reservation.id IS NULL OR reservation.authority_kind<>'studio' OR reservation.state<>'reserved'
      OR reservation.actor_id IS DISTINCT FROM p_actor OR reservation.org_id IS DISTINCT FROM p_org
      OR reservation.workspace_id IS DISTINCT FROM p_workspace OR reservation.authorization_version IS DISTINCT FROM p_authorization_version
      OR reservation.execution_token IS DISTINCT FROM p_execution_token OR reservation.execution_fence IS DISTINCT FROM p_execution_fence
      OR reservation.route_id IS DISTINCT FROM p_route OR reservation.provider_config_id IS DISTINCT FROM p_provider_config
      OR reservation.provider IS DISTINCT FROM p_provider OR reservation.capability IS DISTINCT FROM p_operation
      OR reservation.model IS DISTINCT FROM p_model
      OR reservation.maximum_output_tokens IS DISTINCT FROM p_maximum_output_tokens
    THEN RAISE EXCEPTION 'SYNTHETIC_AI_CAMPAIGN_DOMAIN_STALE'; END IF;
    IF attempt.template_kind='system' THEN
      SELECT * INTO system_template FROM public.studio_system_template_versions WHERE id=attempt.template_id FOR SHARE;
      IF system_template.id IS NULL OR system_template.superseded_at IS NOT NULL
        OR system_template.template_hash IS DISTINCT FROM attempt.template_hash
        OR system_template.template_version IS DISTINCT FROM attempt.template_version
        OR system_template.artifact_type IS DISTINCT FROM artifact.artifact_type
      THEN RAISE EXCEPTION 'SYNTHETIC_AI_CAMPAIGN_DOMAIN_STALE'; END IF;
    ELSE
      SELECT * INTO tenant_template FROM public.studio_tenant_template_versions
        WHERE id=attempt.tenant_template_version_id AND org_id=p_org AND workspace_id=p_workspace FOR SHARE;
      SELECT * INTO tenant_aggregate FROM public.studio_tenant_template_aggregates
        WHERE id=tenant_template.template_id AND org_id=p_org AND workspace_id=p_workspace FOR SHARE;
      IF tenant_template.id IS NULL OR tenant_template.status<>'approved'
        OR tenant_aggregate.current_approved_version_id IS DISTINCT FROM tenant_template.id
        OR tenant_template.template_hash IS DISTINCT FROM attempt.template_hash
        OR tenant_template.version::text IS DISTINCT FROM attempt.template_version
        OR(tenant_template.artifact_class<>'custom' AND tenant_template.artifact_class IS DISTINCT FROM artifact.artifact_type)
      THEN RAISE EXCEPTION 'SYNTHETIC_AI_CAMPAIGN_DOMAIN_STALE'; END IF;
    END IF;
    PERFORM public.studio_assert_actor(p_actor,p_org,p_workspace,'studio.artifacts.generate',p_authorization_version);
    kind:='studio';command_hash:=studio_receipt.request_hash;
  ELSE
    SELECT * INTO enterprise_receipt FROM public.enterprise_ai_command_receipts
      WHERE id=p_receipt AND actor_id=p_actor AND org_id=p_org AND workspace_id=p_workspace FOR SHARE;
    IF enterprise_receipt.id IS NULL OR enterprise_receipt.status<>'claimed'
      OR enterprise_receipt.execution_token IS DISTINCT FROM p_execution_token
      OR enterprise_receipt.execution_fence IS DISTINCT FROM p_execution_fence
    THEN RAISE EXCEPTION 'SYNTHETIC_AI_CAMPAIGN_RECEIPT_STALE'; END IF;
    IF p_operation='provider.validate' THEN
      IF enterprise_receipt.command_type<>'provider.validate' THEN RAISE EXCEPTION 'SYNTHETIC_AI_CAMPAIGN_DOMAIN_STALE'; END IF;
      PERFORM public.pr1b_assert_command_authority(p_actor,p_org,p_workspace,'org.admin',p_authorization_version);
      kind:='enterprise';command_hash:=enterprise_receipt.request_hash;
    ELSIF enterprise_receipt.command_type='assess.document-map.analyze' THEN
      SELECT * INTO mapping_run FROM public.enterprise_assess_document_mapping_runs
        WHERE id=p_effect AND receipt_id=p_receipt AND created_by=p_actor AND org_id=p_org AND workspace_id=p_workspace FOR SHARE;
      SELECT * INTO reservation FROM public.enterprise_ai_budget_reservations
        WHERE receipt_id=p_receipt AND assess_mapping_run_id=p_effect FOR SHARE;
      IF mapping_run.id IS NULL OR mapping_run.status<>'claimed'
        OR mapping_run.authorization_version IS DISTINCT FROM p_authorization_version
        OR mapping_run.execution_token IS DISTINCT FROM p_execution_token OR mapping_run.execution_fence IS DISTINCT FROM p_execution_fence
        OR mapping_run.route_id IS DISTINCT FROM p_route OR mapping_run.provider_config_id IS DISTINCT FROM p_provider_config
        OR mapping_run.provider IS DISTINCT FROM p_provider OR mapping_run.model IS DISTINCT FROM p_model
        OR reservation.id IS NULL OR reservation.authority_kind<>'assess_mapping' OR reservation.state<>'reserved'
        OR reservation.actor_id IS DISTINCT FROM p_actor OR reservation.org_id IS DISTINCT FROM p_org
        OR reservation.workspace_id IS DISTINCT FROM p_workspace OR reservation.authorization_version IS DISTINCT FROM p_authorization_version
        OR reservation.execution_token IS DISTINCT FROM p_execution_token OR reservation.execution_fence IS DISTINCT FROM p_execution_fence
        OR reservation.route_id IS DISTINCT FROM p_route OR reservation.provider_config_id IS DISTINCT FROM p_provider_config
        OR reservation.provider IS DISTINCT FROM p_provider OR reservation.capability IS DISTINCT FROM p_operation
        OR reservation.model IS DISTINCT FROM p_model
        OR reservation.maximum_output_tokens IS DISTINCT FROM p_maximum_output_tokens
      THEN RAISE EXCEPTION 'SYNTHETIC_AI_CAMPAIGN_DOMAIN_STALE'; END IF;
      PERFORM public.enterprise_assess_document_mapping_assert_run_fresh(mapping_run.id);
      PERFORM public.enterprise_assess_document_mapping_assert(p_receipt,p_actor,p_org,p_workspace,
        'assess.document-map.analyze',p_authorization_version,p_execution_token,p_execution_fence,'analyze');
      kind:='assess_mapping';command_hash:=enterprise_receipt.request_hash;
    ELSIF enterprise_receipt.command_type IN('evidence.extract','transcript.assess.extract') THEN
      SELECT * INTO job FROM public.enterprise_ai_job_ledger
        WHERE id=p_effect AND receipt_id=p_receipt AND actor_id=p_actor AND org_id=p_org AND workspace_id=p_workspace FOR SHARE;
      SELECT * INTO reservation FROM public.enterprise_ai_budget_reservations
        WHERE receipt_id=p_receipt AND job_id=p_effect FOR SHARE;
      IF job.id IS NULL OR job.status<>'running' OR job.execution_token IS DISTINCT FROM p_execution_token
        OR job.execution_fence IS DISTINCT FROM p_execution_fence OR job.route_id IS DISTINCT FROM p_route
        OR job.provider_config_id IS DISTINCT FROM p_provider_config OR job.provider IS DISTINCT FROM p_provider
        OR job.capability IS DISTINCT FROM p_operation OR job.model IS DISTINCT FROM p_model
        OR reservation.id IS NULL OR reservation.authority_kind<>'enterprise' OR reservation.state<>'reserved'
        OR reservation.actor_id IS DISTINCT FROM p_actor OR reservation.org_id IS DISTINCT FROM p_org
        OR reservation.workspace_id IS DISTINCT FROM p_workspace
        OR reservation.authorization_version IS DISTINCT FROM p_authorization_version
        OR reservation.execution_token IS DISTINCT FROM p_execution_token OR reservation.execution_fence IS DISTINCT FROM p_execution_fence
        OR reservation.route_id IS DISTINCT FROM p_route OR reservation.provider_config_id IS DISTINCT FROM p_provider_config
        OR reservation.provider IS DISTINCT FROM p_provider OR reservation.capability IS DISTINCT FROM p_operation
        OR reservation.model IS DISTINCT FROM p_model
        OR reservation.maximum_output_tokens IS DISTINCT FROM p_maximum_output_tokens
      THEN RAISE EXCEPTION 'SYNTHETIC_AI_CAMPAIGN_DOMAIN_STALE'; END IF;
      PERFORM public.pr1b_assert_command_authority(p_actor,p_org,p_workspace,'evidence.write',p_authorization_version);
      kind:='enterprise';command_hash:=enterprise_receipt.request_hash;
    ELSE
      -- Preserve the accepted ordinary gateway for every other governed
      -- capability. Campaign mode rejects operations outside its immutable
      -- allowlist below; ordinary mode retains the predecessor's route-bound
      -- behavior without fabricating a legacy job or domain receipt.
      kind:='enterprise';command_hash:=enterprise_receipt.request_hash;
    END IF;
  END IF;

  SELECT * INTO config FROM public.ai_provider_configs WHERE id=p_provider_config AND org_id=p_org
    AND provider=p_provider AND key_ref_id=p_key_ref AND endpoint_url=p_endpoint AND default_model=p_model
    AND model_allowlist=ARRAY[p_model] AND status='active' AND deleted_at IS NULL FOR SHARE;
  IF config.id IS NULL OR NOT EXISTS(SELECT 1 FROM public.ai_provider_key_refs key_ref
      WHERE key_ref.id=p_key_ref AND key_ref.org_id=p_org AND key_ref.provider=p_provider
        AND key_ref.resolver_type='server_reference' AND key_ref.deleted_at IS NULL
        AND(key_ref.expires_at IS NULL OR key_ref.expires_at>statement_timestamp())
        AND((p_operation='provider.validate' AND key_ref.status IN('pending_review','active'))
          OR(p_operation<>'provider.validate' AND key_ref.status='active')))
  THEN RAISE EXCEPTION 'SYNTHETIC_AI_CAMPAIGN_PROVIDER_STALE'; END IF;
  IF p_route IS NOT NULL THEN
    SELECT * INTO route FROM public.enterprise_ai_capability_routes WHERE id=p_route AND org_id=p_org AND workspace_id=p_workspace
      AND provider_config_id=p_provider_config AND capability=p_operation AND model=p_model AND enabled AND deleted_at IS NULL FOR SHARE;
    IF route.id IS NULL OR config.last_validated_at IS NULL OR config.last_validated_at>statement_timestamp()
      OR config.last_validated_at<statement_timestamp()-interval '24 hours'
      OR cardinality(route.allowed_roles)=0 OR NOT EXISTS(
        SELECT 1 FROM public.organization_members member
        JOIN public.roles role ON role.id=member.role_id AND role.org_id=p_org
        WHERE member.user_id=p_actor AND member.org_id=p_org AND member.status='active' AND member.deleted_at IS NULL
          AND role.status='active' AND role.deleted_at IS NULL
          AND EXISTS(SELECT 1 FROM unnest(route.allowed_roles) allowed(value)
            WHERE lower(allowed.value)=lower(role.name) OR lower(allowed.value)=lower(role.id::text))
        UNION ALL
        SELECT 1 FROM public.workspace_memberships member
        JOIN public.roles role ON role.id=member.role_id AND role.org_id=p_org AND role.workspace_id=p_workspace
        WHERE member.user_id=p_actor AND member.org_id=p_org AND member.workspace_id=p_workspace
          AND member.status='active' AND member.deleted_at IS NULL AND role.status='active' AND role.deleted_at IS NULL
          AND EXISTS(SELECT 1 FROM unnest(route.allowed_roles) allowed(value)
            WHERE lower(allowed.value)=lower(role.name) OR lower(allowed.value)=lower(role.id::text)))
    THEN RAISE EXCEPTION 'SYNTHETIC_AI_CAMPAIGN_PROVIDER_STALE'; END IF;
  END IF;
  RETURN jsonb_build_object('authorityKind',kind,'commandRequestHash',command_hash);
END
$$;

CREATE OR REPLACE FUNCTION public.synthetic_ai_campaign_reserve_effect(
 p_actor uuid,p_org uuid,p_workspace uuid,p_authorization_version bigint,
 p_target_fingerprint text,p_project_ref text,p_receipt uuid,p_effect uuid,p_execution_token uuid,p_execution_fence bigint,
 p_route uuid,p_provider_config uuid,p_key_ref uuid,p_provider text,p_endpoint text,p_model text,p_operation text,
 p_effect_request_hash text,p_maximum_output_tokens integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE binding jsonb;kind text;command_hash text;campaign public.synthetic_ai_campaign_authorities;
 prior public.synthetic_ai_campaign_effect_debits;spent bigint;request_host text;
BEGIN
 binding:=public.synthetic_ai_campaign_effect_binding_v2(p_actor,p_org,p_workspace,p_authorization_version,p_receipt,p_effect,
  p_execution_token,p_execution_fence,p_route,p_provider_config,p_key_ref,p_provider,p_endpoint,p_model,p_operation,
  p_effect_request_hash,p_maximum_output_tokens);
 kind:=binding->>'authorityKind';command_hash:=binding->>'commandRequestHash';
 IF p_target_fingerprint IS NULL AND p_project_ref IS NULL THEN
  IF EXISTS(SELECT 1 FROM public.synthetic_admin_targets target WHERE target.org_id=p_org AND target.workspace_id=p_workspace
    AND target.enabled AND NOT target.real_provider_calls_authorized)
   OR EXISTS(SELECT 1 FROM public.synthetic_ai_campaign_authorities authority WHERE authority.org_id=p_org
    AND authority.workspace_id=p_workspace AND authority.provider_config_id=p_provider_config)
  THEN RAISE EXCEPTION 'SYNTHETIC_AI_CAMPAIGN_BINDING_REQUIRED';END IF;
  RETURN jsonb_build_object('mode','ordinary','ownsProviderEffect',true,'replayed',false);
 END IF;
 request_host:=public.synthetic_ai_campaign_request_host();
 SELECT * INTO campaign FROM public.synthetic_ai_campaign_authorities authority
  WHERE authority.target_fingerprint=p_target_fingerprint AND authority.project_ref=p_project_ref
    AND authority.server_host=request_host AND authority.org_id=p_org AND authority.workspace_id=p_workspace
    AND authority.provider_config_id=p_provider_config AND authority.key_ref_id=p_key_ref
    AND authority.provider=p_provider AND authority.endpoint=p_endpoint AND authority.model=p_model AND authority.enabled FOR UPDATE;
 IF campaign.id IS NULL OR campaign.expires_at<=statement_timestamp() OR NOT p_operation=ANY(campaign.allowed_operations)
  OR(p_operation='assess.evidence.extract' AND p_route IS DISTINCT FROM campaign.assess_route_id)
  OR(p_operation='studio.document.generate' AND p_route IS DISTINCT FROM campaign.studio_route_id)
  OR(p_operation='provider.validate' AND p_actor IS DISTINCT FROM campaign.operator_actor_id)
  OR p_maximum_output_tokens>campaign.max_output_tokens
 THEN RAISE EXCEPTION 'SYNTHETIC_AI_CAMPAIGN_NOT_AUTHORIZED';END IF;
 PERFORM public.pr1b_assert_command_authority(p_actor,p_org,p_workspace,
  CASE p_operation WHEN 'assess.evidence.extract' THEN 'assess.v2.draft.write'
   WHEN 'studio.document.generate' THEN 'studio.artifacts.generate' ELSE 'org.admin' END,p_authorization_version);
 SELECT * INTO prior FROM public.synthetic_ai_campaign_effect_debits debit
  WHERE debit.campaign_id=campaign.id AND(debit.effect_id=p_effect
    OR(kind IN('enterprise','assess_mapping') AND debit.receipt_id=p_receipt)
    OR(kind='studio' AND(debit.studio_receipt_id=p_receipt OR debit.studio_attempt_id=p_effect))) FOR UPDATE;
 IF prior.id IS NOT NULL THEN
  IF prior.authority_kind IS DISTINCT FROM kind
   OR(kind IN('enterprise','assess_mapping') AND prior.receipt_id IS DISTINCT FROM p_receipt)
   OR(kind='assess_mapping' AND prior.assess_mapping_run_id IS DISTINCT FROM p_effect)
   OR(kind='studio' AND(prior.receipt_id IS NOT NULL OR prior.studio_receipt_id IS DISTINCT FROM p_receipt
      OR prior.studio_attempt_id IS DISTINCT FROM p_effect))
   OR prior.effect_id IS DISTINCT FROM p_effect OR prior.actor_id IS DISTINCT FROM p_actor
   OR prior.org_id IS DISTINCT FROM p_org OR prior.workspace_id IS DISTINCT FROM p_workspace
   OR prior.authorization_version IS DISTINCT FROM p_authorization_version
   OR prior.execution_token IS DISTINCT FROM p_execution_token OR prior.execution_fence IS DISTINCT FROM p_execution_fence
   OR prior.command_request_hash IS DISTINCT FROM command_hash OR prior.effect_request_hash IS DISTINCT FROM p_effect_request_hash
   OR prior.maximum_output_tokens IS DISTINCT FROM p_maximum_output_tokens OR prior.operation IS DISTINCT FROM p_operation
   OR prior.route_id IS DISTINCT FROM p_route OR prior.provider_config_id IS DISTINCT FROM p_provider_config
   OR prior.key_ref_id IS DISTINCT FROM p_key_ref OR prior.provider IS DISTINCT FROM p_provider
   OR prior.endpoint IS DISTINCT FROM p_endpoint OR prior.model IS DISTINCT FROM p_model
  THEN RAISE EXCEPTION 'SYNTHETIC_AI_CAMPAIGN_REPLAY_SUBSTITUTION';END IF;
  RETURN jsonb_build_object('mode','campaign','reservationId',prior.id,'ownsProviderEffect',false,'replayed',true,
    'consumed',prior.consumed_at IS NOT NULL);
 END IF;
 SELECT COALESCE(sum(debit_usd_nanos),0) INTO spent FROM public.synthetic_ai_campaign_effect_debits WHERE campaign_id=campaign.id;
 IF campaign.carried_usd_nanos+spent+campaign.fixed_debit_usd_nanos>campaign.campaign_cap_usd_nanos
 THEN RAISE EXCEPTION 'SYNTHETIC_AI_CAMPAIGN_BUDGET_EXHAUSTED';END IF;
 INSERT INTO public.synthetic_ai_campaign_effect_debits(
  campaign_id,receipt_id,effect_id,authority_kind,assess_mapping_run_id,studio_receipt_id,studio_attempt_id,
  actor_id,org_id,workspace_id,authorization_version,execution_token,execution_fence,command_request_hash,
  effect_request_hash,maximum_output_tokens,operation,route_id,provider_config_id,key_ref_id,provider,endpoint,model,debit_usd_nanos)
 VALUES(campaign.id,CASE WHEN kind IN('enterprise','assess_mapping') THEN p_receipt END,p_effect,kind,
  CASE WHEN kind='assess_mapping' THEN p_effect END,CASE WHEN kind='studio' THEN p_receipt END,
  CASE WHEN kind='studio' THEN p_effect END,p_actor,p_org,p_workspace,p_authorization_version,p_execution_token,
  p_execution_fence,command_hash,p_effect_request_hash,p_maximum_output_tokens,p_operation,p_route,p_provider_config,
  p_key_ref,p_provider,p_endpoint,p_model,campaign.fixed_debit_usd_nanos) RETURNING * INTO prior;
 RETURN jsonb_build_object('mode','campaign','reservationId',prior.id,'ownsProviderEffect',true,'replayed',false,
  'consumed',false,'debitUsdNanos',campaign.fixed_debit_usd_nanos,
  'remainingUsdNanos',campaign.campaign_cap_usd_nanos-campaign.carried_usd_nanos-spent-campaign.fixed_debit_usd_nanos);
END
$$;

CREATE OR REPLACE FUNCTION public.synthetic_ai_campaign_consume_effect(
 p_reservation uuid,p_actor uuid,p_org uuid,p_workspace uuid,p_authorization_version bigint,
 p_target_fingerprint text,p_project_ref text,p_receipt uuid,p_effect uuid,p_execution_token uuid,p_execution_fence bigint,
 p_route uuid,p_provider_config uuid,p_key_ref uuid,p_provider text,p_endpoint text,p_model text,p_operation text,
 p_effect_request_hash text,p_maximum_output_tokens integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE binding jsonb;kind text;command_hash text;campaign public.synthetic_ai_campaign_authorities;
 debit public.synthetic_ai_campaign_effect_debits;request_host text;
BEGIN
 binding:=public.synthetic_ai_campaign_effect_binding_v2(p_actor,p_org,p_workspace,p_authorization_version,p_receipt,p_effect,
  p_execution_token,p_execution_fence,p_route,p_provider_config,p_key_ref,p_provider,p_endpoint,p_model,p_operation,
  p_effect_request_hash,p_maximum_output_tokens);
 kind:=binding->>'authorityKind';command_hash:=binding->>'commandRequestHash';
 IF p_target_fingerprint IS NULL AND p_project_ref IS NULL AND p_reservation IS NULL THEN
  IF EXISTS(SELECT 1 FROM public.synthetic_admin_targets target WHERE target.org_id=p_org AND target.workspace_id=p_workspace
    AND target.enabled AND NOT target.real_provider_calls_authorized)
   OR EXISTS(SELECT 1 FROM public.synthetic_ai_campaign_authorities authority WHERE authority.org_id=p_org
    AND authority.workspace_id=p_workspace AND authority.provider_config_id=p_provider_config)
  THEN RAISE EXCEPTION 'SYNTHETIC_AI_CAMPAIGN_BINDING_REQUIRED';END IF;
  RETURN jsonb_build_object('mode','ordinary','consumed',true);
 END IF;
 request_host:=public.synthetic_ai_campaign_request_host();
 SELECT * INTO campaign FROM public.synthetic_ai_campaign_authorities authority
  WHERE authority.target_fingerprint=p_target_fingerprint AND authority.project_ref=p_project_ref
    AND authority.server_host=request_host AND authority.org_id=p_org AND authority.workspace_id=p_workspace
    AND authority.provider_config_id=p_provider_config AND authority.key_ref_id=p_key_ref AND authority.enabled FOR UPDATE;
 SELECT * INTO debit FROM public.synthetic_ai_campaign_effect_debits stored
  WHERE stored.id=p_reservation AND stored.campaign_id=campaign.id FOR UPDATE;
 IF campaign.id IS NULL OR campaign.expires_at<=statement_timestamp() OR debit.id IS NULL OR debit.consumed_at IS NOT NULL
  OR debit.authority_kind IS DISTINCT FROM kind
  OR(kind IN('enterprise','assess_mapping') AND debit.receipt_id IS DISTINCT FROM p_receipt)
  OR(kind='assess_mapping' AND debit.assess_mapping_run_id IS DISTINCT FROM p_effect)
  OR(kind='studio' AND(debit.receipt_id IS NOT NULL OR debit.studio_receipt_id IS DISTINCT FROM p_receipt
     OR debit.studio_attempt_id IS DISTINCT FROM p_effect))
  OR debit.effect_id IS DISTINCT FROM p_effect OR debit.actor_id IS DISTINCT FROM p_actor
  OR debit.org_id IS DISTINCT FROM p_org OR debit.workspace_id IS DISTINCT FROM p_workspace
  OR debit.authorization_version IS DISTINCT FROM p_authorization_version
  OR debit.execution_token IS DISTINCT FROM p_execution_token OR debit.execution_fence IS DISTINCT FROM p_execution_fence
  OR debit.command_request_hash IS DISTINCT FROM command_hash OR debit.effect_request_hash IS DISTINCT FROM p_effect_request_hash
  OR debit.maximum_output_tokens IS DISTINCT FROM p_maximum_output_tokens OR debit.operation IS DISTINCT FROM p_operation
  OR debit.route_id IS DISTINCT FROM p_route OR debit.provider_config_id IS DISTINCT FROM p_provider_config
  OR debit.key_ref_id IS DISTINCT FROM p_key_ref OR debit.provider IS DISTINCT FROM p_provider
  OR debit.endpoint IS DISTINCT FROM p_endpoint OR debit.model IS DISTINCT FROM p_model
 THEN RAISE EXCEPTION 'SYNTHETIC_AI_CAMPAIGN_PERMIT_INVALID_OR_REPLAYED';END IF;
 UPDATE public.synthetic_ai_campaign_effect_debits SET consumed_at=statement_timestamp() WHERE id=debit.id;
 RETURN jsonb_build_object('mode','campaign','reservationId',debit.id,'consumed',true);
END
$$;

CREATE FUNCTION public.enterprise_assess_mapping_budget_identity_v1(
  p_row public.enterprise_ai_budget_reservations,
  p_actor uuid,p_org uuid,p_workspace uuid,p_receipt uuid,p_run uuid,
  p_execution_token uuid,p_execution_fence bigint,
  p_route uuid,p_provider_config uuid,p_provider text,p_capability text,p_model text
) RETURNS public.enterprise_assess_document_mapping_runs
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE mapping_run public.enterprise_assess_document_mapping_runs;
BEGIN
  SELECT * INTO mapping_run FROM public.enterprise_assess_document_mapping_runs
    WHERE id=p_run AND receipt_id=p_receipt AND created_by=p_actor
      AND org_id=p_org AND workspace_id=p_workspace FOR SHARE;
  IF p_row.id IS NULL OR p_row.authority_kind<>'assess_mapping'
    OR p_row.receipt_id IS DISTINCT FROM p_receipt OR p_row.job_id IS NOT NULL
    OR p_row.assess_mapping_run_id IS DISTINCT FROM p_run
    OR p_row.actor_id IS DISTINCT FROM p_actor OR p_row.org_id IS DISTINCT FROM p_org
    OR p_row.workspace_id IS DISTINCT FROM p_workspace OR p_row.authorization_version IS DISTINCT FROM mapping_run.authorization_version
    OR p_row.route_id IS DISTINCT FROM p_route OR p_row.provider_config_id IS DISTINCT FROM p_provider_config
    OR p_row.provider IS DISTINCT FROM p_provider OR p_row.capability IS DISTINCT FROM p_capability
    OR p_row.model IS DISTINCT FROM p_model OR p_row.execution_token IS DISTINCT FROM p_execution_token
    OR p_row.execution_fence IS DISTINCT FROM p_execution_fence
    OR mapping_run.id IS NULL OR mapping_run.execution_token IS DISTINCT FROM p_execution_token
    OR mapping_run.execution_fence IS DISTINCT FROM p_execution_fence
  THEN RAISE EXCEPTION 'ENTERPRISE_AI_PROVIDER_ROUTE_STALE'; END IF;
  RETURN mapping_run;
END
$$;

CREATE FUNCTION public.enterprise_assess_mapping_reserve_provider_budget_v1(
  p_actor uuid,p_org uuid,p_workspace uuid,p_authorization_version bigint,
  p_receipt uuid,p_run uuid,p_execution_token uuid,p_execution_fence bigint,
  p_route uuid,p_provider_config uuid,p_provider text,p_capability text,p_model text,
  p_estimated_input_tokens integer,p_maximum_output_tokens integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE receipt public.enterprise_ai_command_receipts;mapping_run public.enterprise_assess_document_mapping_runs;
  route public.enterprise_ai_capability_routes;config public.ai_provider_configs;
  reservation public.enterprise_ai_budget_reservations;daily_limit bigint;monthly_limit bigint;daily_used bigint;monthly_used bigint;
  day_value date:=(statement_timestamp() AT TIME ZONE 'UTC')::date;
  month_value date:=date_trunc('month',statement_timestamp() AT TIME ZONE 'UTC')::date;
BEGIN
  IF p_capability<>'assess.evidence.extract' OR p_execution_fence<1
    OR p_provider NOT IN('openai','azure_openai','anthropic','gemini','groq','openai_compatible')
    OR length(btrim(COALESCE(p_model,''))) NOT BETWEEN 1 AND 200
    OR p_estimated_input_tokens<1 OR p_maximum_output_tokens<1
  THEN RAISE EXCEPTION 'ENTERPRISE_AI_PROVIDER_ROUTE_STALE'; END IF;
  receipt:=public.enterprise_assess_document_mapping_assert(p_receipt,p_actor,p_org,p_workspace,
    'assess.document-map.analyze',p_authorization_version,p_execution_token,p_execution_fence,'analyze');
  PERFORM pg_advisory_xact_lock(hashtextextended(concat_ws(':','enterprise-ai-budget',p_org,p_workspace,p_provider,p_capability),0));
  SELECT * INTO mapping_run FROM public.enterprise_assess_document_mapping_runs
    WHERE id=p_run AND receipt_id=p_receipt AND created_by=p_actor AND org_id=p_org AND workspace_id=p_workspace FOR UPDATE;
  IF mapping_run.id IS NULL OR mapping_run.status<>'claimed'
    OR mapping_run.authorization_version IS DISTINCT FROM p_authorization_version
    OR mapping_run.execution_token IS DISTINCT FROM p_execution_token OR mapping_run.execution_fence IS DISTINCT FROM p_execution_fence
    OR mapping_run.route_id IS DISTINCT FROM p_route OR mapping_run.provider_config_id IS DISTINCT FROM p_provider_config
    OR mapping_run.provider IS DISTINCT FROM p_provider OR mapping_run.model IS DISTINCT FROM p_model
  THEN RAISE EXCEPTION 'ENTERPRISE_AI_PROVIDER_ROUTE_STALE'; END IF;
  PERFORM public.enterprise_assess_document_mapping_assert_run_fresh(mapping_run.id);
  SELECT * INTO route FROM public.enterprise_ai_capability_routes
    WHERE id=p_route AND org_id=p_org AND workspace_id=p_workspace FOR SHARE;
  SELECT * INTO config FROM public.ai_provider_configs WHERE id=p_provider_config AND org_id=p_org FOR SHARE;
  IF route.id IS NULL OR NOT route.enabled OR route.deleted_at IS NOT NULL
    OR route.provider_config_id IS DISTINCT FROM p_provider_config OR route.capability IS DISTINCT FROM p_capability
    OR route.model IS DISTINCT FROM p_model OR cardinality(route.allowed_roles)=0
    OR config.id IS NULL OR config.status<>'active' OR config.deleted_at IS NOT NULL
    OR config.provider IS DISTINCT FROM p_provider OR NOT(p_model=ANY(config.model_allowlist))
    OR config.last_validated_at IS NULL OR config.last_validated_at>statement_timestamp()
    OR config.last_validated_at<statement_timestamp()-interval '24 hours'
    OR config.key_ref_id IS NULL OR NOT EXISTS(
      SELECT 1 FROM public.ai_provider_key_refs key_ref
      WHERE key_ref.id=config.key_ref_id AND key_ref.org_id=p_org AND key_ref.provider=p_provider
        AND key_ref.resolver_type='server_reference' AND key_ref.status='active' AND key_ref.deleted_at IS NULL
        AND(key_ref.expires_at IS NULL OR key_ref.expires_at>statement_timestamp()))
    OR NOT EXISTS(
      SELECT 1 FROM public.organization_members member JOIN public.roles role ON role.id=member.role_id AND role.org_id=p_org
      WHERE member.user_id=p_actor AND member.org_id=p_org AND member.status='active' AND member.deleted_at IS NULL
        AND role.status='active' AND role.deleted_at IS NULL AND EXISTS(
          SELECT 1 FROM unnest(route.allowed_roles) allowed(value)
          WHERE lower(allowed.value)=lower(role.name) OR lower(allowed.value)=lower(role.id::text))
      UNION ALL
      SELECT 1 FROM public.workspace_memberships member JOIN public.roles role
        ON role.id=member.role_id AND role.org_id=p_org AND role.workspace_id=p_workspace
      WHERE member.user_id=p_actor AND member.org_id=p_org AND member.workspace_id=p_workspace
        AND member.status='active' AND member.deleted_at IS NULL AND role.status='active' AND role.deleted_at IS NULL
        AND EXISTS(SELECT 1 FROM unnest(route.allowed_roles) allowed(value)
          WHERE lower(allowed.value)=lower(role.name) OR lower(allowed.value)=lower(role.id::text)))
    OR EXISTS(SELECT 1 FROM public.enterprise_ai_effect_journal effect
      WHERE effect.receipt_id=p_receipt AND effect.effect_key='command')
  THEN RAISE EXCEPTION 'ENTERPRISE_AI_PROVIDER_ROUTE_STALE'; END IF;

  SELECT * INTO reservation FROM public.enterprise_ai_budget_reservations
    WHERE assess_mapping_run_id=p_run FOR UPDATE;
  IF reservation.id IS NOT NULL THEN
    PERFORM public.enterprise_assess_mapping_budget_identity_v1(reservation,p_actor,p_org,p_workspace,p_receipt,p_run,
      p_execution_token,p_execution_fence,p_route,p_provider_config,p_provider,p_capability,p_model);
    IF reservation.estimated_input_tokens IS DISTINCT FROM p_estimated_input_tokens
      OR reservation.maximum_output_tokens IS DISTINCT FROM p_maximum_output_tokens
    THEN RAISE EXCEPTION 'ENTERPRISE_AI_PROVIDER_ROUTE_STALE'; END IF;
    IF reservation.state='reserved' AND reservation.assess_mapping_transfer_pending THEN
      UPDATE public.enterprise_ai_budget_reservations SET assess_mapping_transfer_pending=false,updated_at=statement_timestamp()
        WHERE id=reservation.id RETURNING * INTO reservation;
      RETURN public.enterprise_ai_budget_result(reservation,true,false);
    END IF;
    RETURN public.enterprise_ai_budget_result(reservation,false,true);
  END IF;
  daily_limit:=CASE WHEN(config.budget_policy->>'dailyRequests')~'^[1-9][0-9]*$' THEN(config.budget_policy->>'dailyRequests')::bigint END;
  monthly_limit:=CASE WHEN(config.budget_policy->>'monthlyTokens')~'^[1-9][0-9]*$' THEN(config.budget_policy->>'monthlyTokens')::bigint END;
  SELECT count(*) FILTER(WHERE day_bucket=day_value),
    COALESCE(sum(CASE WHEN state='settled' THEN actual_total_tokens ELSE reserved_tokens END)
      FILTER(WHERE month_bucket=month_value),0)
  INTO daily_used,monthly_used FROM public.enterprise_ai_budget_reservations
  WHERE org_id=p_org AND workspace_id=p_workspace AND provider=p_provider AND capability=p_capability
    AND state IN('reserved','settled','uncertain');
  IF(daily_limit IS NOT NULL AND daily_used+1>daily_limit)
    OR(monthly_limit IS NOT NULL AND monthly_used+p_estimated_input_tokens+p_maximum_output_tokens>monthly_limit)
  THEN RETURN jsonb_build_object('errorCode','BUDGET_EXHAUSTED'); END IF;
  INSERT INTO public.enterprise_ai_budget_reservations(
    receipt_id,job_id,authority_kind,assess_mapping_run_id,org_id,workspace_id,actor_id,authorization_version,
    route_id,provider_config_id,provider,capability,model,state,estimated_input_tokens,maximum_output_tokens,
    execution_token,execution_fence,day_bucket,month_bucket)
  VALUES(p_receipt,NULL,'assess_mapping',p_run,p_org,p_workspace,p_actor,p_authorization_version,p_route,p_provider_config,
    p_provider,p_capability,p_model,'reserved',p_estimated_input_tokens,p_maximum_output_tokens,p_execution_token,p_execution_fence,
    day_value,month_value) RETURNING * INTO reservation;
  RETURN public.enterprise_ai_budget_result(reservation,true,false);
EXCEPTION WHEN SQLSTATE 'P0001' THEN
  IF SQLERRM LIKE '%PR1B_AUTHORIZATION_STALE%' THEN RETURN jsonb_build_object('errorCode','AUTHORIZATION_STALE'); END IF;
  IF SQLERRM LIKE '%PR1B_NOT_FOUND%' THEN RETURN jsonb_build_object('errorCode','PERMISSION_DENIED'); END IF;
  IF SQLERRM LIKE '%ENTERPRISE_AI_PROVIDER_ROUTE_STALE%' OR SQLERRM LIKE '%ENTERPRISE_ASSESS_DOCUMENT_MAPPING_%'
    OR SQLERRM LIKE '%ENTERPRISE_AI_RUNTIME_%' THEN RETURN jsonb_build_object('errorCode','PROVIDER_ROUTE_STALE'); END IF;
  RAISE;
END
$$;

CREATE FUNCTION public.enterprise_assess_mapping_provider_budget_transition_v1(
  p_operation text,p_actor uuid,p_org uuid,p_workspace uuid,p_authorization_version bigint,
  p_receipt uuid,p_run uuid,p_execution_token uuid,p_execution_fence bigint,p_route uuid,p_provider_config uuid,
  p_provider text,p_capability text,p_model text,p_reservation uuid,
  p_input_tokens integer,p_output_tokens integer,p_total_tokens integer,p_reason text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE reservation public.enterprise_ai_budget_reservations;mapping_run public.enterprise_assess_document_mapping_runs;
BEGIN
  -- Global mapping order is run -> reservation -> optional currency debit.
  SELECT * INTO mapping_run FROM public.enterprise_assess_document_mapping_runs WHERE id=p_run FOR UPDATE;
  SELECT * INTO reservation FROM public.enterprise_ai_budget_reservations WHERE id=p_reservation FOR UPDATE;
  mapping_run:=public.enterprise_assess_mapping_budget_identity_v1(reservation,p_actor,p_org,p_workspace,p_receipt,p_run,
    p_execution_token,p_execution_fence,p_route,p_provider_config,p_provider,p_capability,p_model);
  IF p_authorization_version<1 OR mapping_run.authorization_version IS DISTINCT FROM p_authorization_version
    OR p_capability<>'assess.evidence.extract' THEN RAISE EXCEPTION 'ENTERPRISE_AI_PROVIDER_ROUTE_STALE'; END IF;
  IF p_operation='settle' THEN
    IF reservation.state='settled' THEN RETURN public.enterprise_ai_budget_result(reservation,false,true); END IF;
    IF reservation.state NOT IN('reserved','uncertain') OR mapping_run.status<>'staged'
      OR p_input_tokens<0 OR p_output_tokens<0 OR p_total_tokens<1 OR p_total_tokens<>p_input_tokens+p_output_tokens
    THEN RAISE EXCEPTION 'ENTERPRISE_AI_PROVIDER_ROUTE_STALE'; END IF;
    UPDATE public.enterprise_ai_budget_reservations SET state='settled',actual_input_tokens=p_input_tokens,
      actual_output_tokens=p_output_tokens,actual_total_tokens=p_total_tokens,assess_mapping_transfer_pending=false,
      updated_at=statement_timestamp(),settled_at=statement_timestamp()
      WHERE id=reservation.id RETURNING * INTO reservation;
  ELSIF p_operation='uncertain' THEN
    IF reservation.state IN('settled','uncertain') THEN RETURN public.enterprise_ai_budget_result(reservation,false,true); END IF;
    IF reservation.state<>'reserved' OR mapping_run.status NOT IN('claimed','staged') OR p_reason!~'^[a-z0-9_]{1,80}$'
    THEN RAISE EXCEPTION 'ENTERPRISE_AI_PROVIDER_ROUTE_STALE'; END IF;
    UPDATE public.enterprise_ai_budget_reservations SET state='uncertain',failure_class=p_reason,
      assess_mapping_transfer_pending=false,updated_at=statement_timestamp()
      WHERE id=reservation.id RETURNING * INTO reservation;
  ELSIF p_operation='release' THEN
    IF reservation.state='released' THEN RETURN public.enterprise_ai_budget_result(reservation,false,true); END IF;
    IF reservation.state<>'reserved' OR mapping_run.status<>'claimed' OR p_reason<>'before_provider_effect'
      OR mapping_run.safe_result IS NOT NULL OR mapping_run.output_hash IS NOT NULL OR mapping_run.staged_payload_hash IS NOT NULL
      OR EXISTS(SELECT 1 FROM public.enterprise_assess_document_mapping_proposals proposal WHERE proposal.run_id=mapping_run.id)
      OR EXISTS(SELECT 1 FROM public.synthetic_ai_campaign_effect_debits debit
        WHERE debit.effect_id=mapping_run.id AND debit.consumed_at IS NOT NULL)
    THEN RAISE EXCEPTION 'ENTERPRISE_AI_PROVIDER_ROUTE_STALE'; END IF;
    UPDATE public.enterprise_ai_budget_reservations SET state='released',release_reason='before_provider_effect',
      assess_mapping_transfer_pending=false,updated_at=statement_timestamp(),settled_at=statement_timestamp()
      WHERE id=reservation.id RETURNING * INTO reservation;
  ELSE RAISE EXCEPTION 'ENTERPRISE_AI_PROVIDER_ROUTE_STALE'; END IF;
  RETURN public.enterprise_ai_budget_result(reservation,false,false);
EXCEPTION WHEN SQLSTATE 'P0001' THEN RETURN jsonb_build_object('errorCode','PROVIDER_ROUTE_STALE');
END
$$;

CREATE FUNCTION public.enterprise_assess_mapping_settle_provider_budget_v1(
  p_actor uuid,p_org uuid,p_workspace uuid,p_authorization_version bigint,p_receipt uuid,p_run uuid,
  p_execution_token uuid,p_execution_fence bigint,p_route uuid,p_provider_config uuid,p_provider text,p_capability text,p_model text,
  p_reservation uuid,p_input_tokens integer,p_output_tokens integer,p_total_tokens integer
) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT public.enterprise_assess_mapping_provider_budget_transition_v1('settle',p_actor,p_org,p_workspace,
    p_authorization_version,p_receipt,p_run,p_execution_token,p_execution_fence,p_route,p_provider_config,p_provider,p_capability,
    p_model,p_reservation,p_input_tokens,p_output_tokens,p_total_tokens,NULL)
$$;
CREATE FUNCTION public.enterprise_assess_mapping_mark_provider_budget_uncertain_v1(
  p_actor uuid,p_org uuid,p_workspace uuid,p_authorization_version bigint,p_receipt uuid,p_run uuid,
  p_execution_token uuid,p_execution_fence bigint,p_route uuid,p_provider_config uuid,p_provider text,p_capability text,p_model text,
  p_reservation uuid,p_failure_class text
) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT public.enterprise_assess_mapping_provider_budget_transition_v1('uncertain',p_actor,p_org,p_workspace,
    p_authorization_version,p_receipt,p_run,p_execution_token,p_execution_fence,p_route,p_provider_config,p_provider,p_capability,
    p_model,p_reservation,NULL,NULL,NULL,p_failure_class)
$$;
CREATE FUNCTION public.enterprise_assess_mapping_release_provider_budget_v1(
  p_actor uuid,p_org uuid,p_workspace uuid,p_authorization_version bigint,p_receipt uuid,p_run uuid,
  p_execution_token uuid,p_execution_fence bigint,p_route uuid,p_provider_config uuid,p_provider text,p_capability text,p_model text,
  p_reservation uuid,p_release_reason text
) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT public.enterprise_assess_mapping_provider_budget_transition_v1('release',p_actor,p_org,p_workspace,
    p_authorization_version,p_receipt,p_run,p_execution_token,p_execution_fence,p_route,p_provider_config,p_provider,p_capability,
    p_model,p_reservation,NULL,NULL,NULL,p_release_reason)
$$;

-- Wrap the accepted mapping claim implementation so a newer fence cannot
-- outrun durable budget/currency state. The predecessor remains private and
-- continues to perform the full claim-binding validation and initial insert.
ALTER FUNCTION public.enterprise_claim_assess_document_mapping_run_v1(
  uuid,uuid,uuid,bigint,text,text,jsonb,uuid,uuid,bigint,jsonb,uuid,uuid,text,text,text,
  uuid,uuid,uuid,bigint,uuid,uuid,bigint
) RENAME TO enterprise_claim_assess_document_mapping_run_pre_budget_v1;

CREATE FUNCTION public.enterprise_assess_mapping_claim_snapshot_v1(p_run uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE mapping_run public.enterprise_assess_document_mapping_runs;catalog public.enterprise_assess_document_mapping_catalogs;
  targets jsonb;bindings jsonb;recovery text:='none';owns boolean:=false;
BEGIN
  SELECT * INTO mapping_run FROM public.enterprise_assess_document_mapping_runs WHERE id=p_run FOR SHARE;
  SELECT * INTO catalog FROM public.enterprise_assess_document_mapping_catalogs WHERE id=mapping_run.catalog_id FOR SHARE;
  IF mapping_run.id IS NULL OR catalog.id IS NULL THEN RAISE EXCEPTION 'ENTERPRISE_AI_PROVIDER_ROUTE_STALE'; END IF;
  SELECT COALESCE(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'selectorId',target.selector_id,'catalogId',target.catalog_id,'caseId',catalog.assess_case_id,
    'caseVersion',catalog.case_version,'assessSchemaVersion',catalog.assess_schema_version,
    'targetKind',target.target_kind,'operation',target.operation,'entityId',target.entity_id,
    'fieldId',target.field_id,'label',target.label,'contextLabel',target.context_label,
    'valueType',target.value_type,'allowedValues',target.allowed_values,'currentValue',target.current_value,
    'currentValueHash',target.current_value_hash,'manual',target.manual)) ORDER BY target.ordinal),'[]'::jsonb)
    INTO targets FROM public.enterprise_assess_document_mapping_targets target WHERE target.catalog_id=catalog.id;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'sourceSetId',source.source_set_id,'sourceSetVersionId',source.source_set_version_id,
    'expectedSourceSetVersion',source.expected_source_set_version,'sourceId',source.source_id,
    'sourceVersionId',source.source_version_id,'extractionBindingId',source.extraction_binding_id,
    'extractionJobId',source.extraction_job_id,'parserVersion',source.parser_version,
    'normalizedHash',source.normalized_hash,'extractedByteCount',source.extracted_byte_count,
    'sheetCount',source.sheet_count,'cellCount',source.cell_count,'warnings',source.warnings) ORDER BY source.ordinal),'[]'::jsonb)
    INTO bindings FROM public.enterprise_assess_document_mapping_run_sources source WHERE source.run_id=mapping_run.id;
  IF mapping_run.status='staged' THEN recovery:='finalize_staged'; END IF;
  RETURN jsonb_strip_nulls(jsonb_build_object('state',mapping_run.status,'ownsExecution',owns,'recoveryMode',recovery,
    'runId',mapping_run.id,'catalogId',mapping_run.catalog_id,'catalogHash',catalog.catalog_hash,
    'targets',targets,'sourceBindings',bindings,'safeResult',mapping_run.safe_result));
END
$$;

CREATE FUNCTION public.enterprise_claim_assess_document_mapping_run_v1(
 p_run uuid,p_catalog uuid,p_case uuid,p_expected_case_version bigint,p_assess_schema_version text,p_catalog_hash text,p_targets jsonb,
 p_input_bundle uuid,p_input_bundle_version uuid,p_expected_input_bundle_version bigint,p_source_bindings jsonb,
 p_route_id uuid,p_provider_config_id uuid,p_provider text,p_model text,p_prompt_version text,
 p_actor uuid,p_org uuid,p_workspace uuid,p_authorization_version bigint,p_receipt uuid,p_execution_token uuid,p_execution_fence bigint
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE mapping_run public.enterprise_assess_document_mapping_runs;reservation public.enterprise_ai_budget_reservations;
  result jsonb;transferable boolean:=false;pending_transfer boolean:=false;
  pending_same_fence boolean:=false;pending_higher_fence boolean:=false;blocked_by_budget boolean:=false;
BEGIN
  SELECT * INTO mapping_run FROM public.enterprise_assess_document_mapping_runs
    WHERE receipt_id=p_receipt AND org_id=p_org AND workspace_id=p_workspace FOR UPDATE;
  IF mapping_run.id IS NULL THEN
    RETURN public.enterprise_claim_assess_document_mapping_run_pre_budget_v1(p_run,p_catalog,p_case,p_expected_case_version,
      p_assess_schema_version,p_catalog_hash,p_targets,p_input_bundle,p_input_bundle_version,p_expected_input_bundle_version,
      p_source_bindings,p_route_id,p_provider_config_id,p_provider,p_model,p_prompt_version,p_actor,p_org,p_workspace,
      p_authorization_version,p_receipt,p_execution_token,p_execution_fence);
  END IF;
  SELECT * INTO reservation FROM public.enterprise_ai_budget_reservations
    WHERE assess_mapping_run_id=mapping_run.id FOR UPDATE;
  IF mapping_run.status='claimed' AND reservation.id IS NOT NULL THEN
    -- A transferred reservation stays pending until the reserve RPC atomically
    -- grants its sole provider-effect ownership. Claim-response loss may replay
    -- that pending hand-off on the same fence, or rebind the still-unconsumed
    -- hand-off to a higher validated fence. It never creates another transfer.
    pending_transfer:=reservation.authority_kind='assess_mapping'
      AND reservation.state='reserved' AND reservation.release_reason IS NULL
      AND reservation.failure_class IS NULL AND reservation.settled_at IS NULL
      AND reservation.assess_mapping_transfer_count=1
      AND reservation.assess_mapping_last_transfer_at IS NOT NULL
      AND reservation.assess_mapping_transfer_pending
      AND reservation.receipt_id IS NOT DISTINCT FROM mapping_run.receipt_id
      AND reservation.assess_mapping_run_id IS NOT DISTINCT FROM mapping_run.id
      AND reservation.actor_id IS NOT DISTINCT FROM mapping_run.created_by
      AND reservation.org_id IS NOT DISTINCT FROM mapping_run.org_id
      AND reservation.workspace_id IS NOT DISTINCT FROM mapping_run.workspace_id
      AND reservation.authorization_version IS NOT DISTINCT FROM mapping_run.authorization_version
      AND reservation.authorization_version IS NOT DISTINCT FROM p_authorization_version
      AND reservation.route_id IS NOT DISTINCT FROM mapping_run.route_id
      AND reservation.provider_config_id IS NOT DISTINCT FROM mapping_run.provider_config_id
      AND reservation.provider IS NOT DISTINCT FROM mapping_run.provider
      AND reservation.capability='assess.evidence.extract'
      AND reservation.model IS NOT DISTINCT FROM mapping_run.model
      AND reservation.execution_token IS NOT DISTINCT FROM mapping_run.execution_token
      AND reservation.execution_fence IS NOT DISTINCT FROM mapping_run.execution_fence
      AND NOT EXISTS(SELECT 1 FROM public.synthetic_ai_campaign_effect_debits debit
        WHERE debit.effect_id=mapping_run.id OR debit.assess_mapping_run_id=mapping_run.id);
    pending_same_fence:=pending_transfer
      AND p_execution_token IS NOT DISTINCT FROM mapping_run.execution_token
      AND p_execution_fence IS NOT DISTINCT FROM mapping_run.execution_fence;
    pending_higher_fence:=pending_transfer AND p_execution_fence>mapping_run.execution_fence;
  END IF;
  IF mapping_run.status='claimed'
    AND(mapping_run.execution_token IS DISTINCT FROM p_execution_token OR mapping_run.execution_fence IS DISTINCT FROM p_execution_fence)
    AND reservation.id IS NOT NULL THEN
    transferable:=reservation.authority_kind='assess_mapping' AND reservation.state='released'
      AND reservation.release_reason='before_provider_effect' AND reservation.assess_mapping_transfer_count=0
      AND NOT reservation.assess_mapping_transfer_pending
      AND reservation.execution_token IS NOT DISTINCT FROM mapping_run.execution_token
      AND reservation.execution_fence IS NOT DISTINCT FROM mapping_run.execution_fence
      AND p_execution_fence>mapping_run.execution_fence
      AND NOT EXISTS(SELECT 1 FROM public.synthetic_ai_campaign_effect_debits debit
        WHERE debit.effect_id=mapping_run.id OR debit.assess_mapping_run_id=mapping_run.id);
    blocked_by_budget:=NOT transferable AND NOT pending_higher_fence;
  END IF;
  IF blocked_by_budget THEN
    -- Execute the predecessor in a subtransaction so every command/catalog/run
    -- binding is still validated. The sentinel rolls its fence write back.
    BEGIN
      PERFORM public.enterprise_claim_assess_document_mapping_run_pre_budget_v1(p_run,p_catalog,p_case,p_expected_case_version,
        p_assess_schema_version,p_catalog_hash,p_targets,p_input_bundle,p_input_bundle_version,p_expected_input_bundle_version,
        p_source_bindings,p_route_id,p_provider_config_id,p_provider,p_model,p_prompt_version,p_actor,p_org,p_workspace,
        p_authorization_version,p_receipt,p_execution_token,p_execution_fence);
      RAISE EXCEPTION USING ERRCODE='ZX001',MESSAGE='ENTERPRISE_ASSESS_DOCUMENT_MAPPING_CLAIM_VALIDATED';
    EXCEPTION WHEN SQLSTATE 'ZX001' THEN NULL;
    END;
    PERFORM public.enterprise_assess_document_mapping_assert_run_fresh(mapping_run.id);
    RETURN public.enterprise_assess_mapping_claim_snapshot_v1(mapping_run.id);
  END IF;
  result:=public.enterprise_claim_assess_document_mapping_run_pre_budget_v1(p_run,p_catalog,p_case,p_expected_case_version,
    p_assess_schema_version,p_catalog_hash,p_targets,p_input_bundle,p_input_bundle_version,p_expected_input_bundle_version,
    p_source_bindings,p_route_id,p_provider_config_id,p_provider,p_model,p_prompt_version,p_actor,p_org,p_workspace,
    p_authorization_version,p_receipt,p_execution_token,p_execution_fence);
  IF pending_same_fence THEN
    IF result->>'state'<>'claimed' OR result->>'ownsExecution'<>'false'
      OR result->>'recoveryMode'<>'none'
    THEN RAISE EXCEPTION 'ENTERPRISE_ASSESS_DOCUMENT_MAPPING_RESERVATION_TRANSFER_CONFLICT'; END IF;
    result:=result||jsonb_build_object('ownsExecution',true,'recoveryMode','execute_provider');
  ELSIF pending_higher_fence THEN
    UPDATE public.enterprise_ai_budget_reservations SET execution_token=p_execution_token,
      execution_fence=p_execution_fence,updated_at=statement_timestamp()
    WHERE id=reservation.id AND authority_kind='assess_mapping' AND state='reserved'
      AND release_reason IS NULL AND failure_class IS NULL AND settled_at IS NULL
      AND assess_mapping_transfer_count=1 AND assess_mapping_last_transfer_at IS NOT NULL
      AND assess_mapping_transfer_pending
      AND execution_token IS NOT DISTINCT FROM mapping_run.execution_token
      AND execution_fence IS NOT DISTINCT FROM mapping_run.execution_fence
      AND NOT EXISTS(SELECT 1 FROM public.synthetic_ai_campaign_effect_debits debit
        WHERE debit.effect_id=mapping_run.id OR debit.assess_mapping_run_id=mapping_run.id)
    RETURNING * INTO reservation;
    IF reservation.id IS NULL OR result->>'state'<>'claimed' OR result->>'ownsExecution'<>'true'
      OR result->>'recoveryMode'<>'execute_provider'
    THEN RAISE EXCEPTION 'ENTERPRISE_ASSESS_DOCUMENT_MAPPING_RESERVATION_TRANSFER_CONFLICT'; END IF;
  END IF;
  IF transferable THEN
    UPDATE public.enterprise_ai_budget_reservations SET state='reserved',execution_token=p_execution_token,
      execution_fence=p_execution_fence,release_reason=NULL,settled_at=NULL,failure_class=NULL,
      assess_mapping_transfer_count=1,assess_mapping_last_transfer_at=statement_timestamp(),
      assess_mapping_transfer_pending=true,updated_at=statement_timestamp()
    WHERE id=reservation.id AND state='released' AND release_reason='before_provider_effect'
      AND assess_mapping_transfer_count=0 AND NOT assess_mapping_transfer_pending
      AND NOT EXISTS(SELECT 1 FROM public.synthetic_ai_campaign_effect_debits debit
        WHERE debit.effect_id=mapping_run.id OR debit.assess_mapping_run_id=mapping_run.id)
    RETURNING * INTO reservation;
    IF reservation.id IS NULL OR result->>'state'<>'claimed' OR result->>'ownsExecution'<>'true'
      OR result->>'recoveryMode'<>'execute_provider'
    THEN RAISE EXCEPTION 'ENTERPRISE_ASSESS_DOCUMENT_MAPPING_RESERVATION_TRANSFER_CONFLICT'; END IF;
  END IF;
  RETURN result;
END
$$;

-- Reservation replay is an exact request replay across every authority kind.
-- The accepted generic and Studio functions predate the mapping authority and
-- did not compare their stored estimate/output ceiling on an existing row.
-- Forward only those guarded replay branches; signatures and grants stay fixed.
DO $budget_reservation_request_forward$
DECLARE generic_function regprocedure:='public.enterprise_ai_reserve_provider_budget(uuid,uuid,uuid,bigint,uuid,uuid,uuid,bigint,uuid,uuid,text,text,text,integer,integer)'::regprocedure;
  studio_function regprocedure:='public.studio_artifact_reserve_provider_budget_v2(uuid,uuid,uuid,bigint,uuid,uuid,uuid,bigint,uuid,uuid,text,text,text,integer,integer)'::regprocedure;
  definition text;
  generic_prior text:='RETURN public.enterprise_ai_budget_result(reservation,false,true);';
  generic_bound text:='IF reservation.estimated_input_tokens IS DISTINCT FROM p_estimated_input_tokens OR reservation.maximum_output_tokens IS DISTINCT FROM p_maximum_output_tokens THEN RAISE EXCEPTION ''ENTERPRISE_AI_PROVIDER_ROUTE_STALE''; END IF; RETURN public.enterprise_ai_budget_result(reservation,false,true);';
  studio_prior text:='OR reservation.model IS DISTINCT FROM p_model';
  studio_bound text:='OR reservation.model IS DISTINCT FROM p_model OR reservation.estimated_input_tokens IS DISTINCT FROM p_estimated_input_tokens OR reservation.maximum_output_tokens IS DISTINCT FROM p_maximum_output_tokens';
BEGIN
  SELECT pg_get_functiondef(generic_function) INTO STRICT definition;
  IF length(definition)-length(replace(definition,generic_prior,''))<>length(generic_prior)
    OR position(generic_bound IN definition)>0
  THEN RAISE EXCEPTION 'ENTERPRISE_AI_BUDGET_RESERVATION_REPLAY_DRIFT';END IF;
  EXECUTE replace(definition,generic_prior,generic_bound);
  SELECT pg_get_functiondef(generic_function) INTO STRICT definition;
  IF length(definition)-length(replace(definition,generic_bound,''))<>length(generic_bound)
    OR length(definition)-length(replace(definition,generic_prior,''))<>length(generic_prior)
  THEN RAISE EXCEPTION 'ENTERPRISE_AI_BUDGET_RESERVATION_REPLAY_FORWARD_FAILED';END IF;

  SELECT pg_get_functiondef(studio_function) INTO STRICT definition;
  IF length(definition)-length(replace(definition,studio_prior,''))<>length(studio_prior)
    OR position(studio_bound IN definition)>0
  THEN RAISE EXCEPTION 'STUDIO_BUDGET_RESERVATION_REPLAY_DRIFT';END IF;
  EXECUTE replace(definition,studio_prior,studio_bound);
  SELECT pg_get_functiondef(studio_function) INTO STRICT definition;
  IF length(definition)-length(replace(definition,studio_bound,''))<>length(studio_bound)
    OR length(definition)-length(replace(definition,studio_prior,''))<>length(studio_prior)
  THEN RAISE EXCEPTION 'STUDIO_BUDGET_RESERVATION_REPLAY_FORWARD_FAILED';END IF;
END
$budget_reservation_request_forward$;

-- A completed Studio attempt still owns the durable execution identity that
-- committed its artifact version. Return that exact identity on claim replay
-- so a scheduler recovering from finalizer-response loss can replay finalize
-- without inventing a new token/fence or re-entering provider execution.
DO $studio_claim_terminal_replay_forward$
DECLARE claim_function regprocedure:='public.studio_artifact_generation_claim_v2(uuid,uuid,integer)'::regprocedure;
  definition text;
  prior_projection text:='''outcome'',''replayed'',''attemptId'',attempt.id,''state'',attempt.state,''providerAllowed'',false,''reconcileOnly'',false';
  durable_projection text:='''outcome'',''replayed'',''attemptId'',attempt.id,''state'',attempt.state,''executionToken'',attempt.execution_token,''executionFence'',attempt.execution_fence,''leaseExpiresAt'',attempt.execution_lease_expires_at,''providerAllowed'',false,''reconcileOnly'',false';
BEGIN
  SELECT pg_get_functiondef(claim_function) INTO STRICT definition;
  IF length(definition)-length(replace(definition,prior_projection,''))<>length(prior_projection)
    OR position(durable_projection IN definition)>0
  THEN RAISE EXCEPTION 'STUDIO_GENERATION_CLAIM_TERMINAL_REPLAY_DRIFT';END IF;
  EXECUTE replace(definition,prior_projection,durable_projection);
  SELECT pg_get_functiondef(claim_function) INTO STRICT definition;
  IF position(prior_projection IN definition)>0 OR position(durable_projection IN definition)=0
  THEN RAISE EXCEPTION 'STUDIO_GENERATION_CLAIM_TERMINAL_REPLAY_FORWARD_FAILED';END IF;
END
$studio_claim_terminal_replay_forward$;

-- Forward only the exact hosted-marker guard used by the accepted bootstrap.
-- Every empty-target, fixed-cap, route, role, and synthetic-only invariant in
-- the predecessor body remains unchanged.
DO $bootstrap_forward$
DECLARE predecessor regprocedure:='public.synthetic_ai_campaign_bootstrap(uuid,uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,uuid,timestamptz)'::regprocedure;
  definition text;old_guard text:='marker.migration_tip=''20260917173445''';new_guard text:='marker.migration_tip=''20260918082307''';
BEGIN
  SELECT pg_get_functiondef(predecessor) INTO STRICT definition;
  IF length(definition)-length(replace(definition,old_guard,''))<>length(old_guard)
    OR position(new_guard IN definition)>0
  THEN RAISE EXCEPTION 'SYNTHETIC_AI_DOMAIN_BUDGET_BOOTSTRAP_DRIFT';END IF;
  EXECUTE replace(definition,old_guard,new_guard);
  SELECT pg_get_functiondef(predecessor) INTO STRICT definition;
  IF position(old_guard IN definition)>0 OR position(new_guard IN definition)=0
  THEN RAISE EXCEPTION 'SYNTHETIC_AI_DOMAIN_BUDGET_BOOTSTRAP_FORWARD_FAILED';END IF;
END
$bootstrap_forward$;

REVOKE ALL ON FUNCTION
  public.enterprise_assess_mapping_budget_identity_v1(public.enterprise_ai_budget_reservations,uuid,uuid,uuid,uuid,uuid,uuid,bigint,uuid,uuid,text,text,text),
  public.enterprise_assess_mapping_provider_budget_transition_v1(text,uuid,uuid,uuid,bigint,uuid,uuid,uuid,bigint,uuid,uuid,text,text,text,uuid,integer,integer,integer,text),
  public.enterprise_assess_mapping_claim_snapshot_v1(uuid),
  public.enterprise_claim_assess_document_mapping_run_pre_budget_v1(uuid,uuid,uuid,bigint,text,text,jsonb,uuid,uuid,bigint,jsonb,uuid,uuid,text,text,text,uuid,uuid,uuid,bigint,uuid,uuid,bigint),
  public.synthetic_ai_campaign_effect_binding_v2(uuid,uuid,uuid,bigint,uuid,uuid,uuid,bigint,uuid,uuid,uuid,text,text,text,text,text,integer)
FROM PUBLIC,anon,authenticated,service_role;

REVOKE ALL ON FUNCTION
  public.enterprise_assess_mapping_reserve_provider_budget_v1(uuid,uuid,uuid,bigint,uuid,uuid,uuid,bigint,uuid,uuid,text,text,text,integer,integer),
  public.enterprise_assess_mapping_settle_provider_budget_v1(uuid,uuid,uuid,bigint,uuid,uuid,uuid,bigint,uuid,uuid,text,text,text,uuid,integer,integer,integer),
  public.enterprise_assess_mapping_mark_provider_budget_uncertain_v1(uuid,uuid,uuid,bigint,uuid,uuid,uuid,bigint,uuid,uuid,text,text,text,uuid,text),
  public.enterprise_assess_mapping_release_provider_budget_v1(uuid,uuid,uuid,bigint,uuid,uuid,uuid,bigint,uuid,uuid,text,text,text,uuid,text),
  public.enterprise_claim_assess_document_mapping_run_v1(uuid,uuid,uuid,bigint,text,text,jsonb,uuid,uuid,bigint,jsonb,uuid,uuid,text,text,text,uuid,uuid,uuid,bigint,uuid,uuid,bigint),
  public.synthetic_ai_campaign_reserve_effect(uuid,uuid,uuid,bigint,text,text,uuid,uuid,uuid,bigint,uuid,uuid,uuid,text,text,text,text,text,integer),
  public.synthetic_ai_campaign_consume_effect(uuid,uuid,uuid,uuid,bigint,text,text,uuid,uuid,uuid,bigint,uuid,uuid,uuid,text,text,text,text,text,integer)
FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION
  public.enterprise_assess_mapping_reserve_provider_budget_v1(uuid,uuid,uuid,bigint,uuid,uuid,uuid,bigint,uuid,uuid,text,text,text,integer,integer),
  public.enterprise_assess_mapping_settle_provider_budget_v1(uuid,uuid,uuid,bigint,uuid,uuid,uuid,bigint,uuid,uuid,text,text,text,uuid,integer,integer,integer),
  public.enterprise_assess_mapping_mark_provider_budget_uncertain_v1(uuid,uuid,uuid,bigint,uuid,uuid,uuid,bigint,uuid,uuid,text,text,text,uuid,text),
  public.enterprise_assess_mapping_release_provider_budget_v1(uuid,uuid,uuid,bigint,uuid,uuid,uuid,bigint,uuid,uuid,text,text,text,uuid,text),
  public.enterprise_claim_assess_document_mapping_run_v1(uuid,uuid,uuid,bigint,text,text,jsonb,uuid,uuid,bigint,jsonb,uuid,uuid,text,text,text,uuid,uuid,uuid,bigint,uuid,uuid,bigint),
  public.synthetic_ai_campaign_reserve_effect(uuid,uuid,uuid,bigint,text,text,uuid,uuid,uuid,bigint,uuid,uuid,uuid,text,text,text,text,text,integer),
  public.synthetic_ai_campaign_consume_effect(uuid,uuid,uuid,uuid,bigint,text,text,uuid,uuid,uuid,bigint,uuid,uuid,uuid,text,text,text,text,text,integer)
TO service_role;

ALTER TABLE public.hosted_pilot_environment_identity DROP CONSTRAINT hosted_pilot_environment_identity_migration_tip_check;
UPDATE public.hosted_pilot_environment_identity SET migration_tip='20260918082307'
 WHERE singleton AND migration_tip='20260917173445'
  AND NOT production_authorized AND NOT customer_data_authorized AND NOT real_provider_calls_authorized;
DO $tip$
BEGIN
 IF(SELECT count(*) FROM public.hosted_pilot_environment_identity WHERE singleton
   AND migration_tip='20260918082307' AND NOT production_authorized
   AND NOT customer_data_authorized AND NOT real_provider_calls_authorized)<>1
 THEN RAISE EXCEPTION 'SYNTHETIC_AI_DOMAIN_BUDGET_MIGRATION_TIP_FAILED';END IF;
END
$tip$;
ALTER TABLE public.hosted_pilot_environment_identity ADD CONSTRAINT hosted_pilot_environment_identity_migration_tip_check
  CHECK(migration_tip='20260918082307');

COMMENT ON COLUMN public.enterprise_ai_budget_reservations.assess_mapping_run_id IS
  'Exclusive real-FK authority for Assess mapping provider budget. Rollback disables mapping/provider execution; rows remain durable for receipt/run reconciliation.';
COMMENT ON COLUMN public.synthetic_ai_campaign_effect_debits.authority_kind IS
  'Server-derived enterprise, assess_mapping, or studio authority. Existing currency debits are immutable and never transferred or refunded.';
