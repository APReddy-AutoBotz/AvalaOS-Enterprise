-- Workstream 6 rollback projection correction. Additive, non-live, and forward-safe.
-- Actionable candidates remain separate from immutable promoted-release history.
-- Hosted activation remains structurally unavailable: LIVE_ACTIVATION_NOT_AUTHORIZED.

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
     AND e.event_type='promoted_non_live' AND c.id<>promoted.id
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
    WHEN promoted.id IS NULL THEN 'ROLLBACK_CURRENT_NOT_PROMOTED'
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


-- Safe fallback: maintenance/read-only or release disablement; preserve immutable history and forward-fix only.
