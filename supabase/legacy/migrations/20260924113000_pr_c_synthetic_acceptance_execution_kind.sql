ALTER TABLE public.pr_c_controlled_human_step_observations
  ADD COLUMN execution_kind text NOT NULL DEFAULT 'human'
  CHECK (execution_kind IN ('human', 'synthetic'));

ALTER TABLE public.pr_c_controlled_human_step_observations
  ADD CONSTRAINT pr_c_observation_execution_kind_matches_record
  CHECK (
    (execution_kind = 'human'
      AND safe_record ? 'humanAttemptDigest'
      AND NOT (safe_record ? 'machineAttemptDigest')
      AND NOT (safe_record ? 'executionKind'))
    OR
    (execution_kind = 'synthetic'
      AND safe_record ->> 'executionKind' = 'synthetic'
      AND safe_record ? 'machineAttemptDigest'
      AND NOT (safe_record ? 'humanAttemptDigest'))
  );

CREATE INDEX pr_c_step_observations_execution_kind_idx
  ON public.pr_c_controlled_human_step_observations
    (exercise_id, execution_kind, human_role, observed_at);

COMMENT ON COLUMN public.pr_c_controlled_human_step_observations.execution_kind IS
  'Immutable provenance discriminator. Human and synthetic observations are verified by separate evidence contracts.';

CREATE TABLE public.pr_c_synthetic_acceptance_session_bindings (
  exercise_id uuid NOT NULL REFERENCES public.pr_c_controlled_human_exercises(id) ON DELETE RESTRICT,
  persona_key text NOT NULL,
  application_actor_digest text NOT NULL CHECK (application_actor_digest ~ '^sha256:[0-9a-f]{64}$'),
  application_session_digest text NOT NULL CHECK (application_session_digest ~ '^sha256:[0-9a-f]{64}$'),
  request_digest text NOT NULL CHECK (request_digest ~ '^sha256:[0-9a-f]{64}$'),
  bound_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY (exercise_id, persona_key),
  UNIQUE (exercise_id, application_actor_digest),
  UNIQUE (exercise_id, application_session_digest),
  FOREIGN KEY (exercise_id, persona_key)
    REFERENCES public.pr_c_controlled_human_persona_bindings(exercise_id, persona_key) ON DELETE RESTRICT
);

CREATE TRIGGER pr_c_synthetic_acceptance_session_bindings_immutable
  BEFORE UPDATE OR DELETE ON public.pr_c_synthetic_acceptance_session_bindings
  FOR EACH ROW EXECUTE FUNCTION public.pr_c_controlled_human_event_immutable();

ALTER TABLE public.pr_c_synthetic_acceptance_session_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pr_c_synthetic_acceptance_session_bindings FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.pr_c_synthetic_acceptance_session_bindings FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON TABLE public.pr_c_synthetic_acceptance_session_bindings IS
  'Server-verified, append-only digests for the exact synthetic browser sessions; raw Auth session identifiers never leave the database.';

-- Advance the hosted-pilot marker and the server-owned PR C marker assertion.
-- Retained human exercises keep their original 20260904120000 provenance;
-- newly seeded synthetic acceptance exercises bind 20260924113000.
DO $pr_c_synthetic_acceptance_identity_forward$
DECLARE marker public.hosted_pilot_environment_identity;constraint_expression text;exercise_constraint_expression text;bootstrap_definition text;assert_marker_definition text;
 old_bootstrap text:='marker.migration_tip=''20260924052038''';
 new_bootstrap text:='marker.migration_tip=''20260924113000''';
 old_assert_marker text:='marker.migration_tip = ''20260904120000''';
 new_assert_marker text:='marker.migration_tip = ''20260924113000''';
 old_count integer;new_count integer;old_assert_count integer;new_assert_count integer;
BEGIN
 LOCK TABLE public.hosted_pilot_environment_identity IN SHARE ROW EXCLUSIVE MODE;
 SELECT * INTO STRICT marker FROM public.hosted_pilot_environment_identity WHERE singleton FOR UPDATE;
 IF marker.product_key<>'avalaos-core' OR marker.environment_class<>'hosted_nonproduction_pilot'
  OR marker.schema_contract<>'hosted-pilot-2026-08' OR marker.production_authorized
  OR marker.customer_data_authorized OR marker.real_provider_calls_authorized
 THEN RAISE EXCEPTION 'PR_C_SYNTHETIC_ACCEPTANCE_IDENTITY_MISMATCH';END IF;
 SELECT pg_get_expr(conbin,conrelid,false) INTO STRICT constraint_expression FROM pg_constraint
  WHERE conrelid='public.hosted_pilot_environment_identity'::regclass
   AND conname='hosted_pilot_environment_identity_migration_tip_check';
 SELECT pg_get_functiondef('public.synthetic_ai_campaign_bootstrap(uuid,uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,uuid,timestamptz)'::regprocedure)
  INTO STRICT bootstrap_definition;
 SELECT pg_get_expr(conbin,conrelid,false) INTO STRICT exercise_constraint_expression FROM pg_constraint
  WHERE conrelid='public.pr_c_controlled_human_exercises'::regclass
   AND conname='pr_c_controlled_human_exercises_migration_tip_check';
 SELECT pg_get_functiondef('public.pr_c_controlled_human_assert_marker()'::regprocedure)
  INTO STRICT assert_marker_definition;
 old_count:=(length(bootstrap_definition)-length(replace(bootstrap_definition,old_bootstrap,'')))/length(old_bootstrap);
 new_count:=(length(bootstrap_definition)-length(replace(bootstrap_definition,new_bootstrap,'')))/length(new_bootstrap);
 old_assert_count:=(length(assert_marker_definition)-length(replace(assert_marker_definition,old_assert_marker,'')))/length(old_assert_marker);
 new_assert_count:=(length(assert_marker_definition)-length(replace(assert_marker_definition,new_assert_marker,'')))/length(new_assert_marker);
 IF marker.migration_tip='20260924052038'
  AND constraint_expression='(migration_tip = ''20260924052038''::text)'
  AND exercise_constraint_expression='(migration_tip = ''20260904120000''::text)'
  AND old_count=1 AND new_count=0 AND old_assert_count=1 AND new_assert_count=0
 THEN
  EXECUTE replace(bootstrap_definition,old_bootstrap,new_bootstrap);
  EXECUTE replace(assert_marker_definition,old_assert_marker,new_assert_marker);
  ALTER TABLE public.pr_c_controlled_human_exercises DROP CONSTRAINT pr_c_controlled_human_exercises_migration_tip_check;
  ALTER TABLE public.pr_c_controlled_human_exercises ADD CONSTRAINT pr_c_controlled_human_exercises_migration_tip_check
   CHECK(migration_tip IN ('20260904120000','20260924113000'));
  ALTER TABLE public.hosted_pilot_environment_identity DROP CONSTRAINT hosted_pilot_environment_identity_migration_tip_check;
  UPDATE public.hosted_pilot_environment_identity SET migration_tip='20260924113000' WHERE singleton;
  ALTER TABLE public.hosted_pilot_environment_identity ADD CONSTRAINT hosted_pilot_environment_identity_migration_tip_check
   CHECK(migration_tip='20260924113000');
 ELSIF marker.migration_tip='20260924113000'
  AND constraint_expression='(migration_tip = ''20260924113000''::text)'
  AND exercise_constraint_expression='(migration_tip = ANY (ARRAY[''20260904120000''::text, ''20260924113000''::text]))'
  AND old_count=0 AND new_count=1 AND old_assert_count=0 AND new_assert_count=1
 THEN NULL;
 ELSE RAISE EXCEPTION 'PR_C_SYNTHETIC_ACCEPTANCE_IDENTITY_SOURCE_MISMATCH';END IF;
END
$pr_c_synthetic_acceptance_identity_forward$;

-- An abort after a seeded exercise retains disabled synthetic Auth users as
-- immutable exercise history. A partial pre-seed abort still removes its users.
CREATE OR REPLACE FUNCTION public.pr_c_controlled_human_complete_recovery(
  p_exercise_digest text,p_release_sha text,p_operation text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF p_operation='apply' AND NOT EXISTS (
    SELECT 1 FROM public.pr_c_controlled_human_exercises exercise
    WHERE exercise.exercise_digest=p_exercise_digest AND exercise.release_sha=p_release_sha
  ) THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_RECOVERY_REJECTED'; END IF;
  IF p_operation='quiesce' AND NOT EXISTS (
    SELECT 1 FROM public.pr_c_controlled_human_exercises exercise
    WHERE exercise.exercise_digest=p_exercise_digest AND exercise.release_sha=p_release_sha
      AND exercise.lifecycle IN ('read_only','deprovisioned') AND exercise.quiesced_history_digest IS NOT NULL
  ) THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_RECOVERY_REJECTED'; END IF;
  IF p_operation='deprovision' AND NOT EXISTS (
    SELECT 1 FROM public.pr_c_controlled_human_exercises exercise
    WHERE exercise.exercise_digest=p_exercise_digest AND exercise.release_sha=p_release_sha AND exercise.lifecycle='deprovisioned'
  ) THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_RECOVERY_REJECTED'; END IF;
  IF p_operation IN ('abort','expiry') THEN
    IF EXISTS (SELECT 1 FROM public.pr_c_controlled_human_exercises exercise WHERE exercise.exercise_digest=p_exercise_digest) THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.pr_c_controlled_human_exercises exercise
        JOIN public.pr_c_controlled_human_recovery_authorities source
          ON source.exercise_digest=exercise.exercise_digest AND source.release_sha=exercise.release_sha AND source.operation='apply'
        WHERE exercise.exercise_digest=p_exercise_digest AND exercise.release_sha=p_release_sha
          AND exercise.lifecycle='deprovisioned' AND exercise.quiesced_history_digest IS NOT NULL
          AND cardinality(source.auth_user_ids)=12
          AND (SELECT count(*) FROM public.pr_c_controlled_human_persona_bindings binding WHERE binding.exercise_id=exercise.id)=12
          AND NOT EXISTS (
            SELECT 1 FROM public.pr_c_controlled_human_persona_bindings binding
            LEFT JOIN auth.users user_record ON user_record.id=binding.auth_user_id
            WHERE binding.exercise_id=exercise.id
              AND (NOT (binding.auth_user_id=ANY(source.auth_user_ids))
                OR user_record.id IS NULL OR user_record.banned_until IS NULL
                OR user_record.banned_until<=statement_timestamp()+interval '10 years'
                OR EXISTS (SELECT 1 FROM auth.sessions session WHERE session.user_id=binding.auth_user_id)
                OR EXISTS (SELECT 1 FROM public.workspace_memberships membership
                  WHERE membership.user_id=binding.auth_user_id AND membership.status='active'))
          )
      ) THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_RECOVERY_REJECTED'; END IF;
    ELSIF EXISTS (
      SELECT 1 FROM public.pr_c_controlled_human_recovery_authorities source
      CROSS JOIN LATERAL unnest(source.auth_user_ids) user_id(value)
      JOIN auth.users user_record ON user_record.id=user_id.value
      WHERE source.exercise_digest=p_exercise_digest AND source.release_sha=p_release_sha AND source.operation='apply'
    ) THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_RECOVERY_REJECTED'; END IF;
  END IF;
  PERFORM public.pr_c_controlled_human_assert_marker();
  PERFORM public.pr_c_controlled_human_assert_provider_state();
  UPDATE public.pr_c_controlled_human_recovery_authorities SET state='completed',updated_at=statement_timestamp()
  WHERE exercise_digest=p_exercise_digest AND release_sha=p_release_sha AND operation=p_operation;
  IF NOT FOUND THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_RECOVERY_REJECTED'; END IF;
END $$;
