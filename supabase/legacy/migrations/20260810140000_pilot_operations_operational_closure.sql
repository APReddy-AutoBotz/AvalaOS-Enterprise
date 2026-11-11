-- Workstream 6 operational-control closure. Additive, non-live, and forward-safe.
CREATE TABLE public.pilot_operations_rollback_events(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL, workspace_id uuid NOT NULL,
 environment_id uuid NOT NULL, from_candidate_id uuid NOT NULL, target_candidate_id uuid NOT NULL,
 from_version bigint NOT NULL, target_version bigint NOT NULL, actor_id uuid NOT NULL REFERENCES public.profiles(id),
 authorization_version bigint NOT NULL, request_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(environment_id,org_id,workspace_id) REFERENCES public.pilot_operations_environments(id,org_id,workspace_id) ON DELETE RESTRICT,
 FOREIGN KEY(from_candidate_id,org_id,workspace_id) REFERENCES public.pilot_operations_release_candidates(id,org_id,workspace_id) ON DELETE RESTRICT,
 FOREIGN KEY(target_candidate_id,org_id,workspace_id) REFERENCES public.pilot_operations_release_candidates(id,org_id,workspace_id) ON DELETE RESTRICT
);
CREATE TRIGGER pilot_operations_rollback_immutable BEFORE UPDATE OR DELETE ON public.pilot_operations_rollback_events FOR EACH ROW EXECUTE FUNCTION public.pilot_operations_immutable();
ALTER TABLE public.pilot_operations_rollback_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pilot_operations_rollback_events FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.pilot_operations_rollback_events FROM PUBLIC,anon,authenticated;

-- Trusted evidence ingestion obeys the exact environment's current mutation controls.
CREATE OR REPLACE FUNCTION public.pilot_operations_ingest_recovery_evidence(
  p_org uuid,p_workspace uuid,p_environment uuid,p_workflow_name text,p_workflow_run_id text,
  p_workflow_head_sha text,p_artifact_sha256 text,p_evidence_sha256 text,p_schema_version text,p_created_by uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE env public.pilot_operations_environments; drill_id uuid;
BEGIN
 SELECT * INTO env FROM public.pilot_operations_environments WHERE id=p_environment AND org_id=p_org AND workspace_id=p_workspace FOR UPDATE;
 IF env.id IS NULL OR env.lifecycle='deactivated' THEN RAISE EXCEPTION 'ENVIRONMENT_BLOCKED'; END IF;
 IF env.maintenance THEN RAISE EXCEPTION 'MAINTENANCE_MODE'; END IF;
 IF env.read_only THEN RAISE EXCEPTION 'READ_ONLY_MODE'; END IF;
 IF env.disabled_features ? 'recovery' THEN RAISE EXCEPTION 'FEATURE_DISABLED'; END IF;
 IF p_workflow_name IS DISTINCT FROM 'Pilot Operations' OR p_workflow_head_sha !~ '^[0-9a-f]{40}$' OR p_artifact_sha256 !~ '^[0-9a-f]{64}$' OR p_evidence_sha256 !~ '^[0-9a-f]{64}$' OR p_schema_version IS DISTINCT FROM env.expected_schema_version THEN RAISE EXCEPTION 'EVIDENCE_INVALID'; END IF;
 INSERT INTO public.pilot_operations_recovery_drills(org_id,workspace_id,environment_id,evidence_sha256,backup_schema_version,result,truth_classification,created_by,workflow_name,workflow_run_id,workflow_head_sha,artifact_sha256)
 VALUES(p_org,p_workspace,p_environment,p_evidence_sha256,p_schema_version,'passed','proven_disposable_or_ci_evidence',p_created_by,p_workflow_name,p_workflow_run_id,p_workflow_head_sha,p_artifact_sha256) RETURNING id INTO drill_id;
 INSERT INTO public.pilot_operations_recovery_evidence_ingestions VALUES(drill_id,p_org,p_workspace,p_environment,p_workflow_name,p_workflow_run_id,p_workflow_head_sha,p_artifact_sha256,p_evidence_sha256,p_schema_version,now());
 RETURN jsonb_build_object('resourceId',drill_id,'truthClassification','proven_disposable_or_ci_evidence','liveActivationAuthorized',false);
END$$;

ALTER FUNCTION public.pilot_operations_command(uuid,uuid,uuid,text,uuid,text,text,bigint,bigint,jsonb) RENAME TO pilot_operations_command_v3;
REVOKE ALL ON FUNCTION public.pilot_operations_command_v3(uuid,uuid,uuid,text,uuid,text,text,bigint,bigint,jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.pilot_operations_command(p_actor uuid,p_org uuid,p_workspace uuid,p_operation text,p_request uuid,p_idempotency_key text,p_request_payload text,p_authorization_version bigint,p_expected_version bigint,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE env public.pilot_operations_environments; tenant public.pilot_operations_tenants; current_candidate public.pilot_operations_release_candidates; target_candidate public.pilot_operations_release_candidates; prior public.pilot_operations_command_receipts; promoted_actor uuid; request_digest text; response jsonb; receipt public.pilot_operations_command_receipts;
BEGIN
 IF p_operation IS DISTINCT FROM 'rollback_non_live_promotion' THEN RETURN public.pilot_operations_command_v3(p_actor,p_org,p_workspace,p_operation,p_request,p_idempotency_key,p_request_payload,p_authorization_version,p_expected_version,p_payload); END IF;
 PERFORM public.pr1b_assert_command_authority(p_actor,p_org,p_workspace,'release.promote',p_authorization_version);
 SELECT * INTO tenant FROM public.pilot_operations_tenants WHERE org_id=p_org AND workspace_id=p_workspace FOR UPDATE;
 IF tenant.id IS NOT NULL AND tenant.lifecycle='deprovisioned' THEN RAISE EXCEPTION 'TENANT_DEPROVISIONED'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_org::text||':'||p_workspace::text||':'||p_operation||':'||p_idempotency_key,0));
 request_digest:=encode(public.digest(convert_to(p_request_payload,'UTF8'),'sha256'),'hex');
 SELECT * INTO prior FROM public.pilot_operations_command_receipts WHERE org_id=p_org AND workspace_id=p_workspace AND operation=p_operation AND idempotency_key=p_idempotency_key;
 IF FOUND THEN IF prior.actor_id IS DISTINCT FROM p_actor OR prior.request_hash IS DISTINCT FROM request_digest THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF; RETURN prior.response_body; END IF;
 IF p_expected_version IS NULL THEN RAISE EXCEPTION 'EXPECTED_VERSION_REQUIRED'; END IF;
 SELECT * INTO env FROM public.pilot_operations_environments WHERE id=(p_payload->>'environmentId')::uuid AND org_id=p_org AND workspace_id=p_workspace FOR UPDATE;
 IF env.id IS NULL OR env.lifecycle='deactivated' THEN RAISE EXCEPTION 'ENVIRONMENT_BLOCKED'; END IF;
 IF env.maintenance THEN RAISE EXCEPTION 'MAINTENANCE_MODE'; END IF; IF env.read_only THEN RAISE EXCEPTION 'READ_ONLY_MODE'; END IF; IF env.disabled_features ? 'release' THEN RAISE EXCEPTION 'FEATURE_DISABLED'; END IF;
 SELECT * INTO current_candidate FROM public.pilot_operations_release_candidates WHERE id=(p_payload->>'candidateId')::uuid AND environment_id=env.id AND org_id=p_org AND workspace_id=p_workspace FOR UPDATE;
 IF current_candidate.id IS NULL THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
 IF current_candidate.version IS DISTINCT FROM p_expected_version THEN RAISE EXCEPTION 'VERSION_CONFLICT'; END IF;
 SELECT e.actor_id INTO promoted_actor FROM public.pilot_operations_release_events e WHERE e.candidate_id=current_candidate.id AND e.event_type='promoted_non_live' ORDER BY e.created_at DESC,e.id DESC LIMIT 1;
 SELECT c.* INTO target_candidate FROM public.pilot_operations_release_events e JOIN public.pilot_operations_release_candidates c ON c.id=e.candidate_id WHERE e.org_id=p_org AND e.workspace_id=p_workspace AND c.environment_id=env.id AND e.event_type='promoted_non_live' AND c.id<>current_candidate.id ORDER BY e.created_at DESC,e.id DESC LIMIT 1 FOR UPDATE OF c;
 IF current_candidate.lifecycle<>'promoted_non_live' OR target_candidate.id IS NULL OR target_candidate.id IS DISTINCT FROM (p_payload->>'rollbackTargetCandidateId')::uuid THEN RAISE EXCEPTION 'ROLLBACK_NOT_ELIGIBLE'; END IF;
 IF target_candidate.version IS DISTINCT FROM (p_payload->>'rollbackTargetVersion')::bigint THEN RAISE EXCEPTION 'VERSION_CONFLICT'; END IF;
 IF promoted_actor IS NOT NULL AND promoted_actor=p_actor THEN RAISE EXCEPTION 'SEPARATION_OF_DUTY_REQUIRED'; END IF;
 UPDATE public.pilot_operations_release_candidates SET lifecycle='superseded',version=version+1 WHERE id=current_candidate.id;
 UPDATE public.pilot_operations_release_candidates SET lifecycle='promoted_non_live',version=version+1 WHERE id=target_candidate.id RETURNING * INTO target_candidate;
 INSERT INTO public.pilot_operations_release_events(org_id,workspace_id,candidate_id,event_type,candidate_version,candidate_hash,actor_id,authorization_version,metadata) VALUES(p_org,p_workspace,current_candidate.id,'superseded',current_candidate.version+1,encode(public.digest(convert_to(current_candidate::text,'UTF8'),'sha256'),'hex'),p_actor,p_authorization_version,jsonb_build_object('reason','non_live_rollback','targetCandidateId',target_candidate.id));
 INSERT INTO public.pilot_operations_release_events(org_id,workspace_id,candidate_id,event_type,candidate_version,candidate_hash,actor_id,authorization_version,metadata) VALUES(p_org,p_workspace,target_candidate.id,'promoted_non_live',target_candidate.version,encode(public.digest(convert_to(target_candidate::text,'UTF8'),'sha256'),'hex'),p_actor,p_authorization_version,jsonb_build_object('reason','non_live_rollback','fromCandidateId',current_candidate.id));
 INSERT INTO public.pilot_operations_rollback_events(org_id,workspace_id,environment_id,from_candidate_id,target_candidate_id,from_version,target_version,actor_id,authorization_version,request_id) VALUES(p_org,p_workspace,env.id,current_candidate.id,target_candidate.id,current_candidate.version,target_candidate.version,p_actor,p_authorization_version,p_request);
 response:=jsonb_build_object('resourceId',target_candidate.id,'version',target_candidate.version,'lifecycle','promoted_non_live','rollback','non_live_supersession','liveActivationAuthorized',false);
 INSERT INTO public.pilot_operations_command_receipts(org_id,workspace_id,actor_id,operation,idempotency_key,initial_request_id,request_hash,status,response_body,resource_id) VALUES(p_org,p_workspace,p_actor,p_operation,p_idempotency_key,p_request,request_digest,'committed',response,target_candidate.id) RETURNING * INTO receipt;
 INSERT INTO public.pilot_operations_audit_events(org_id,workspace_id,actor_id,action,resource_id,receipt_id,result,metadata) VALUES(p_org,p_workspace,p_actor,p_operation,target_candidate.id,receipt.id,'committed',jsonb_build_object('nonLive',true,'historyPreserved',true));
 RETURN response;
END$$;
REVOKE ALL ON FUNCTION public.pilot_operations_command(uuid,uuid,uuid,text,uuid,text,text,bigint,bigint,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pilot_operations_command(uuid,uuid,uuid,text,uuid,text,text,bigint,bigint,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.pilot_operations_projection(p_actor uuid,p_org uuid,p_workspace uuid,p_authorization_version bigint) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE env public.pilot_operations_environments; candidate public.pilot_operations_release_candidates; target public.pilot_operations_release_candidates; binding public.pilot_operations_provider_bindings; tenant public.pilot_operations_tenants; blockers jsonb:='[]'; rollback_reason text;
BEGIN
 PERFORM public.pr1b_assert_command_authority(p_actor,p_org,p_workspace,'operations.read',p_authorization_version);
 SELECT * INTO tenant FROM public.pilot_operations_tenants WHERE org_id=p_org AND workspace_id=p_workspace; IF tenant.id IS NOT NULL AND tenant.lifecycle='deprovisioned' THEN RAISE EXCEPTION 'TENANT_DEPROVISIONED'; END IF;
 SELECT * INTO env FROM public.pilot_operations_environments WHERE org_id=p_org AND workspace_id=p_workspace AND environment_type='pilot_candidate';
 SELECT c.* INTO candidate FROM public.pilot_operations_release_events e JOIN public.pilot_operations_release_candidates c ON c.id=e.candidate_id WHERE e.org_id=p_org AND e.workspace_id=p_workspace AND c.environment_id=env.id AND c.lifecycle='promoted_non_live' AND e.event_type='promoted_non_live' ORDER BY e.created_at DESC,e.id DESC LIMIT 1;
 IF candidate.id IS NULL THEN SELECT * INTO candidate FROM public.pilot_operations_release_candidates WHERE org_id=p_org AND workspace_id=p_workspace AND environment_id=env.id ORDER BY created_at DESC LIMIT 1; END IF;
 SELECT c.* INTO target FROM public.pilot_operations_release_events e JOIN public.pilot_operations_release_candidates c ON c.id=e.candidate_id WHERE e.org_id=p_org AND e.workspace_id=p_workspace AND c.environment_id=env.id AND e.event_type='promoted_non_live' AND c.id<>candidate.id ORDER BY e.created_at DESC,e.id DESC LIMIT 1;
 SELECT * INTO binding FROM public.pilot_operations_provider_bindings WHERE org_id=p_org AND workspace_id=p_workspace AND environment_id=env.id ORDER BY created_at DESC LIMIT 1;
 IF candidate.id IS NULL OR candidate.lifecycle<>'approved_for_pilot_promotion' THEN blockers:=blockers||'"CANDIDATE_NOT_APPROVED"'; END IF; IF env.maintenance THEN blockers:=blockers||'"MAINTENANCE_MODE"'; END IF; IF env.read_only THEN blockers:=blockers||'"READ_ONLY_MODE"'; END IF; IF env.disabled_features ? 'release' THEN blockers:=blockers||'"FEATURE_DISABLED"'; END IF;
 rollback_reason:=CASE WHEN env.lifecycle='deactivated' THEN 'ENVIRONMENT_BLOCKED' WHEN env.maintenance THEN 'MAINTENANCE_MODE' WHEN env.read_only THEN 'READ_ONLY_MODE' WHEN env.disabled_features ? 'release' THEN 'FEATURE_DISABLED' WHEN candidate.lifecycle<>'promoted_non_live' THEN 'ROLLBACK_CURRENT_NOT_PROMOTED' WHEN target.id IS NULL THEN 'ROLLBACK_PRIOR_CANDIDATE_NOT_FOUND' ELSE NULL END;
 RETURN jsonb_build_object('truthClassification','configured_not_live_verified','liveActivationAuthorized',false,'environment',jsonb_build_object('id',env.id,'type',env.environment_type,'lifecycle',env.lifecycle,'version',env.version,'maintenance',env.maintenance,'readOnly',env.read_only,'disabledFeatures',env.disabled_features),'release',jsonb_build_object('id',candidate.id,'gitSha',candidate.git_sha,'lifecycle',candidate.lifecycle,'version',candidate.version),'provider',CASE WHEN binding.id IS NULL THEN NULL ELSE jsonb_build_object('configured',binding.configured,'enabled',binding.enabled,'purpose',binding.purpose) END,'blockers',blockers,'liveStopGates',jsonb_build_array('LIVE_ACTIVATION_NOT_AUTHORIZED','HOSTED_LIVE_NOT_PROVEN'),'rollback',jsonb_build_object('eligible',rollback_reason IS NULL,'reason',rollback_reason,'targetCandidateId',CASE WHEN rollback_reason IS NULL THEN target.id ELSE NULL END,'targetVersion',CASE WHEN rollback_reason IS NULL THEN target.version ELSE NULL END,'targetLabel',CASE WHEN rollback_reason IS NULL THEN 'Candidate '||left(target.id::text,8) ELSE NULL END));
END$$;
-- Safe fallback: disable Pilot Operations or enter read-only/maintenance; retain all immutable history and forward-fix only.
