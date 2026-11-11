-- Workstream 6 pending-candidate registration serialization. Additive and non-live.
-- Registration order is server-owned; timestamps and UUIDs are never ordering authority.

CREATE TABLE public.pilot_operations_candidate_sequences(
  environment_id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  next_ordinal bigint NOT NULL DEFAULT 1 CHECK(next_ordinal>0),
  legacy_ambiguous boolean NOT NULL DEFAULT false,
  FOREIGN KEY(environment_id,org_id,workspace_id)
    REFERENCES public.pilot_operations_environments(id,org_id,workspace_id) ON DELETE RESTRICT
);
CREATE TABLE public.pilot_operations_candidate_history(
  environment_id uuid NOT NULL,
  org_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  candidate_ordinal bigint NOT NULL CHECK(candidate_ordinal>0),
  candidate_id uuid NOT NULL UNIQUE,
  PRIMARY KEY(environment_id,candidate_ordinal),
  FOREIGN KEY(environment_id,org_id,workspace_id)
    REFERENCES public.pilot_operations_environments(id,org_id,workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY(candidate_id,org_id,workspace_id)
    REFERENCES public.pilot_operations_release_candidates(id,org_id,workspace_id) ON DELETE RESTRICT
);
CREATE INDEX pilot_operations_candidate_history_current_idx
  ON public.pilot_operations_candidate_history(environment_id,candidate_ordinal DESC);
CREATE TRIGGER pilot_operations_candidate_history_immutable BEFORE UPDATE OR DELETE
  ON public.pilot_operations_candidate_history FOR EACH ROW EXECUTE FUNCTION public.pilot_operations_immutable();
ALTER TABLE public.pilot_operations_candidate_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pilot_operations_candidate_sequences FORCE ROW LEVEL SECURITY;
ALTER TABLE public.pilot_operations_candidate_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pilot_operations_candidate_history FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.pilot_operations_candidate_sequences,public.pilot_operations_candidate_history
  FROM PUBLIC,anon,authenticated;

-- A sole legacy actionable candidate has a provable current identity. Multiple
-- legacy candidates have no recoverable serialized order, so fail closed rather
-- than elevating one using transaction timestamps or UUIDs.
INSERT INTO public.pilot_operations_candidate_sequences(environment_id,org_id,workspace_id,next_ordinal,legacy_ambiguous)
SELECT environment_id,org_id,workspace_id,CASE WHEN count(*)=1 THEN 2 ELSE 1 END,count(*)>1
FROM public.pilot_operations_release_candidates
WHERE lifecycle IN('draft','validated','approved_for_pilot_promotion')
GROUP BY environment_id,org_id,workspace_id;
INSERT INTO public.pilot_operations_candidate_history(environment_id,org_id,workspace_id,candidate_ordinal,candidate_id)
SELECT c.environment_id,c.org_id,c.workspace_id,1,c.id
FROM public.pilot_operations_release_candidates c
JOIN public.pilot_operations_candidate_sequences s ON s.environment_id=c.environment_id
WHERE c.lifecycle IN('draft','validated','approved_for_pilot_promotion') AND NOT s.legacy_ambiguous;

ALTER FUNCTION public.pilot_operations_command(uuid,uuid,uuid,text,uuid,text,text,bigint,bigint,jsonb)
  RENAME TO pilot_operations_command_v6;
REVOKE ALL ON FUNCTION public.pilot_operations_command_v6(uuid,uuid,uuid,text,uuid,text,text,bigint,bigint,jsonb)
  FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.pilot_operations_command(
  p_actor uuid,p_org uuid,p_workspace uuid,p_operation text,p_request uuid,p_idempotency_key text,
  p_request_payload text,p_authorization_version bigint,p_expected_version bigint,p_payload jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE env public.pilot_operations_environments; tenant public.pilot_operations_tenants; seq public.pilot_operations_candidate_sequences;
 prior public.pilot_operations_command_receipts; response jsonb; request_digest text; candidate_id uuid; allocated bigint;
BEGIN
 IF p_operation<>'register_release_candidate' THEN
   RETURN public.pilot_operations_command_v6(p_actor,p_org,p_workspace,p_operation,p_request,p_idempotency_key,p_request_payload,p_authorization_version,p_expected_version,p_payload);
 END IF;
 PERFORM public.pr1b_assert_command_authority(p_actor,p_org,p_workspace,'release.manage',p_authorization_version);
 SELECT * INTO tenant FROM public.pilot_operations_tenants WHERE org_id=p_org AND workspace_id=p_workspace FOR UPDATE;
 IF tenant.id IS NOT NULL AND tenant.lifecycle='deprovisioned' THEN RAISE EXCEPTION 'TENANT_DEPROVISIONED'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_org::text||':'||p_workspace::text||':'||p_operation||':'||p_idempotency_key,0));
 request_digest:=encode(public.digest(convert_to(p_request_payload,'UTF8'),'sha256'),'hex');
 SELECT * INTO prior FROM public.pilot_operations_command_receipts
  WHERE org_id=p_org AND workspace_id=p_workspace AND operation=p_operation AND idempotency_key=p_idempotency_key;
 IF FOUND THEN
   IF prior.actor_id IS DISTINCT FROM p_actor OR prior.request_hash IS DISTINCT FROM request_digest THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF;
   RETURN prior.response_body;
 END IF;
 SELECT * INTO env FROM public.pilot_operations_environments
  WHERE id=(p_payload->>'environmentId')::uuid AND org_id=p_org AND workspace_id=p_workspace FOR UPDATE;
 IF env.id IS NULL THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
 INSERT INTO public.pilot_operations_candidate_sequences(environment_id,org_id,workspace_id)
  VALUES(env.id,p_org,p_workspace) ON CONFLICT(environment_id) DO NOTHING;
 SELECT * INTO seq FROM public.pilot_operations_candidate_sequences WHERE environment_id=env.id FOR UPDATE;
 IF seq.legacy_ambiguous THEN RAISE EXCEPTION 'AMBIGUOUS_PENDING_CANDIDATE_HISTORY'; END IF;
 response:=public.pilot_operations_command_v6(p_actor,p_org,p_workspace,p_operation,p_request,p_idempotency_key,p_request_payload,p_authorization_version,p_expected_version,p_payload);
 candidate_id:=(response->>'resourceId')::uuid;
 allocated:=seq.next_ordinal;
 INSERT INTO public.pilot_operations_candidate_history(environment_id,org_id,workspace_id,candidate_ordinal,candidate_id)
  VALUES(env.id,p_org,p_workspace,allocated,candidate_id);
 UPDATE public.pilot_operations_candidate_sequences SET next_ordinal=allocated+1 WHERE environment_id=env.id;
 RETURN response;
END$$;
REVOKE ALL ON FUNCTION public.pilot_operations_command(uuid,uuid,uuid,text,uuid,text,text,bigint,bigint,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pilot_operations_command(uuid,uuid,uuid,text,uuid,text,text,bigint,bigint,jsonb) TO service_role;

-- Replace only the pending-candidate ordering clause in the current sanitized projection.
CREATE OR REPLACE FUNCTION public.pilot_operations_current_actionable_candidate(p_environment uuid,p_org uuid,p_workspace uuid)
RETURNS public.pilot_operations_release_candidates LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE candidate public.pilot_operations_release_candidates;
BEGIN
 IF EXISTS(SELECT 1 FROM public.pilot_operations_candidate_sequences WHERE environment_id=p_environment AND legacy_ambiguous) THEN
   RAISE EXCEPTION 'AMBIGUOUS_PENDING_CANDIDATE_HISTORY';
 END IF;
 SELECT c.* INTO candidate FROM public.pilot_operations_candidate_history h
 JOIN public.pilot_operations_release_candidates c ON c.id=h.candidate_id
 WHERE h.environment_id=p_environment AND h.org_id=p_org AND h.workspace_id=p_workspace
   AND c.lifecycle IN('draft','validated','approved_for_pilot_promotion')
 ORDER BY h.candidate_ordinal DESC LIMIT 1;
 RETURN candidate;
END$$;
REVOKE ALL ON FUNCTION public.pilot_operations_current_actionable_candidate(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

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
  candidate:=public.pilot_operations_current_actionable_candidate(env.id,p_org,p_workspace);
  IF EXISTS(SELECT 1 FROM public.pilot_operations_promotion_sequences
       WHERE environment_id=env.id AND legacy_ambiguous) THEN
    RAISE EXCEPTION 'AMBIGUOUS_PROMOTION_HISTORY';
  END IF;
  SELECT c.* INTO promoted FROM public.pilot_operations_promotion_history h
   JOIN public.pilot_operations_release_candidates c ON c.id=h.candidate_id
   WHERE h.environment_id=env.id
   ORDER BY h.promotion_ordinal DESC LIMIT 1;
  IF candidate.id IS NULL THEN candidate:=promoted; END IF;
  SELECT c.* INTO target FROM public.pilot_operations_promotion_history h
   JOIN public.pilot_operations_release_candidates c ON c.id=h.candidate_id
   WHERE h.environment_id=env.id
     AND h.promotion_ordinal < (SELECT max(current_history.promotion_ordinal)
       FROM public.pilot_operations_promotion_history current_history
       WHERE current_history.environment_id=env.id)
   ORDER BY h.promotion_ordinal DESC LIMIT 1;

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

-- LIVE_ACTIVATION_NOT_AUTHORIZED remains absolute; safe fallback is read-only and additive forward repair.
