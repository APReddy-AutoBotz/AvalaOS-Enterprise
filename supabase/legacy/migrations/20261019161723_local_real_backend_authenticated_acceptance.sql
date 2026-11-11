-- Local real-backend authenticated acceptance authority.
--
-- The migration adds a second, exact execution identity to the existing
-- authenticated synthetic exercise authority. Existing Netlify-bound rows and
-- the hosted activation RPC keep their original identity contract. The local
-- RPC is service-role only, accepts only the loopback production build origin,
-- and cannot activate provider calls, production data, or customer data.

DO $local_real_backend_source$
DECLARE
  marker public.hosted_pilot_environment_identity;
BEGIN
  LOCK TABLE public.hosted_pilot_environment_identity IN SHARE ROW EXCLUSIVE MODE;
  SELECT * INTO STRICT marker
  FROM public.hosted_pilot_environment_identity
  WHERE singleton
  FOR UPDATE;

  IF marker.product_key <> 'avalaos-core'
    OR marker.environment_class <> 'hosted_nonproduction_pilot'
    OR marker.schema_contract <> 'hosted-pilot-2026-08'
    OR marker.migration_tip <> '20261011053000'
    OR marker.production_authorized
    OR marker.customer_data_authorized
    OR marker.real_provider_calls_authorized
    OR to_regprocedure('public.authenticated_synthetic_local_exercise_activate(uuid,text,text,text,text,text,text,text,text,text,text,uuid,uuid,timestamptz)') IS NOT NULL
    OR EXISTS (
      SELECT 1 FROM public.authenticated_synthetic_exercises
      WHERE lifecycle = 'active'
    )
  THEN
    RAISE EXCEPTION 'LOCAL_REAL_BACKEND_ACCEPTANCE_SOURCE_MISMATCH';
  END IF;
END
$local_real_backend_source$;

ALTER TABLE public.authenticated_synthetic_exercises
  ADD COLUMN execution_kind text NOT NULL DEFAULT 'hosted_authenticated_synthetic',
  ADD COLUMN build_digest text;

ALTER TABLE public.authenticated_synthetic_exercises
  ALTER COLUMN deployment_id DROP NOT NULL;

ALTER TABLE public.authenticated_synthetic_exercises
  DROP CONSTRAINT authenticated_synthetic_exercises_origin_check,
  DROP CONSTRAINT authenticated_synthetic_exercises_profile_version_check;

ALTER TABLE public.authenticated_synthetic_exercises
  ADD CONSTRAINT authenticated_synthetic_exercises_execution_kind_check
    CHECK(execution_kind IN('hosted_authenticated_synthetic','local_real_backend_authenticated')),
  ADD CONSTRAINT authenticated_synthetic_exercises_build_digest_check
    CHECK(build_digest IS NULL OR build_digest~'^sha256:[0-9a-f]{64}$'),
  ADD CONSTRAINT authenticated_synthetic_exercises_profile_version_check
    CHECK(profile_version IN(
      'hosted-authenticated-synthetic-profile-v2',
      'hosted-authenticated-synthetic-profile-v3',
      'local-real-backend-authenticated-profile-v1'
    )),
  ADD CONSTRAINT authenticated_synthetic_exercises_execution_identity_check CHECK(
    (execution_kind='hosted_authenticated_synthetic'
      AND deployment_id IS NOT NULL
      AND deployment_id~'^[0-9a-f]{24}$'
      AND origin='https://avalaos-pilot.netlify.app'
      AND build_digest IS NULL
      AND profile_version IN(
        'hosted-authenticated-synthetic-profile-v2',
        'hosted-authenticated-synthetic-profile-v3'
      ))
    OR
    (execution_kind='local_real_backend_authenticated'
      AND deployment_id IS NULL
      AND origin='http://127.0.0.1:4173'
      AND build_digest IS NOT NULL
      AND build_digest~'^sha256:[0-9a-f]{64}$'
      AND profile_version='local-real-backend-authenticated-profile-v1')
  );

CREATE OR REPLACE FUNCTION public.authenticated_synthetic_local_exercise_activate(
  p_exercise_id uuid,p_release_sha text,p_build_digest text,p_origin text,p_backend_fingerprint text,p_migration_tip text,
  p_migration_digest text,p_exercise_digest text,p_profile_version text,p_catalog_digest text,p_source_digest text,
  p_org uuid,p_workspace uuid,p_expires_at timestamptz
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  marker public.hosted_pilot_environment_identity;
  studio public.studio_artifact_runtime_control;
  enterprise public.enterprise_intelligence_runtime_control;
  exercise public.authenticated_synthetic_exercises;
BEGIN
  SELECT * INTO STRICT marker
  FROM public.hosted_pilot_environment_identity
  WHERE singleton
  FOR SHARE;
  SELECT * INTO STRICT studio
  FROM public.studio_artifact_runtime_control
  WHERE singleton
  FOR SHARE;
  SELECT * INTO STRICT enterprise
  FROM public.enterprise_intelligence_runtime_control
  WHERE singleton
  FOR SHARE;

  IF p_exercise_id IS NULL OR p_org IS NULL OR p_workspace IS NULL OR p_expires_at IS NULL
    OR p_release_sha IS NULL OR p_build_digest IS NULL OR p_origin IS NULL
    OR p_backend_fingerprint IS NULL OR p_migration_tip IS NULL OR p_migration_digest IS NULL
    OR p_exercise_digest IS NULL OR p_profile_version IS NULL OR p_catalog_digest IS NULL
    OR p_source_digest IS NULL
    OR p_release_sha!~'^[0-9a-f]{40}$'
    OR p_build_digest!~'^sha256:[0-9a-f]{64}$'
    OR p_origin IS DISTINCT FROM 'http://127.0.0.1:4173'
    OR p_backend_fingerprint!~'^sha256:[0-9a-f]{64}$'
    OR p_migration_tip<>'20261019161723'
    OR p_migration_digest!~'^sha256:[0-9a-f]{64}$'
    OR p_exercise_digest!~'^sha256:[0-9a-f]{64}$'
    OR p_profile_version<>'local-real-backend-authenticated-profile-v1'
    OR p_catalog_digest!~'^sha256:[0-9a-f]{64}$'
    OR p_source_digest!~'^sha256:[0-9a-f]{64}$'
    OR p_expires_at<=statement_timestamp()
    OR p_expires_at>statement_timestamp()+interval '6 hours'
    OR marker.product_key<>'avalaos-core'
    OR marker.environment_class<>'hosted_nonproduction_pilot'
    OR marker.schema_contract<>'hosted-pilot-2026-08'
    OR marker.migration_tip<>p_migration_tip
    OR marker.production_authorized
    OR marker.customer_data_authorized
    OR marker.real_provider_calls_authorized
    OR NOT studio.enabled
    OR studio.read_only
    OR studio.provider_enabled
    OR NOT enterprise.enabled
    OR enterprise.read_only
    OR enterprise.provider_enabled
    OR NOT EXISTS(
      SELECT 1 FROM public.workspaces workspace
      WHERE workspace.id=p_workspace AND workspace.org_id=p_org
    )
  THEN
    RAISE EXCEPTION 'LOCAL_REAL_BACKEND_ACCEPTANCE_ACTIVATION_REJECTED';
  END IF;

  INSERT INTO public.authenticated_synthetic_exercises(
    id,environment_class,release_sha,deployment_id,origin,backend_fingerprint,
    migration_tip,migration_digest,exercise_digest,profile_version,catalog_digest,source_digest,
    org_id,workspace_id,expires_at,execution_kind,build_digest
  ) VALUES(
    p_exercise_id,marker.environment_class,p_release_sha,NULL,p_origin,p_backend_fingerprint,
    p_migration_tip,p_migration_digest,p_exercise_digest,p_profile_version,p_catalog_digest,p_source_digest,
    p_org,p_workspace,p_expires_at,'local_real_backend_authenticated',p_build_digest
  ) RETURNING * INTO exercise;

  RETURN jsonb_build_object(
    'exerciseId',exercise.id,
    'lifecycle',exercise.lifecycle,
    'executionKind',exercise.execution_kind,
    'buildDigest',exercise.build_digest,
    'expiresAt',exercise.expires_at
  );
END
$$;

REVOKE EXECUTE ON FUNCTION
  public.authenticated_synthetic_local_exercise_activate(uuid,text,text,text,text,text,text,text,text,text,text,uuid,uuid,timestamptz)
FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION
  public.authenticated_synthetic_local_exercise_activate(uuid,text,text,text,text,text,text,text,text,text,text,uuid,uuid,timestamptz)
TO service_role;

-- The hosted observer keeps its original object shape for retained hosted
-- evidence. Local evidence carries the exact stored build identity and never
-- fabricates a Netlify deployment identifier.
CREATE OR REPLACE FUNCTION public.authenticated_synthetic_observe(
  p_exercise_id uuid,p_from timestamptz,p_to timestamptz
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog STABLE AS $$
DECLARE exercise public.authenticated_synthetic_exercises;
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_from>p_to OR p_to-p_from>interval '12 hours' THEN
    RAISE EXCEPTION 'AUTHENTICATED_SYNTHETIC_OBSERVATION_REJECTED';
  END IF;
  SELECT * INTO exercise FROM public.authenticated_synthetic_exercises WHERE id=p_exercise_id;
  IF exercise.id IS NULL THEN RAISE EXCEPTION 'AUTHENTICATED_SYNTHETIC_EXERCISE_NOT_FOUND'; END IF;
  RETURN jsonb_build_object(
    'schemaVersion','authenticated-synthetic-authority-observation-v1','capturedAt',statement_timestamp(),
    'exercise',CASE WHEN exercise.execution_kind='local_real_backend_authenticated' THEN
      jsonb_build_object(
        'exerciseIdHash','sha256:'||encode(public.digest(exercise.id::text,'sha256'),'hex'),
        'releaseSha',exercise.release_sha,'executionKind',exercise.execution_kind,
        'buildDigest',exercise.build_digest,'origin',exercise.origin,
        'backendFingerprint',exercise.backend_fingerprint,'migrationTip',exercise.migration_tip,
        'migrationDigest',exercise.migration_digest,'exerciseDigest',exercise.exercise_digest,
        'profileVersion',exercise.profile_version,'catalogDigest',exercise.catalog_digest,
        'sourceDigest',exercise.source_digest,
        'organizationHash','sha256:'||encode(public.digest(exercise.org_id::text,'sha256'),'hex'),
        'workspaceHash','sha256:'||encode(public.digest(exercise.workspace_id::text,'sha256'),'hex'),
        'lifecycle',exercise.lifecycle,'expiresAt',exercise.expires_at,
        'activatedAt',exercise.activated_at,'quiescedAt',exercise.quiesced_at
      )
    ELSE
      jsonb_build_object(
        'exerciseIdHash','sha256:'||encode(public.digest(exercise.id::text,'sha256'),'hex'),
        'releaseSha',exercise.release_sha,
        'deploymentIdHash','sha256:'||encode(public.digest(exercise.deployment_id,'sha256'),'hex'),
        'origin',exercise.origin,'backendFingerprint',exercise.backend_fingerprint,
        'migrationTip',exercise.migration_tip,'migrationDigest',exercise.migration_digest,
        'exerciseDigest',exercise.exercise_digest,'profileVersion',exercise.profile_version,
        'catalogDigest',exercise.catalog_digest,'sourceDigest',exercise.source_digest,
        'organizationHash','sha256:'||encode(public.digest(exercise.org_id::text,'sha256'),'hex'),
        'workspaceHash','sha256:'||encode(public.digest(exercise.workspace_id::text,'sha256'),'hex'),
        'lifecycle',exercise.lifecycle,'expiresAt',exercise.expires_at,
        'activatedAt',exercise.activated_at,'quiescedAt',exercise.quiesced_at
      )
    END,
    'actorSessions',(SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'persona',binding.persona,'actorHash',binding.actor_hash,'sessionHash',binding.session_hash,
      'state',binding.state,'boundAt',binding.bound_at,'revokedAt',binding.revoked_at
    ) ORDER BY binding.persona),'[]'::jsonb)
      FROM public.authenticated_synthetic_actor_sessions binding
      WHERE binding.exercise_id=exercise.id),
    'permits',(SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'permitIdHash','sha256:'||encode(public.digest(permit.id::text,'sha256'),'hex'),
      'kind',permit.kind,'commandType',permit.command_type,
      'requestHash','sha256:'||encode(public.digest(permit.request_id::text,'sha256'),'hex'),
      'payloadHash','sha256:'||permit.payload_hash,'expectedVersion',permit.expected_version,
      'state',permit.state,
      'attemptIdHash',CASE WHEN permit.attempt_id IS NULL THEN NULL ELSE 'sha256:'||encode(public.digest(permit.attempt_id::text,'sha256'),'hex') END,
      'executionFence',permit.execution_fence,'armedAt',permit.armed_at,'expiresAt',permit.expires_at,
      'consumedAt',permit.consumed_at,'revokedAt',permit.revoked_at,
      'classification',CASE WHEN permit.state='armed' THEN 'transient_control' ELSE 'immutable_history' END
    ) ORDER BY permit.armed_at,permit.id),'[]'::jsonb)
      FROM public.authenticated_synthetic_permits permit
      WHERE permit.exercise_id=exercise.id),
    'permitEvents',(SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'eventIdHash','sha256:'||encode(public.digest(event.id::text,'sha256'),'hex'),
      'permitIdHash','sha256:'||encode(public.digest(event.permit_id::text,'sha256'),'hex'),
      'actorHash','sha256:'||encode(public.digest(event.actor_id::text,'sha256'),'hex'),
      'sessionHash',event.session_hash,'requestHash',event.request_hash,'payloadHash',event.payload_hash,
      'eventType',event.event_type,'commandType',event.command_type,
      'attemptIdHash',CASE WHEN event.attempt_id IS NULL THEN NULL ELSE 'sha256:'||encode(public.digest(event.attempt_id::text,'sha256'),'hex') END,
      'executionFence',event.execution_fence,'occurredAt',event.occurred_at,'classification','immutable_history'
    ) ORDER BY event.occurred_at,event.id),'[]'::jsonb)
      FROM public.authenticated_synthetic_permit_events event
      WHERE event.exercise_id=exercise.id AND event.occurred_at BETWEEN p_from AND p_to)
  );
END
$$;

REVOKE EXECUTE ON FUNCTION public.authenticated_synthetic_observe(uuid,timestamptz,timestamptz)
FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.authenticated_synthetic_observe(uuid,timestamptz,timestamptz)
TO service_role;

-- Advance every exact-tip authority function under a guarded, one-occurrence
-- replacement. This retains every existing authorization and provider-off
-- predicate while moving the shared nonproduction identity atomically.
DO $local_real_backend_identity_forward$
DECLARE
  procedure_name regprocedure;
  definition text;
  old_tip text:='20261011053000';
  new_tip text:='20261019161723';
  old_count integer;
  new_count integer;
BEGIN
  FOREACH procedure_name IN ARRAY ARRAY[
    'public.synthetic_ai_campaign_activate_final_continuation(uuid,uuid,uuid,bigint,text,text,uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,integer)'::regprocedure,
    'public.synthetic_ai_campaign_bootstrap(uuid,uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,uuid,timestamptz)'::regprocedure,
    'public.pr_c_controlled_human_assert_marker()'::regprocedure,
    'public.synthetic_ai_campaign_activate_brd_v3_quality_validation(uuid,uuid,uuid,bigint,text,text,uuid,uuid,uuid,uuid,uuid,uuid,uuid,bigint,uuid,text,uuid,uuid,uuid,uuid,text,text,integer)'::regprocedure,
    'public.authenticated_synthetic_exercise_activate(uuid,text,text,text,text,text,text,text,text,text,text,uuid,uuid,timestamptz)'::regprocedure,
    'public.enterprise_provider_secret_write(uuid,uuid,bigint,uuid,uuid,text,text,text,text)'::regprocedure,
    'public.enterprise_provider_secret_resolve(uuid,uuid,text,text,text)'::regprocedure,
    'public.enterprise_provider_secret_resolve_for_receipt(uuid,uuid,bigint,uuid,uuid,text,text,text)'::regprocedure,
    'public.enterprise_provider_secret_observe(uuid,uuid,uuid,text,text)'::regprocedure,
    'public.enterprise_provider_secret_inventory(uuid,uuid)'::regprocedure,
    'public.enterprise_provider_secret_delete_for_receipt(uuid,uuid,bigint,uuid,uuid,text,text,text)'::regprocedure,
    'public.enterprise_provider_secret_delete_for_cleanup(uuid,uuid,bigint,uuid,uuid,text,text,text)'::regprocedure
  ] LOOP
    SELECT replace(pg_get_functiondef(procedure_name),chr(13)||chr(10),chr(10))
    INTO STRICT definition;
    old_count:=(length(definition)-length(replace(definition,old_tip,'')))/length(old_tip);
    new_count:=(length(definition)-length(replace(definition,new_tip,'')))/length(new_tip);
    IF old_count<>1 OR new_count<>0 THEN
      RAISE EXCEPTION 'LOCAL_REAL_BACKEND_FUNCTION_SOURCE_MISMATCH:%',procedure_name;
    END IF;
    EXECUTE replace(definition,old_tip,new_tip);
  END LOOP;

  ALTER TABLE public.pr_c_controlled_human_exercises
    DROP CONSTRAINT pr_c_controlled_human_exercises_migration_tip_check;
  ALTER TABLE public.pr_c_controlled_human_exercises
    ADD CONSTRAINT pr_c_controlled_human_exercises_migration_tip_check
    CHECK(migration_tip IN(
      '20260904120000','20260924113000','20260926053818','20260928060000',
      '20261003015246','20261003055918','20261003123459','20261003150800',
      '20261004025101','20261004112232','20261008022445','20261009162752',
      '20261010025331','20261010051100','20261010051413','20261010144356',
      '20261011053000','20261019161723'
    ));

  ALTER TABLE public.authenticated_synthetic_exercises
    DROP CONSTRAINT authenticated_synthetic_exercises_migration_tip_check;
  ALTER TABLE public.authenticated_synthetic_exercises
    ADD CONSTRAINT authenticated_synthetic_exercises_migration_tip_check
    CHECK(migration_tip IN('20261010144356','20261011053000','20261019161723'));

  ALTER TABLE public.hosted_pilot_environment_identity
    DROP CONSTRAINT hosted_pilot_environment_identity_migration_tip_check;
  UPDATE public.hosted_pilot_environment_identity
  SET migration_tip='20261019161723'
  WHERE singleton;
  ALTER TABLE public.hosted_pilot_environment_identity
    ADD CONSTRAINT hosted_pilot_environment_identity_migration_tip_check
    CHECK(migration_tip='20261019161723');
END
$local_real_backend_identity_forward$;

COMMENT ON COLUMN public.authenticated_synthetic_exercises.execution_kind IS
  'Exact hosted or local real-backend authenticated acceptance execution identity.';
COMMENT ON COLUMN public.authenticated_synthetic_exercises.build_digest IS
  'Exact local production-build digest. NULL is mandatory for retained hosted Netlify exercises.';
COMMENT ON FUNCTION public.authenticated_synthetic_local_exercise_activate(uuid,text,text,text,text,text,text,text,text,text,text,uuid,uuid,timestamptz) IS
  'Service-only activation for the exact loopback production build against the nonproduction synthetic backend. Providers remain off.';
