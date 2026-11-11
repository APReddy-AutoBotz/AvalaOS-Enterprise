-- Workstream 6 authority correction. Additive/forward-safe and non-live only.
-- A later, separately approved mechanism may ingest independently executed evidence;
-- this migration cannot activate or address a hosted environment.
ALTER TABLE public.pilot_operations_environments
  ADD COLUMN disabled_features jsonb NOT NULL DEFAULT '[]'::jsonb
  CHECK (jsonb_typeof(disabled_features) = 'array');

ALTER TABLE public.pilot_operations_release_candidates
  ADD COLUMN environment_id uuid,
  ADD CONSTRAINT pilot_operations_candidate_environment_fk
    FOREIGN KEY (environment_id, org_id, workspace_id)
    REFERENCES public.pilot_operations_environments(id, org_id, workspace_id) ON DELETE RESTRICT;

CREATE TABLE public.pilot_operations_evidence_manifests (
  candidate_id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  git_sha text NOT NULL CHECK (git_sha ~ '^[0-9a-f]{40}$'),
  build_identity text NOT NULL CHECK (length(btrim(build_identity)) BETWEEN 1 AND 200),
  workflow_name text NOT NULL CHECK (length(btrim(workflow_name)) BETWEEN 1 AND 200),
  workflow_run_id text NOT NULL CHECK (workflow_run_id ~ '^[1-9][0-9]*$'),
  workflow_head_sha text NOT NULL CHECK (workflow_head_sha ~ '^[0-9a-f]{40}$'),
  manifest_sha256 text NOT NULL CHECK (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  schema_version text NOT NULL CHECK (length(btrim(schema_version)) BETWEEN 1 AND 120),
  migration_compatible boolean NOT NULL,
  required_gates jsonb NOT NULL CHECK (jsonb_typeof(required_gates) = 'object'),
  status text NOT NULL CHECK (status IN ('verified', 'rejected', 'superseded')),
  verified_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (candidate_id, org_id, workspace_id)
    REFERENCES public.pilot_operations_release_candidates(id, org_id, workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY (environment_id, org_id, workspace_id)
    REFERENCES public.pilot_operations_environments(id, org_id, workspace_id) ON DELETE RESTRICT
);
COMMENT ON TABLE public.pilot_operations_evidence_manifests IS
  'Authoritative exact-head gate results ingested server-side from independently executed non-live workflows; never caller assertions.';

CREATE TRIGGER pilot_operations_evidence_immutable
  BEFORE UPDATE OR DELETE ON public.pilot_operations_evidence_manifests
  FOR EACH ROW EXECUTE FUNCTION public.pilot_operations_immutable();
REVOKE ALL ON public.pilot_operations_evidence_manifests FROM anon, authenticated;
ALTER TABLE public.pilot_operations_evidence_manifests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pilot_operations_evidence_manifests FORCE ROW LEVEL SECURITY;

-- Retain the accepted implementation for its effect/audit construction and place a
-- serialized, fail-closed authority boundary around it.
ALTER FUNCTION public.pilot_operations_command(uuid,uuid,uuid,text,uuid,text,text,bigint,bigint,jsonb)
  RENAME TO pilot_operations_command_v1;
REVOKE ALL ON FUNCTION public.pilot_operations_command_v1(uuid,uuid,uuid,text,uuid,text,text,bigint,bigint,jsonb)
  FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.pilot_operations_command(
  p_actor uuid,p_org uuid,p_workspace uuid,p_operation text,p_request uuid,
  p_idempotency_key text,p_request_payload text,p_authorization_version bigint,
  p_expected_version bigint,p_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  prior public.pilot_operations_command_receipts;
  tenant public.pilot_operations_tenants;
  env public.pilot_operations_environments;
  candidate public.pilot_operations_release_candidates;
  evidence public.pilot_operations_evidence_manifests;
  request_digest text;
  required_capability text;
  feature_name text;
  result jsonb;
BEGIN
  required_capability := CASE
    WHEN p_operation='approve_promotion' THEN 'release.approve'
    WHEN p_operation='simulate_promotion' THEN 'release.promote'
    WHEN p_operation='validate_release_candidate' THEN 'release.validate'
    WHEN p_operation IN('register_release_candidate','supersede_release_candidate') THEN 'release.manage'
    WHEN p_operation='bind_provider_reference' THEN 'byok.manage'
    WHEN p_operation IN('bootstrap_tenant','deprovision_tenant','reactivate_tenant') THEN 'org.admin'
    ELSE 'operations.manage' END;
  PERFORM public.pr1b_assert_command_authority(
    p_actor,p_org,p_workspace,required_capability,p_authorization_version);

  -- Serialize before receipt lookup or any effect. The lock deliberately excludes
  -- actor so a key has one canonical meaning for a command in a tenant/workspace.
  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_org::text || ':' || p_workspace::text || ':' || p_operation || ':' || p_idempotency_key, 0));
  request_digest := encode(public.digest(convert_to(p_request_payload,'UTF8'),'sha256'),'hex');
  SELECT * INTO prior FROM public.pilot_operations_command_receipts
   WHERE org_id=p_org AND workspace_id=p_workspace AND operation=p_operation
     AND idempotency_key=p_idempotency_key;
  IF FOUND THEN
    IF prior.actor_id IS DISTINCT FROM p_actor OR prior.request_hash IS DISTINCT FROM request_digest THEN
      RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';
    END IF;
    RETURN prior.response_body;
  END IF;

  IF p_expected_version IS NULL THEN RAISE EXCEPTION 'EXPECTED_VERSION_REQUIRED'; END IF;

  IF p_operation IN ('register_environment','register_release_candidate','record_recovery_drill')
     AND p_expected_version IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'VERSION_CONFLICT';
  END IF;

  SELECT * INTO tenant FROM public.pilot_operations_tenants
   WHERE org_id=p_org AND workspace_id=p_workspace FOR UPDATE;
  IF tenant.id IS NOT NULL AND tenant.lifecycle='deprovisioned'
     AND p_operation <> 'reactivate_tenant' THEN
    RAISE EXCEPTION 'TENANT_DEPROVISIONED';
  END IF;

  IF p_operation IN('validate_release_candidate','approve_promotion','simulate_promotion','supersede_release_candidate') THEN
    SELECT * INTO candidate FROM public.pilot_operations_release_candidates
     WHERE id=(p_payload->>'candidateId')::uuid AND org_id=p_org AND workspace_id=p_workspace FOR UPDATE;
    IF candidate.id IS NULL THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
    IF candidate.version IS DISTINCT FROM p_expected_version THEN RAISE EXCEPTION 'VERSION_CONFLICT'; END IF;
    SELECT * INTO env FROM public.pilot_operations_environments WHERE id=candidate.environment_id FOR UPDATE;
  ELSIF p_operation='register_release_candidate' THEN
    SELECT * INTO env FROM public.pilot_operations_environments
     WHERE id=(p_payload->>'environmentId')::uuid AND org_id=p_org AND workspace_id=p_workspace FOR UPDATE;
    IF env.id IS NULL THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
  ELSIF p_payload ? 'environmentId' THEN
    SELECT * INTO env FROM public.pilot_operations_environments
     WHERE id=(p_payload->>'environmentId')::uuid AND org_id=p_org AND workspace_id=p_workspace FOR UPDATE;
  ELSIF tenant.id IS NOT NULL THEN
    SELECT * INTO env FROM public.pilot_operations_environments WHERE id=tenant.environment_id FOR UPDATE;
  END IF;

  IF p_operation='bind_provider_reference' THEN
    PERFORM 1 FROM public.pilot_operations_provider_bindings
     WHERE environment_id=env.id AND purpose=p_payload->>'purpose'
       AND version IS DISTINCT FROM p_expected_version;
    IF FOUND THEN RAISE EXCEPTION 'VERSION_CONFLICT'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.pilot_operations_provider_bindings
                    WHERE environment_id=env.id AND purpose=p_payload->>'purpose')
       AND p_expected_version IS DISTINCT FROM 0 THEN
      RAISE EXCEPTION 'VERSION_CONFLICT';
    END IF;
  ELSIF p_operation='bootstrap_tenant' THEN
    IF tenant.id IS NULL AND p_expected_version IS DISTINCT FROM 0 THEN
      RAISE EXCEPTION 'VERSION_CONFLICT';
    ELSIF tenant.id IS NOT NULL AND tenant.version IS DISTINCT FROM p_expected_version THEN
      RAISE EXCEPTION 'VERSION_CONFLICT';
    END IF;
  END IF;

  IF p_operation NOT IN('register_environment','set_runtime_control','deprovision_tenant','reactivate_tenant') THEN
    IF env.id IS NULL OR env.lifecycle='deactivated' THEN RAISE EXCEPTION 'ENVIRONMENT_BLOCKED'; END IF;
    IF env.maintenance THEN RAISE EXCEPTION 'MAINTENANCE_MODE'; END IF;
    IF env.read_only THEN RAISE EXCEPTION 'READ_ONLY_MODE'; END IF;
    feature_name := CASE
      WHEN p_operation LIKE '%release_candidate' OR p_operation IN('approve_promotion','simulate_promotion') THEN 'release'
      WHEN p_operation='bind_provider_reference' THEN 'provider'
      WHEN p_operation LIKE '%tenant' THEN 'bootstrap'
      WHEN p_operation='record_recovery_drill' THEN 'recovery'
      ELSE 'control_plane' END;
    IF env.disabled_features ? feature_name THEN RAISE EXCEPTION 'FEATURE_DISABLED'; END IF;
  END IF;

  IF p_operation='validate_release_candidate' THEN
    SELECT * INTO evidence FROM public.pilot_operations_evidence_manifests
     WHERE candidate_id=candidate.id AND org_id=p_org AND workspace_id=p_workspace;
    IF evidence.candidate_id IS NULL OR evidence.status<>'verified' OR NOT evidence.migration_compatible
       OR evidence.workflow_name IS DISTINCT FROM 'Pilot Operations'
       OR evidence.environment_id IS DISTINCT FROM candidate.environment_id
       OR evidence.git_sha IS DISTINCT FROM candidate.git_sha
       OR evidence.workflow_head_sha IS DISTINCT FROM candidate.git_sha
       OR evidence.build_identity IS DISTINCT FROM candidate.build_identity
       OR evidence.manifest_sha256 IS DISTINCT FROM candidate.evidence_manifest_sha256
       OR evidence.schema_version IS DISTINCT FROM candidate.schema_version
       OR evidence.schema_version IS DISTINCT FROM env.expected_schema_version
       OR NOT (evidence.required_gates ?& ARRAY[
         'retained-authority','operations-source','postgres-fresh-upgrade','tenant-adversarial',
         'backup-restore-recovery','maintenance-rollback','browser-desktop','browser-pixel7',
         'accessibility-performance','security-hygiene'])
       OR EXISTS (SELECT 1 FROM jsonb_each(evidence.required_gates) gate WHERE gate.value IS DISTINCT FROM 'true'::jsonb)
       OR NOT EXISTS (SELECT 1 FROM jsonb_each(evidence.required_gates)) THEN
      RAISE EXCEPTION 'EVIDENCE_NOT_VERIFIED';
    END IF;
  END IF;

  -- Bind every newly registered candidate to the environment selected above.
  result := public.pilot_operations_command_v1(
    p_actor,p_org,p_workspace,p_operation,p_request,p_idempotency_key,p_request_payload,
    p_authorization_version,p_expected_version,p_payload);
  IF p_operation='register_release_candidate' THEN
    UPDATE public.pilot_operations_release_candidates SET environment_id=env.id
     WHERE id=(result->>'resourceId')::uuid AND environment_id IS NULL;
  ELSIF p_operation='set_runtime_control' AND p_payload ? 'disabledFeatures' THEN
    IF jsonb_typeof(p_payload->'disabledFeatures')<>'array'
       OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(p_payload->'disabledFeatures') f
                  WHERE f NOT IN ('release','provider','bootstrap','recovery','control_plane')) THEN
      RAISE EXCEPTION 'VALIDATION_FAILED';
    END IF;
    UPDATE public.pilot_operations_environments
       SET disabled_features=p_payload->'disabledFeatures'
     WHERE id=(p_payload->>'environmentId')::uuid AND org_id=p_org AND workspace_id=p_workspace;
  END IF;
  RETURN result;
END$$;

REVOKE ALL ON FUNCTION public.pilot_operations_command_v1(uuid,uuid,uuid,text,uuid,text,text,bigint,bigint,jsonb)
  FROM service_role;
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
  binding public.pilot_operations_provider_bindings;
  tenant public.pilot_operations_tenants;
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
  SELECT * INTO candidate FROM public.pilot_operations_release_candidates
   WHERE org_id=p_org AND workspace_id=p_workspace AND environment_id=env.id
   ORDER BY created_at DESC LIMIT 1;
  SELECT * INTO binding FROM public.pilot_operations_provider_bindings
   WHERE org_id=p_org AND workspace_id=p_workspace AND environment_id=env.id
   ORDER BY created_at DESC LIMIT 1;
  RETURN jsonb_build_object(
    'truthClassification','configured_not_live_verified','liveActivationAuthorized',false,
    'environment',CASE WHEN env.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id',env.id,'type',env.environment_type,'lifecycle',env.lifecycle,'version',env.version,
      'maintenance',env.maintenance,'readOnly',env.read_only,'disabledFeatures',env.disabled_features) END,
    'release',CASE WHEN candidate.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id',candidate.id,'gitSha',candidate.git_sha,'lifecycle',candidate.lifecycle,'version',candidate.version) END,
    'provider',CASE WHEN binding.id IS NULL THEN NULL ELSE jsonb_build_object(
      'configured',binding.configured,'enabled',binding.enabled,'purpose',binding.purpose) END,
    'blockers',jsonb_build_array('LIVE_ACTIVATION_NOT_AUTHORIZED','HOSTED_LIVE_NOT_PROVEN'));
END$$;
REVOKE ALL ON FUNCTION public.pilot_operations_projection(uuid,uuid,uuid,bigint)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pilot_operations_projection(uuid,uuid,uuid,bigint) TO service_role;

-- Rollback/fallback: disable the Edge feature and retain immutable authority/evidence
-- read-only. Correct only with another additive migration. Hosted activation remains
-- LIVE_ACTIVATION_NOT_AUTHORIZED.
