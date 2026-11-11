-- Workstream 6 authority/truth closure. Additive, disposable/non-live only.
-- LIVE_ACTIVATION_NOT_AUTHORIZED remains the permanent hosted activation stop gate.
ALTER TABLE public.pilot_operations_recovery_drills
  ADD COLUMN workflow_name text,
  ADD COLUMN workflow_run_id text,
  ADD COLUMN workflow_head_sha text,
  ADD COLUMN artifact_sha256 text;

CREATE TABLE public.pilot_operations_recovery_evidence_ingestions (
  recovery_drill_id uuid PRIMARY KEY REFERENCES public.pilot_operations_recovery_drills(id) ON DELETE RESTRICT,
  org_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  workflow_name text NOT NULL CHECK (length(btrim(workflow_name)) BETWEEN 1 AND 200),
  workflow_run_id text NOT NULL CHECK (workflow_run_id ~ '^[1-9][0-9]*$'),
  workflow_head_sha text NOT NULL CHECK (workflow_head_sha ~ '^[0-9a-f]{40}$'),
  artifact_sha256 text NOT NULL CHECK (artifact_sha256 ~ '^[0-9a-f]{64}$'),
  evidence_sha256 text NOT NULL CHECK (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  schema_version text NOT NULL CHECK (length(btrim(schema_version)) BETWEEN 1 AND 120),
  ingested_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workflow_name,workflow_run_id,workflow_head_sha,artifact_sha256),
  FOREIGN KEY(environment_id,org_id,workspace_id)
    REFERENCES public.pilot_operations_environments(id,org_id,workspace_id) ON DELETE RESTRICT
);
CREATE TRIGGER pilot_operations_recovery_ingestion_immutable
  BEFORE UPDATE OR DELETE ON public.pilot_operations_recovery_evidence_ingestions
  FOR EACH ROW EXECUTE FUNCTION public.pilot_operations_immutable();
ALTER TABLE public.pilot_operations_recovery_evidence_ingestions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pilot_operations_recovery_evidence_ingestions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.pilot_operations_recovery_evidence_ingestions FROM PUBLIC,anon,authenticated;

CREATE TABLE public.pilot_operations_tenant_rebind_results (
  org_id uuid NOT NULL, workspace_id uuid NOT NULL, idempotency_key text NOT NULL,
  request_hash text NOT NULL CHECK(request_hash ~ '^[0-9a-f]{64}$'),
  response_body jsonb NOT NULL CHECK(jsonb_typeof(response_body)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(org_id,workspace_id,idempotency_key)
);
CREATE TRIGGER pilot_operations_rebind_results_immutable
  BEFORE UPDATE OR DELETE ON public.pilot_operations_tenant_rebind_results
  FOR EACH ROW EXECUTE FUNCTION public.pilot_operations_immutable();
ALTER TABLE public.pilot_operations_tenant_rebind_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pilot_operations_tenant_rebind_results FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.pilot_operations_tenant_rebind_results FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.pilot_operations_ingest_recovery_evidence(
  p_org uuid,p_workspace uuid,p_environment uuid,p_workflow_name text,p_workflow_run_id text,
  p_workflow_head_sha text,p_artifact_sha256 text,p_evidence_sha256 text,p_schema_version text,p_created_by uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE env public.pilot_operations_environments; drill_id uuid;
BEGIN
  SELECT * INTO env FROM public.pilot_operations_environments
   WHERE id=p_environment AND org_id=p_org AND workspace_id=p_workspace FOR UPDATE;
  IF env.id IS NULL OR env.lifecycle='deactivated' THEN RAISE EXCEPTION 'ENVIRONMENT_BLOCKED'; END IF;
  IF p_workflow_name IS DISTINCT FROM 'Pilot Operations' OR p_workflow_head_sha !~ '^[0-9a-f]{40}$'
     OR p_artifact_sha256 !~ '^[0-9a-f]{64}$' OR p_evidence_sha256 !~ '^[0-9a-f]{64}$'
     OR p_schema_version IS DISTINCT FROM env.expected_schema_version THEN RAISE EXCEPTION 'EVIDENCE_INVALID'; END IF;
  INSERT INTO public.pilot_operations_recovery_drills(
    org_id,workspace_id,environment_id,evidence_sha256,backup_schema_version,result,truth_classification,
    created_by,workflow_name,workflow_run_id,workflow_head_sha,artifact_sha256)
  VALUES(p_org,p_workspace,p_environment,p_evidence_sha256,p_schema_version,'passed',
    'proven_disposable_or_ci_evidence',p_created_by,p_workflow_name,p_workflow_run_id,p_workflow_head_sha,p_artifact_sha256)
  RETURNING id INTO drill_id;
  INSERT INTO public.pilot_operations_recovery_evidence_ingestions VALUES(
    drill_id,p_org,p_workspace,p_environment,p_workflow_name,p_workflow_run_id,p_workflow_head_sha,
    p_artifact_sha256,p_evidence_sha256,p_schema_version,now());
  RETURN jsonb_build_object('resourceId',drill_id,'truthClassification','proven_disposable_or_ci_evidence','liveActivationAuthorized',false);
END$$;
REVOKE ALL ON FUNCTION public.pilot_operations_ingest_recovery_evidence(uuid,uuid,uuid,text,text,text,text,text,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pilot_operations_ingest_recovery_evidence(uuid,uuid,uuid,text,text,text,text,text,text,uuid) TO service_role;

ALTER FUNCTION public.pilot_operations_command(uuid,uuid,uuid,text,uuid,text,text,bigint,bigint,jsonb)
  RENAME TO pilot_operations_command_v2;
REVOKE ALL ON FUNCTION public.pilot_operations_command_v2(uuid,uuid,uuid,text,uuid,text,text,bigint,bigint,jsonb) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.pilot_operations_command(
  p_actor uuid,p_org uuid,p_workspace uuid,p_operation text,p_request uuid,p_idempotency_key text,
  p_request_payload text,p_authorization_version bigint,p_expected_version bigint,p_payload jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE tenant public.pilot_operations_tenants; config public.ai_provider_configs; key_ref public.ai_provider_key_refs;
  route public.enterprise_ai_capability_routes; result jsonb; prior jsonb; request_digest text; next_version bigint;
  previous_environment uuid; was_rebind boolean:=false;
BEGIN
  request_digest:=encode(public.digest(convert_to(p_request_payload,'UTF8'),'sha256'),'hex');
  IF p_operation='record_recovery_drill' AND p_payload->>'result'='passed' THEN
    RAISE EXCEPTION 'EVIDENCE_NOT_VERIFIED';
  END IF;
  IF p_operation='bind_provider_reference' AND COALESCE((p_payload->>'enabled')::boolean,false) THEN
    SELECT * INTO config FROM public.ai_provider_configs
      WHERE id=(p_payload->>'providerConfigurationId')::uuid AND org_id=p_org
        AND status='active' AND deleted_at IS NULL FOR UPDATE;
    IF config.id IS NULL OR config.key_ref_id IS NULL OR config.last_validated_at IS NULL
       OR config.last_validated_at > statement_timestamp()
       OR config.last_validated_at < statement_timestamp()-interval '24 hours' THEN
      RAISE EXCEPTION 'PROVIDER_REFERENCE_STALE';
    END IF;
    SELECT * INTO key_ref FROM public.ai_provider_key_refs
      WHERE id=config.key_ref_id AND org_id=p_org AND provider=config.provider
        AND status='active' AND deleted_at IS NULL FOR UPDATE;
    SELECT * INTO route FROM public.enterprise_ai_capability_routes
      WHERE provider_config_id=config.id AND org_id=p_org AND workspace_id=p_workspace
        AND enabled AND deleted_at IS NULL ORDER BY id LIMIT 1 FOR UPDATE;
    IF key_ref.id IS NULL OR route.id IS NULL THEN RAISE EXCEPTION 'PROVIDER_REFERENCE_INVALID'; END IF;
  END IF;
  IF p_operation='bootstrap_tenant' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(p_org::text||':'||p_workspace::text||':bootstrap_tenant:'||p_idempotency_key,0));
    SELECT response_body INTO prior FROM public.pilot_operations_tenant_rebind_results
      WHERE org_id=p_org AND workspace_id=p_workspace AND idempotency_key=p_idempotency_key AND request_hash=request_digest;
    IF prior IS NOT NULL THEN RETURN prior; END IF;
    IF EXISTS(SELECT 1 FROM public.pilot_operations_tenant_rebind_results WHERE org_id=p_org AND workspace_id=p_workspace AND idempotency_key=p_idempotency_key)
      THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF;
    SELECT * INTO tenant FROM public.pilot_operations_tenants WHERE org_id=p_org AND workspace_id=p_workspace FOR UPDATE;
    previous_environment:=tenant.environment_id;
    was_rebind:=tenant.id IS NOT NULL AND tenant.lifecycle='active' AND previous_environment IS DISTINCT FROM (p_payload->>'environmentId')::uuid;
    IF tenant.id IS NOT NULL AND tenant.lifecycle='active' AND tenant.environment_id IS DISTINCT FROM (p_payload->>'environmentId')::uuid
       AND tenant.version IS DISTINCT FROM p_expected_version THEN RAISE EXCEPTION 'VERSION_CONFLICT'; END IF;
  END IF;
  result:=public.pilot_operations_command_v2(p_actor,p_org,p_workspace,p_operation,p_request,p_idempotency_key,
    p_request_payload,p_authorization_version,p_expected_version,p_payload);
  IF p_operation='bootstrap_tenant' THEN
    SELECT * INTO tenant FROM public.pilot_operations_tenants WHERE org_id=p_org AND workspace_id=p_workspace FOR UPDATE;
    IF was_rebind THEN
      UPDATE public.pilot_operations_tenants SET version=version+1,updated_at=now()
       WHERE id=tenant.id RETURNING version INTO next_version;
    ELSE next_version:=tenant.version; END IF;
    result:=result||jsonb_build_object('version',next_version);
    INSERT INTO public.pilot_operations_tenant_rebind_results(org_id,workspace_id,idempotency_key,request_hash,response_body)
      VALUES(p_org,p_workspace,p_idempotency_key,request_digest,result);
  END IF;
  RETURN result;
END$$;
REVOKE ALL ON FUNCTION public.pilot_operations_command_v2(uuid,uuid,uuid,text,uuid,text,text,bigint,bigint,jsonb) FROM service_role;
REVOKE ALL ON FUNCTION public.pilot_operations_command(uuid,uuid,uuid,text,uuid,text,text,bigint,bigint,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pilot_operations_command(uuid,uuid,uuid,text,uuid,text,text,bigint,bigint,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.pilot_operations_projection(p_actor uuid,p_org uuid,p_workspace uuid,p_authorization_version bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE env public.pilot_operations_environments; candidate public.pilot_operations_release_candidates; binding public.pilot_operations_provider_bindings; tenant public.pilot_operations_tenants; non_live_blockers jsonb:='[]'::jsonb;
BEGIN
  PERFORM public.pr1b_assert_command_authority(p_actor,p_org,p_workspace,'operations.read',p_authorization_version);
  SELECT * INTO tenant FROM public.pilot_operations_tenants WHERE org_id=p_org AND workspace_id=p_workspace;
  IF tenant.id IS NOT NULL AND tenant.lifecycle='deprovisioned' THEN RAISE EXCEPTION 'TENANT_DEPROVISIONED'; END IF;
  SELECT * INTO env FROM public.pilot_operations_environments WHERE org_id=p_org AND workspace_id=p_workspace AND environment_type='pilot_candidate';
  SELECT * INTO candidate FROM public.pilot_operations_release_candidates WHERE org_id=p_org AND workspace_id=p_workspace AND environment_id=env.id ORDER BY created_at DESC LIMIT 1;
  SELECT * INTO binding FROM public.pilot_operations_provider_bindings WHERE org_id=p_org AND workspace_id=p_workspace AND environment_id=env.id ORDER BY created_at DESC LIMIT 1;
  IF candidate.id IS NULL OR candidate.lifecycle<>'approved_for_pilot_promotion' THEN non_live_blockers:=non_live_blockers||'"CANDIDATE_NOT_APPROVED"'::jsonb; END IF;
  IF env.maintenance THEN non_live_blockers:=non_live_blockers||'"MAINTENANCE_MODE"'::jsonb; END IF;
  IF env.read_only THEN non_live_blockers:=non_live_blockers||'"READ_ONLY_MODE"'::jsonb; END IF;
  RETURN jsonb_build_object('truthClassification','configured_not_live_verified','liveActivationAuthorized',false,
    'environment',jsonb_build_object('id',env.id,'type',env.environment_type,'lifecycle',env.lifecycle,'version',env.version,'maintenance',env.maintenance,'readOnly',env.read_only,'disabledFeatures',env.disabled_features),
    'release',jsonb_build_object('id',candidate.id,'gitSha',candidate.git_sha,'lifecycle',candidate.lifecycle,'version',candidate.version),
    'provider',CASE WHEN binding.id IS NULL THEN NULL ELSE jsonb_build_object('configured',binding.configured,'enabled',binding.enabled,'purpose',binding.purpose) END,
    'blockers',non_live_blockers,'liveStopGates',jsonb_build_array('LIVE_ACTIVATION_NOT_AUTHORIZED','HOSTED_LIVE_NOT_PROVEN'));
END$$;
REVOKE ALL ON FUNCTION public.pilot_operations_projection(uuid,uuid,uuid,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pilot_operations_projection(uuid,uuid,uuid,bigint) TO service_role;

-- Rollback/fallback: disable the Edge feature and retain all immutable evidence read-only.
