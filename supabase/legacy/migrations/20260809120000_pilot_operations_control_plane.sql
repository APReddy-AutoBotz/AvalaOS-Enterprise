-- Workstream 6 non-live pilot operations authority. Additive only; never activates a hosted target.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
INSERT INTO public.capabilities(capability_key,module,description) VALUES
 ('operations.read','admin','Read sanitized pilot operations projections'),('operations.manage','admin','Manage non-live pilot operations controls'),
 ('release.manage','admin','Register and supersede release candidates'),('release.validate','admin','Validate exact release evidence'),
 ('release.approve','admin','Approve an exact validated candidate'),('release.promote','admin','Run a non-live promotion simulation')
ON CONFLICT(capability_key) DO UPDATE SET module=excluded.module,description=excluded.description;

CREATE TABLE public.pilot_operations_environments(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 workspace_id uuid NOT NULL,environment_type text NOT NULL CHECK(environment_type IN('disposable_ci','pilot_candidate')),
 lifecycle text NOT NULL DEFAULT 'configured' CHECK(lifecycle IN('configured','active_non_live','maintenance','deactivated')),
 expected_schema_version text NOT NULL CHECK(length(btrim(expected_schema_version)) BETWEEN 1 AND 120),required_capabilities jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(required_capabilities)='array'),
 maintenance boolean NOT NULL DEFAULT false,read_only boolean NOT NULL DEFAULT true,version bigint NOT NULL DEFAULT 1 CHECK(version>0),
 created_by uuid NOT NULL REFERENCES public.profiles(id),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,org_id,workspace_id),UNIQUE(org_id,workspace_id,environment_type),FOREIGN KEY(workspace_id,org_id) REFERENCES public.workspaces(id,org_id) ON DELETE RESTRICT);
CREATE TABLE public.pilot_operations_release_candidates(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,workspace_id uuid NOT NULL,
 git_sha text NOT NULL CHECK(git_sha~'^[0-9a-f]{40}$'),build_identity text NOT NULL CHECK(length(btrim(build_identity)) BETWEEN 1 AND 200),
 evidence_manifest_sha256 text NOT NULL CHECK(evidence_manifest_sha256~'^[0-9a-f]{64}$'),schema_version text NOT NULL CHECK(length(btrim(schema_version)) BETWEEN 1 AND 120),
 lifecycle text NOT NULL DEFAULT 'draft' CHECK(lifecycle IN('draft','validated','approved_for_pilot_promotion','promoted_non_live','superseded','blocked')),
 version bigint NOT NULL DEFAULT 1 CHECK(version>0),created_by uuid NOT NULL REFERENCES public.profiles(id),created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,org_id,workspace_id),UNIQUE(org_id,workspace_id,git_sha,evidence_manifest_sha256),FOREIGN KEY(workspace_id,org_id) REFERENCES public.workspaces(id,org_id) ON DELETE RESTRICT);
CREATE TABLE public.pilot_operations_release_events(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL,workspace_id uuid NOT NULL,candidate_id uuid NOT NULL,event_type text NOT NULL CHECK(event_type IN('validated','approved','promoted_non_live','superseded','blocked')),
 candidate_version bigint NOT NULL CHECK(candidate_version>0),candidate_hash text NOT NULL CHECK(candidate_hash~'^[0-9a-f]{64}$'),actor_id uuid NOT NULL REFERENCES public.profiles(id),
 authorization_version bigint NOT NULL CHECK(authorization_version>0),metadata jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(metadata)='object' AND pg_column_size(metadata)<=4096),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(candidate_id,org_id,workspace_id) REFERENCES public.pilot_operations_release_candidates(id,org_id,workspace_id) ON DELETE RESTRICT);
CREATE UNIQUE INDEX pilot_operations_one_approval ON public.pilot_operations_release_events(candidate_id,candidate_hash,event_type,actor_id) WHERE event_type='approved';
CREATE TABLE public.pilot_operations_provider_bindings(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL,workspace_id uuid NOT NULL,environment_id uuid NOT NULL,
 provider_configuration_id uuid NOT NULL,purpose text NOT NULL CHECK(purpose IN('assessment','studio','ingestion')),
 configured boolean NOT NULL DEFAULT false,enabled boolean NOT NULL DEFAULT false,version bigint NOT NULL DEFAULT 1,created_by uuid NOT NULL REFERENCES public.profiles(id),created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(environment_id,purpose),FOREIGN KEY(environment_id,org_id,workspace_id) REFERENCES public.pilot_operations_environments(id,org_id,workspace_id) ON DELETE RESTRICT,
 FOREIGN KEY(provider_configuration_id,org_id) REFERENCES public.ai_provider_configs(id,org_id) ON DELETE RESTRICT);
COMMENT ON TABLE public.pilot_operations_provider_bindings IS 'Internal canonical provider FK only. Query projections expose configured/enabled/purpose and never secret reference identifiers.';
CREATE TABLE public.pilot_operations_tenants(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,workspace_id uuid NOT NULL,environment_id uuid NOT NULL,
 lifecycle text NOT NULL DEFAULT 'active' CHECK(lifecycle IN('active','deprovisioned')),version bigint NOT NULL DEFAULT 1,created_by uuid NOT NULL REFERENCES public.profiles(id),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(org_id,workspace_id),FOREIGN KEY(environment_id,org_id,workspace_id) REFERENCES public.pilot_operations_environments(id,org_id,workspace_id) ON DELETE RESTRICT,FOREIGN KEY(workspace_id,org_id) REFERENCES public.workspaces(id,org_id) ON DELETE RESTRICT);
CREATE TABLE public.pilot_operations_recovery_drills(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL,workspace_id uuid NOT NULL,environment_id uuid NOT NULL,
 evidence_sha256 text NOT NULL CHECK(evidence_sha256~'^[0-9a-f]{64}$'),backup_schema_version text NOT NULL CHECK(length(btrim(backup_schema_version)) BETWEEN 1 AND 120),
 result text NOT NULL CHECK(result IN('passed','failed','rejected_corrupt','rejected_wrong_version')),truth_classification text NOT NULL CHECK(truth_classification IN('proven_disposable_or_ci_evidence','failed')),
 created_by uuid NOT NULL REFERENCES public.profiles(id),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(environment_id,org_id,workspace_id) REFERENCES public.pilot_operations_environments(id,org_id,workspace_id) ON DELETE RESTRICT);
CREATE TABLE public.pilot_operations_command_receipts(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL,workspace_id uuid NOT NULL,actor_id uuid NOT NULL REFERENCES public.profiles(id),operation text NOT NULL,
 idempotency_key text NOT NULL CHECK(length(btrim(idempotency_key)) BETWEEN 8 AND 200),initial_request_id uuid NOT NULL,request_hash text NOT NULL CHECK(request_hash~'^[0-9a-f]{64}$'),
 status text NOT NULL CHECK(status='committed'),response_body jsonb NOT NULL CHECK(jsonb_typeof(response_body)='object'),resource_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(org_id,workspace_id,actor_id,operation,idempotency_key),FOREIGN KEY(workspace_id,org_id) REFERENCES public.workspaces(id,org_id) ON DELETE RESTRICT);
CREATE TABLE public.pilot_operations_audit_events(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL,workspace_id uuid NOT NULL,actor_id uuid NOT NULL REFERENCES public.profiles(id),action text NOT NULL,resource_id uuid NOT NULL,
 receipt_id uuid NOT NULL REFERENCES public.pilot_operations_command_receipts(id) ON DELETE RESTRICT,result text NOT NULL CHECK(result='committed'),metadata jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(metadata)='object' AND pg_column_size(metadata)<=4096),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(workspace_id,org_id) REFERENCES public.workspaces(id,org_id) ON DELETE RESTRICT);

CREATE FUNCTION public.pilot_operations_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$BEGIN RAISE EXCEPTION 'PILOT_OPERATIONS_IMMUTABLE';END$$;
CREATE TRIGGER pilot_operations_release_events_immutable BEFORE UPDATE OR DELETE ON public.pilot_operations_release_events FOR EACH ROW EXECUTE FUNCTION public.pilot_operations_immutable();
CREATE TRIGGER pilot_operations_receipts_immutable BEFORE UPDATE OR DELETE ON public.pilot_operations_command_receipts FOR EACH ROW EXECUTE FUNCTION public.pilot_operations_immutable();
CREATE TRIGGER pilot_operations_audit_immutable BEFORE UPDATE OR DELETE ON public.pilot_operations_audit_events FOR EACH ROW EXECUTE FUNCTION public.pilot_operations_immutable();
CREATE TRIGGER pilot_operations_recovery_immutable BEFORE UPDATE OR DELETE ON public.pilot_operations_recovery_drills FOR EACH ROW EXECUTE FUNCTION public.pilot_operations_immutable();

CREATE FUNCTION public.pilot_operations_command(p_actor uuid,p_org uuid,p_workspace uuid,p_operation text,p_request uuid,p_idempotency_key text,p_request_payload text,p_authorization_version bigint,p_expected_version bigint,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r public.pilot_operations_command_receipts; resource uuid; response jsonb; request_digest text; env public.pilot_operations_environments; candidate public.pilot_operations_release_candidates;
BEGIN
 IF p_payload ?| ARRAY['secret','secretValue','token','credential','password','databaseUrl','signedUrl'] OR COALESCE((p_payload->>'liveActivation')::boolean,false) OR p_payload->>'target' IN('hosted','production') THEN RAISE EXCEPTION 'LIVE_ACTIVATION_NOT_AUTHORIZED'; END IF;
 PERFORM public.pr1b_assert_command_authority(p_actor,p_org,p_workspace,CASE WHEN p_operation='approve_promotion' THEN 'release.approve' WHEN p_operation='simulate_promotion' THEN 'release.promote' WHEN p_operation='validate_release_candidate' THEN 'release.validate' WHEN p_operation IN('register_release_candidate','supersede_release_candidate') THEN 'release.manage' WHEN p_operation='bind_provider_reference' THEN 'byok.manage' WHEN p_operation IN('bootstrap_tenant','deprovision_tenant','reactivate_tenant') THEN 'org.admin' ELSE 'operations.manage' END,p_authorization_version);
 request_digest:=encode(public.digest(convert_to(p_request_payload,'UTF8'),'sha256'),'hex');
 SELECT * INTO r FROM public.pilot_operations_command_receipts WHERE org_id=p_org AND workspace_id=p_workspace AND actor_id=p_actor AND operation=p_operation AND idempotency_key=p_idempotency_key;
 IF FOUND THEN IF r.request_hash<>request_digest THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';END IF;RETURN r.response_body;END IF;
 IF p_operation='register_environment' THEN
  INSERT INTO public.pilot_operations_environments(org_id,workspace_id,environment_type,expected_schema_version,required_capabilities,created_by)
  VALUES(p_org,p_workspace,p_payload->>'environmentType',p_payload->>'schemaVersion',COALESCE(p_payload->'requiredCapabilities','[]'),p_actor) RETURNING * INTO env;
  resource:=env.id;response:=jsonb_build_object('resourceId',resource,'version',env.version,'lifecycle',env.lifecycle,'liveActivationAuthorized',false);
 ELSIF p_operation='register_release_candidate' THEN
  INSERT INTO public.pilot_operations_release_candidates(org_id,workspace_id,git_sha,build_identity,evidence_manifest_sha256,schema_version,created_by)
  VALUES(p_org,p_workspace,p_payload->>'gitSha',p_payload->>'buildIdentity',p_payload->>'evidenceManifestSha256',p_payload->>'schemaVersion',p_actor) RETURNING * INTO candidate;
  resource:=candidate.id;response:=jsonb_build_object('resourceId',resource,'version',candidate.version,'lifecycle',candidate.lifecycle,'liveActivationAuthorized',false);
 ELSIF p_operation IN('validate_release_candidate','approve_promotion','simulate_promotion','supersede_release_candidate') THEN
  SELECT * INTO candidate FROM public.pilot_operations_release_candidates WHERE id=(p_payload->>'candidateId')::uuid AND org_id=p_org AND workspace_id=p_workspace FOR UPDATE;
  IF candidate.id IS NULL THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;IF candidate.version<>p_expected_version THEN RAISE EXCEPTION 'VERSION_CONFLICT';END IF;
  IF p_operation='validate_release_candidate' AND candidate.lifecycle='draft' THEN candidate.lifecycle:='validated';
  ELSIF p_operation='approve_promotion' AND candidate.lifecycle='validated' AND candidate.created_by<>p_actor THEN candidate.lifecycle:='approved_for_pilot_promotion';
  ELSIF p_operation='simulate_promotion' AND candidate.lifecycle='approved_for_pilot_promotion' AND NOT EXISTS(SELECT 1 FROM public.pilot_operations_release_events WHERE candidate_id=candidate.id AND event_type='approved' AND actor_id=p_actor) THEN candidate.lifecycle:='promoted_non_live';
  ELSIF p_operation='supersede_release_candidate' AND candidate.lifecycle<>'promoted_non_live' THEN candidate.lifecycle:='superseded'; ELSE RAISE EXCEPTION 'VERSION_CONFLICT';END IF;
  UPDATE public.pilot_operations_release_candidates SET lifecycle=candidate.lifecycle,version=version+1 WHERE id=candidate.id RETURNING * INTO candidate;
  INSERT INTO public.pilot_operations_release_events(org_id,workspace_id,candidate_id,event_type,candidate_version,candidate_hash,actor_id,authorization_version,metadata) VALUES(p_org,p_workspace,candidate.id,CASE p_operation WHEN 'validate_release_candidate' THEN 'validated' WHEN 'approve_promotion' THEN 'approved' WHEN 'simulate_promotion' THEN 'promoted_non_live' ELSE 'superseded' END,candidate.version,encode(public.digest(convert_to(candidate::text,'UTF8'),'sha256'),'hex'),p_actor,p_authorization_version,jsonb_build_object('nonLive',true));
  resource:=candidate.id;response:=jsonb_build_object('resourceId',resource,'version',candidate.version,'lifecycle',candidate.lifecycle,'liveActivationAuthorized',false);
 ELSIF p_operation='bind_provider_reference' THEN
  SELECT * INTO env FROM public.pilot_operations_environments WHERE id=(p_payload->>'environmentId')::uuid AND org_id=p_org AND workspace_id=p_workspace FOR UPDATE;
  IF env.id IS NULL OR env.lifecycle='deactivated' THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
  INSERT INTO public.pilot_operations_provider_bindings(org_id,workspace_id,environment_id,provider_configuration_id,purpose,configured,enabled,created_by)
  SELECT p_org,p_workspace,env.id,c.id,p_payload->>'purpose',(c.key_ref_id IS NOT NULL),COALESCE((p_payload->>'enabled')::boolean,false) AND c.key_ref_id IS NOT NULL,p_actor FROM public.ai_provider_configs c WHERE c.id=(p_payload->>'providerConfigurationId')::uuid AND c.org_id=p_org
  ON CONFLICT(environment_id,purpose) DO UPDATE SET provider_configuration_id=excluded.provider_configuration_id,configured=excluded.configured,enabled=excluded.enabled,version=public.pilot_operations_provider_bindings.version+1 RETURNING id INTO resource;
  IF resource IS NULL THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;response:=jsonb_build_object('resourceId',resource,'configured',true,'liveActivationAuthorized',false);
 ELSIF p_operation='bootstrap_tenant' THEN
  SELECT * INTO env FROM public.pilot_operations_environments WHERE id=(p_payload->>'environmentId')::uuid AND org_id=p_org AND workspace_id=p_workspace AND lifecycle<>'deactivated' FOR UPDATE;
  IF env.id IS NULL THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;
  INSERT INTO public.pilot_operations_tenants(org_id,workspace_id,environment_id,created_by) VALUES(p_org,p_workspace,env.id,p_actor)
  ON CONFLICT(org_id,workspace_id) DO UPDATE SET environment_id=excluded.environment_id WHERE public.pilot_operations_tenants.lifecycle='active' RETURNING id,version INTO resource,p_expected_version;
  IF resource IS NULL THEN RAISE EXCEPTION 'VERSION_CONFLICT';END IF;response:=jsonb_build_object('resourceId',resource,'lifecycle','active','liveActivationAuthorized',false);
 ELSIF p_operation IN('deprovision_tenant','reactivate_tenant') THEN
  UPDATE public.pilot_operations_tenants SET lifecycle=CASE WHEN p_operation='deprovision_tenant' THEN 'deprovisioned' ELSE 'active' END,version=version+1,updated_at=now()
  WHERE org_id=p_org AND workspace_id=p_workspace AND version=p_expected_version AND lifecycle=CASE WHEN p_operation='deprovision_tenant' THEN 'active' ELSE 'deprovisioned' END RETURNING id INTO resource;
  IF resource IS NULL THEN RAISE EXCEPTION 'VERSION_CONFLICT';END IF;response:=jsonb_build_object('resourceId',resource,'lifecycle',CASE WHEN p_operation='deprovision_tenant' THEN 'deprovisioned' ELSE 'active' END,'liveActivationAuthorized',false);
 ELSIF p_operation='set_runtime_control' THEN
  UPDATE public.pilot_operations_environments SET maintenance=COALESCE((p_payload->>'maintenance')::boolean,maintenance),read_only=COALESCE((p_payload->>'readOnly')::boolean,read_only),version=version+1,updated_at=now()
  WHERE id=(p_payload->>'environmentId')::uuid AND org_id=p_org AND workspace_id=p_workspace AND version=p_expected_version RETURNING id,version,maintenance,read_only INTO resource,p_expected_version,env.maintenance,env.read_only;
  IF resource IS NULL THEN RAISE EXCEPTION 'VERSION_CONFLICT';END IF;response:=jsonb_build_object('resourceId',resource,'version',p_expected_version,'maintenance',env.maintenance,'readOnly',env.read_only,'liveActivationAuthorized',false);
 ELSIF p_operation='record_recovery_drill' THEN
  INSERT INTO public.pilot_operations_recovery_drills(org_id,workspace_id,environment_id,evidence_sha256,backup_schema_version,result,truth_classification,created_by)
  SELECT p_org,p_workspace,e.id,p_payload->>'evidenceSha256',p_payload->>'backupSchemaVersion',p_payload->>'result',CASE WHEN p_payload->>'result'='passed' THEN 'proven_disposable_or_ci_evidence' ELSE 'failed' END,p_actor
  FROM public.pilot_operations_environments e WHERE e.id=(p_payload->>'environmentId')::uuid AND e.org_id=p_org AND e.workspace_id=p_workspace RETURNING id INTO resource;
  IF resource IS NULL THEN RAISE EXCEPTION 'ACCESS_DENIED';END IF;response:=jsonb_build_object('resourceId',resource,'truthClassification',CASE WHEN p_payload->>'result'='passed' THEN 'proven_disposable_or_ci_evidence' ELSE 'failed' END,'liveActivationAuthorized',false);
 ELSE RAISE EXCEPTION 'VALIDATION_FAILED';END IF;
 INSERT INTO public.pilot_operations_command_receipts(org_id,workspace_id,actor_id,operation,idempotency_key,initial_request_id,request_hash,status,response_body,resource_id) VALUES(p_org,p_workspace,p_actor,p_operation,p_idempotency_key,p_request,request_digest,'committed',response,resource) RETURNING * INTO r;
 INSERT INTO public.pilot_operations_audit_events(org_id,workspace_id,actor_id,action,resource_id,receipt_id,result,metadata) VALUES(p_org,p_workspace,p_actor,p_operation,resource,r.id,'committed',jsonb_build_object('nonLive',true));RETURN response;
END$$;

CREATE FUNCTION public.pilot_operations_projection(p_actor uuid,p_org uuid,p_workspace uuid,p_authorization_version bigint) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE env public.pilot_operations_environments; candidate public.pilot_operations_release_candidates; binding public.pilot_operations_provider_bindings;
BEGIN PERFORM public.pr1b_assert_command_authority(p_actor,p_org,p_workspace,'operations.read',p_authorization_version);
 SELECT * INTO env FROM public.pilot_operations_environments WHERE org_id=p_org AND workspace_id=p_workspace AND environment_type='pilot_candidate';
 SELECT * INTO candidate FROM public.pilot_operations_release_candidates WHERE org_id=p_org AND workspace_id=p_workspace ORDER BY created_at DESC LIMIT 1;
 SELECT * INTO binding FROM public.pilot_operations_provider_bindings WHERE org_id=p_org AND workspace_id=p_workspace ORDER BY created_at DESC LIMIT 1;
 RETURN jsonb_build_object('truthClassification','configured_not_live_verified','liveActivationAuthorized',false,'environment',CASE WHEN env.id IS NULL THEN NULL ELSE jsonb_build_object('id',env.id,'type',env.environment_type,'lifecycle',env.lifecycle,'version',env.version,'maintenance',env.maintenance,'readOnly',env.read_only) END,'release',CASE WHEN candidate.id IS NULL THEN NULL ELSE jsonb_build_object('id',candidate.id,'gitSha',candidate.git_sha,'lifecycle',candidate.lifecycle,'version',candidate.version) END,'provider',CASE WHEN binding.id IS NULL THEN NULL ELSE jsonb_build_object('configured',binding.configured,'enabled',binding.enabled,'purpose',binding.purpose) END,'blockers',jsonb_build_array('LIVE_ACTIVATION_NOT_AUTHORIZED','HOSTED_LIVE_NOT_PROVEN'));
END$$;

REVOKE ALL ON public.pilot_operations_environments,public.pilot_operations_release_candidates,public.pilot_operations_release_events,public.pilot_operations_provider_bindings,public.pilot_operations_tenants,public.pilot_operations_recovery_drills,public.pilot_operations_command_receipts,public.pilot_operations_audit_events FROM anon,authenticated;
ALTER TABLE public.pilot_operations_environments ENABLE ROW LEVEL SECURITY;ALTER TABLE public.pilot_operations_environments FORCE ROW LEVEL SECURITY;
ALTER TABLE public.pilot_operations_release_candidates ENABLE ROW LEVEL SECURITY;ALTER TABLE public.pilot_operations_release_candidates FORCE ROW LEVEL SECURITY;
ALTER TABLE public.pilot_operations_release_events ENABLE ROW LEVEL SECURITY;ALTER TABLE public.pilot_operations_release_events FORCE ROW LEVEL SECURITY;
ALTER TABLE public.pilot_operations_provider_bindings ENABLE ROW LEVEL SECURITY;ALTER TABLE public.pilot_operations_provider_bindings FORCE ROW LEVEL SECURITY;
ALTER TABLE public.pilot_operations_tenants ENABLE ROW LEVEL SECURITY;ALTER TABLE public.pilot_operations_tenants FORCE ROW LEVEL SECURITY;
ALTER TABLE public.pilot_operations_recovery_drills ENABLE ROW LEVEL SECURITY;ALTER TABLE public.pilot_operations_recovery_drills FORCE ROW LEVEL SECURITY;
ALTER TABLE public.pilot_operations_command_receipts ENABLE ROW LEVEL SECURITY;ALTER TABLE public.pilot_operations_command_receipts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.pilot_operations_audit_events ENABLE ROW LEVEL SECURITY;ALTER TABLE public.pilot_operations_audit_events FORCE ROW LEVEL SECURITY;
REVOKE ALL ON FUNCTION public.pilot_operations_command(uuid,uuid,uuid,text,uuid,text,text,bigint,bigint,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.pilot_operations_projection(uuid,uuid,uuid,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pilot_operations_command(uuid,uuid,uuid,text,uuid,text,text,bigint,bigint,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.pilot_operations_projection(uuid,uuid,uuid,bigint) TO service_role;
-- Rollback/fallback: disable the Edge feature and retain all immutable rows read-only. Correct schema only by additive forward migration; no destructive rollback or hosted action is authorized.
