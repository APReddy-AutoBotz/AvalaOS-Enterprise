-- Workstream 6 lifecycle/replay/operator-truth convergence. Additive, non-live only.
-- Hosted activation remains structurally unavailable: LIVE_ACTIVATION_NOT_AUTHORIZED.

-- Recovery evidence is a mutation of the tenant control plane, so the current
-- tenant lifecycle is locked and checked before the existing environment gates.
ALTER FUNCTION public.pilot_operations_ingest_recovery_evidence(uuid,uuid,uuid,text,text,text,text,text,text,uuid)
  RENAME TO pilot_operations_ingest_recovery_evidence_v3;
REVOKE ALL ON FUNCTION public.pilot_operations_ingest_recovery_evidence_v3(uuid,uuid,uuid,text,text,text,text,text,text,uuid)
  FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.pilot_operations_ingest_recovery_evidence(
  p_org uuid,p_workspace uuid,p_environment uuid,p_workflow_name text,p_workflow_run_id text,
  p_workflow_head_sha text,p_artifact_sha256 text,p_evidence_sha256 text,p_schema_version text,p_created_by uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE tenant public.pilot_operations_tenants; prior public.pilot_operations_recovery_evidence_ingestions;
BEGIN
  SELECT * INTO tenant FROM public.pilot_operations_tenants
   WHERE org_id=p_org AND workspace_id=p_workspace FOR UPDATE;
  IF tenant.id IS NOT NULL AND tenant.lifecycle='deprovisioned' THEN
    RAISE EXCEPTION 'TENANT_DEPROVISIONED';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_org::text||':'||p_workspace::text||':recovery:'||p_workflow_name||':'||p_workflow_run_id||':'||p_artifact_sha256,0));
  SELECT * INTO prior FROM public.pilot_operations_recovery_evidence_ingestions
   WHERE workflow_name=p_workflow_name AND workflow_run_id=p_workflow_run_id
     AND workflow_head_sha=p_workflow_head_sha AND artifact_sha256=p_artifact_sha256;
  IF FOUND THEN
    IF prior.org_id IS DISTINCT FROM p_org OR prior.workspace_id IS DISTINCT FROM p_workspace
       OR prior.environment_id IS DISTINCT FROM p_environment
       OR prior.evidence_sha256 IS DISTINCT FROM p_evidence_sha256
       OR prior.schema_version IS DISTINCT FROM p_schema_version THEN RAISE EXCEPTION 'EVIDENCE_INVALID'; END IF;
    RETURN jsonb_build_object('resourceId',prior.recovery_drill_id,
      'truthClassification','proven_disposable_or_ci_evidence','liveActivationAuthorized',false);
  END IF;
  RETURN public.pilot_operations_ingest_recovery_evidence_v3(
    p_org,p_workspace,p_environment,p_workflow_name,p_workflow_run_id,p_workflow_head_sha,
    p_artifact_sha256,p_evidence_sha256,p_schema_version,p_created_by);
END$$;
REVOKE ALL ON FUNCTION public.pilot_operations_ingest_recovery_evidence(uuid,uuid,uuid,text,text,text,text,text,text,uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pilot_operations_ingest_recovery_evidence(uuid,uuid,uuid,text,text,text,text,text,text,uuid)
  TO service_role;

-- Current authority and lifecycle are checked before any historical receipt can
-- be disclosed. Provider retries may then recover a committed response before
-- current external-reference validation; this never authorizes a new effect.
ALTER FUNCTION public.pilot_operations_command(uuid,uuid,uuid,text,uuid,text,text,bigint,bigint,jsonb)
  RENAME TO pilot_operations_command_v4;
REVOKE ALL ON FUNCTION public.pilot_operations_command_v4(uuid,uuid,uuid,text,uuid,text,text,bigint,bigint,jsonb)
  FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.pilot_operations_command(
  p_actor uuid,p_org uuid,p_workspace uuid,p_operation text,p_request uuid,p_idempotency_key text,
  p_request_payload text,p_authorization_version bigint,p_expected_version bigint,p_payload jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  tenant public.pilot_operations_tenants;
  prior public.pilot_operations_command_receipts;
  request_digest text;
  required_capability text;
  approval_actor uuid;
  approval_authorization_version bigint;
BEGIN
  required_capability:=CASE
    WHEN p_operation='approve_promotion' THEN 'release.approve'
    WHEN p_operation IN('simulate_promotion','rollback_non_live_promotion') THEN 'release.promote'
    WHEN p_operation='validate_release_candidate' THEN 'release.validate'
    WHEN p_operation IN('register_release_candidate','supersede_release_candidate') THEN 'release.manage'
    WHEN p_operation='bind_provider_reference' THEN 'byok.manage'
    WHEN p_operation IN('bootstrap_tenant','deprovision_tenant','reactivate_tenant') THEN 'org.admin'
    ELSE 'operations.manage' END;
  PERFORM public.pr1b_assert_command_authority(
    p_actor,p_org,p_workspace,required_capability,p_authorization_version);
  SELECT * INTO tenant FROM public.pilot_operations_tenants
   WHERE org_id=p_org AND workspace_id=p_workspace FOR UPDATE;
  IF tenant.id IS NOT NULL AND tenant.lifecycle='deprovisioned'
     AND p_operation<>'reactivate_tenant' THEN RAISE EXCEPTION 'TENANT_DEPROVISIONED'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_org::text||':'||p_workspace::text||':'||p_operation||':'||p_idempotency_key,0));
  request_digest:=encode(public.digest(convert_to(p_request_payload,'UTF8'),'sha256'),'hex');
  SELECT * INTO prior FROM public.pilot_operations_command_receipts
   WHERE org_id=p_org AND workspace_id=p_workspace AND operation=p_operation
     AND idempotency_key=p_idempotency_key;
  IF FOUND THEN
    IF prior.actor_id IS DISTINCT FROM p_actor OR prior.request_hash IS DISTINCT FROM request_digest
      THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF;
    RETURN prior.response_body;
  END IF;

  -- Approval is authority, not merely history. Promotion requires the approving
  -- actor's capability/version to remain current at the promotion boundary.
  IF p_operation='simulate_promotion' THEN
    SELECT e.actor_id,e.authorization_version INTO approval_actor,approval_authorization_version
      FROM public.pilot_operations_release_events e
     WHERE e.candidate_id=(p_payload->>'candidateId')::uuid AND e.org_id=p_org
       AND e.workspace_id=p_workspace AND e.event_type='approved'
     ORDER BY e.created_at DESC,e.id DESC LIMIT 1;
    IF approval_actor IS NULL THEN RAISE EXCEPTION 'PREFLIGHT_BLOCKED'; END IF;
    PERFORM public.pr1b_assert_command_authority(
      approval_actor,p_org,p_workspace,'release.approve',approval_authorization_version);
  END IF;
  RETURN public.pilot_operations_command_v4(
    p_actor,p_org,p_workspace,p_operation,p_request,p_idempotency_key,p_request_payload,
    p_authorization_version,p_expected_version,p_payload);
END$$;
REVOKE ALL ON FUNCTION public.pilot_operations_command(uuid,uuid,uuid,text,uuid,text,text,bigint,bigint,jsonb)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pilot_operations_command(uuid,uuid,uuid,text,uuid,text,text,bigint,bigint,jsonb)
  TO service_role;

CREATE OR REPLACE FUNCTION public.pilot_operations_projection(
  p_actor uuid,p_org uuid,p_workspace uuid,p_authorization_version bigint
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  env public.pilot_operations_environments;
  candidate public.pilot_operations_release_candidates;
  promoted public.pilot_operations_release_candidates;
  target public.pilot_operations_release_candidates;
  binding public.pilot_operations_provider_bindings;
  tenant public.pilot_operations_tenants;
  evidence public.pilot_operations_evidence_manifests;
  recovery public.pilot_operations_recovery_drills;
  config public.ai_provider_configs;
  key_ref public.ai_provider_key_refs;
  route public.enterprise_ai_capability_routes;
  blockers jsonb:='[]'::jsonb;
  rollback_reason text;
  provider_current boolean:=false;
  provider_status text:='not_configured';
  schema_compatible boolean:=false;
BEGIN
  PERFORM public.pr1b_assert_command_authority(
    p_actor,p_org,p_workspace,'operations.read',p_authorization_version);
  SELECT * INTO tenant FROM public.pilot_operations_tenants
   WHERE org_id=p_org AND workspace_id=p_workspace;
  IF tenant.id IS NOT NULL AND tenant.lifecycle='deprovisioned' THEN
    RAISE EXCEPTION 'TENANT_DEPROVISIONED';
  END IF;
  SELECT * INTO env FROM public.pilot_operations_environments
   WHERE org_id=p_org AND workspace_id=p_workspace AND environment_type='pilot_candidate';

  -- The newest non-terminal candidate is actionable. Promoted history remains a
  -- separate immutable projection and is used as the rollback target.
  SELECT * INTO candidate FROM public.pilot_operations_release_candidates
   WHERE org_id=p_org AND workspace_id=p_workspace AND environment_id=env.id
     AND lifecycle NOT IN('promoted_non_live','superseded','blocked')
   ORDER BY created_at DESC,id DESC LIMIT 1;
  SELECT c.* INTO promoted FROM public.pilot_operations_release_events e
   JOIN public.pilot_operations_release_candidates c ON c.id=e.candidate_id
   WHERE e.org_id=p_org AND e.workspace_id=p_workspace AND c.environment_id=env.id
     AND e.event_type='promoted_non_live'
   ORDER BY e.created_at DESC,e.id DESC LIMIT 1;
  IF candidate.id IS NULL THEN candidate:=promoted; END IF;
  SELECT c.* INTO target FROM public.pilot_operations_release_events e
   JOIN public.pilot_operations_release_candidates c ON c.id=e.candidate_id
   WHERE e.org_id=p_org AND e.workspace_id=p_workspace AND c.environment_id=env.id
     AND e.event_type='promoted_non_live' AND c.id<>candidate.id
   ORDER BY e.created_at DESC,e.id DESC LIMIT 1;

  SELECT * INTO evidence FROM public.pilot_operations_evidence_manifests
   WHERE candidate_id=candidate.id AND status='verified';
  schema_compatible:=COALESCE(evidence.migration_compatible,false)
    AND evidence.schema_version IS NOT DISTINCT FROM env.expected_schema_version;
  IF candidate.id IS NULL OR candidate.lifecycle<>'approved_for_pilot_promotion' THEN
    blockers:=blockers||'"CANDIDATE_NOT_APPROVED"'::jsonb; END IF;
  IF NOT schema_compatible THEN blockers:=blockers||'"SCHEMA_INCOMPATIBLE"'::jsonb; END IF;
  IF env.maintenance THEN blockers:=blockers||'"MAINTENANCE_MODE"'::jsonb; END IF;
  IF env.read_only THEN blockers:=blockers||'"READ_ONLY_MODE"'::jsonb; END IF;
  IF env.disabled_features ? 'release' THEN blockers:=blockers||'"FEATURE_DISABLED"'::jsonb; END IF;

  SELECT * INTO binding FROM public.pilot_operations_provider_bindings
   WHERE org_id=p_org AND workspace_id=p_workspace AND environment_id=env.id
   ORDER BY created_at DESC,id DESC LIMIT 1;
  IF binding.id IS NOT NULL THEN
    provider_status:='revoked';
    SELECT * INTO config FROM public.ai_provider_configs
     WHERE id=binding.provider_configuration_id AND org_id=p_org AND status='active'
       AND deleted_at IS NULL;
    IF config.id IS NOT NULL AND config.key_ref_id IS NOT NULL
       AND config.last_validated_at BETWEEN statement_timestamp()-interval '24 hours' AND statement_timestamp() THEN
      SELECT * INTO key_ref FROM public.ai_provider_key_refs
       WHERE id=config.key_ref_id AND org_id=p_org AND provider=config.provider
         AND status='active' AND deleted_at IS NULL;
      SELECT * INTO route FROM public.enterprise_ai_capability_routes
       WHERE provider_config_id=config.id AND org_id=p_org AND workspace_id=p_workspace
         AND enabled AND deleted_at IS NULL ORDER BY id LIMIT 1;
      provider_current:=key_ref.id IS NOT NULL AND route.id IS NOT NULL;
      provider_status:=CASE WHEN NOT provider_current THEN 'revoked'
        WHEN binding.enabled THEN 'enabled' ELSE 'disabled' END;
    ELSIF config.id IS NOT NULL THEN
      provider_status:='expired';
    END IF;
  END IF;
  SELECT * INTO recovery FROM public.pilot_operations_recovery_drills
   WHERE org_id=p_org AND workspace_id=p_workspace AND environment_id=env.id
     AND result='passed' AND truth_classification='proven_disposable_or_ci_evidence'
   ORDER BY created_at DESC,id DESC LIMIT 1;

  rollback_reason:=CASE
    WHEN env.lifecycle='deactivated' THEN 'ENVIRONMENT_BLOCKED'
    WHEN env.maintenance THEN 'MAINTENANCE_MODE' WHEN env.read_only THEN 'READ_ONLY_MODE'
    WHEN env.disabled_features ? 'release' THEN 'FEATURE_DISABLED'
    WHEN candidate.lifecycle<>'promoted_non_live' THEN 'ROLLBACK_CURRENT_NOT_PROMOTED'
    WHEN target.id IS NULL THEN 'ROLLBACK_PRIOR_CANDIDATE_NOT_FOUND' ELSE NULL END;
  RETURN jsonb_build_object(
    'truthClassification','configured_not_live_verified','liveActivationAuthorized',false,
    'environment',jsonb_build_object('id',env.id,'type',env.environment_type,'lifecycle',env.lifecycle,
      'version',env.version,'maintenance',env.maintenance,'readOnly',env.read_only,'disabledFeatures',env.disabled_features),
    'release',jsonb_build_object('id',candidate.id,'gitSha',candidate.git_sha,'lifecycle',candidate.lifecycle,'version',candidate.version),
    'promotedRelease',CASE WHEN promoted.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id',promoted.id,'gitSha',promoted.git_sha,'lifecycle',promoted.lifecycle,'version',promoted.version) END,
    'provider',CASE WHEN binding.id IS NULL THEN NULL ELSE jsonb_build_object(
      'configured',binding.configured AND provider_current,'enabled',binding.enabled AND provider_current,
      'status',provider_status,'purpose',binding.purpose) END,
    'health',jsonb_build_object('schemaCompatible',schema_compatible,'queueState','not_proven','reconciliationState','not_proven'),
    'recovery',jsonb_build_object('backupState',CASE WHEN recovery.id IS NULL THEN 'not_run' ELSE 'completed' END,
      'restoreState',CASE WHEN recovery.id IS NULL THEN 'not_run' ELSE 'completed' END),
    'blockers',blockers,'liveStopGates',jsonb_build_array('LIVE_ACTIVATION_NOT_AUTHORIZED','HOSTED_LIVE_NOT_PROVEN'),
    'rollback',jsonb_build_object('eligible',rollback_reason IS NULL,'reason',rollback_reason,
      'targetCandidateId',CASE WHEN rollback_reason IS NULL THEN target.id ELSE NULL END,
      'targetVersion',CASE WHEN rollback_reason IS NULL THEN target.version ELSE NULL END,
      'targetLabel',CASE WHEN rollback_reason IS NULL THEN 'Candidate '||left(target.id::text,8) ELSE NULL END));
END$$;
REVOKE ALL ON FUNCTION public.pilot_operations_projection(uuid,uuid,uuid,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pilot_operations_projection(uuid,uuid,uuid,bigint) TO service_role;

-- Safe rollback is read-only/maintenance plus an additive forward fix. Immutable
-- receipts, promotion history, recovery evidence, and audits are never rewritten.
