-- Authenticated hosted synthetic exercise authority.
-- Installation is inert: no exercise row, session binding or permit exists by
-- default. Rollback is quiesce/revoke while immutable business history,
-- receipts and audits remain available for authorized reads and forward repair.

DO $authenticated_synthetic_source$
DECLARE marker public.hosted_pilot_environment_identity;
BEGIN
  LOCK TABLE public.hosted_pilot_environment_identity IN SHARE ROW EXCLUSIVE MODE;
  SELECT * INTO STRICT marker FROM public.hosted_pilot_environment_identity WHERE singleton FOR UPDATE;
  IF marker.product_key<>'avalaos-core'
    OR marker.environment_class<>'hosted_nonproduction_pilot'
    OR marker.schema_contract<>'hosted-pilot-2026-08'
    OR marker.migration_tip<>'20261010051413'
    OR marker.production_authorized OR marker.customer_data_authorized OR marker.real_provider_calls_authorized
    OR to_regclass('public.authenticated_synthetic_exercises') IS NOT NULL
    OR EXISTS(SELECT 1 FROM public.pr_c_controlled_human_exercises WHERE lifecycle<>'deprovisioned')
  THEN RAISE EXCEPTION 'AUTHENTICATED_SYNTHETIC_SOURCE_MISMATCH'; END IF;
END
$authenticated_synthetic_source$;

CREATE TABLE public.authenticated_synthetic_exercises(
  id uuid PRIMARY KEY,
  environment_class text NOT NULL CHECK(environment_class='hosted_nonproduction_pilot'),
  release_sha text NOT NULL CHECK(release_sha~'^[0-9a-f]{40}$'),
  deployment_id text NOT NULL CHECK(deployment_id~'^[0-9a-f]{24}$'),
  origin text NOT NULL CHECK(origin='https://avalaos-pilot.netlify.app'),
  backend_fingerprint text NOT NULL CHECK(backend_fingerprint~'^sha256:[0-9a-f]{64}$'),
  migration_tip text NOT NULL CHECK(migration_tip='20261010144356'),
  migration_digest text NOT NULL CHECK(migration_digest~'^sha256:[0-9a-f]{64}$'),
  exercise_digest text NOT NULL UNIQUE CHECK(exercise_digest~'^sha256:[0-9a-f]{64}$'),
  profile_version text NOT NULL CHECK(profile_version='hosted-authenticated-synthetic-profile-v2'),
  catalog_digest text NOT NULL CHECK(catalog_digest~'^sha256:[0-9a-f]{64}$'),
  source_digest text NOT NULL CHECK(source_digest~'^sha256:[0-9a-f]{64}$'),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL,
  lifecycle text NOT NULL DEFAULT 'active' CHECK(lifecycle IN('active','quiesced')),
  expires_at timestamptz NOT NULL,
  activated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  quiesced_at timestamptz,
  CHECK(expires_at>activated_at AND expires_at<=activated_at+interval '6 hours'),
  CHECK((lifecycle='active' AND quiesced_at IS NULL) OR(lifecycle='quiesced' AND quiesced_at IS NOT NULL)),
  UNIQUE(id,org_id,workspace_id),
  FOREIGN KEY(workspace_id,org_id) REFERENCES public.workspaces(id,org_id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX authenticated_synthetic_one_active_exercise
  ON public.authenticated_synthetic_exercises((true)) WHERE lifecycle='active';

CREATE TABLE public.authenticated_synthetic_actor_sessions(
  exercise_id uuid NOT NULL REFERENCES public.authenticated_synthetic_exercises(id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  session_id uuid NOT NULL,
  persona text NOT NULL CHECK(persona~'^[a-z][a-z0-9_-]{1,63}$'),
  actor_hash text NOT NULL CHECK(actor_hash~'^sha256:[0-9a-f]{64}$'),
  session_hash text NOT NULL CHECK(session_hash~'^sha256:[0-9a-f]{64}$'),
  state text NOT NULL DEFAULT 'active' CHECK(state IN('active','revoked')),
  bound_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  revoked_at timestamptz,
  PRIMARY KEY(exercise_id,actor_id,session_id),
  UNIQUE(exercise_id,persona),
  CHECK((state='active' AND revoked_at IS NULL) OR(state='revoked' AND revoked_at IS NOT NULL))
);

CREATE TABLE public.authenticated_synthetic_permits(
  id uuid PRIMARY KEY,
  exercise_id uuid NOT NULL,
  org_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  session_id uuid NOT NULL,
  kind text NOT NULL CHECK(kind IN('studio_deterministic_success','studio_failure_after_claim','process_server_error_precommit')),
  command_type text NOT NULL CHECK(command_type IN('studio.generation.request','process.create','process.update')),
  request_id uuid NOT NULL,
  payload_hash text NOT NULL CHECK(payload_hash~'^[0-9a-f]{64}$'),
  expected_version bigint NOT NULL CHECK(expected_version>=0),
  state text NOT NULL DEFAULT 'armed' CHECK(state IN('armed','consumed','revoked')),
  attempt_id uuid,
  execution_fence bigint,
  expires_at timestamptz NOT NULL,
  armed_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  consumed_at timestamptz,
  revoked_at timestamptz,
  CHECK(
    (kind IN('studio_deterministic_success','studio_failure_after_claim') AND command_type='studio.generation.request')
    OR(kind='process_server_error_precommit' AND command_type IN('process.create','process.update'))
  ),
  CHECK((state='armed' AND consumed_at IS NULL AND revoked_at IS NULL AND attempt_id IS NULL AND execution_fence IS NULL)
    OR(state='consumed' AND consumed_at IS NOT NULL AND revoked_at IS NULL)
    OR(state='revoked' AND consumed_at IS NULL AND revoked_at IS NOT NULL)),
  UNIQUE(exercise_id,actor_id,request_id),
  UNIQUE(exercise_id,id,org_id,workspace_id),
  FOREIGN KEY(exercise_id,org_id,workspace_id)
    REFERENCES public.authenticated_synthetic_exercises(id,org_id,workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY(exercise_id,actor_id,session_id)
    REFERENCES public.authenticated_synthetic_actor_sessions(exercise_id,actor_id,session_id) ON DELETE RESTRICT,
  FOREIGN KEY(attempt_id) REFERENCES public.studio_artifact_generation_attempts(id) ON DELETE RESTRICT
);

CREATE TABLE public.authenticated_synthetic_permit_events(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exercise_id uuid NOT NULL,
  permit_id uuid NOT NULL,
  org_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  session_hash text NOT NULL CHECK(session_hash~'^sha256:[0-9a-f]{64}$'),
  request_hash text NOT NULL CHECK(request_hash~'^sha256:[0-9a-f]{64}$'),
  payload_hash text NOT NULL CHECK(payload_hash~'^sha256:[0-9a-f]{64}$'),
  event_type text NOT NULL CHECK(event_type IN('armed','consumed_after_claim','consumed_precommit','revoked')),
  command_type text NOT NULL,
  attempt_id uuid,
  execution_fence bigint,
  occurred_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  FOREIGN KEY(exercise_id,permit_id,org_id,workspace_id)
    REFERENCES public.authenticated_synthetic_permits(exercise_id,id,org_id,workspace_id) ON DELETE RESTRICT
);

ALTER TABLE public.authenticated_synthetic_exercises ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.authenticated_synthetic_exercises FORCE ROW LEVEL SECURITY;
ALTER TABLE public.authenticated_synthetic_actor_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.authenticated_synthetic_actor_sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.authenticated_synthetic_permits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.authenticated_synthetic_permits FORCE ROW LEVEL SECURITY;
ALTER TABLE public.authenticated_synthetic_permit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.authenticated_synthetic_permit_events FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.authenticated_synthetic_exercises,public.authenticated_synthetic_actor_sessions,
  public.authenticated_synthetic_permits,public.authenticated_synthetic_permit_events FROM PUBLIC,anon,authenticated;

-- Existing attempts retain their provider plan. New synthetic attempts carry
-- an explicit permit binding and cannot satisfy the provider-plan branch.
ALTER TABLE public.studio_artifact_generation_attempts
  ADD COLUMN transport_kind text NOT NULL DEFAULT 'provider'
    CHECK(transport_kind IN('provider','authenticated_synthetic')),
  ADD COLUMN authenticated_synthetic_permit_id uuid;
ALTER TABLE public.studio_artifact_generation_attempts
  DROP CONSTRAINT studio_generation_provider_plan_check;
ALTER TABLE public.studio_artifact_generation_attempts
  ADD CONSTRAINT studio_generation_provider_plan_check CHECK(
    (provider_plan_state='legacy_unverified' AND transport_kind='provider'
      AND provider_route_id IS NULL AND provider_config_id IS NULL AND provider_name IS NULL AND provider_model IS NULL
      AND prompt_key IS NULL AND prompt_version IS NULL AND provider_plan_hash IS NULL AND authenticated_synthetic_permit_id IS NULL)
    OR(provider_plan_state='bound' AND transport_kind='provider' AND authenticated_synthetic_permit_id IS NULL
      AND provider_route_id IS NOT NULL AND provider_config_id IS NOT NULL
      AND provider_name IN('openai','azure_openai','anthropic','gemini','groq','openai_compatible')
      AND length(btrim(provider_model)) BETWEEN 1 AND 200
      AND prompt_key IS NOT NULL AND prompt_version IS NOT NULL AND provider_plan_hash IS NOT NULL
      AND prompt_key='studio-multisource-generation'
      AND prompt_version IN('studio-pr-b-1','studio-pr-b-2','studio-pr-b-3')
      AND provider_plan_hash~'^[0-9a-f]{64}$')
    OR(provider_plan_state='authenticated_synthetic' AND transport_kind='authenticated_synthetic'
      AND authenticated_synthetic_permit_id IS NOT NULL AND provider_route_id IS NULL AND provider_config_id IS NULL
      AND provider_name IS NULL AND provider_model IS NULL AND prompt_key='studio-multisource-generation'
      AND prompt_version='studio-pr-b-1' AND provider_plan_hash~'^[0-9a-f]{64}$')
  );

CREATE OR REPLACE FUNCTION public.authenticated_synthetic_exercise_activate(
 p_exercise_id uuid,p_release_sha text,p_deployment_id text,p_origin text,p_backend_fingerprint text,p_migration_tip text,
 p_migration_digest text,p_exercise_digest text,p_profile_version text,p_catalog_digest text,p_source_digest text,
 p_org uuid,p_workspace uuid,p_expires_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE marker public.hosted_pilot_environment_identity;studio public.studio_artifact_runtime_control;
 enterprise public.enterprise_intelligence_runtime_control;row public.authenticated_synthetic_exercises;
BEGIN
 SELECT * INTO STRICT marker FROM public.hosted_pilot_environment_identity WHERE singleton FOR SHARE;
 SELECT * INTO STRICT studio FROM public.studio_artifact_runtime_control WHERE singleton FOR SHARE;
 SELECT * INTO STRICT enterprise FROM public.enterprise_intelligence_runtime_control WHERE singleton FOR SHARE;
 IF p_exercise_id IS NULL OR p_org IS NULL OR p_workspace IS NULL OR p_expires_at IS NULL
  OR p_release_sha!~'^[0-9a-f]{40}$' OR p_deployment_id!~'^[0-9a-f]{24}$'
  OR p_origin IS DISTINCT FROM 'https://avalaos-pilot.netlify.app'
  OR p_backend_fingerprint!~'^sha256:[0-9a-f]{64}$' OR p_migration_tip<>'20261010144356'
  OR p_migration_digest!~'^sha256:[0-9a-f]{64}$' OR p_exercise_digest!~'^sha256:[0-9a-f]{64}$'
  OR p_profile_version<>'hosted-authenticated-synthetic-profile-v2'
  OR p_catalog_digest!~'^sha256:[0-9a-f]{64}$' OR p_source_digest!~'^sha256:[0-9a-f]{64}$'
  OR p_expires_at<=statement_timestamp() OR p_expires_at>statement_timestamp()+interval '6 hours'
  OR marker.environment_class<>'hosted_nonproduction_pilot' OR marker.migration_tip<>p_migration_tip
  OR marker.production_authorized OR marker.customer_data_authorized OR marker.real_provider_calls_authorized
  OR NOT studio.enabled OR studio.read_only OR studio.provider_enabled
  OR NOT enterprise.enabled OR enterprise.read_only OR enterprise.provider_enabled
  OR NOT EXISTS(SELECT 1 FROM public.workspaces w WHERE w.id=p_workspace AND w.org_id=p_org)
 THEN RAISE EXCEPTION 'AUTHENTICATED_SYNTHETIC_ACTIVATION_REJECTED'; END IF;
 INSERT INTO public.authenticated_synthetic_exercises(id,environment_class,release_sha,deployment_id,origin,backend_fingerprint,
   migration_tip,migration_digest,exercise_digest,profile_version,catalog_digest,source_digest,org_id,workspace_id,expires_at)
 VALUES(p_exercise_id,marker.environment_class,p_release_sha,p_deployment_id,p_origin,p_backend_fingerprint,p_migration_tip,
   p_migration_digest,p_exercise_digest,p_profile_version,p_catalog_digest,p_source_digest,p_org,p_workspace,p_expires_at)
 RETURNING * INTO row;
 RETURN jsonb_build_object('exerciseId',row.id,'lifecycle',row.lifecycle,'expiresAt',row.expires_at);
END$$;

CREATE OR REPLACE FUNCTION public.authenticated_synthetic_bind_session(
 p_exercise_id uuid,p_actor_id uuid,p_session_id uuid,p_persona text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE exercise public.authenticated_synthetic_exercises;binding public.authenticated_synthetic_actor_sessions;
BEGIN
 SELECT * INTO exercise FROM public.authenticated_synthetic_exercises WHERE id=p_exercise_id FOR UPDATE;
 IF exercise.id IS NULL OR exercise.lifecycle<>'active' OR exercise.expires_at<=statement_timestamp()
  OR p_persona!~'^[a-z][a-z0-9_-]{1,63}$'
  OR NOT EXISTS(SELECT 1 FROM auth.sessions session WHERE session.id=p_session_id AND session.user_id=p_actor_id
    AND(session.not_after IS NULL OR session.not_after>statement_timestamp()))
  OR NOT EXISTS(SELECT 1 FROM public.organization_members member WHERE member.org_id=exercise.org_id AND member.user_id=p_actor_id
    AND member.status='active' AND member.deleted_at IS NULL)
 THEN RAISE EXCEPTION 'AUTHENTICATED_SYNTHETIC_SESSION_REJECTED'; END IF;
 SELECT * INTO binding FROM public.authenticated_synthetic_actor_sessions
  WHERE exercise_id=exercise.id AND actor_id=p_actor_id AND session_id=p_session_id FOR UPDATE;
 IF binding.exercise_id IS NOT NULL THEN
  IF binding.persona<>p_persona OR binding.state<>'active' THEN
   RAISE EXCEPTION 'AUTHENTICATED_SYNTHETIC_SESSION_REJECTED';
  END IF;
  RETURN jsonb_build_object('actorHash',binding.actor_hash,'sessionHash',binding.session_hash,'state',binding.state);
 END IF;
 IF EXISTS(SELECT 1 FROM public.authenticated_synthetic_actor_sessions
   WHERE exercise_id=exercise.id AND persona=p_persona) THEN
  RAISE EXCEPTION 'AUTHENTICATED_SYNTHETIC_SESSION_REJECTED';
 END IF;
 INSERT INTO public.authenticated_synthetic_actor_sessions(exercise_id,actor_id,session_id,persona,actor_hash,session_hash)
 VALUES(exercise.id,p_actor_id,p_session_id,p_persona,
   'sha256:'||encode(public.digest(p_actor_id::text,'sha256'),'hex'),
   'sha256:'||encode(public.digest(p_session_id::text,'sha256'),'hex'))
 RETURNING * INTO binding;
 RETURN jsonb_build_object('actorHash',binding.actor_hash,'sessionHash',binding.session_hash,'state',binding.state);
END$$;

CREATE OR REPLACE FUNCTION public.authenticated_synthetic_arm_permit(
 p_exercise_id uuid,p_permit_id uuid,p_kind text,p_command_type text,p_actor_id uuid,p_session_id uuid,
 p_request_id uuid,p_payload_hash text,p_expected_version bigint,p_expires_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE exercise public.authenticated_synthetic_exercises;binding public.authenticated_synthetic_actor_sessions;
 permit public.authenticated_synthetic_permits;
BEGIN
 SELECT * INTO exercise FROM public.authenticated_synthetic_exercises WHERE id=p_exercise_id FOR UPDATE;
 SELECT * INTO binding FROM public.authenticated_synthetic_actor_sessions
  WHERE exercise_id=p_exercise_id AND actor_id=p_actor_id AND session_id=p_session_id FOR SHARE;
 IF exercise.id IS NULL OR exercise.lifecycle<>'active' OR exercise.expires_at<=statement_timestamp()
  OR binding.exercise_id IS NULL OR binding.state<>'active'
  OR NOT EXISTS(SELECT 1 FROM auth.sessions session WHERE session.id=p_session_id AND session.user_id=p_actor_id
    AND(session.not_after IS NULL OR session.not_after>statement_timestamp()))
  OR p_payload_hash!~'^[0-9a-f]{64}$' OR p_expected_version<0 OR p_request_id IS NULL OR p_permit_id IS NULL
  OR p_expires_at<=statement_timestamp() OR p_expires_at>exercise.expires_at OR p_expires_at>statement_timestamp()+interval '30 minutes'
  OR NOT((p_kind IN('studio_deterministic_success','studio_failure_after_claim') AND p_command_type='studio.generation.request')
    OR(p_kind='process_server_error_precommit' AND p_command_type IN('process.create','process.update')))
 THEN RAISE EXCEPTION 'AUTHENTICATED_SYNTHETIC_PERMIT_REJECTED'; END IF;
 INSERT INTO public.authenticated_synthetic_permits(id,exercise_id,org_id,workspace_id,actor_id,session_id,kind,command_type,
   request_id,payload_hash,expected_version,expires_at)
 VALUES(p_permit_id,p_exercise_id,exercise.org_id,exercise.workspace_id,p_actor_id,p_session_id,p_kind,p_command_type,
   p_request_id,p_payload_hash,p_expected_version,p_expires_at)
 RETURNING * INTO permit;
 INSERT INTO public.authenticated_synthetic_permit_events(exercise_id,permit_id,org_id,workspace_id,actor_id,session_hash,
   request_hash,payload_hash,event_type,command_type)
 VALUES(permit.exercise_id,permit.id,permit.org_id,permit.workspace_id,permit.actor_id,binding.session_hash,
   'sha256:'||encode(public.digest(permit.request_id::text,'sha256'),'hex'),'sha256:'||permit.payload_hash,'armed',permit.command_type);
 RETURN jsonb_build_object('permitId',permit.id,'state',permit.state,'expiresAt',permit.expires_at);
END$$;

CREATE OR REPLACE FUNCTION public.authenticated_synthetic_resolve_studio_permit(
 p_actor_id uuid,p_org_id uuid,p_workspace_id uuid,p_session_id uuid,p_request_id uuid,p_payload_hash text,p_expected_version bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE permit public.authenticated_synthetic_permits;
BEGIN
 SELECT candidate.* INTO permit FROM public.authenticated_synthetic_permits candidate
 JOIN public.authenticated_synthetic_exercises exercise ON exercise.id=candidate.exercise_id
 JOIN public.authenticated_synthetic_actor_sessions binding ON binding.exercise_id=candidate.exercise_id
  AND binding.actor_id=candidate.actor_id AND binding.session_id=candidate.session_id
 WHERE candidate.actor_id=p_actor_id AND candidate.org_id=p_org_id AND candidate.workspace_id=p_workspace_id
  AND candidate.request_id=p_request_id AND candidate.command_type='studio.generation.request'
  AND candidate.kind IN('studio_deterministic_success','studio_failure_after_claim')
 ORDER BY (exercise.lifecycle='active') DESC,candidate.armed_at DESC,candidate.id
 LIMIT 1;
 IF permit.id IS NULL THEN RETURN jsonb_build_object('active',false); END IF;
 IF permit.session_id IS DISTINCT FROM p_session_id OR permit.payload_hash IS DISTINCT FROM p_payload_hash
  OR permit.expected_version IS DISTINCT FROM p_expected_version
  OR NOT(
    (permit.state='armed' AND permit.expires_at>statement_timestamp())
    OR(permit.state='consumed' AND EXISTS(
      SELECT 1 FROM public.studio_artifact_generation_attempts attempt
      JOIN public.studio_artifact_command_receipts receipt
        ON receipt.request_id=attempt.request_id AND receipt.org_id=attempt.org_id
       AND receipt.actor_id=attempt.requested_by AND receipt.command_type='studio.artifact.generation.request.v2'
       AND receipt.status='committed'
      WHERE attempt.id=permit.attempt_id AND attempt.authenticated_synthetic_permit_id=permit.id
        AND attempt.request_id=permit.request_id AND attempt.org_id=permit.org_id
        AND attempt.workspace_id=permit.workspace_id AND attempt.requested_by=permit.actor_id))
  )
  OR NOT EXISTS(SELECT 1 FROM public.authenticated_synthetic_exercises stored
    WHERE stored.id=permit.exercise_id AND stored.lifecycle='active' AND stored.expires_at>statement_timestamp())
  OR NOT EXISTS(SELECT 1 FROM public.authenticated_synthetic_actor_sessions stored
    WHERE stored.exercise_id=permit.exercise_id AND stored.actor_id=permit.actor_id
      AND stored.session_id=permit.session_id AND stored.state='active')
  OR NOT EXISTS(SELECT 1 FROM auth.sessions session WHERE session.id=p_session_id AND session.user_id=p_actor_id
    AND(session.not_after IS NULL OR session.not_after>statement_timestamp()))
 THEN RAISE EXCEPTION 'AUTHENTICATED_SYNTHETIC_PERMIT_REJECTED'; END IF;
 RETURN jsonb_build_object('active',true,'permitId',permit.id,'kind',permit.kind);
END$$;

-- This is the normal Studio request transaction with provider route lookup
-- replaced only by an exact server permit. It preserves authority, source,
-- template, receipt, attempt, aggregate fencing and request audit behavior.
CREATE OR REPLACE FUNCTION public.studio_artifact_generation_request_authenticated_synthetic(p_command jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
#variable_conflict use_variable
DECLARE actor uuid;org uuid;workspace uuid;request_id uuid;artifact_id uuid;source_package_id uuid;template_version_id uuid;
 authorization_version bigint;expected_aggregate_version bigint;expected_current_version_id uuid;expected_approved_version_id uuid;
 permit_id uuid;session_id uuid;idempotency_key text;template_kind text;permit_kind text;payload_hash text;request_hash text;provider_plan_hash text;input_hash text;
 artifact public.studio_artifact_aggregates;package public.studio_artifact_source_packages;system_template public.studio_system_template_versions;
 tenant_template public.studio_tenant_template_versions;tenant_aggregate public.studio_tenant_template_aggregates;
 flags public.enterprise_transcript_workspace_flags;control public.studio_artifact_runtime_control;
 permit public.authenticated_synthetic_permits;receipt public.studio_artifact_command_receipts;attempt public.studio_artifact_generation_attempts;
 result jsonb;plan jsonb;audit_id uuid:=gen_random_uuid();
BEGIN
 IF p_command IS NULL OR jsonb_typeof(p_command)<>'object'
  OR NOT(p_command?&ARRAY['actorId','organizationId','workspaceId','requestId','idempotencyKey','authorizationVersion','artifactId','sourcePackageId','templateKind','templateVersionId','expectedAggregateVersion','expectedCurrentVersionId','expectedApprovedVersionId','authenticatedSyntheticPermitId','authenticatedSyntheticKind','authenticatedSyntheticSessionId','authenticatedSyntheticPayloadHash'])
  OR(p_command-ARRAY['actorId','organizationId','workspaceId','requestId','idempotencyKey','authorizationVersion','artifactId','sourcePackageId','templateKind','templateVersionId','expectedAggregateVersion','expectedCurrentVersionId','expectedApprovedVersionId','authenticatedSyntheticPermitId','authenticatedSyntheticKind','authenticatedSyntheticSessionId','authenticatedSyntheticPayloadHash'])<>'{}'::jsonb
 THEN RAISE EXCEPTION 'INVALID_COMMAND'; END IF;
 BEGIN
  actor:=(p_command->>'actorId')::uuid;org:=(p_command->>'organizationId')::uuid;workspace:=(p_command->>'workspaceId')::uuid;
  request_id:=(p_command->>'requestId')::uuid;artifact_id:=(p_command->>'artifactId')::uuid;source_package_id:=(p_command->>'sourcePackageId')::uuid;
  template_version_id:=(p_command->>'templateVersionId')::uuid;authorization_version:=(p_command->>'authorizationVersion')::bigint;
  expected_aggregate_version:=(p_command->>'expectedAggregateVersion')::bigint;
  expected_current_version_id:=NULLIF(p_command->>'expectedCurrentVersionId','')::uuid;
  expected_approved_version_id:=NULLIF(p_command->>'expectedApprovedVersionId','')::uuid;
  permit_id:=(p_command->>'authenticatedSyntheticPermitId')::uuid;session_id:=(p_command->>'authenticatedSyntheticSessionId')::uuid;
 EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'INVALID_COMMAND';END;
 idempotency_key:=p_command->>'idempotencyKey';template_kind:=p_command->>'templateKind';permit_kind:=p_command->>'authenticatedSyntheticKind';payload_hash:=p_command->>'authenticatedSyntheticPayloadHash';
 IF length(idempotency_key) NOT BETWEEN 8 AND 128 OR template_kind NOT IN('system','tenant') OR expected_aggregate_version<0
  OR permit_kind NOT IN('studio_deterministic_success','studio_failure_after_claim') OR payload_hash!~'^[0-9a-f]{64}$'
 THEN RAISE EXCEPTION 'INVALID_COMMAND';END IF;
 PERFORM public.studio_assert_actor(actor,org,workspace,'studio.artifacts.generate',authorization_version);
 SELECT * INTO control FROM public.studio_artifact_runtime_control WHERE singleton FOR SHARE;
 SELECT * INTO flags FROM public.enterprise_transcript_workspace_flags WHERE org_id=org AND workspace_id=workspace FOR SHARE;
 IF control.singleton IS NULL OR NOT control.enabled OR control.read_only OR control.provider_enabled THEN RAISE EXCEPTION 'STUDIO_READ_ONLY';END IF;
 SELECT candidate.* INTO permit FROM public.authenticated_synthetic_permits candidate
 JOIN public.authenticated_synthetic_exercises exercise ON exercise.id=candidate.exercise_id
 JOIN public.authenticated_synthetic_actor_sessions binding ON binding.exercise_id=candidate.exercise_id AND binding.actor_id=candidate.actor_id AND binding.session_id=candidate.session_id
 WHERE candidate.id=permit_id AND candidate.actor_id=actor AND candidate.org_id=org AND candidate.workspace_id=workspace
  AND candidate.session_id=session_id AND candidate.request_id=request_id AND candidate.payload_hash=payload_hash
  AND candidate.expected_version=expected_aggregate_version AND candidate.kind=permit_kind
  AND candidate.command_type='studio.generation.request' AND candidate.state IN('armed','consumed')
  AND exercise.lifecycle='active' AND exercise.expires_at>statement_timestamp() AND binding.state='active'
  AND EXISTS(SELECT 1 FROM auth.sessions session WHERE session.id=session_id AND session.user_id=actor
    AND(session.not_after IS NULL OR session.not_after>statement_timestamp()))
 FOR SHARE OF candidate,binding,exercise;
 IF permit.id IS NULL THEN RAISE EXCEPTION 'AUTHENTICATED_SYNTHETIC_PERMIT_REJECTED';END IF;
 request_hash:=public.enterprise_sha256_jsonb(p_command);
 SELECT * INTO receipt FROM public.studio_artifact_command_receipts stored
  WHERE stored.org_id=org AND stored.actor_id=actor AND stored.command_type='studio.artifact.generation.request.v2' AND stored.idempotency_key=idempotency_key FOR UPDATE;
 IF receipt.id IS NOT NULL THEN
  IF receipt.workspace_id IS DISTINCT FROM workspace OR receipt.request_hash IS DISTINCT FROM request_hash THEN RAISE EXCEPTION 'STUDIO_IDEMPOTENCY_CONFLICT';END IF;
  IF receipt.status='committed' THEN
   SELECT * INTO attempt FROM public.studio_artifact_generation_attempts existing WHERE existing.request_id=receipt.request_id AND existing.org_id=org AND existing.requested_by=actor;
    IF attempt.id IS NULL OR attempt.authenticated_synthetic_permit_id IS DISTINCT FROM permit.id
      OR permit.state NOT IN('armed','consumed') THEN RAISE EXCEPTION 'AUTHENTICATED_SYNTHETIC_PERMIT_REJECTED';END IF;
   plan:=jsonb_build_object('attemptId',attempt.id,'artifactId',attempt.artifact_id,'promptKey',attempt.prompt_key,'promptVersion',attempt.prompt_version,
    'providerPlanHash',attempt.provider_plan_hash,'providerEffectKey',attempt.provider_effect_key,'sourcePackageId',attempt.source_package_id,
    'sourcePackageHash',attempt.source_package_hash,'templateKind',attempt.template_kind,'templateVersionId',COALESCE(attempt.template_id,attempt.tenant_template_version_id),
    'templateVersion',attempt.template_version,'templateHash',attempt.template_hash,'authenticatedSyntheticPermitId',attempt.authenticated_synthetic_permit_id,
    'authenticatedSyntheticKind',permit.kind,'authenticatedSyntheticSessionId',permit.session_id,'authenticatedSyntheticPayloadHash',permit.payload_hash,
    'authenticatedSyntheticExpectedVersion',permit.expected_version);
   RETURN receipt.response||jsonb_build_object('outcome','replayed','generationPlan',plan);
  END IF;
  RAISE EXCEPTION 'COMMAND_IN_PROGRESS';
 END IF;
 IF permit.state<>'armed' OR permit.expires_at<=statement_timestamp() THEN RAISE EXCEPTION 'AUTHENTICATED_SYNTHETIC_PERMIT_REJECTED';END IF;
 SELECT * INTO artifact FROM public.studio_artifact_aggregates WHERE id=artifact_id AND org_id=org AND workspace_id=workspace FOR UPDATE;
 SELECT * INTO package FROM public.studio_artifact_source_packages WHERE id=source_package_id AND artifact_id=artifact.id AND org_id=org AND workspace_id=workspace FOR SHARE;
 IF artifact.id IS NULL OR package.id IS NULL OR artifact.source_package_id IS DISTINCT FROM package.id OR artifact.source_package_hash IS DISTINCT FROM package.package_hash
  OR artifact.aggregate_version IS DISTINCT FROM expected_aggregate_version OR artifact.current_version_id IS DISTINCT FROM expected_current_version_id
  OR artifact.current_approved_version_id IS DISTINCT FROM expected_approved_version_id THEN RAISE EXCEPTION 'SOURCE_PACKAGE_STALE';END IF;
 IF NOT public.studio_pr_b_lock_source_package_current(package.id,org,workspace) THEN RAISE EXCEPTION 'SOURCE_PACKAGE_STALE';END IF;
 IF package.source_mode<>'assess_handoff' AND(flags.org_id IS NULL OR NOT flags.studio_multisource_enabled) THEN RAISE EXCEPTION 'STUDIO_FEATURE_DISABLED';END IF;
 IF package.source_mode='assess_handoff' AND NOT COALESCE((package.route_policy_snapshot->>'migrationBackfill')::boolean,false)
  AND(flags.org_id IS NULL OR NOT flags.module_handoffs_enabled) THEN RAISE EXCEPTION 'STUDIO_FEATURE_DISABLED';END IF;
 IF template_kind='system' THEN
  SELECT * INTO system_template FROM public.studio_system_template_versions WHERE id=template_version_id AND artifact_type=artifact.artifact_type AND superseded_at IS NULL FOR SHARE;
  IF system_template.id IS NULL THEN RAISE EXCEPTION 'TEMPLATE_STALE';END IF;
 ELSE
  IF flags.org_id IS NULL OR NOT flags.studio_tenant_templates_enabled THEN RAISE EXCEPTION 'STUDIO_FEATURE_DISABLED';END IF;
  SELECT * INTO tenant_template FROM public.studio_tenant_template_versions WHERE id=template_version_id AND org_id=org AND workspace_id=workspace AND status='approved' FOR SHARE;
  SELECT * INTO tenant_aggregate FROM public.studio_tenant_template_aggregates WHERE id=tenant_template.template_id AND org_id=org AND workspace_id=workspace FOR SHARE;
  IF tenant_template.id IS NULL OR tenant_aggregate.current_approved_version_id IS DISTINCT FROM tenant_template.id
   OR(tenant_template.artifact_class<>'custom' AND tenant_template.artifact_class IS DISTINCT FROM artifact.artifact_type) THEN RAISE EXCEPTION 'TEMPLATE_STALE';END IF;
 END IF;
 provider_plan_hash:=public.enterprise_sha256_jsonb(jsonb_build_object('transport','authenticated_synthetic','permitId',permit.id,
  'capability','studio.document.generate','promptKey','studio-multisource-generation','promptVersion','studio-pr-b-1','maximumOutputTokens',4000));
 input_hash:=public.enterprise_sha256_jsonb(jsonb_build_object('sourcePackageId',package.id,'sourcePackageHash',package.package_hash,
  'candidateManifestHash',package.candidate_manifest_hash,'anchorManifestHash',package.anchor_manifest_hash,'templateKind',template_kind,
  'templateVersionId',template_version_id,'templateHash',CASE template_kind WHEN 'system' THEN system_template.template_hash ELSE tenant_template.template_hash END,
  'providerPlanHash',provider_plan_hash,'expectedAggregateVersion',expected_aggregate_version,'expectedCurrentVersionId',expected_current_version_id,
  'expectedApprovedVersionId',expected_approved_version_id));
 INSERT INTO public.studio_artifact_command_receipts(org_id,workspace_id,actor_id,command_type,idempotency_key,request_id,request_hash,status)
 VALUES(org,workspace,actor,'studio.artifact.generation.request.v2',idempotency_key,request_id,request_hash,'claimed') RETURNING * INTO receipt;
 INSERT INTO public.studio_artifact_generation_attempts(artifact_id,org_id,workspace_id,handoff_id,requested_by,request_id,template_id,tenant_template_version_id,
  input_hash,state,source_package_id,source_package_hash,template_kind,template_version,template_hash,expected_aggregate_version,expected_current_version_id,
  expected_approved_version_id,requester_authorization_version,provider_plan_state,prompt_key,prompt_version,provider_plan_hash,provider_effect_key,
  candidate_manifest_hash,candidate_count,anchor_manifest_hash,anchor_count,timeout_at,transport_kind,authenticated_synthetic_permit_id)
 VALUES(artifact.id,org,workspace,artifact.handoff_id,actor,request_id,CASE WHEN template_kind='system' THEN system_template.id END,
  CASE WHEN template_kind='tenant' THEN tenant_template.id END,input_hash,'requested',package.id,package.package_hash,template_kind,
  CASE template_kind WHEN 'system' THEN system_template.template_version ELSE tenant_template.version::text END,
  CASE template_kind WHEN 'system' THEN system_template.template_hash ELSE tenant_template.template_hash END,
  expected_aggregate_version+1,expected_current_version_id,expected_approved_version_id,authorization_version,'authenticated_synthetic',
  'studio-multisource-generation','studio-pr-b-1',provider_plan_hash,encode(public.digest('studio-generation:'||receipt.id::text,'sha256'),'hex'),
  package.candidate_manifest_hash,package.candidate_count,package.anchor_manifest_hash,package.anchor_count,statement_timestamp()+interval '10 minutes',
  'authenticated_synthetic',permit.id) RETURNING * INTO attempt;
 UPDATE public.studio_artifact_aggregates SET aggregate_version=aggregate_version+1,updated_at=statement_timestamp() WHERE id=artifact.id RETURNING * INTO artifact;
 plan:=jsonb_build_object('attemptId',attempt.id,'artifactId',artifact.id,'capability','studio.document.generate','promptKey',attempt.prompt_key,
  'promptVersion',attempt.prompt_version,'maximumOutputTokens',4000,'providerPlanHash',attempt.provider_plan_hash,'providerEffectKey',attempt.provider_effect_key,
  'sourcePackageId',package.id,'sourcePackageHash',package.package_hash,'candidateManifestHash',package.candidate_manifest_hash,'candidateCount',package.candidate_count,
  'anchorManifestHash',package.anchor_manifest_hash,'anchorCount',package.anchor_count,'templateKind',template_kind,'templateVersionId',template_version_id,
  'templateVersion',attempt.template_version,'templateHash',attempt.template_hash,'expectedAggregateVersion',attempt.expected_aggregate_version,
  'expectedCurrentVersionId',attempt.expected_current_version_id,'expectedApprovedVersionId',attempt.expected_approved_version_id,
  'authenticatedSyntheticPermitId',permit.id,'authenticatedSyntheticKind',permit.kind,'authenticatedSyntheticSessionId',permit.session_id,
  'authenticatedSyntheticPayloadHash',permit.payload_hash,'authenticatedSyntheticExpectedVersion',permit.expected_version);
 result:=jsonb_build_object('outcome','committed','receiptId',receipt.id,'resourceId',artifact.id,'attemptId',attempt.id,'state','requested');
 UPDATE public.studio_artifact_command_receipts SET status='committed',resource_id=artifact.id,response=result,completed_at=statement_timestamp() WHERE id=receipt.id;
 INSERT INTO public.privileged_audit_events(id,org_id,workspace_id,actor_id,request_id,action,resource_type,resource_id,outcome,resource_version,metadata)
 VALUES(audit_id,org,workspace,actor,request_id,'studio.artifact.generation.request.v2','studio_generation_attempt',attempt.id,'succeeded',artifact.aggregate_version,
  jsonb_build_object('receiptId',receipt.id,'artifactId',artifact.id,'sourcePackageId',package.id,'templateVersionId',template_version_id,
   'transportKind','authenticated_synthetic','permitId',permit.id,'providerPlanHash',provider_plan_hash));
 RETURN result||jsonb_build_object('generationPlan',plan);
END$$;

-- Synthetic generation has its own fenced claim. It repeats the normal
-- source/template/current-authority checks but cannot load a provider route,
-- provider configuration, secret reference, or budget reservation.
CREATE OR REPLACE FUNCTION public.studio_artifact_generation_claim_authenticated_synthetic(
 p_attempt_id uuid,p_execution_token uuid,p_lease_seconds integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE attempt public.studio_artifact_generation_attempts;artifact public.studio_artifact_aggregates;
 source_package public.studio_artifact_source_packages;system_template public.studio_system_template_versions;
 tenant_template public.studio_tenant_template_versions;tenant_aggregate public.studio_tenant_template_aggregates;
 permit public.authenticated_synthetic_permits;exercise public.authenticated_synthetic_exercises;
 binding public.authenticated_synthetic_actor_sessions;flags public.enterprise_transcript_workspace_flags;
 control public.studio_artifact_runtime_control;result jsonb;
BEGIN
 IF p_execution_token IS NULL OR p_lease_seconds NOT BETWEEN 30 AND 300 THEN RAISE EXCEPTION 'INVALID_COMMAND';END IF;
 SELECT * INTO attempt FROM public.studio_artifact_generation_attempts WHERE id=p_attempt_id FOR UPDATE;
 IF attempt.id IS NULL THEN RAISE EXCEPTION 'RESOURCE_NOT_AVAILABLE';END IF;
 PERFORM public.studio_assert_actor(attempt.requested_by,attempt.org_id,attempt.workspace_id,'studio.artifacts.generate',attempt.requester_authorization_version);
 IF attempt.provider_plan_state<>'authenticated_synthetic' OR attempt.transport_kind<>'authenticated_synthetic'
  OR attempt.authenticated_synthetic_permit_id IS NULL OR attempt.provider_route_id IS NOT NULL
  OR attempt.provider_config_id IS NOT NULL OR attempt.provider_name IS NOT NULL OR attempt.provider_model IS NOT NULL
 THEN RAISE EXCEPTION 'AUTHENTICATED_SYNTHETIC_PERMIT_REJECTED';END IF;
 IF attempt.state IN('completed','stale_completed') THEN
  RETURN jsonb_build_object('outcome','replayed','attemptId',attempt.id,'state',attempt.state,
   'executionToken',attempt.execution_token,'executionFence',attempt.execution_fence,
   'leaseExpiresAt',attempt.execution_lease_expires_at,'providerAllowed',false,'reconcileOnly',false);
 END IF;
 SELECT * INTO artifact FROM public.studio_artifact_aggregates
  WHERE id=attempt.artifact_id AND org_id=attempt.org_id AND workspace_id=attempt.workspace_id FOR SHARE;
 SELECT * INTO source_package FROM public.studio_artifact_source_packages
  WHERE id=attempt.source_package_id AND artifact_id=artifact.id AND org_id=artifact.org_id AND workspace_id=artifact.workspace_id FOR SHARE;
 IF artifact.id IS NULL OR source_package.id IS NULL OR source_package.package_hash IS DISTINCT FROM attempt.source_package_hash
  OR artifact.source_package_id IS DISTINCT FROM source_package.id OR artifact.source_package_hash IS DISTINCT FROM source_package.package_hash
  OR artifact.aggregate_version IS DISTINCT FROM attempt.expected_aggregate_version
  OR artifact.current_version_id IS DISTINCT FROM attempt.expected_current_version_id
  OR artifact.current_approved_version_id IS DISTINCT FROM attempt.expected_approved_version_id
  OR NOT public.studio_pr_b_lock_source_package_current(source_package.id,attempt.org_id,attempt.workspace_id)
 THEN RAISE EXCEPTION 'SOURCE_PACKAGE_STALE';END IF;
 IF attempt.template_kind='system' THEN
  SELECT * INTO system_template FROM public.studio_system_template_versions WHERE id=attempt.template_id FOR SHARE;
  IF system_template.id IS NULL OR system_template.superseded_at IS NOT NULL
   OR system_template.template_hash IS DISTINCT FROM attempt.template_hash
   OR system_template.template_version IS DISTINCT FROM attempt.template_version
   OR system_template.artifact_type IS DISTINCT FROM artifact.artifact_type THEN RAISE EXCEPTION 'TEMPLATE_STALE';END IF;
 ELSE
  SELECT * INTO tenant_template FROM public.studio_tenant_template_versions
   WHERE id=attempt.tenant_template_version_id AND org_id=attempt.org_id AND workspace_id=attempt.workspace_id FOR SHARE;
  SELECT * INTO tenant_aggregate FROM public.studio_tenant_template_aggregates
   WHERE id=tenant_template.template_id AND org_id=attempt.org_id AND workspace_id=attempt.workspace_id FOR SHARE;
  IF tenant_template.id IS NULL OR tenant_template.status<>'approved'
   OR tenant_aggregate.current_approved_version_id IS DISTINCT FROM tenant_template.id
   OR tenant_template.template_hash IS DISTINCT FROM attempt.template_hash
   OR tenant_template.version::text IS DISTINCT FROM attempt.template_version
   OR(tenant_template.artifact_class<>'custom' AND tenant_template.artifact_class IS DISTINCT FROM artifact.artifact_type)
  THEN RAISE EXCEPTION 'TEMPLATE_STALE';END IF;
 END IF;
 SELECT * INTO flags FROM public.enterprise_transcript_workspace_flags
  WHERE org_id=attempt.org_id AND workspace_id=attempt.workspace_id FOR SHARE;
 IF source_package.source_mode<>'assess_handoff' AND(flags.org_id IS NULL OR NOT flags.studio_multisource_enabled)
 THEN RAISE EXCEPTION 'STUDIO_FEATURE_DISABLED';END IF;
 IF source_package.source_mode='assess_handoff' AND NOT COALESCE((source_package.route_policy_snapshot->>'migrationBackfill')::boolean,false)
  AND(flags.org_id IS NULL OR NOT flags.module_handoffs_enabled) THEN RAISE EXCEPTION 'STUDIO_FEATURE_DISABLED';END IF;
 SELECT * INTO control FROM public.studio_artifact_runtime_control WHERE singleton FOR SHARE;
 SELECT * INTO permit FROM public.authenticated_synthetic_permits
  WHERE id=attempt.authenticated_synthetic_permit_id FOR UPDATE;
 SELECT * INTO exercise FROM public.authenticated_synthetic_exercises WHERE id=permit.exercise_id FOR SHARE;
 SELECT * INTO binding FROM public.authenticated_synthetic_actor_sessions
  WHERE exercise_id=permit.exercise_id AND actor_id=permit.actor_id AND session_id=permit.session_id FOR SHARE;
 IF control.singleton IS NULL OR NOT control.enabled OR control.read_only OR control.provider_enabled
  OR permit.id IS NULL OR permit.state<>'armed' OR permit.expires_at<=statement_timestamp()
  OR permit.kind NOT IN('studio_deterministic_success','studio_failure_after_claim')
  OR permit.command_type<>'studio.generation.request' OR permit.actor_id IS DISTINCT FROM attempt.requested_by
  OR permit.org_id IS DISTINCT FROM attempt.org_id OR permit.workspace_id IS DISTINCT FROM attempt.workspace_id
  OR permit.request_id IS DISTINCT FROM attempt.request_id OR permit.expected_version+1 IS DISTINCT FROM attempt.expected_aggregate_version
  OR exercise.id IS NULL OR exercise.lifecycle<>'active' OR exercise.expires_at<=statement_timestamp()
  OR binding.exercise_id IS NULL OR binding.state<>'active'
  OR NOT EXISTS(SELECT 1 FROM auth.sessions session WHERE session.id=permit.session_id AND session.user_id=permit.actor_id
    AND(session.not_after IS NULL OR session.not_after>statement_timestamp()))
  OR EXISTS(SELECT 1 FROM public.enterprise_ai_budget_reservations reservation WHERE reservation.studio_attempt_id=attempt.id)
 THEN RAISE EXCEPTION 'AUTHENTICATED_SYNTHETIC_PERMIT_REJECTED';END IF;
 IF attempt.state='generating' THEN
  IF attempt.execution_token IS DISTINCT FROM p_execution_token OR attempt.execution_lease_expires_at<=statement_timestamp()
  THEN RAISE EXCEPTION 'COMMAND_IN_PROGRESS';END IF;
 ELSIF attempt.state='requested' THEN
  UPDATE public.studio_artifact_generation_attempts SET execution_token=p_execution_token,execution_fence=execution_fence+1,
   execution_lease_expires_at=statement_timestamp()+make_interval(secs=>p_lease_seconds),state='generating',
   started_at=COALESCE(started_at,statement_timestamp()) WHERE id=attempt.id RETURNING * INTO attempt;
  INSERT INTO public.studio_generation_recovery_events(attempt_id,artifact_id,org_id,workspace_id,execution_fence,event_type)
  VALUES(attempt.id,attempt.artifact_id,attempt.org_id,attempt.workspace_id,attempt.execution_fence,'lease_claimed');
 ELSE RAISE EXCEPTION 'VERSION_CONFLICT';END IF;
 result:=jsonb_build_object('outcome',CASE WHEN attempt.execution_fence=1 THEN 'committed' ELSE 'replayed' END,
  'attemptId',attempt.id,'artifactId',attempt.artifact_id,'artifactType',artifact.artifact_type,
  'organizationId',attempt.org_id,'workspaceId',attempt.workspace_id,'actorId',attempt.requested_by,'requestId',attempt.request_id,
  'executionToken',attempt.execution_token,'executionFence',attempt.execution_fence,'leaseExpiresAt',attempt.execution_lease_expires_at,
  'providerAllowed',true,'reconcileOnly',false,'sourcePackageId',attempt.source_package_id,'sourcePackageHash',attempt.source_package_hash,
  'templateKind',attempt.template_kind,'templateVersionId',COALESCE(attempt.template_id,attempt.tenant_template_version_id),
  'templateVersion',attempt.template_version,'templateHash',attempt.template_hash,'promptKey',attempt.prompt_key,
  'promptVersion',attempt.prompt_version,'maximumOutputTokens',4000,'providerPlanHash',attempt.provider_plan_hash,
  'expectedAggregateVersion',attempt.expected_aggregate_version,'expectedCurrentVersionId',attempt.expected_current_version_id,
  'expectedApprovedVersionId',attempt.expected_approved_version_id,'authenticatedSyntheticPermitId',permit.id,
  'authenticatedSyntheticKind',permit.kind,'authenticatedSyntheticSessionId',permit.session_id,
  'authenticatedSyntheticPayloadHash',permit.payload_hash,'authenticatedSyntheticExpectedVersion',permit.expected_version);
 RETURN result;
END$$;

CREATE OR REPLACE FUNCTION public.authenticated_synthetic_consume_studio_permit(
 p_permit_id uuid,p_actor_id uuid,p_org_id uuid,p_workspace_id uuid,p_session_id uuid,p_request_id uuid,
 p_payload_hash text,p_expected_version bigint,p_attempt_id uuid,p_execution_token uuid,p_execution_fence bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE permit public.authenticated_synthetic_permits;exercise public.authenticated_synthetic_exercises;
 binding public.authenticated_synthetic_actor_sessions;attempt public.studio_artifact_generation_attempts;
BEGIN
 SELECT * INTO permit FROM public.authenticated_synthetic_permits WHERE id=p_permit_id FOR UPDATE;
 SELECT * INTO exercise FROM public.authenticated_synthetic_exercises WHERE id=permit.exercise_id FOR SHARE;
 SELECT * INTO binding FROM public.authenticated_synthetic_actor_sessions
  WHERE exercise_id=permit.exercise_id AND actor_id=permit.actor_id AND session_id=permit.session_id FOR SHARE;
 SELECT * INTO attempt FROM public.studio_artifact_generation_attempts WHERE id=p_attempt_id FOR UPDATE;
 IF permit.id IS NULL OR permit.state<>'armed' OR permit.expires_at<=statement_timestamp()
  OR exercise.lifecycle<>'active' OR exercise.expires_at<=statement_timestamp() OR binding.state<>'active'
  OR permit.actor_id IS DISTINCT FROM p_actor_id OR permit.org_id IS DISTINCT FROM p_org_id OR permit.workspace_id IS DISTINCT FROM p_workspace_id
  OR permit.session_id IS DISTINCT FROM p_session_id OR permit.request_id IS DISTINCT FROM p_request_id
  OR permit.payload_hash IS DISTINCT FROM p_payload_hash OR permit.expected_version IS DISTINCT FROM p_expected_version
  OR permit.kind NOT IN('studio_deterministic_success','studio_failure_after_claim') OR permit.command_type<>'studio.generation.request'
  OR attempt.id IS NULL OR attempt.authenticated_synthetic_permit_id IS DISTINCT FROM permit.id
  OR attempt.transport_kind<>'authenticated_synthetic' OR attempt.requested_by IS DISTINCT FROM p_actor_id
  OR attempt.org_id IS DISTINCT FROM p_org_id OR attempt.workspace_id IS DISTINCT FROM p_workspace_id
  OR attempt.request_id IS DISTINCT FROM p_request_id OR attempt.expected_aggregate_version IS DISTINCT FROM p_expected_version+1
  OR attempt.state<>'generating' OR attempt.execution_token IS DISTINCT FROM p_execution_token
  OR attempt.execution_fence IS DISTINCT FROM p_execution_fence OR attempt.execution_lease_expires_at<=statement_timestamp()
  OR EXISTS(SELECT 1 FROM public.enterprise_ai_budget_reservations reservation WHERE reservation.studio_attempt_id=attempt.id)
  OR NOT EXISTS(SELECT 1 FROM auth.sessions session WHERE session.id=p_session_id AND session.user_id=p_actor_id
    AND(session.not_after IS NULL OR session.not_after>statement_timestamp()))
 THEN RAISE EXCEPTION 'AUTHENTICATED_SYNTHETIC_PERMIT_REJECTED'; END IF;
 UPDATE public.authenticated_synthetic_permits SET state='consumed',attempt_id=attempt.id,execution_fence=attempt.execution_fence,
  consumed_at=statement_timestamp() WHERE id=permit.id RETURNING * INTO permit;
 INSERT INTO public.authenticated_synthetic_permit_events(exercise_id,permit_id,org_id,workspace_id,actor_id,session_hash,
  request_hash,payload_hash,event_type,command_type,attempt_id,execution_fence)
 VALUES(permit.exercise_id,permit.id,permit.org_id,permit.workspace_id,permit.actor_id,binding.session_hash,
  'sha256:'||encode(public.digest(permit.request_id::text,'sha256'),'hex'),'sha256:'||permit.payload_hash,
  'consumed_after_claim',permit.command_type,attempt.id,attempt.execution_fence);
 RETURN jsonb_build_object('consumed',true,'kind',permit.kind);
END$$;

CREATE OR REPLACE FUNCTION public.authenticated_synthetic_consume_process_fault(
 p_actor_id uuid,p_org_id uuid,p_workspace_id uuid,p_session_id uuid,p_command_type text,p_request_id uuid,p_payload_hash text,p_expected_version bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE permit public.authenticated_synthetic_permits;binding public.authenticated_synthetic_actor_sessions;
BEGIN
 SELECT candidate.* INTO permit FROM public.authenticated_synthetic_permits candidate
 JOIN public.authenticated_synthetic_exercises exercise ON exercise.id=candidate.exercise_id
 JOIN public.authenticated_synthetic_actor_sessions session_binding ON session_binding.exercise_id=candidate.exercise_id
  AND session_binding.actor_id=candidate.actor_id AND session_binding.session_id=candidate.session_id
 WHERE candidate.actor_id=p_actor_id AND candidate.org_id=p_org_id AND candidate.workspace_id=p_workspace_id
  AND candidate.request_id=p_request_id AND candidate.kind='process_server_error_precommit'
 ORDER BY (exercise.lifecycle='active') DESC,candidate.armed_at DESC,candidate.id
 FOR UPDATE OF candidate;
 IF permit.id IS NULL THEN RETURN jsonb_build_object('consumed',false); END IF;
 IF permit.session_id IS DISTINCT FROM p_session_id OR permit.payload_hash IS DISTINCT FROM p_payload_hash
  OR permit.expected_version IS DISTINCT FROM p_expected_version OR permit.command_type IS DISTINCT FROM p_command_type
  OR permit.state<>'armed' OR permit.expires_at<=statement_timestamp()
  OR NOT EXISTS(SELECT 1 FROM public.authenticated_synthetic_exercises stored
    WHERE stored.id=permit.exercise_id AND stored.lifecycle='active' AND stored.expires_at>statement_timestamp())
  OR NOT EXISTS(SELECT 1 FROM public.authenticated_synthetic_actor_sessions stored
    WHERE stored.exercise_id=permit.exercise_id AND stored.actor_id=permit.actor_id
      AND stored.session_id=permit.session_id AND stored.state='active')
  OR NOT EXISTS(SELECT 1 FROM auth.sessions auth_session WHERE auth_session.id=p_session_id AND auth_session.user_id=p_actor_id
    AND(auth_session.not_after IS NULL OR auth_session.not_after>statement_timestamp()))
 THEN RAISE EXCEPTION 'AUTHENTICATED_SYNTHETIC_PERMIT_REJECTED'; END IF;
 SELECT * INTO binding FROM public.authenticated_synthetic_actor_sessions
  WHERE exercise_id=permit.exercise_id AND actor_id=permit.actor_id AND session_id=permit.session_id;
 UPDATE public.authenticated_synthetic_permits SET state='consumed',consumed_at=statement_timestamp()
  WHERE id=permit.id RETURNING * INTO permit;
 INSERT INTO public.authenticated_synthetic_permit_events(exercise_id,permit_id,org_id,workspace_id,actor_id,session_hash,
  request_hash,payload_hash,event_type,command_type)
 VALUES(permit.exercise_id,permit.id,permit.org_id,permit.workspace_id,permit.actor_id,binding.session_hash,
  'sha256:'||encode(public.digest(permit.request_id::text,'sha256'),'hex'),'sha256:'||permit.payload_hash,'consumed_precommit',permit.command_type);
 RETURN jsonb_build_object('consumed',true);
END$$;

CREATE OR REPLACE FUNCTION public.authenticated_synthetic_quiesce(p_exercise_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE exercise public.authenticated_synthetic_exercises;revoked_permits integer;revoked_sessions integer;
BEGIN
 SELECT * INTO exercise FROM public.authenticated_synthetic_exercises WHERE id=p_exercise_id FOR UPDATE;
 IF exercise.id IS NULL THEN RAISE EXCEPTION 'AUTHENTICATED_SYNTHETIC_EXERCISE_NOT_FOUND'; END IF;
 IF exercise.lifecycle='quiesced' THEN
  RETURN jsonb_build_object('exerciseId',exercise.id,'lifecycle','quiesced','revokedPermits',0,'revokedSessions',0,
   'retainedClassification','immutable_synthetic_history');
 END IF;
 WITH changed AS (UPDATE public.authenticated_synthetic_permits SET state='revoked',revoked_at=statement_timestamp()
  WHERE exercise_id=exercise.id AND state='armed' RETURNING *) SELECT count(*)::integer INTO revoked_permits FROM changed;
 INSERT INTO public.authenticated_synthetic_permit_events(exercise_id,permit_id,org_id,workspace_id,actor_id,session_hash,
  request_hash,payload_hash,event_type,command_type)
 SELECT permit.exercise_id,permit.id,permit.org_id,permit.workspace_id,permit.actor_id,binding.session_hash,
  'sha256:'||encode(public.digest(permit.request_id::text,'sha256'),'hex'),'sha256:'||permit.payload_hash,'revoked',permit.command_type
 FROM public.authenticated_synthetic_permits permit
 JOIN public.authenticated_synthetic_actor_sessions binding ON binding.exercise_id=permit.exercise_id
  AND binding.actor_id=permit.actor_id AND binding.session_id=permit.session_id
 WHERE permit.exercise_id=exercise.id AND permit.state='revoked' AND permit.revoked_at=statement_timestamp();
 WITH changed AS (UPDATE public.authenticated_synthetic_actor_sessions SET state='revoked',revoked_at=statement_timestamp()
  WHERE exercise_id=exercise.id AND state='active' RETURNING *) SELECT count(*)::integer INTO revoked_sessions FROM changed;
 UPDATE public.authenticated_synthetic_exercises SET lifecycle='quiesced',quiesced_at=statement_timestamp()
  WHERE id=exercise.id RETURNING * INTO exercise;
 RETURN jsonb_build_object('exerciseId',exercise.id,'lifecycle',exercise.lifecycle,'revokedPermits',revoked_permits,
  'revokedSessions',revoked_sessions,'retainedClassification','immutable_synthetic_history');
END$$;

CREATE OR REPLACE FUNCTION public.authenticated_synthetic_observe(p_exercise_id uuid,p_from timestamptz,p_to timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog STABLE AS $$
DECLARE exercise public.authenticated_synthetic_exercises;
BEGIN
 IF p_from IS NULL OR p_to IS NULL OR p_from>p_to OR p_to-p_from>interval '12 hours' THEN
  RAISE EXCEPTION 'AUTHENTICATED_SYNTHETIC_OBSERVATION_REJECTED'; END IF;
 SELECT * INTO exercise FROM public.authenticated_synthetic_exercises WHERE id=p_exercise_id;
 IF exercise.id IS NULL THEN RAISE EXCEPTION 'AUTHENTICATED_SYNTHETIC_EXERCISE_NOT_FOUND'; END IF;
 RETURN jsonb_build_object(
  'schemaVersion','authenticated-synthetic-authority-observation-v1','capturedAt',statement_timestamp(),
  'exercise',jsonb_build_object('exerciseIdHash','sha256:'||encode(public.digest(exercise.id::text,'sha256'),'hex'),
   'releaseSha',exercise.release_sha,'deploymentIdHash','sha256:'||encode(public.digest(exercise.deployment_id,'sha256'),'hex'),
   'origin',exercise.origin,'backendFingerprint',exercise.backend_fingerprint,'migrationTip',exercise.migration_tip,
   'migrationDigest',exercise.migration_digest,'exerciseDigest',exercise.exercise_digest,'profileVersion',exercise.profile_version,
   'catalogDigest',exercise.catalog_digest,'sourceDigest',exercise.source_digest,
   'organizationHash','sha256:'||encode(public.digest(exercise.org_id::text,'sha256'),'hex'),
   'workspaceHash','sha256:'||encode(public.digest(exercise.workspace_id::text,'sha256'),'hex'),
   'lifecycle',exercise.lifecycle,'expiresAt',exercise.expires_at,'activatedAt',exercise.activated_at,'quiescedAt',exercise.quiesced_at),
  'actorSessions',(SELECT COALESCE(jsonb_agg(jsonb_build_object('persona',binding.persona,'actorHash',binding.actor_hash,
   'sessionHash',binding.session_hash,'state',binding.state,'boundAt',binding.bound_at,'revokedAt',binding.revoked_at)
   ORDER BY binding.persona),'[]'::jsonb) FROM public.authenticated_synthetic_actor_sessions binding WHERE binding.exercise_id=exercise.id),
  'permits',(SELECT COALESCE(jsonb_agg(jsonb_build_object('permitIdHash','sha256:'||encode(public.digest(permit.id::text,'sha256'),'hex'),
   'kind',permit.kind,'commandType',permit.command_type,'requestHash','sha256:'||encode(public.digest(permit.request_id::text,'sha256'),'hex'),
   'payloadHash','sha256:'||permit.payload_hash,'expectedVersion',permit.expected_version,'state',permit.state,
   'attemptIdHash',CASE WHEN permit.attempt_id IS NULL THEN NULL ELSE 'sha256:'||encode(public.digest(permit.attempt_id::text,'sha256'),'hex') END,
   'executionFence',permit.execution_fence,'armedAt',permit.armed_at,'expiresAt',permit.expires_at,
   'consumedAt',permit.consumed_at,'revokedAt',permit.revoked_at,'classification',CASE WHEN permit.state='armed' THEN 'transient_control' ELSE 'immutable_history' END)
   ORDER BY permit.armed_at,permit.id),'[]'::jsonb) FROM public.authenticated_synthetic_permits permit WHERE permit.exercise_id=exercise.id),
  'permitEvents',(SELECT COALESCE(jsonb_agg(jsonb_build_object('eventIdHash','sha256:'||encode(public.digest(event.id::text,'sha256'),'hex'),
   'permitIdHash','sha256:'||encode(public.digest(event.permit_id::text,'sha256'),'hex'),'actorHash','sha256:'||encode(public.digest(event.actor_id::text,'sha256'),'hex'),
   'sessionHash',event.session_hash,'requestHash',event.request_hash,'payloadHash',event.payload_hash,'eventType',event.event_type,
   'commandType',event.command_type,'attemptIdHash',CASE WHEN event.attempt_id IS NULL THEN NULL ELSE 'sha256:'||encode(public.digest(event.attempt_id::text,'sha256'),'hex') END,
   'executionFence',event.execution_fence,'occurredAt',event.occurred_at,'classification','immutable_history') ORDER BY event.occurred_at,event.id),'[]'::jsonb)
   FROM public.authenticated_synthetic_permit_events event WHERE event.exercise_id=exercise.id AND event.occurred_at BETWEEN p_from AND p_to)
 );
END$$;

REVOKE EXECUTE ON FUNCTION public.authenticated_synthetic_exercise_activate(uuid,text,text,text,text,text,text,text,text,text,text,uuid,uuid,timestamptz),
 public.authenticated_synthetic_bind_session(uuid,uuid,uuid,text),
 public.authenticated_synthetic_arm_permit(uuid,uuid,text,text,uuid,uuid,uuid,text,bigint,timestamptz),
 public.authenticated_synthetic_resolve_studio_permit(uuid,uuid,uuid,uuid,uuid,text,bigint),
 public.studio_artifact_generation_request_authenticated_synthetic(jsonb),
 public.studio_artifact_generation_claim_authenticated_synthetic(uuid,uuid,integer),
 public.authenticated_synthetic_consume_studio_permit(uuid,uuid,uuid,uuid,uuid,uuid,text,bigint,uuid,uuid,bigint),
 public.authenticated_synthetic_consume_process_fault(uuid,uuid,uuid,uuid,text,uuid,text,bigint),
 public.authenticated_synthetic_quiesce(uuid),public.authenticated_synthetic_observe(uuid,timestamptz,timestamptz)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.authenticated_synthetic_exercise_activate(uuid,text,text,text,text,text,text,text,text,text,text,uuid,uuid,timestamptz),
 public.authenticated_synthetic_bind_session(uuid,uuid,uuid,text),
 public.authenticated_synthetic_arm_permit(uuid,uuid,text,text,uuid,uuid,uuid,text,bigint,timestamptz),
 public.authenticated_synthetic_resolve_studio_permit(uuid,uuid,uuid,uuid,uuid,text,bigint),
 public.studio_artifact_generation_request_authenticated_synthetic(jsonb),
 public.studio_artifact_generation_claim_authenticated_synthetic(uuid,uuid,integer),
 public.authenticated_synthetic_consume_studio_permit(uuid,uuid,uuid,uuid,uuid,uuid,text,bigint,uuid,uuid,bigint),
 public.authenticated_synthetic_consume_process_fault(uuid,uuid,uuid,uuid,text,uuid,text,bigint),
 public.authenticated_synthetic_quiesce(uuid),public.authenticated_synthetic_observe(uuid,timestamptz,timestamptz)
 TO service_role;

COMMENT ON TABLE public.authenticated_synthetic_exercises IS
'Default-off, nonproduction-only authenticated acceptance exercise binding. Quiesce is the rollback boundary.';
COMMENT ON TABLE public.authenticated_synthetic_permits IS
'Controller-armed exact one-shot request/session permits; never exposed to browser roles or provider ledgers.';
COMMENT ON FUNCTION public.authenticated_synthetic_consume_process_fault(uuid,uuid,uuid,uuid,text,uuid,text,bigint) IS
'Consumes only an exact authenticated precommit process fault after command authorization and before domain, receipt or audit mutation.';

DO $authenticated_synthetic_marker$
DECLARE final_activation_definition text;bootstrap_definition text;assert_marker_definition text;brd_v3_activation_definition text;
 old_not_equal text:='marker.migration_tip<>''20261010051413''';new_not_equal text:='marker.migration_tip<>''20261010144356''';
 old_equal text:='marker.migration_tip=''20261010051413''';new_equal text:='marker.migration_tip=''20261010144356''';
 old_assert text:='marker.migration_tip = ''20261010051413''';new_assert text:='marker.migration_tip = ''20261010144356''';
BEGIN
 SELECT replace(pg_get_functiondef('public.synthetic_ai_campaign_activate_final_continuation(uuid,uuid,uuid,bigint,text,text,uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,integer)'::regprocedure),chr(13)||chr(10),chr(10)) INTO STRICT final_activation_definition;
 SELECT replace(pg_get_functiondef('public.synthetic_ai_campaign_bootstrap(uuid,uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,uuid,timestamptz)'::regprocedure),chr(13)||chr(10),chr(10)) INTO STRICT bootstrap_definition;
 SELECT replace(pg_get_functiondef('public.pr_c_controlled_human_assert_marker()'::regprocedure),chr(13)||chr(10),chr(10)) INTO STRICT assert_marker_definition;
 SELECT replace(pg_get_functiondef('public.synthetic_ai_campaign_activate_brd_v3_quality_validation(uuid,uuid,uuid,bigint,text,text,uuid,uuid,uuid,uuid,uuid,uuid,uuid,bigint,uuid,text,uuid,uuid,uuid,uuid,text,text,integer)'::regprocedure),chr(13)||chr(10),chr(10)) INTO STRICT brd_v3_activation_definition;
 IF position(old_not_equal in final_activation_definition)=0 OR position(old_equal in bootstrap_definition)=0
  OR position(old_assert in assert_marker_definition)=0 OR position(old_not_equal in brd_v3_activation_definition)=0
 THEN RAISE EXCEPTION 'AUTHENTICATED_SYNTHETIC_MARKER_SOURCE_MISMATCH'; END IF;
 EXECUTE replace(final_activation_definition,old_not_equal,new_not_equal);
 EXECUTE replace(bootstrap_definition,old_equal,new_equal);
 EXECUTE replace(assert_marker_definition,old_assert,new_assert);
 EXECUTE replace(brd_v3_activation_definition,old_not_equal,new_not_equal);
 ALTER TABLE public.pr_c_controlled_human_exercises DROP CONSTRAINT pr_c_controlled_human_exercises_migration_tip_check;
 ALTER TABLE public.pr_c_controlled_human_exercises ADD CONSTRAINT pr_c_controlled_human_exercises_migration_tip_check
  CHECK(migration_tip IN('20260904120000','20260924113000','20260926053818','20260928060000','20261003015246','20261003055918','20261003123459','20261003150800','20261004025101','20261004112232','20261008022445','20261009162752','20261010025331','20261010051100','20261010051413','20261010144356'));
 ALTER TABLE public.hosted_pilot_environment_identity DROP CONSTRAINT hosted_pilot_environment_identity_migration_tip_check;
 UPDATE public.hosted_pilot_environment_identity SET migration_tip='20261010144356' WHERE singleton;
 ALTER TABLE public.hosted_pilot_environment_identity ADD CONSTRAINT hosted_pilot_environment_identity_migration_tip_check CHECK(migration_tip='20261010144356');
END
$authenticated_synthetic_marker$;
