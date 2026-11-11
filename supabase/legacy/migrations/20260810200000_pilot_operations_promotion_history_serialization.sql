-- Workstream 6 promotion-history serialization. Additive, non-live, forward-safe.
-- Promotion ordinals are server-owned and allocated under the environment row lock.
-- Hosted activation remains structurally unavailable: LIVE_ACTIVATION_NOT_AUTHORIZED.

CREATE TABLE public.pilot_operations_promotion_sequences(
  environment_id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  next_ordinal bigint NOT NULL DEFAULT 1 CHECK(next_ordinal>0),
  legacy_ambiguous boolean NOT NULL DEFAULT false,
  FOREIGN KEY(environment_id,org_id,workspace_id)
    REFERENCES public.pilot_operations_environments(id,org_id,workspace_id) ON DELETE RESTRICT
);
CREATE TABLE public.pilot_operations_promotion_history(
  environment_id uuid NOT NULL,
  org_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  promotion_ordinal bigint NOT NULL CHECK(promotion_ordinal>0),
  release_event_id uuid NOT NULL UNIQUE REFERENCES public.pilot_operations_release_events(id) ON DELETE RESTRICT,
  candidate_id uuid NOT NULL,
  PRIMARY KEY(environment_id,promotion_ordinal),
  FOREIGN KEY(environment_id,org_id,workspace_id)
    REFERENCES public.pilot_operations_environments(id,org_id,workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY(candidate_id,org_id,workspace_id)
    REFERENCES public.pilot_operations_release_candidates(id,org_id,workspace_id) ON DELETE RESTRICT
);
CREATE INDEX pilot_operations_promotion_history_current_idx
  ON public.pilot_operations_promotion_history(environment_id,promotion_ordinal DESC);
CREATE TRIGGER pilot_operations_promotion_history_immutable BEFORE UPDATE OR DELETE
  ON public.pilot_operations_promotion_history FOR EACH ROW EXECUTE FUNCTION public.pilot_operations_immutable();
ALTER TABLE public.pilot_operations_promotion_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pilot_operations_promotion_sequences FORCE ROW LEVEL SECURITY;
ALTER TABLE public.pilot_operations_promotion_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pilot_operations_promotion_history FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.pilot_operations_promotion_sequences,public.pilot_operations_promotion_history
  FROM PUBLIC,anon,authenticated;

-- A single legacy promotion is provable. Multiple timestamp/UUID-ordered promotions
-- are not, so retain them unchanged and fail closed instead of inventing order.
INSERT INTO public.pilot_operations_promotion_sequences(environment_id,org_id,workspace_id,next_ordinal,legacy_ambiguous)
SELECT c.environment_id,e.org_id,e.workspace_id,
       CASE WHEN count(*)=1 THEN 2 ELSE 1 END,
       count(*)>1
FROM public.pilot_operations_release_events e
JOIN public.pilot_operations_release_candidates c ON c.id=e.candidate_id
WHERE e.event_type='promoted_non_live'
GROUP BY c.environment_id,e.org_id,e.workspace_id;
INSERT INTO public.pilot_operations_promotion_history(environment_id,org_id,workspace_id,promotion_ordinal,release_event_id,candidate_id)
SELECT c.environment_id,e.org_id,e.workspace_id,1,e.id,e.candidate_id
FROM public.pilot_operations_release_events e
JOIN public.pilot_operations_release_candidates c ON c.id=e.candidate_id
JOIN public.pilot_operations_promotion_sequences s ON s.environment_id=c.environment_id
WHERE e.event_type='promoted_non_live' AND NOT s.legacy_ambiguous;

CREATE FUNCTION public.pilot_operations_record_promotion(
  p_environment uuid,p_org uuid,p_workspace uuid,p_event uuid,p_candidate uuid
) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE env public.pilot_operations_environments; seq public.pilot_operations_promotion_sequences; allocated bigint;
BEGIN
  SELECT * INTO env FROM public.pilot_operations_environments
   WHERE id=p_environment AND org_id=p_org AND workspace_id=p_workspace FOR UPDATE;
  IF env.id IS NULL THEN RAISE EXCEPTION 'ENVIRONMENT_BLOCKED'; END IF;
  INSERT INTO public.pilot_operations_promotion_sequences(environment_id,org_id,workspace_id)
   VALUES(p_environment,p_org,p_workspace) ON CONFLICT(environment_id) DO NOTHING;
  SELECT * INTO seq FROM public.pilot_operations_promotion_sequences
   WHERE environment_id=p_environment FOR UPDATE;
  IF seq.legacy_ambiguous THEN RAISE EXCEPTION 'AMBIGUOUS_PROMOTION_HISTORY'; END IF;
  allocated:=seq.next_ordinal;
  INSERT INTO public.pilot_operations_promotion_history
   (environment_id,org_id,workspace_id,promotion_ordinal,release_event_id,candidate_id)
   VALUES(p_environment,p_org,p_workspace,allocated,p_event,p_candidate);
  UPDATE public.pilot_operations_promotion_sequences SET next_ordinal=allocated+1
   WHERE environment_id=p_environment;
  RETURN allocated;
END$$;
REVOKE ALL ON FUNCTION public.pilot_operations_record_promotion(uuid,uuid,uuid,uuid,uuid)
  FROM PUBLIC,anon,authenticated,service_role;

ALTER FUNCTION public.pilot_operations_command(uuid,uuid,uuid,text,uuid,text,text,bigint,bigint,jsonb)
  RENAME TO pilot_operations_command_v5;
REVOKE ALL ON FUNCTION public.pilot_operations_command_v5(uuid,uuid,uuid,text,uuid,text,text,bigint,bigint,jsonb)
  FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.pilot_operations_command(
  p_actor uuid,p_org uuid,p_workspace uuid,p_operation text,p_request uuid,p_idempotency_key text,
  p_request_payload text,p_authorization_version bigint,p_expected_version bigint,p_payload jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE env public.pilot_operations_environments; tenant public.pilot_operations_tenants;
 current_candidate public.pilot_operations_release_candidates; target_candidate public.pilot_operations_release_candidates;
 prior public.pilot_operations_command_receipts; receipt public.pilot_operations_command_receipts;
 current_history public.pilot_operations_promotion_history; target_history public.pilot_operations_promotion_history;
 promoted_actor uuid; request_digest text; response jsonb; event_id uuid; event_count bigint;
BEGIN
 IF p_operation NOT IN('simulate_promotion','rollback_non_live_promotion') THEN
   RETURN public.pilot_operations_command_v5(p_actor,p_org,p_workspace,p_operation,p_request,p_idempotency_key,p_request_payload,p_authorization_version,p_expected_version,p_payload);
 END IF;
 PERFORM public.pr1b_assert_command_authority(p_actor,p_org,p_workspace,'release.promote',p_authorization_version);
 SELECT * INTO tenant FROM public.pilot_operations_tenants WHERE org_id=p_org AND workspace_id=p_workspace FOR UPDATE;
 IF tenant.id IS NOT NULL AND tenant.lifecycle='deprovisioned' THEN RAISE EXCEPTION 'TENANT_DEPROVISIONED'; END IF;
 request_digest:=encode(public.digest(convert_to(p_request_payload,'UTF8'),'sha256'),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended(p_org::text||':'||p_workspace::text||':'||p_operation||':'||p_idempotency_key,0));
 SELECT * INTO prior FROM public.pilot_operations_command_receipts WHERE org_id=p_org AND workspace_id=p_workspace AND operation=p_operation AND idempotency_key=p_idempotency_key;
 IF FOUND THEN
   IF prior.actor_id IS DISTINCT FROM p_actor OR prior.request_hash IS DISTINCT FROM request_digest THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF;
   RETURN prior.response_body;
 END IF;
 IF p_expected_version IS NULL THEN RAISE EXCEPTION 'EXPECTED_VERSION_REQUIRED'; END IF;
 SELECT * INTO env FROM public.pilot_operations_environments
  WHERE id=CASE WHEN p_operation='simulate_promotion' THEN
    (SELECT environment_id FROM public.pilot_operations_release_candidates
      WHERE id=(p_payload->>'candidateId')::uuid AND org_id=p_org AND workspace_id=p_workspace)
    ELSE (p_payload->>'environmentId')::uuid END
    AND org_id=p_org AND workspace_id=p_workspace FOR UPDATE;
 IF env.id IS NULL OR env.lifecycle='deactivated' THEN RAISE EXCEPTION 'ENVIRONMENT_BLOCKED'; END IF;
 IF EXISTS(SELECT 1 FROM public.pilot_operations_promotion_sequences WHERE environment_id=env.id AND legacy_ambiguous) THEN RAISE EXCEPTION 'AMBIGUOUS_PROMOTION_HISTORY'; END IF;
 IF env.maintenance THEN RAISE EXCEPTION 'MAINTENANCE_MODE'; END IF;
 IF env.read_only THEN RAISE EXCEPTION 'READ_ONLY_MODE'; END IF;
 IF env.disabled_features ? 'release' THEN RAISE EXCEPTION 'FEATURE_DISABLED'; END IF;
 IF p_operation='simulate_promotion' THEN
   response:=public.pilot_operations_command_v5(p_actor,p_org,p_workspace,p_operation,p_request,p_idempotency_key,p_request_payload,p_authorization_version,p_expected_version,p_payload);
   SELECT (array_agg(e.id))[1],count(*) INTO event_id,event_count FROM public.pilot_operations_release_events e
    LEFT JOIN public.pilot_operations_promotion_history h ON h.release_event_id=e.id
    WHERE e.org_id=p_org AND e.workspace_id=p_workspace AND e.candidate_id=(p_payload->>'candidateId')::uuid
      AND e.event_type='promoted_non_live' AND h.release_event_id IS NULL;
   IF event_count IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'PROMOTION_HISTORY_NOT_RECORDED'; END IF;
   PERFORM public.pilot_operations_record_promotion(env.id,p_org,p_workspace,event_id,(p_payload->>'candidateId')::uuid);
   RETURN response;
 END IF;
 SELECT * INTO current_history FROM public.pilot_operations_promotion_history WHERE environment_id=env.id ORDER BY promotion_ordinal DESC LIMIT 1;
 SELECT * INTO target_history FROM public.pilot_operations_promotion_history WHERE environment_id=env.id AND promotion_ordinal<current_history.promotion_ordinal ORDER BY promotion_ordinal DESC LIMIT 1;
 SELECT * INTO current_candidate FROM public.pilot_operations_release_candidates WHERE id=current_history.candidate_id FOR UPDATE;
 SELECT * INTO target_candidate FROM public.pilot_operations_release_candidates WHERE id=target_history.candidate_id FOR UPDATE;
 IF current_candidate.id IS NULL OR current_candidate.id IS DISTINCT FROM (p_payload->>'candidateId')::uuid OR target_candidate.id IS NULL OR target_candidate.id IS DISTINCT FROM (p_payload->>'rollbackTargetCandidateId')::uuid THEN RAISE EXCEPTION 'ROLLBACK_NOT_ELIGIBLE'; END IF;
 IF current_candidate.version IS DISTINCT FROM p_expected_version OR target_candidate.version IS DISTINCT FROM (p_payload->>'rollbackTargetVersion')::bigint THEN RAISE EXCEPTION 'VERSION_CONFLICT'; END IF;
 SELECT e.actor_id INTO promoted_actor FROM public.pilot_operations_promotion_history h JOIN public.pilot_operations_release_events e ON e.id=h.release_event_id WHERE h.environment_id=env.id AND h.promotion_ordinal=current_history.promotion_ordinal;
 IF promoted_actor IS NOT NULL AND promoted_actor=p_actor THEN RAISE EXCEPTION 'SEPARATION_OF_DUTY_REQUIRED'; END IF;
 UPDATE public.pilot_operations_release_candidates SET lifecycle='superseded',version=version+1 WHERE id=current_candidate.id;
 UPDATE public.pilot_operations_release_candidates SET lifecycle='promoted_non_live',version=version+1 WHERE id=target_candidate.id RETURNING * INTO target_candidate;
 INSERT INTO public.pilot_operations_release_events(org_id,workspace_id,candidate_id,event_type,candidate_version,candidate_hash,actor_id,authorization_version,metadata)
  VALUES(p_org,p_workspace,current_candidate.id,'superseded',current_candidate.version+1,encode(public.digest(convert_to(current_candidate::text,'UTF8'),'sha256'),'hex'),p_actor,p_authorization_version,jsonb_build_object('reason','non_live_rollback','targetCandidateId',target_candidate.id));
 INSERT INTO public.pilot_operations_release_events(org_id,workspace_id,candidate_id,event_type,candidate_version,candidate_hash,actor_id,authorization_version,metadata)
  VALUES(p_org,p_workspace,target_candidate.id,'promoted_non_live',target_candidate.version,encode(public.digest(convert_to(target_candidate::text,'UTF8'),'sha256'),'hex'),p_actor,p_authorization_version,jsonb_build_object('reason','non_live_rollback','fromCandidateId',current_candidate.id)) RETURNING id INTO event_id;
 PERFORM public.pilot_operations_record_promotion(env.id,p_org,p_workspace,event_id,target_candidate.id);
 INSERT INTO public.pilot_operations_rollback_events(org_id,workspace_id,environment_id,from_candidate_id,target_candidate_id,from_version,target_version,actor_id,authorization_version,request_id) VALUES(p_org,p_workspace,env.id,current_candidate.id,target_candidate.id,current_candidate.version,target_candidate.version,p_actor,p_authorization_version,p_request);
 response:=jsonb_build_object('resourceId',target_candidate.id,'version',target_candidate.version,'lifecycle','promoted_non_live','rollback','non_live_supersession','liveActivationAuthorized',false);
 INSERT INTO public.pilot_operations_command_receipts(org_id,workspace_id,actor_id,operation,idempotency_key,initial_request_id,request_hash,status,response_body,resource_id) VALUES(p_org,p_workspace,p_actor,p_operation,p_idempotency_key,p_request,request_digest,'committed',response,target_candidate.id) RETURNING * INTO receipt;
 INSERT INTO public.pilot_operations_audit_events(org_id,workspace_id,actor_id,action,resource_id,receipt_id,result,metadata) VALUES(p_org,p_workspace,p_actor,p_operation,target_candidate.id,receipt.id,'committed',jsonb_build_object('nonLive',true,'historyPreserved',true,'serializedPromotion',true));
 RETURN response;
END$$;
REVOKE ALL ON FUNCTION public.pilot_operations_command(uuid,uuid,uuid,text,uuid,text,text,bigint,bigint,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pilot_operations_command(uuid,uuid,uuid,text,uuid,text,text,bigint,bigint,jsonb) TO service_role;

-- Projection uses the accepted sanitized read model with serialized history.
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


-- Safe fallback: maintenance/read-only or release disablement; preserve immutable history and forward-fix only.
