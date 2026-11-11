-- Second and final continuation of the same bounded synthetic AI campaign.
-- This migration performs no provider effect, enables no runtime, and changes
-- no historic charge. It first adds one exact no-effect reconciliation path
-- for the retained failed Assess mapping reservation, then permits one fresh
-- provider validation followed by one joined Studio generation under the
-- original aggregate USD 10 cap.
DO $precondition$
DECLARE marker public.hosted_pilot_environment_identity;
BEGIN
  LOCK TABLE public.hosted_pilot_environment_identity IN SHARE ROW EXCLUSIVE MODE;
  SELECT * INTO STRICT marker FROM public.hosted_pilot_environment_identity WHERE singleton FOR UPDATE;
  IF marker.product_key<>'avalaos-core'
    OR marker.environment_class<>'hosted_nonproduction_pilot'
    OR marker.schema_contract<>'hosted-pilot-2026-08'
    OR marker.migration_tip<>'20260928060000'
    OR marker.production_authorized OR marker.customer_data_authorized OR marker.real_provider_calls_authorized
    OR pg_catalog.to_regclass('public.synthetic_ai_mapping_no_effect_reconciliations') IS NOT NULL
    OR pg_catalog.to_regclass('public.synthetic_ai_campaign_final_continuations') IS NOT NULL
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_attribute
      WHERE attrelid='public.synthetic_ai_campaign_effect_debits'::regclass
        AND attname='final_continuation_id' AND NOT attisdropped)
    OR EXISTS(SELECT 1 FROM public.pr_c_controlled_human_exercises WHERE lifecycle<>'deprovisioned')
  THEN RAISE EXCEPTION 'SYNTHETIC_AI_FINAL_CONTINUATION_MIGRATION_PRECONDITION_FAILED'; END IF;
END
$precondition$;

CREATE TABLE public.synthetic_ai_mapping_no_effect_reconciliations(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.synthetic_ai_campaign_authorities(id) ON DELETE RESTRICT,
  reservation_id uuid NOT NULL UNIQUE REFERENCES public.enterprise_ai_budget_reservations(id) ON DELETE RESTRICT,
  receipt_id uuid NOT NULL UNIQUE REFERENCES public.enterprise_ai_command_receipts(id) ON DELETE RESTRICT,
  mapping_run_id uuid NOT NULL UNIQUE REFERENCES public.enterprise_assess_document_mapping_runs(id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  historical_actor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  historical_authorization_version bigint NOT NULL CHECK(historical_authorization_version>0),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL,
  authorization_version bigint NOT NULL CHECK(authorization_version>0),
  target_fingerprint text NOT NULL CHECK(target_fingerprint~'^sha256:[0-9a-f]{64}$'),
  project_ref text NOT NULL CHECK(project_ref~'^[a-z0-9]{20}$'),
  retained_failure_class text NOT NULL CHECK(retained_failure_class='provider_request_failed'),
  retained_receipt_error_code text NOT NULL CHECK(retained_receipt_error_code='COMMAND_UNAVAILABLE'),
  retained_reserved_at timestamptz NOT NULL CHECK(retained_reserved_at=timestamptz '2026-09-23 05:22:54.727991+00'),
  retained_reserved_tokens integer NOT NULL CHECK(retained_reserved_tokens=34601),
  reconciliation_digest text NOT NULL UNIQUE CHECK(reconciliation_digest~'^sha256:[0-9a-f]{64}$'),
  result jsonb NOT NULL CHECK(jsonb_typeof(result)='object'),
  reconciled_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  FOREIGN KEY(workspace_id,org_id) REFERENCES public.workspaces(id,org_id) ON DELETE RESTRICT
);

CREATE TABLE public.synthetic_ai_campaign_final_continuations(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL UNIQUE REFERENCES public.synthetic_ai_campaign_authorities(id) ON DELETE RESTRICT,
  prior_renewal_id uuid NOT NULL UNIQUE REFERENCES public.synthetic_ai_campaign_renewals(id) ON DELETE RESTRICT,
  reconciliation_id uuid NOT NULL UNIQUE REFERENCES public.synthetic_ai_mapping_no_effect_reconciliations(id) ON DELETE RESTRICT,
  activated_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  authorization_version bigint NOT NULL CHECK(authorization_version>0),
  target_fingerprint text NOT NULL CHECK(target_fingerprint~'^sha256:[0-9a-f]{64}$'),
  project_ref text NOT NULL CHECK(project_ref~'^[a-z0-9]{20}$'),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL,
  provider_config_id uuid NOT NULL,
  key_ref_id uuid NOT NULL,
  assess_route_id uuid NOT NULL,
  studio_route_id uuid NOT NULL,
  source_package_id uuid NOT NULL,
  artifact_id uuid NOT NULL,
  source_package_hash text NOT NULL CHECK(source_package_hash~'^[0-9a-f]{64}$'),
  release_sha text NOT NULL CHECK(release_sha~'^[0-9a-f]{40}$'),
  source_attestation_digest text NOT NULL CHECK(source_attestation_digest~'^sha256:[0-9a-f]{64}$'),
  baseline_debit_count integer NOT NULL DEFAULT 6 CHECK(baseline_debit_count=6),
  baseline_aggregate_usd_nanos bigint NOT NULL DEFAULT 3698075200 CHECK(baseline_aggregate_usd_nanos=3698075200),
  fixed_debit_usd_nanos bigint NOT NULL DEFAULT 471459200 CHECK(fixed_debit_usd_nanos=471459200),
  maximum_additional_effects integer NOT NULL DEFAULT 2 CHECK(maximum_additional_effects=2),
  maximum_aggregate_usd_nanos bigint NOT NULL DEFAULT 4640993600 CHECK(maximum_aggregate_usd_nanos=4640993600),
  binding_digest text NOT NULL UNIQUE CHECK(binding_digest~'^sha256:[0-9a-f]{64}$'),
  result jsonb NOT NULL CHECK(jsonb_typeof(result)='object'),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  expires_at timestamptz NOT NULL,
  CHECK(expires_at>created_at AND expires_at<=created_at+interval '24 hours'),
  CHECK(maximum_aggregate_usd_nanos=baseline_aggregate_usd_nanos+maximum_additional_effects*fixed_debit_usd_nanos),
  FOREIGN KEY(workspace_id,org_id) REFERENCES public.workspaces(id,org_id) ON DELETE RESTRICT,
  FOREIGN KEY(provider_config_id,org_id) REFERENCES public.ai_provider_configs(id,org_id) ON DELETE RESTRICT,
  FOREIGN KEY(key_ref_id,org_id) REFERENCES public.ai_provider_key_refs(id,org_id) ON DELETE RESTRICT,
  FOREIGN KEY(assess_route_id,org_id,workspace_id) REFERENCES public.enterprise_ai_capability_routes(id,org_id,workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY(studio_route_id,org_id,workspace_id) REFERENCES public.enterprise_ai_capability_routes(id,org_id,workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY(source_package_id,artifact_id,org_id,workspace_id)
    REFERENCES public.studio_artifact_source_packages(id,artifact_id,org_id,workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY(artifact_id,org_id,workspace_id)
    REFERENCES public.studio_artifact_aggregates(id,org_id,workspace_id) ON DELETE RESTRICT
);

ALTER TABLE public.synthetic_ai_campaign_effect_debits
  ADD COLUMN final_continuation_id uuid
  REFERENCES public.synthetic_ai_campaign_final_continuations(id) ON DELETE RESTRICT;
CREATE INDEX synthetic_ai_campaign_debit_final_continuation_idx
  ON public.synthetic_ai_campaign_effect_debits(final_continuation_id,id)
  WHERE final_continuation_id IS NOT NULL;

CREATE FUNCTION public.synthetic_ai_final_continuation_immutable_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'SYNTHETIC_AI_FINAL_CONTINUATION_IMMUTABLE';
END
$$;
CREATE TRIGGER synthetic_ai_mapping_reconciliation_immutable
  BEFORE UPDATE OR DELETE ON public.synthetic_ai_mapping_no_effect_reconciliations
  FOR EACH ROW EXECUTE FUNCTION public.synthetic_ai_final_continuation_immutable_guard();
CREATE TRIGGER synthetic_ai_final_continuation_immutable
  BEFORE UPDATE OR DELETE ON public.synthetic_ai_campaign_final_continuations
  FOR EACH ROW EXECUTE FUNCTION public.synthetic_ai_final_continuation_immutable_guard();

ALTER TABLE public.synthetic_ai_mapping_no_effect_reconciliations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.synthetic_ai_mapping_no_effect_reconciliations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.synthetic_ai_campaign_final_continuations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.synthetic_ai_campaign_final_continuations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.synthetic_ai_mapping_no_effect_reconciliations,
  public.synthetic_ai_campaign_final_continuations FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.synthetic_ai_mapping_no_effect_reconciliations,
  public.synthetic_ai_campaign_final_continuations TO service_role;

CREATE FUNCTION public.synthetic_ai_reconcile_mapping_no_effect_once(
  p_actor uuid,p_org uuid,p_workspace uuid,p_authorization_version bigint,
  p_target_fingerprint text,p_project_ref text,p_campaign uuid,
  p_reservation uuid,p_receipt uuid,p_mapping_run uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  target public.synthetic_admin_targets;campaign public.synthetic_ai_campaign_authorities;
  receipt public.enterprise_ai_command_receipts;mapping_run public.enterprise_assess_document_mapping_runs;
  reservation public.enterprise_ai_budget_reservations;
  prior public.synthetic_ai_mapping_no_effect_reconciliations;inserted public.synthetic_ai_mapping_no_effect_reconciliations;
  marker public.hosted_pilot_environment_identity;enterprise_control public.enterprise_intelligence_runtime_control;
  studio_control public.studio_artifact_runtime_control;request_host text;digest_value text;result_value jsonb;
BEGIN
  IF p_actor IS NULL OR p_org IS NULL OR p_workspace IS NULL OR p_campaign IS NULL
    OR p_reservation IS NULL OR p_receipt IS NULL OR p_mapping_run IS NULL
    OR p_target_fingerprint!~'^sha256:[0-9a-f]{64}$' OR p_project_ref!~'^[a-z0-9]{20}$'
  THEN RAISE EXCEPTION 'SYNTHETIC_AI_MAPPING_RECONCILIATION_INVALID';END IF;
  PERFORM public.pr1b_assert_command_authority(p_actor,p_org,p_workspace,'org.admin',p_authorization_version);
  target:=public.synthetic_admin_assert_target(p_actor,p_org,p_workspace,p_authorization_version,p_target_fingerprint);
  request_host:=public.synthetic_ai_campaign_request_host();
  IF request_host IS DISTINCT FROM p_project_ref||'.supabase.co'
    OR target.org_id IS DISTINCT FROM p_org OR target.workspace_id IS DISTINCT FROM p_workspace
    OR target.operator_actor_id IS DISTINCT FROM p_actor OR NOT target.enabled OR NOT target.synthetic_only
    OR target.production_authorized OR target.customer_data_authorized OR target.real_provider_calls_authorized
  THEN RAISE EXCEPTION 'SYNTHETIC_AI_MAPPING_RECONCILIATION_NOT_AUTHORIZED';END IF;
  SELECT * INTO STRICT marker FROM public.hosted_pilot_environment_identity WHERE singleton FOR SHARE;
  SELECT * INTO STRICT enterprise_control FROM public.enterprise_intelligence_runtime_control WHERE singleton FOR SHARE;
  SELECT * INTO STRICT studio_control FROM public.studio_artifact_runtime_control WHERE singleton FOR SHARE;
  IF marker.migration_tip<>'20261003015246' OR marker.production_authorized OR marker.customer_data_authorized
    OR marker.real_provider_calls_authorized OR enterprise_control.provider_enabled OR studio_control.provider_enabled
  THEN RAISE EXCEPTION 'SYNTHETIC_AI_MAPPING_RECONCILIATION_RUNTIME_NOT_OFF';END IF;

  SELECT * INTO campaign FROM public.synthetic_ai_campaign_authorities authority
    WHERE authority.id=p_campaign AND authority.target_id=target.id AND authority.target_fingerprint=p_target_fingerprint
      AND authority.project_ref=p_project_ref AND authority.server_host=request_host
      AND authority.org_id=p_org AND authority.workspace_id=p_workspace AND authority.operator_actor_id=p_actor
    FOR UPDATE;
  SELECT * INTO receipt FROM public.enterprise_ai_command_receipts row
    WHERE row.id=p_receipt AND row.org_id=p_org AND row.workspace_id=p_workspace FOR UPDATE;
  SELECT * INTO mapping_run FROM public.enterprise_assess_document_mapping_runs row
    WHERE row.id=p_mapping_run AND row.org_id=p_org AND row.workspace_id=p_workspace
      AND row.receipt_id=p_receipt FOR UPDATE;
  SELECT * INTO reservation FROM public.enterprise_ai_budget_reservations row
    WHERE row.id=p_reservation AND row.org_id=p_org AND row.workspace_id=p_workspace
      AND row.receipt_id=p_receipt AND row.assess_mapping_run_id=p_mapping_run FOR UPDATE;
  -- Fresh Admin authority belongs to the reconciler. Historical execution
  -- identity belongs to the original author and must agree across locked rows.
  IF campaign.id IS NULL OR receipt.id IS NULL OR mapping_run.id IS NULL OR reservation.id IS NULL
    OR receipt.actor_id IS NULL OR mapping_run.created_by IS DISTINCT FROM receipt.actor_id
    OR reservation.actor_id IS DISTINCT FROM receipt.actor_id
    OR reservation.authorization_version IS NULL OR reservation.authorization_version<=0
    OR mapping_run.authorization_version IS DISTINCT FROM reservation.authorization_version
    OR receipt.execution_token IS NULL OR mapping_run.execution_token IS DISTINCT FROM receipt.execution_token
    OR reservation.execution_token IS DISTINCT FROM receipt.execution_token
    OR receipt.execution_fence IS NULL OR receipt.execution_fence<=0
    OR mapping_run.execution_fence IS DISTINCT FROM receipt.execution_fence
    OR reservation.execution_fence IS DISTINCT FROM receipt.execution_fence
    OR mapping_run.route_id IS DISTINCT FROM reservation.route_id
    OR mapping_run.provider_config_id IS DISTINCT FROM reservation.provider_config_id
    OR mapping_run.provider IS DISTINCT FROM reservation.provider OR mapping_run.model IS DISTINCT FROM reservation.model
    OR reservation.route_id IS DISTINCT FROM campaign.assess_route_id
    OR reservation.provider_config_id IS DISTINCT FROM campaign.provider_config_id
    OR reservation.provider IS DISTINCT FROM campaign.provider OR reservation.model IS DISTINCT FROM campaign.model
  THEN RAISE EXCEPTION 'SYNTHETIC_AI_MAPPING_RECONCILIATION_LINEAGE_MISMATCH';END IF;
  digest_value:='sha256:'||encode(public.digest(convert_to(concat_ws('|','synthetic-ai-mapping-no-effect-v1',
    campaign.id::text,p_reservation::text,p_receipt::text,p_mapping_run::text,p_actor::text,p_org::text,p_workspace::text,
    p_authorization_version::text,p_target_fingerprint,p_project_ref,reservation.failure_class,reservation.reserved_at::text,
    reservation.reserved_tokens::text,receipt.actor_id::text,reservation.authorization_version::text,
    receipt.execution_token::text,receipt.execution_fence::text),'UTF8'),'sha256'),'hex');
  SELECT * INTO prior FROM public.synthetic_ai_mapping_no_effect_reconciliations row
    WHERE row.reservation_id=p_reservation;
  IF prior.id IS NOT NULL THEN
    IF prior.campaign_id IS DISTINCT FROM p_campaign OR prior.receipt_id IS DISTINCT FROM p_receipt
      OR prior.mapping_run_id IS DISTINCT FROM p_mapping_run OR prior.actor_id IS DISTINCT FROM p_actor
      OR prior.org_id IS DISTINCT FROM p_org OR prior.workspace_id IS DISTINCT FROM p_workspace
      OR prior.authorization_version IS DISTINCT FROM p_authorization_version
      OR prior.historical_actor_id IS DISTINCT FROM receipt.actor_id
      OR prior.historical_authorization_version IS DISTINCT FROM reservation.authorization_version
      OR prior.reconciliation_digest IS DISTINCT FROM digest_value
      OR prior.target_fingerprint IS DISTINCT FROM p_target_fingerprint OR prior.project_ref IS DISTINCT FROM p_project_ref
      OR reservation.state<>'released' OR reservation.release_reason<>'reconciled_no_effect'
    THEN RAISE EXCEPTION 'SYNTHETIC_AI_MAPPING_RECONCILIATION_REPLAY_MISMATCH';END IF;
    RETURN prior.result;
  END IF;
  IF campaign.id IS NULL OR NOT campaign.enabled OR campaign.disabled_at IS NOT NULL
    OR campaign.provider<>'openai' OR campaign.endpoint<>'https://api.openai.com'
    OR campaign.model<>'gpt-4.1-mini-2025-04-14' OR campaign.campaign_cap_usd_nanos<>10000000000
    OR campaign.carried_usd_nanos<>869320000 OR campaign.fixed_debit_usd_nanos<>471459200
    OR receipt.id IS NULL OR receipt.status<>'failed' OR receipt.command_type<>'assess.document-map.analyze'
    OR receipt.runtime_area<>'ingestion' OR receipt.completed_at IS NULL
    OR receipt.response#>>'{error,code}' IS DISTINCT FROM 'COMMAND_UNAVAILABLE'
    OR mapping_run.id IS NULL OR mapping_run.status<>'claimed'
    OR mapping_run.safe_result IS NOT NULL OR mapping_run.output_hash IS NOT NULL OR mapping_run.staged_payload_hash IS NOT NULL
    OR mapping_run.token_input IS NOT NULL OR mapping_run.token_output IS NOT NULL OR mapping_run.latency_ms IS NOT NULL
    OR reservation.id IS NULL OR reservation.authority_kind<>'assess_mapping' OR reservation.job_id IS NOT NULL
    OR reservation.state<>'uncertain' OR reservation.failure_class<>'provider_request_failed'
    OR reservation.release_reason IS NOT NULL OR reservation.settled_at IS NOT NULL
    OR reservation.reserved_at IS DISTINCT FROM timestamptz '2026-09-23 05:22:54.727991+00'
    OR reservation.reserved_tokens<>34601 OR reservation.actual_input_tokens IS NOT NULL
    OR reservation.actual_output_tokens IS NOT NULL OR reservation.actual_total_tokens IS NOT NULL
    OR reservation.assess_mapping_transfer_pending
    OR reservation.route_id IS DISTINCT FROM campaign.assess_route_id
    OR reservation.provider_config_id IS DISTINCT FROM campaign.provider_config_id
    OR reservation.provider<>'openai' OR reservation.capability<>'assess.evidence.extract'
    OR reservation.model IS DISTINCT FROM campaign.model
    OR EXISTS(SELECT 1 FROM public.enterprise_ai_effect_journal effect WHERE effect.receipt_id=p_receipt)
    OR EXISTS(SELECT 1 FROM public.enterprise_assess_document_mapping_proposals proposal WHERE proposal.run_id=p_mapping_run)
    OR EXISTS(SELECT 1 FROM public.enterprise_assess_document_mapping_applications application
      JOIN public.enterprise_assess_document_mapping_proposals proposal ON proposal.id=application.proposal_id
      WHERE proposal.run_id=p_mapping_run)
    OR EXISTS(SELECT 1 FROM public.synthetic_ai_campaign_effect_debits debit
      WHERE debit.receipt_id=p_receipt OR debit.assess_mapping_run_id=p_mapping_run OR debit.effect_id=p_mapping_run)
  THEN RAISE EXCEPTION 'SYNTHETIC_AI_MAPPING_RECONCILIATION_UNSAFE';END IF;
  result_value:=jsonb_build_object('status','reconciled_no_effect','campaignId',campaign.id,
    'reservationId',p_reservation,'receiptId',p_receipt,'mappingRunId',p_mapping_run,'reconciliationDigest',digest_value);
  INSERT INTO public.synthetic_ai_mapping_no_effect_reconciliations(campaign_id,reservation_id,receipt_id,mapping_run_id,
    actor_id,historical_actor_id,historical_authorization_version,org_id,workspace_id,authorization_version,target_fingerprint,project_ref,retained_failure_class,
    retained_receipt_error_code,retained_reserved_at,retained_reserved_tokens,reconciliation_digest,result)
  VALUES(campaign.id,p_reservation,p_receipt,p_mapping_run,p_actor,receipt.actor_id,reservation.authorization_version,p_org,p_workspace,p_authorization_version,
    p_target_fingerprint,p_project_ref,reservation.failure_class,'COMMAND_UNAVAILABLE',reservation.reserved_at,
    reservation.reserved_tokens,digest_value,result_value) RETURNING * INTO inserted;
  UPDATE public.enterprise_ai_budget_reservations SET state='released',release_reason='reconciled_no_effect',
    assess_mapping_transfer_pending=false,updated_at=statement_timestamp(),settled_at=statement_timestamp()
    WHERE id=p_reservation;
  RETURN inserted.result;
END
$$;

CREATE FUNCTION public.synthetic_ai_campaign_activate_final_continuation(
  p_actor uuid,p_org uuid,p_workspace uuid,p_authorization_version bigint,
  p_target_fingerprint text,p_project_ref text,p_campaign uuid,p_provider_config uuid,p_key_ref uuid,
  p_assess_route uuid,p_studio_route uuid,p_source_package uuid,p_artifact uuid,
  p_release_sha text,p_source_attestation_digest text,p_window_seconds integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  target public.synthetic_admin_targets;campaign public.synthetic_ai_campaign_authorities;
  renewal public.synthetic_ai_campaign_renewals;reconciliation public.synthetic_ai_mapping_no_effect_reconciliations;
  existing public.synthetic_ai_campaign_final_continuations;inserted public.synthetic_ai_campaign_final_continuations;
  package public.studio_artifact_source_packages;artifact public.studio_artifact_aggregates;
  marker public.hosted_pilot_environment_identity;enterprise_control public.enterprise_intelligence_runtime_control;
  studio_control public.studio_artifact_runtime_control;request_host text;digest_value text;result_value jsonb;
  debit_count integer;consumed_count integer;debit_spend bigint;operation_counts jsonb;created_value timestamptz:=statement_timestamp();
BEGIN
  IF p_actor IS NULL OR p_org IS NULL OR p_workspace IS NULL OR p_campaign IS NULL OR p_provider_config IS NULL
    OR p_key_ref IS NULL OR p_assess_route IS NULL OR p_studio_route IS NULL OR p_source_package IS NULL OR p_artifact IS NULL
    OR p_target_fingerprint!~'^sha256:[0-9a-f]{64}$' OR p_project_ref!~'^[a-z0-9]{20}$'
    OR p_release_sha!~'^[0-9a-f]{40}$' OR p_source_attestation_digest!~'^sha256:[0-9a-f]{64}$'
    OR p_window_seconds NOT BETWEEN 1 AND 86400
  THEN RAISE EXCEPTION 'SYNTHETIC_AI_FINAL_CONTINUATION_INVALID';END IF;
  PERFORM public.pr1b_assert_command_authority(p_actor,p_org,p_workspace,'org.admin',p_authorization_version);
  target:=public.synthetic_admin_assert_target(p_actor,p_org,p_workspace,p_authorization_version,p_target_fingerprint);
  request_host:=public.synthetic_ai_campaign_request_host();
  IF request_host IS DISTINCT FROM p_project_ref||'.supabase.co'
    OR target.org_id IS DISTINCT FROM p_org OR target.workspace_id IS DISTINCT FROM p_workspace
    OR target.operator_actor_id IS DISTINCT FROM p_actor OR NOT target.enabled OR NOT target.synthetic_only
    OR target.production_authorized OR target.customer_data_authorized OR target.real_provider_calls_authorized
  THEN RAISE EXCEPTION 'SYNTHETIC_AI_FINAL_CONTINUATION_NOT_AUTHORIZED';END IF;
  SELECT * INTO STRICT marker FROM public.hosted_pilot_environment_identity WHERE singleton FOR SHARE;
  SELECT * INTO STRICT enterprise_control FROM public.enterprise_intelligence_runtime_control WHERE singleton FOR SHARE;
  SELECT * INTO STRICT studio_control FROM public.studio_artifact_runtime_control WHERE singleton FOR SHARE;
  IF marker.migration_tip<>'20261003015246' OR marker.production_authorized OR marker.customer_data_authorized
    OR marker.real_provider_calls_authorized OR enterprise_control.provider_enabled OR studio_control.provider_enabled
  THEN RAISE EXCEPTION 'SYNTHETIC_AI_FINAL_CONTINUATION_RUNTIME_NOT_OFF';END IF;
  SELECT * INTO campaign FROM public.synthetic_ai_campaign_authorities authority
    WHERE authority.id=p_campaign AND authority.target_id=target.id AND authority.target_fingerprint=p_target_fingerprint
      AND authority.project_ref=p_project_ref AND authority.server_host=request_host AND authority.org_id=p_org
      AND authority.workspace_id=p_workspace AND authority.operator_actor_id=p_actor
      AND authority.provider_config_id=p_provider_config AND authority.key_ref_id=p_key_ref
      AND authority.assess_route_id=p_assess_route AND authority.studio_route_id=p_studio_route FOR UPDATE;
  SELECT * INTO renewal FROM public.synthetic_ai_campaign_renewals row WHERE row.campaign_id=p_campaign FOR SHARE;
  SELECT * INTO reconciliation FROM public.synthetic_ai_mapping_no_effect_reconciliations row WHERE row.campaign_id=p_campaign FOR SHARE;
  SELECT * INTO package FROM public.studio_artifact_source_packages row
    WHERE row.id=p_source_package AND row.artifact_id=p_artifact AND row.org_id=p_org AND row.workspace_id=p_workspace FOR SHARE;
  SELECT * INTO artifact FROM public.studio_artifact_aggregates row
    WHERE row.id=p_artifact AND row.org_id=p_org AND row.workspace_id=p_workspace FOR SHARE;
  SELECT * INTO existing FROM public.synthetic_ai_campaign_final_continuations row WHERE row.campaign_id=p_campaign;
  IF existing.id IS NOT NULL THEN
    IF existing.activated_by IS DISTINCT FROM p_actor OR existing.authorization_version IS DISTINCT FROM p_authorization_version
      OR existing.target_fingerprint IS DISTINCT FROM p_target_fingerprint OR existing.project_ref IS DISTINCT FROM p_project_ref
      OR existing.provider_config_id IS DISTINCT FROM p_provider_config OR existing.key_ref_id IS DISTINCT FROM p_key_ref
      OR existing.assess_route_id IS DISTINCT FROM p_assess_route OR existing.studio_route_id IS DISTINCT FROM p_studio_route
      OR existing.source_package_id IS DISTINCT FROM p_source_package OR existing.artifact_id IS DISTINCT FROM p_artifact
      OR existing.release_sha IS DISTINCT FROM p_release_sha OR existing.source_attestation_digest IS DISTINCT FROM p_source_attestation_digest
      OR existing.expires_at-existing.created_at IS DISTINCT FROM make_interval(secs=>p_window_seconds)
    THEN RAISE EXCEPTION 'SYNTHETIC_AI_FINAL_CONTINUATION_REPLAY_MISMATCH';END IF;
    RETURN existing.result;
  END IF;
  SELECT count(*)::integer,count(*) FILTER(WHERE consumed_at IS NOT NULL)::integer,
    COALESCE(sum(debit_usd_nanos),0)::bigint INTO debit_count,consumed_count,debit_spend
  FROM public.synthetic_ai_campaign_effect_debits WHERE campaign_id=p_campaign;
  SELECT jsonb_object_agg(operation,n) INTO operation_counts
  FROM(SELECT operation,count(*)::integer n FROM public.synthetic_ai_campaign_effect_debits
    WHERE campaign_id=p_campaign GROUP BY operation) counts;
  IF campaign.id IS NULL OR NOT campaign.enabled OR campaign.disabled_at IS NOT NULL
    OR campaign.expires_at>=created_value OR campaign.provider<>'openai' OR campaign.endpoint<>'https://api.openai.com'
    OR campaign.model<>'gpt-4.1-mini-2025-04-14' OR campaign.campaign_cap_usd_nanos<>10000000000
    OR campaign.carried_usd_nanos<>869320000 OR campaign.fixed_debit_usd_nanos<>471459200
    OR renewal.id IS NULL OR renewal.expires_at>=created_value OR renewal.maximum_additional_effects<>6
    OR renewal.maximum_aggregate_usd_nanos<>4169534400
    OR reconciliation.id IS NULL OR package.id IS NULL OR package.source_mode<>'assess_handoff'
    OR package.lineage_classification<>'assessed' OR package.planning_only OR artifact.id IS NULL
    OR package.assess_handoff_id IS NULL OR package.studio_input_bundle_id IS NOT NULL
    OR package.studio_input_bundle_version_id IS NOT NULL
    OR artifact.handoff_id IS DISTINCT FROM package.assess_handoff_id
    OR artifact.artifact_type<>'brd' OR artifact.lineage_classification<>'assessed' OR artifact.planning_only
    OR artifact.source_package_id IS DISTINCT FROM package.id OR artifact.source_package_hash IS DISTINCT FROM package.package_hash
    OR artifact.source_mode<>'assess_handoff' OR artifact.aggregate_version<>0
    OR artifact.current_version_id IS NOT NULL OR artifact.current_approved_version_id IS NOT NULL OR artifact.lifecycle<>'draft'
    OR EXISTS(SELECT 1 FROM public.studio_artifact_generation_attempts attempt WHERE attempt.artifact_id=p_artifact)
    OR debit_count<>6 OR consumed_count<>6 OR debit_spend<>2828755200
    OR campaign.carried_usd_nanos+debit_spend<>3698075200
    OR operation_counts IS DISTINCT FROM jsonb_build_object('assess.evidence.extract',1,'provider.validate',2,'studio.document.generate',3)
    OR (SELECT count(*) FROM public.synthetic_ai_campaign_effect_debits debit
      WHERE debit.campaign_id=p_campaign AND debit.renewal_id IS NULL)<>1
    OR (SELECT count(*) FROM public.synthetic_ai_campaign_effect_debits debit
      WHERE debit.campaign_id=p_campaign AND debit.renewal_id=renewal.id)<>5
    OR EXISTS(SELECT 1 FROM public.enterprise_ai_budget_reservations reservation
      WHERE reservation.org_id=p_org AND reservation.workspace_id=p_workspace
        AND reservation.provider_config_id=p_provider_config
        AND(reservation.state IN('reserved','uncertain') OR reservation.studio_transfer_pending OR reservation.assess_mapping_transfer_pending))
    OR NOT EXISTS(SELECT 1 FROM public.ai_provider_configs config
      WHERE config.id=p_provider_config AND config.org_id=p_org AND config.provider='openai'
        AND config.key_ref_id=p_key_ref AND config.endpoint_url='https://api.openai.com'
        AND config.default_model='gpt-4.1-mini-2025-04-14'
        AND config.model_allowlist=ARRAY['gpt-4.1-mini-2025-04-14']::text[]
        AND config.status='active' AND config.deleted_at IS NULL)
    OR NOT EXISTS(SELECT 1 FROM public.ai_provider_key_refs key_ref
      WHERE key_ref.id=p_key_ref AND key_ref.org_id=p_org AND key_ref.provider='openai'
        AND key_ref.resolver_type='server_reference' AND key_ref.status='active' AND key_ref.deleted_at IS NULL
        AND(key_ref.expires_at IS NULL OR key_ref.expires_at>created_value))
    OR NOT EXISTS(SELECT 1 FROM public.enterprise_ai_capability_routes route
      WHERE route.id=p_assess_route AND route.org_id=p_org AND route.workspace_id=p_workspace
        AND route.provider_config_id=p_provider_config AND route.capability='assess.evidence.extract'
        AND route.model='gpt-4.1-mini-2025-04-14' AND route.enabled AND route.deleted_at IS NULL)
    OR NOT EXISTS(SELECT 1 FROM public.enterprise_ai_capability_routes route
      WHERE route.id=p_studio_route AND route.org_id=p_org AND route.workspace_id=p_workspace
        AND route.provider_config_id=p_provider_config AND route.capability='studio.document.generate'
        AND route.model='gpt-4.1-mini-2025-04-14' AND route.enabled AND route.deleted_at IS NULL)
  THEN RAISE EXCEPTION 'SYNTHETIC_AI_FINAL_CONTINUATION_HISTORY_UNSAFE';END IF;
  digest_value:='sha256:'||encode(public.digest(convert_to(concat_ws('|','synthetic-ai-final-continuation-v1',
    campaign.id::text,renewal.id::text,reconciliation.id::text,p_actor::text,p_org::text,p_workspace::text,
    p_authorization_version::text,p_target_fingerprint,p_project_ref,p_provider_config::text,p_key_ref::text,
    p_assess_route::text,p_studio_route::text,p_source_package::text,p_artifact::text,package.package_hash,
    p_release_sha,p_source_attestation_digest,p_window_seconds::text,created_value::text),'UTF8'),'sha256'),'hex');
  result_value:=jsonb_build_object('status','activated','campaignId',campaign.id,'expiresAt',created_value+make_interval(secs=>p_window_seconds),
    'baselineAggregateUsdNanos',3698075200,'maximumAdditionalEffects',2,'maximumAggregateUsdNanos',4640993600,
    'releaseSha',p_release_sha,'sourceAttestationDigest',p_source_attestation_digest,'bindingDigest',digest_value);
  INSERT INTO public.synthetic_ai_campaign_final_continuations(campaign_id,prior_renewal_id,reconciliation_id,
    activated_by,authorization_version,target_fingerprint,project_ref,org_id,workspace_id,provider_config_id,key_ref_id,
    assess_route_id,studio_route_id,source_package_id,artifact_id,source_package_hash,release_sha,source_attestation_digest,
    binding_digest,result,created_at,expires_at)
  VALUES(campaign.id,renewal.id,reconciliation.id,p_actor,p_authorization_version,p_target_fingerprint,p_project_ref,p_org,
    p_workspace,p_provider_config,p_key_ref,p_assess_route,p_studio_route,p_source_package,p_artifact,package.package_hash,
    p_release_sha,p_source_attestation_digest,digest_value,result_value,created_value,created_value+make_interval(secs=>p_window_seconds))
  RETURNING * INTO inserted;
  RETURN inserted.result;
END
$$;

-- The current active window is unambiguous: original, first renewal, or final
-- continuation. Any overlapping continuation state fails closed.
CREATE OR REPLACE FUNCTION public.synthetic_ai_campaign_active_until(p_campaign uuid)
RETURNS timestamptz LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT CASE
    WHEN NOT authority.enabled OR authority.disabled_at IS NOT NULL THEN NULL
    WHEN authority.expires_at>statement_timestamp() THEN authority.expires_at
    WHEN (SELECT count(*) FROM public.synthetic_ai_campaign_renewals renewal
            WHERE renewal.campaign_id=authority.id AND renewal.expires_at>statement_timestamp())
       + (SELECT count(*) FROM public.synthetic_ai_campaign_final_continuations final
            WHERE final.campaign_id=authority.id AND final.expires_at>statement_timestamp())<>1 THEN NULL
    ELSE COALESCE(
      (SELECT renewal.expires_at FROM public.synthetic_ai_campaign_renewals renewal
        WHERE renewal.campaign_id=authority.id AND renewal.expires_at>statement_timestamp()),
      (SELECT final.expires_at FROM public.synthetic_ai_campaign_final_continuations final
        WHERE final.campaign_id=authority.id AND final.expires_at>statement_timestamp()))
  END
  FROM public.synthetic_ai_campaign_authorities authority WHERE authority.id=p_campaign;
$$;

DO $reserve_forward$
DECLARE fn regprocedure:='public.synthetic_ai_campaign_reserve_effect(uuid,uuid,uuid,bigint,text,text,uuid,uuid,uuid,bigint,uuid,uuid,uuid,text,text,text,text,text,integer)'::regprocedure;
 definition text;old text;replacement text;
BEGIN
 SELECT pg_get_functiondef(fn) INTO STRICT definition;
 old:=' prior public.synthetic_ai_campaign_effect_debits;renewal public.synthetic_ai_campaign_renewals;spent bigint;renewal_count integer;slot_count integer;request_host text;';
 replacement:=' prior public.synthetic_ai_campaign_effect_debits;renewal public.synthetic_ai_campaign_renewals;final_continuation public.synthetic_ai_campaign_final_continuations;spent bigint;renewal_count integer;slot_count integer;validation_count integer;generation_count integer;request_host text;';
 IF length(definition)-length(replace(definition,old,''))<>length(old) THEN RAISE EXCEPTION 'SYNTHETIC_AI_FINAL_RESERVE_DECLARATION_DRIFT';END IF;
 definition:=replace(definition,old,replacement);
 old:=E' IF campaign.expires_at<=statement_timestamp() THEN\n  SELECT * INTO renewal FROM public.synthetic_ai_campaign_renewals active\n   WHERE active.campaign_id=campaign.id AND active.expires_at>statement_timestamp() FOR SHARE;\n  SELECT count(*)::integer INTO renewal_count FROM public.synthetic_ai_campaign_effect_debits debit WHERE debit.renewal_id=renewal.id;\n  IF renewal.id IS NULL OR renewal_count>=renewal.maximum_additional_effects THEN RAISE EXCEPTION ''SYNTHETIC_AI_CAMPAIGN_EFFECT_LIMIT_REACHED'';END IF;\n  SELECT count(*)::integer INTO slot_count FROM public.synthetic_ai_campaign_effect_debits debit WHERE debit.renewal_id=renewal.id AND(\n   (kind=''enterprise'' AND p_operation=''provider.validate'' AND debit.authority_kind=''enterprise'' AND debit.operation=''provider.validate'')\n   OR(kind=''enterprise'' AND p_operation=''assess.evidence.extract'' AND debit.authority_kind=''enterprise'' AND debit.operation=''assess.evidence.extract'')\n   OR(kind=''assess_mapping'' AND p_operation=''assess.evidence.extract'' AND debit.authority_kind=''assess_mapping'' AND debit.operation=''assess.evidence.extract'')\n   OR(kind=''studio'' AND p_operation=''studio.document.generate'' AND debit.authority_kind=''studio'' AND debit.operation=''studio.document.generate''));\n  IF NOT ((kind=''enterprise'' AND p_operation=''provider.validate'' AND slot_count<1)\n    OR(kind=''enterprise'' AND p_operation=''assess.evidence.extract'' AND slot_count<1)\n    OR(kind=''assess_mapping'' AND p_operation=''assess.evidence.extract'' AND slot_count<1)\n    OR(kind=''studio'' AND p_operation=''studio.document.generate'' AND slot_count<3))\n  THEN RAISE EXCEPTION ''SYNTHETIC_AI_CAMPAIGN_EFFECT_SLOT_NOT_AUTHORIZED'';END IF;\n END IF;';
 replacement:=E' IF campaign.expires_at<=statement_timestamp() THEN\n  SELECT * INTO renewal FROM public.synthetic_ai_campaign_renewals active\n   WHERE active.campaign_id=campaign.id AND active.expires_at>statement_timestamp() FOR SHARE;\n  SELECT * INTO final_continuation FROM public.synthetic_ai_campaign_final_continuations active\n   WHERE active.campaign_id=campaign.id AND active.expires_at>statement_timestamp() FOR SHARE;\n  IF final_continuation.id IS NOT NULL THEN\n   SELECT count(*)::integer,count(*) FILTER(WHERE operation=''provider.validate'')::integer,\n    count(*) FILTER(WHERE operation=''studio.document.generate'')::integer\n    INTO renewal_count,validation_count,generation_count FROM public.synthetic_ai_campaign_effect_debits debit\n    WHERE debit.final_continuation_id=final_continuation.id;\n   IF renewal.id IS NOT NULL OR renewal_count>=2 THEN RAISE EXCEPTION ''SYNTHETIC_AI_CAMPAIGN_EFFECT_LIMIT_REACHED'';END IF;\n   IF NOT ((kind=''enterprise'' AND p_operation=''provider.validate'' AND p_route IS NULL AND validation_count=0 AND generation_count=0)\n    OR(kind=''studio'' AND p_operation=''studio.document.generate'' AND validation_count=1 AND generation_count=0\n      AND p_route=final_continuation.studio_route_id\n      AND EXISTS(SELECT 1 FROM public.synthetic_ai_campaign_effect_debits validation JOIN public.ai_provider_configs config\n       ON config.id=final_continuation.provider_config_id AND config.org_id=final_continuation.org_id\n       WHERE validation.final_continuation_id=final_continuation.id AND validation.operation=''provider.validate''\n        AND validation.authority_kind=''enterprise'' AND validation.consumed_at IS NOT NULL\n        AND config.last_validated_at>=validation.consumed_at AND config.last_validated_at<=statement_timestamp())\n      AND EXISTS(SELECT 1 FROM public.studio_artifact_generation_attempts attempt\n       WHERE attempt.id=p_effect AND attempt.artifact_id=final_continuation.artifact_id\n        AND attempt.source_package_id=final_continuation.source_package_id\n        AND attempt.source_package_hash=final_continuation.source_package_hash)))\n   THEN RAISE EXCEPTION ''SYNTHETIC_AI_CAMPAIGN_EFFECT_SLOT_NOT_AUTHORIZED'';END IF;\n  ELSE\n   SELECT count(*)::integer INTO renewal_count FROM public.synthetic_ai_campaign_effect_debits debit WHERE debit.renewal_id=renewal.id;\n   IF renewal.id IS NULL OR renewal_count>=renewal.maximum_additional_effects THEN RAISE EXCEPTION ''SYNTHETIC_AI_CAMPAIGN_EFFECT_LIMIT_REACHED'';END IF;\n   SELECT count(*)::integer INTO slot_count FROM public.synthetic_ai_campaign_effect_debits debit WHERE debit.renewal_id=renewal.id AND(\n    (kind=''enterprise'' AND p_operation=''provider.validate'' AND debit.authority_kind=''enterprise'' AND debit.operation=''provider.validate'')\n    OR(kind=''enterprise'' AND p_operation=''assess.evidence.extract'' AND debit.authority_kind=''enterprise'' AND debit.operation=''assess.evidence.extract'')\n    OR(kind=''assess_mapping'' AND p_operation=''assess.evidence.extract'' AND debit.authority_kind=''assess_mapping'' AND debit.operation=''assess.evidence.extract'')\n    OR(kind=''studio'' AND p_operation=''studio.document.generate'' AND debit.authority_kind=''studio'' AND debit.operation=''studio.document.generate''));\n   IF NOT ((kind=''enterprise'' AND p_operation=''provider.validate'' AND slot_count<1)\n     OR(kind=''enterprise'' AND p_operation=''assess.evidence.extract'' AND slot_count<1)\n     OR(kind=''assess_mapping'' AND p_operation=''assess.evidence.extract'' AND slot_count<1)\n     OR(kind=''studio'' AND p_operation=''studio.document.generate'' AND slot_count<3))\n   THEN RAISE EXCEPTION ''SYNTHETIC_AI_CAMPAIGN_EFFECT_SLOT_NOT_AUTHORIZED'';END IF;\n  END IF;\n END IF;';
 IF length(definition)-length(replace(definition,old,''))<>length(old) THEN RAISE EXCEPTION 'SYNTHETIC_AI_FINAL_RESERVE_WINDOW_DRIFT';END IF;
 definition:=replace(definition,old,replacement);
 old:='  campaign_id,renewal_id,receipt_id,effect_id,authority_kind,assess_mapping_run_id,studio_receipt_id,studio_attempt_id,';
 replacement:='  campaign_id,renewal_id,final_continuation_id,receipt_id,effect_id,authority_kind,assess_mapping_run_id,studio_receipt_id,studio_attempt_id,';
 IF length(definition)-length(replace(definition,old,''))<>length(old) THEN RAISE EXCEPTION 'SYNTHETIC_AI_FINAL_RESERVE_INSERT_DRIFT';END IF;
 definition:=replace(definition,old,replacement);
 old:=' VALUES(campaign.id,renewal.id,CASE WHEN kind IN(''enterprise'',''assess_mapping'') THEN p_receipt END,p_effect,kind,';
 replacement:=' VALUES(campaign.id,renewal.id,final_continuation.id,CASE WHEN kind IN(''enterprise'',''assess_mapping'') THEN p_receipt END,p_effect,kind,';
 IF length(definition)-length(replace(definition,old,''))<>length(old) THEN RAISE EXCEPTION 'SYNTHETIC_AI_FINAL_RESERVE_VALUES_DRIFT';END IF;
 definition:=replace(definition,old,replacement);
 old:=' IF renewal.id IS NOT NULL AND campaign.carried_usd_nanos+spent+campaign.fixed_debit_usd_nanos>renewal.maximum_aggregate_usd_nanos';
 replacement:=E' IF (renewal.id IS NOT NULL AND campaign.carried_usd_nanos+spent+campaign.fixed_debit_usd_nanos>renewal.maximum_aggregate_usd_nanos)\n  OR(final_continuation.id IS NOT NULL AND campaign.carried_usd_nanos+spent+campaign.fixed_debit_usd_nanos>final_continuation.maximum_aggregate_usd_nanos)';
 IF length(definition)-length(replace(definition,old,''))<>length(old) THEN RAISE EXCEPTION 'SYNTHETIC_AI_FINAL_RESERVE_CAP_DRIFT';END IF;
 EXECUTE replace(definition,old,replacement);
END
$reserve_forward$;

DO $consume_forward$
DECLARE fn regprocedure:='public.synthetic_ai_campaign_consume_effect(uuid,uuid,uuid,uuid,bigint,text,text,uuid,uuid,uuid,bigint,uuid,uuid,uuid,text,text,text,text,text,integer)'::regprocedure;
 definition text;old text;replacement text;
BEGIN
 SELECT pg_get_functiondef(fn) INTO STRICT definition;
 old:=' debit public.synthetic_ai_campaign_effect_debits;renewal public.synthetic_ai_campaign_renewals;request_host text;';
 replacement:=' debit public.synthetic_ai_campaign_effect_debits;renewal public.synthetic_ai_campaign_renewals;final_continuation public.synthetic_ai_campaign_final_continuations;request_host text;';
 IF length(definition)-length(replace(definition,old,''))<>length(old) THEN RAISE EXCEPTION 'SYNTHETIC_AI_FINAL_CONSUME_DECLARATION_DRIFT';END IF;
 definition:=replace(definition,old,replacement);
 old:=E' IF campaign.expires_at<=statement_timestamp() THEN\n  SELECT * INTO renewal FROM public.synthetic_ai_campaign_renewals active\n   WHERE active.campaign_id=campaign.id AND active.expires_at>statement_timestamp() FOR SHARE;\n END IF;';
 replacement:=E' IF campaign.expires_at<=statement_timestamp() THEN\n  SELECT * INTO renewal FROM public.synthetic_ai_campaign_renewals active\n   WHERE active.campaign_id=campaign.id AND active.expires_at>statement_timestamp() FOR SHARE;\n  SELECT * INTO final_continuation FROM public.synthetic_ai_campaign_final_continuations active\n   WHERE active.campaign_id=campaign.id AND active.expires_at>statement_timestamp() FOR SHARE;\n END IF;';
 IF length(definition)-length(replace(definition,old,''))<>length(old) THEN RAISE EXCEPTION 'SYNTHETIC_AI_FINAL_CONSUME_WINDOW_DRIFT';END IF;
 definition:=replace(definition,old,replacement);
 old:=E'  OR(campaign.expires_at<=statement_timestamp() AND(renewal.id IS NULL OR debit.renewal_id IS DISTINCT FROM renewal.id\n    OR debit.reserved_at<renewal.created_at OR debit.reserved_at>=renewal.expires_at))';
 replacement:=E'  OR(campaign.expires_at<=statement_timestamp() AND NOT(\n    (renewal.id IS NOT NULL AND final_continuation.id IS NULL AND debit.renewal_id IS NOT DISTINCT FROM renewal.id AND debit.final_continuation_id IS NULL\n      AND debit.reserved_at>=renewal.created_at AND debit.reserved_at<renewal.expires_at)\n    OR(final_continuation.id IS NOT NULL AND renewal.id IS NULL AND debit.final_continuation_id IS NOT DISTINCT FROM final_continuation.id AND debit.renewal_id IS NULL\n      AND debit.reserved_at>=final_continuation.created_at AND debit.reserved_at<final_continuation.expires_at)))';
 IF length(definition)-length(replace(definition,old,''))<>length(old) THEN RAISE EXCEPTION 'SYNTHETIC_AI_FINAL_CONSUME_PERMIT_DRIFT';END IF;
 EXECUTE replace(definition,old,replacement);
END
$consume_forward$;

-- Exact-tip forwarding for fresh bootstrap and retained PR C marker checks.
DO $identity_forward$
DECLARE marker public.hosted_pilot_environment_identity;marker_constraint text;exercise_constraint text;
 bootstrap_definition text;assert_marker_definition text;
 old_bootstrap text:='marker.migration_tip=''20260928060000''';new_bootstrap text:='marker.migration_tip=''20261003015246''';
 old_assert text:='marker.migration_tip = ''20260928060000''';new_assert text:='marker.migration_tip = ''20261003015246''';
BEGIN
 LOCK TABLE public.hosted_pilot_environment_identity IN SHARE ROW EXCLUSIVE MODE;
 SELECT * INTO STRICT marker FROM public.hosted_pilot_environment_identity WHERE singleton FOR UPDATE;
 SELECT pg_get_expr(conbin,conrelid,false) INTO STRICT marker_constraint FROM pg_constraint
  WHERE conrelid='public.hosted_pilot_environment_identity'::regclass AND conname='hosted_pilot_environment_identity_migration_tip_check';
 SELECT pg_get_expr(conbin,conrelid,false) INTO STRICT exercise_constraint FROM pg_constraint
  WHERE conrelid='public.pr_c_controlled_human_exercises'::regclass AND conname='pr_c_controlled_human_exercises_migration_tip_check';
 SELECT pg_get_functiondef('public.synthetic_ai_campaign_bootstrap(uuid,uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,uuid,timestamptz)'::regprocedure) INTO STRICT bootstrap_definition;
 SELECT pg_get_functiondef('public.pr_c_controlled_human_assert_marker()'::regprocedure) INTO STRICT assert_marker_definition;
 IF marker.migration_tip<>'20260928060000' OR marker_constraint<>'(migration_tip = ''20260928060000''::text)'
  OR exercise_constraint<>'(migration_tip = ANY (ARRAY[''20260904120000''::text, ''20260924113000''::text, ''20260926053818''::text, ''20260928060000''::text]))'
  OR (length(bootstrap_definition)-length(replace(bootstrap_definition,old_bootstrap,'')))/length(old_bootstrap)<>1
  OR position(new_bootstrap IN bootstrap_definition)>0
  OR (length(assert_marker_definition)-length(replace(assert_marker_definition,old_assert,'')))/length(old_assert)<>1
  OR position(new_assert IN assert_marker_definition)>0
  OR EXISTS(SELECT 1 FROM public.pr_c_controlled_human_exercises WHERE lifecycle<>'deprovisioned')
 THEN RAISE EXCEPTION 'SYNTHETIC_AI_FINAL_CONTINUATION_IDENTITY_SOURCE_MISMATCH';END IF;
 EXECUTE replace(bootstrap_definition,old_bootstrap,new_bootstrap);
 EXECUTE replace(assert_marker_definition,old_assert,new_assert);
 ALTER TABLE public.pr_c_controlled_human_exercises DROP CONSTRAINT pr_c_controlled_human_exercises_migration_tip_check;
 ALTER TABLE public.pr_c_controlled_human_exercises ADD CONSTRAINT pr_c_controlled_human_exercises_migration_tip_check
  CHECK(migration_tip IN('20260904120000','20260924113000','20260926053818','20260928060000','20261003015246'));
 ALTER TABLE public.hosted_pilot_environment_identity DROP CONSTRAINT hosted_pilot_environment_identity_migration_tip_check;
 UPDATE public.hosted_pilot_environment_identity SET migration_tip='20261003015246' WHERE singleton;
 ALTER TABLE public.hosted_pilot_environment_identity ADD CONSTRAINT hosted_pilot_environment_identity_migration_tip_check
  CHECK(migration_tip='20261003015246');
END
$identity_forward$;

REVOKE ALL ON FUNCTION public.synthetic_ai_final_continuation_immutable_guard(),
  public.synthetic_ai_reconcile_mapping_no_effect_once(uuid,uuid,uuid,bigint,text,text,uuid,uuid,uuid,uuid),
  public.synthetic_ai_campaign_activate_final_continuation(uuid,uuid,uuid,bigint,text,text,uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,integer),
  public.synthetic_ai_campaign_active_until(uuid)
FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION
  public.synthetic_ai_reconcile_mapping_no_effect_once(uuid,uuid,uuid,bigint,text,text,uuid,uuid,uuid,uuid),
  public.synthetic_ai_campaign_activate_final_continuation(uuid,uuid,uuid,bigint,text,text,uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,integer)
TO service_role;

COMMENT ON TABLE public.synthetic_ai_mapping_no_effect_reconciliations IS
 'Append-only proof that the one retained failed Assess mapping reservation had no provider effect, campaign debit, staged output, proposal, or application before release.';
COMMENT ON TABLE public.synthetic_ai_campaign_final_continuations IS
 'Second and final same-campaign window: one fresh provider validation then one exact joined-package Studio generation; original USD 10 cap and all history remain authoritative.';
COMMENT ON COLUMN public.synthetic_ai_campaign_effect_debits.final_continuation_id IS
 'Immutable binding for the two final paid-validation effects. Null on all original and first-renewal debits.';

-- Rollback/read-only fallback: leave both provider runtimes off or invoke the
-- existing campaign disable RPC. Retain reconciliation, continuation, debit,
-- receipt, mapping, Studio, and audit history; forward-fix additive schema only.
