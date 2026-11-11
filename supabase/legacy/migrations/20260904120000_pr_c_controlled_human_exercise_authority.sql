-- PR #264 controlled-human exercise authority.
-- Dedicated hosted-nonproduction only. This migration neither authorizes
-- production/customer data nor permits provider traffic.

-- `now()` is fixed at transaction start. A governed browser action can share a
-- transaction with prerequisite writes, so that default can place its audit
-- before the server-issued pre-action anchor even though the audit insert ran
-- afterward. Use wall-clock time for new audit rows so bounded observation
-- windows retain the real causal order. Existing immutable rows are untouched.
ALTER TABLE public.privileged_audit_events
  ALTER COLUMN created_at SET DEFAULT clock_timestamp();
ALTER TABLE public.enterprise_delivery_monitor_command_attempts
  ALTER COLUMN created_at SET DEFAULT clock_timestamp();

CREATE TABLE public.pr_c_controlled_human_exercises (
  id uuid PRIMARY KEY,
  exercise_digest text NOT NULL UNIQUE CHECK (exercise_digest ~ '^sha256:[0-9a-f]{64}$'),
  environment_class text NOT NULL CHECK (environment_class = 'hosted_nonproduction_pilot'),
  pull_request_number integer NOT NULL CHECK (pull_request_number = 264),
  release_sha text NOT NULL CHECK (release_sha ~ '^[0-9a-f]{40}$'),
  review_head_sha text NOT NULL CHECK (review_head_sha = release_sha),
  deploy_id text NOT NULL CHECK (deploy_id ~ '^[0-9a-f]{24}$'),
  deploy_origin text NOT NULL CHECK (deploy_origin = 'https://deploy-preview-264--avalaos-pilot.netlify.app'),
  target_fingerprint text NOT NULL CHECK (target_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  public_target_digest text NOT NULL CHECK (public_target_digest ~ '^sha256:[0-9a-f]{64}$'),
  persona_manifest_digest text NOT NULL CHECK (persona_manifest_digest ~ '^sha256:[0-9a-f]{64}$'),
  fixture_manifest_digest text NOT NULL CHECK (fixture_manifest_digest ~ '^sha256:[0-9a-f]{64}$'),
  migration_tip text NOT NULL CHECK (migration_tip = '20260904120000'),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL,
  lifecycle text NOT NULL CHECK (lifecycle IN ('active','read_only','deprovisioned','quarantined')),
  concurrency_version bigint NOT NULL DEFAULT 1 CHECK (concurrency_version > 0),
  synthetic_only boolean NOT NULL DEFAULT true CHECK (synthetic_only),
  production_authorized boolean NOT NULL DEFAULT false CHECK (NOT production_authorized),
  customer_data_authorized boolean NOT NULL DEFAULT false CHECK (NOT customer_data_authorized),
  real_provider_calls_authorized boolean NOT NULL DEFAULT false CHECK (NOT real_provider_calls_authorized),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  quiesced_at timestamptz,
  quiesced_history_digest text CHECK (quiesced_history_digest IS NULL OR quiesced_history_digest ~ '^sha256:[0-9a-f]{64}$'),
  deprovisioned_at timestamptz,
  UNIQUE (id, org_id, workspace_id),
  FOREIGN KEY (workspace_id, org_id) REFERENCES public.workspaces(id, org_id) ON DELETE RESTRICT,
  CHECK ((lifecycle = 'active' AND quiesced_at IS NULL AND quiesced_history_digest IS NULL AND deprovisioned_at IS NULL)
    OR (lifecycle = 'read_only' AND quiesced_at IS NOT NULL AND deprovisioned_at IS NULL)
    OR (lifecycle IN ('deprovisioned','quarantined') AND quiesced_at IS NOT NULL AND quiesced_history_digest IS NOT NULL AND deprovisioned_at IS NOT NULL))
);

-- Recovery authority exists before any external Admin API mutation. It is
-- exact-head/exercise/target bound, survives lost runner output, and contains
-- only synthetic Auth user identities needed for bounded recovery.
CREATE TABLE public.pr_c_controlled_human_recovery_authorities (
  exercise_digest text NOT NULL CHECK (exercise_digest ~ '^sha256:[0-9a-f]{64}$'),
  release_sha text NOT NULL CHECK (release_sha ~ '^[0-9a-f]{40}$'),
  deploy_id text NOT NULL CHECK (deploy_id ~ '^[0-9a-f]{24}$'),
  target_fingerprint text NOT NULL CHECK (target_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  authority_digest text NOT NULL CHECK (authority_digest ~ '^sha256:[0-9a-f]{64}$'),
  operation text NOT NULL CHECK (operation IN ('apply','quiesce','deprovision','abort','expiry')),
  state text NOT NULL CHECK (state IN ('prepared','external_effect_started','database_committed','completed','aborted')),
  expected_version bigint NOT NULL CHECK (expected_version >= 0),
  auth_user_ids uuid[] NOT NULL DEFAULT '{}',
  expires_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  CHECK (cardinality(auth_user_ids) <= 12),
  PRIMARY KEY(exercise_digest,operation)
);

CREATE OR REPLACE FUNCTION public.pr_c_controlled_human_prepare_recovery(
  p_exercise_digest text,p_release_sha text,p_deploy_id text,p_target_fingerprint text,
  p_authority_digest text,p_operation text,p_expected_version bigint,p_expires_at timestamptz
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE stored public.pr_c_controlled_human_recovery_authorities;
BEGIN
  PERFORM public.pr_c_controlled_human_assert_marker();
  PERFORM public.pr_c_controlled_human_assert_provider_state();
  IF p_operation NOT IN ('apply','quiesce','deprovision','abort','expiry') OR p_expires_at <= statement_timestamp()
    OR p_expires_at > statement_timestamp()+interval '24 hours' THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_RECOVERY_REJECTED'; END IF;
  IF p_operation IN ('abort','expiry') AND NOT EXISTS (
    SELECT 1 FROM public.pr_c_controlled_human_recovery_authorities source
    WHERE source.exercise_digest=p_exercise_digest AND source.release_sha=p_release_sha
      AND source.deploy_id=p_deploy_id AND source.target_fingerprint=p_target_fingerprint AND source.operation='apply'
      AND (p_operation='abort' OR source.expires_at<=statement_timestamp())
  ) THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_RECOVERY_REJECTED'; END IF;
  INSERT INTO public.pr_c_controlled_human_recovery_authorities(exercise_digest,release_sha,deploy_id,target_fingerprint,authority_digest,operation,state,expected_version,expires_at)
  VALUES(p_exercise_digest,p_release_sha,p_deploy_id,p_target_fingerprint,p_authority_digest,p_operation,'prepared',p_expected_version,p_expires_at)
  ON CONFLICT(exercise_digest,operation) DO UPDATE SET expected_version=excluded.expected_version,authority_digest=excluded.authority_digest,expires_at=excluded.expires_at,updated_at=statement_timestamp()
  WHERE pr_c_controlled_human_recovery_authorities.release_sha=excluded.release_sha
    AND pr_c_controlled_human_recovery_authorities.deploy_id=excluded.deploy_id
    AND pr_c_controlled_human_recovery_authorities.target_fingerprint=excluded.target_fingerprint
    AND pr_c_controlled_human_recovery_authorities.state<>'completed';
  SELECT * INTO stored FROM public.pr_c_controlled_human_recovery_authorities WHERE exercise_digest=p_exercise_digest AND operation=p_operation FOR UPDATE;
  IF stored.release_sha<>p_release_sha OR stored.deploy_id<>p_deploy_id OR stored.target_fingerprint<>p_target_fingerprint
    OR stored.authority_digest<>p_authority_digest OR stored.operation<>p_operation OR stored.expected_version<>p_expected_version THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_RECOVERY_REJECTED'; END IF;
  RETURN jsonb_build_object('operation',stored.operation,'state',stored.state,'expectedVersion',stored.expected_version,
    'authUserCount',cardinality(stored.auth_user_ids),'expired',stored.expires_at<=statement_timestamp());
END $$;

CREATE OR REPLACE FUNCTION public.pr_c_controlled_human_record_auth_user(
  p_exercise_digest text,p_release_sha text,p_user_id uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM auth.users user_record
    WHERE user_record.id=p_user_id AND user_record.raw_user_meta_data->>'synthetic'='true'
      AND user_record.raw_user_meta_data->>'exerciseDigest'=p_exercise_digest
      AND user_record.raw_user_meta_data->>'personaKey' ~ '^[a-z][a-z0-9_]{2,48}$'
  ) THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_RECOVERY_REJECTED'; END IF;
  UPDATE public.pr_c_controlled_human_recovery_authorities SET
    auth_user_ids=(SELECT array_agg(DISTINCT value ORDER BY value) FROM unnest(auth_user_ids||p_user_id) value),
    state='external_effect_started',updated_at=statement_timestamp()
  WHERE exercise_digest=p_exercise_digest AND release_sha=p_release_sha AND operation='apply' AND state IN ('prepared','external_effect_started');
  IF NOT FOUND THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_RECOVERY_REJECTED'; END IF;
END $$;

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
  IF p_operation IN ('abort','expiry') AND (
    EXISTS (
      SELECT 1 FROM public.pr_c_controlled_human_recovery_authorities source
      CROSS JOIN LATERAL unnest(source.auth_user_ids) user_id(value)
      JOIN auth.users user_record ON user_record.id=user_id.value
      WHERE source.exercise_digest=p_exercise_digest AND source.release_sha=p_release_sha AND source.operation='apply'
    ) OR EXISTS (
      SELECT 1 FROM public.pr_c_controlled_human_exercises exercise
      WHERE exercise.exercise_digest=p_exercise_digest AND exercise.lifecycle<>'deprovisioned'
    )
  ) THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_RECOVERY_REJECTED'; END IF;
  -- Revalidate the immutable environment marker and the canonical provider-free
  -- predicate in this transaction at the final authority transition. A caller's
  -- earlier inventory inspection cannot authorize completion after concurrent
  -- provider state is committed.
  PERFORM public.pr_c_controlled_human_assert_marker();
  PERFORM public.pr_c_controlled_human_assert_provider_state();
  UPDATE public.pr_c_controlled_human_recovery_authorities SET state='completed',updated_at=statement_timestamp()
  WHERE exercise_digest=p_exercise_digest AND release_sha=p_release_sha AND operation=p_operation;
  IF NOT FOUND THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_RECOVERY_REJECTED'; END IF;
END $$;

CREATE UNIQUE INDEX pr_c_controlled_human_one_live_exercise
  ON public.pr_c_controlled_human_exercises ((true))
  WHERE lifecycle IN ('active','read_only');

CREATE TABLE public.pr_c_controlled_human_persona_bindings (
  exercise_id uuid NOT NULL,
  org_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  persona_key text NOT NULL CHECK (persona_key ~ '^[a-z][a-z0-9_]{2,48}$'),
  auth_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  role_id uuid NOT NULL REFERENCES public.roles(id) ON DELETE RESTRICT,
  expected_state text NOT NULL CHECK (expected_state IN ('active','revoked')),
  capability_digest text NOT NULL CHECK (capability_digest ~ '^sha256:[0-9a-f]{64}$'),
  credential_generation_digest text NOT NULL CHECK (credential_generation_digest ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY (exercise_id, persona_key),
  UNIQUE (exercise_id, auth_user_id),
  FOREIGN KEY (exercise_id)
    REFERENCES public.pr_c_controlled_human_exercises(id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, org_id) REFERENCES public.workspaces(id, org_id) ON DELETE RESTRICT
);

CREATE TABLE public.pr_c_controlled_human_operation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exercise_id uuid NOT NULL REFERENCES public.pr_c_controlled_human_exercises(id) ON DELETE RESTRICT,
  sequence bigint NOT NULL CHECK (sequence > 0),
  operation text NOT NULL CHECK (operation IN ('seeded','verified','quiesced','sessions_revoked','credentials_disabled','deprovisioned','quarantined')),
  safe_result_digest text NOT NULL CHECK (safe_result_digest ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  UNIQUE (exercise_id, sequence)
);

CREATE OR REPLACE FUNCTION public.pr_c_controlled_human_event_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_HISTORY_IMMUTABLE';
END
$$;
CREATE TRIGGER pr_c_controlled_human_events_immutable
  BEFORE UPDATE OR DELETE ON public.pr_c_controlled_human_operation_events
  FOR EACH ROW EXECUTE FUNCTION public.pr_c_controlled_human_event_immutable();

CREATE OR REPLACE FUNCTION public.pr_c_controlled_human_assert_marker()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.hosted_pilot_environment_identity marker
    WHERE marker.singleton
      AND marker.product_key = 'avalaos-core'
      AND marker.environment_class = 'hosted_nonproduction_pilot'
      AND marker.migration_tip = '20260904120000'
      AND NOT marker.production_authorized
      AND NOT marker.customer_data_authorized
      AND NOT marker.real_provider_calls_authorized
  ) THEN
    RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_ENVIRONMENT_MISMATCH';
  END IF;
END
$$;

-- One canonical, server-owned accounting predicate is used at every exercise
-- boundary. The only non-zero provider-adjacent state it accepts is disabled,
-- keyless, attempt-free offline provenance tied to an exact retained exercise.
CREATE OR REPLACE FUNCTION public.pr_c_controlled_human_provider_state()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE required_relation text;
BEGIN
 -- The retained PR 1A migration harness deliberately installs every migration
 -- except PR 1A before recreating its two legacy audit relations.  Defer parsing
 -- the accounting query so this later migration remains installable in that
 -- supported upgrade/failure scenario, but never interpret a missing authority
 -- relation as an empty (and therefore safe) provider state.
 FOREACH required_relation IN ARRAY ARRAY[
   'public.pr_c_controlled_human_exercises',
   'public.ai_provider_configs',
   'public.enterprise_ai_capability_routes',
   'public.enterprise_ai_job_ledger',
   'public.enterprise_transcript_extraction_bindings',
   'public.enterprise_ai_command_receipts',
   'public.enterprise_evidence_candidates',
   'public.ai_provider_key_refs',
   'public.pilot_operations_provider_bindings',
   'public.hosted_pilot_provider_simulations',
   'public.enterprise_ai_budget_reservations',
   'public.enterprise_provider_secret_cleanup_jobs',
   'public.ai_provider_audit_events',
   'public.enterprise_ai_usage_ledger',
   'public.enterprise_ai_job_attempts',
   'public.enterprise_ai_extraction_staged_results',
   'public.ai_generation_jobs',
   'public.ai_usage_events',
   'public.enterprise_ai_effect_journal',
   'public.studio_artifact_generation_attempts'
 ] LOOP
   IF pg_catalog.to_regclass(required_relation) IS NULL THEN
     RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_PROVIDER_SCHEMA_MISMATCH';
   END IF;
 END LOOP;

 RETURN (SELECT jsonb_build_object(
   'unsafeRows',
     (SELECT count(*) FROM public.ai_provider_configs config WHERE NOT(
       config.provider='groq' AND config.status='disabled' AND config.key_ref_id IS NULL AND config.default_model='synthetic-no-provider'
       AND config.display_name='PR C controlled-human offline provenance'
       AND EXISTS(SELECT 1 FROM public.pr_c_controlled_human_exercises exercise
         WHERE exercise.org_id=config.org_id AND config.evidence_ref='pr-c-controlled-human:'||exercise.exercise_digest)))
     +(SELECT count(*) FROM public.enterprise_ai_capability_routes route WHERE NOT(
       route.enabled=false AND route.deleted_at IS NULL AND route.capability='assess.evidence.extract' AND route.model='synthetic-no-provider'
       AND EXISTS(SELECT 1 FROM public.ai_provider_configs config JOIN public.pr_c_controlled_human_exercises exercise
         ON exercise.org_id=config.org_id AND exercise.workspace_id=route.workspace_id
         WHERE config.id=route.provider_config_id AND config.org_id=route.org_id AND config.status='disabled'
           AND config.key_ref_id IS NULL AND config.default_model='synthetic-no-provider'
           AND config.evidence_ref='pr-c-controlled-human:'||exercise.exercise_digest)))
     +(SELECT count(*) FROM public.enterprise_ai_job_ledger job WHERE NOT(
       job.capability='assess.evidence.extract' AND job.provider_config_id IS NOT NULL AND job.provider='groq' AND job.model='synthetic-no-provider'
       AND job.prompt_key='controlled-human-offline' AND job.status='succeeded'
       AND job.token_input IS NULL AND job.token_output IS NULL AND job.latency_ms IS NULL
       AND job.failure_class IS NULL AND job.output_hash=repeat('b',64) AND job.approval_state='review_required'
       AND job.metadata->>'controlledHumanSyntheticNoProvider'='true'
       AND (SELECT count(*) FROM jsonb_object_keys(job.metadata))=2
       AND EXISTS(SELECT 1 FROM public.pr_c_controlled_human_exercises exercise
         JOIN public.ai_provider_configs config ON config.id=job.provider_config_id AND config.org_id=exercise.org_id
         JOIN public.enterprise_transcript_extraction_bindings binding ON binding.job_id=job.id
           AND binding.org_id=exercise.org_id AND binding.workspace_id=exercise.workspace_id
           AND binding.provider_config_id=config.id AND binding.model='synthetic-no-provider'
         JOIN public.enterprise_ai_capability_routes route ON route.id=binding.provider_route_id
           AND route.org_id=exercise.org_id AND route.workspace_id=exercise.workspace_id
           AND route.provider_config_id=config.id AND route.capability='assess.evidence.extract'
           AND route.model='synthetic-no-provider' AND NOT route.enabled AND route.deleted_at IS NULL
         JOIN public.enterprise_ai_command_receipts receipt ON receipt.id=binding.receipt_id
           AND receipt.org_id=exercise.org_id AND receipt.workspace_id=exercise.workspace_id
           AND receipt.actor_id=job.actor_id AND receipt.command_type='evidence.extract'
           AND receipt.runtime_area='ingestion' AND receipt.status='committed'
           AND receipt.initial_request_id=receipt.last_request_id AND receipt.request_hash=repeat('a',64)
         WHERE exercise.org_id=job.org_id AND exercise.workspace_id=job.workspace_id
           AND job.metadata->>'exerciseDigest'=exercise.exercise_digest
           AND config.provider='groq' AND config.status='disabled' AND config.key_ref_id IS NULL
           AND config.default_model='synthetic-no-provider'
           AND config.evidence_ref='pr-c-controlled-human:'||exercise.exercise_digest
           AND binding.source_id=job.source_id AND binding.source_version_id=job.source_version_id
           AND EXISTS(SELECT 1 FROM public.enterprise_evidence_candidates candidate
             WHERE candidate.ai_job_id=job.id AND candidate.org_id=exercise.org_id
               AND candidate.workspace_id=exercise.workspace_id AND candidate.source_id=job.source_id
               AND candidate.source_version_id=job.source_version_id AND candidate.suggestion_status='accepted'
               AND candidate.reviewed_by=job.actor_id AND candidate.reviewed_at IS NOT NULL))))
     +(SELECT count(*) FROM public.ai_provider_key_refs)
     +(SELECT count(*) FROM public.pilot_operations_provider_bindings)
     +(SELECT count(*) FROM public.hosted_pilot_provider_simulations)
     +(SELECT count(*) FROM public.enterprise_ai_budget_reservations)
     +(SELECT count(*) FROM public.enterprise_provider_secret_cleanup_jobs)
     +(SELECT count(*) FROM public.ai_provider_audit_events)
     +(SELECT count(*) FROM public.enterprise_ai_usage_ledger)
     +(SELECT count(*) FROM public.enterprise_ai_job_attempts)
     +(SELECT count(*) FROM public.enterprise_ai_extraction_staged_results)
     +(SELECT count(*) FROM public.ai_generation_jobs)
     +(SELECT count(*) FROM public.ai_usage_events)
     +(SELECT count(*) FROM public.enterprise_ai_command_receipts receipt
       WHERE receipt.runtime_area='provider')
     +(SELECT count(*) FROM public.enterprise_ai_effect_journal effect
       JOIN public.enterprise_ai_command_receipts receipt ON receipt.id=effect.receipt_id
       WHERE effect.operation_type LIKE 'provider.%' OR receipt.runtime_area='provider'
         OR EXISTS(SELECT 1 FROM public.enterprise_ai_job_ledger job WHERE job.receipt_id=receipt.id AND job.model<>'synthetic-no-provider'))
     +(SELECT count(*) FROM public.studio_artifact_generation_attempts),
   'providerEgress',(SELECT count(*) FROM public.ai_provider_audit_events),
   'providerCalls',(SELECT count(*) FROM public.enterprise_ai_effect_journal effect
     JOIN public.enterprise_ai_command_receipts receipt ON receipt.id=effect.receipt_id
     WHERE effect.operation_type LIKE 'provider.%' OR receipt.runtime_area='provider'
       OR EXISTS(SELECT 1 FROM public.enterprise_ai_job_ledger job WHERE job.receipt_id=receipt.id AND job.model<>'synthetic-no-provider'))
     +(SELECT count(*) FROM public.studio_artifact_generation_attempts)
     +(SELECT count(*) FROM public.enterprise_ai_usage_ledger)
     +(SELECT count(*) FROM public.enterprise_ai_job_attempts)
     +(SELECT count(*) FROM public.enterprise_ai_extraction_staged_results)
     +(SELECT count(*) FROM public.ai_generation_jobs)
     +(SELECT count(*) FROM public.ai_usage_events)
     +(SELECT count(*) FROM public.enterprise_ai_command_receipts receipt
       WHERE receipt.runtime_area='provider')
 ));
END
$$;

CREATE OR REPLACE FUNCTION public.pr_c_controlled_human_assert_provider_state()
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE state jsonb:=public.pr_c_controlled_human_provider_state();
BEGIN
 IF (state->>'unsafeRows')::bigint<>0 OR (state->>'providerEgress')::bigint<>0 OR (state->>'providerCalls')::bigint<>0
 THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_PROVIDER_STATE_REJECTED'; END IF;
END $$;

-- Every mutable human-test resource is registered at insert time against the
-- one live exercise for its exact organization/workspace. This makes later
-- inventory independent of caller-provided selectors and turns cross-scope or
-- unowned rows into a fail-closed condition.
CREATE TABLE public.pr_c_controlled_human_resource_ownership (
  exercise_id uuid NOT NULL REFERENCES public.pr_c_controlled_human_exercises(id) ON DELETE RESTRICT,
  resource_family text NOT NULL CHECK (resource_family ~ '^[a-z][a-z0-9_]{2,80}$'),
  resource_id uuid NOT NULL,
  org_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY (exercise_id, resource_family, resource_id),
  FOREIGN KEY (exercise_id, org_id, workspace_id)
    REFERENCES public.pr_c_controlled_human_exercises(id, org_id, workspace_id) ON DELETE RESTRICT
);

CREATE TABLE public.pr_c_controlled_human_step_contracts (
  exercise_id uuid NOT NULL REFERENCES public.pr_c_controlled_human_exercises(id) ON DELETE RESTRICT,
  checkpoint_id text NOT NULL CHECK (checkpoint_id ~ '^CH-[0-9]{2}$'),
  step_id text NOT NULL CHECK (step_id ~ '^[a-z][a-z0-9-]{2,100}$'),
  persona_key text NOT NULL,
  negative boolean NOT NULL,
  action text NOT NULL CHECK (length(action) BETWEEN 3 AND 120),
  resource_kind text NOT NULL CHECK (resource_kind ~ '^[a-z][a-z0-9_]{2,80}$'),
  observation_kind text NOT NULL CHECK (observation_kind IN ('server_event','human_attestation','negative_attempt','no_effect')),
  expected_result text NOT NULL CHECK (expected_result IN ('succeeded','attested','denied','no_effect_observed')),
  expected_actions text[] NOT NULL DEFAULT '{}' CHECK (cardinality(expected_actions) <= 4),
  capability_digest text NOT NULL CHECK (capability_digest ~ '^sha256:[0-9a-f]{64}$'),
  CHECK ((observation_kind='server_event' AND expected_result='succeeded' AND cardinality(expected_actions)>0)
    OR (observation_kind='human_attestation' AND expected_result='attested' AND cardinality(expected_actions)=0)
    OR (observation_kind='negative_attempt' AND expected_result='denied')
    OR (observation_kind='no_effect' AND expected_result='no_effect_observed')),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY (exercise_id, checkpoint_id, step_id),
  FOREIGN KEY (exercise_id, persona_key)
    REFERENCES public.pr_c_controlled_human_persona_bindings(exercise_id, persona_key) ON DELETE RESTRICT
);
CREATE TABLE public.pr_c_controlled_human_step_observations (
  exercise_id uuid NOT NULL REFERENCES public.pr_c_controlled_human_exercises(id) ON DELETE RESTRICT,
  checkpoint_id text NOT NULL,
  step_id text NOT NULL,
  persona_key text NOT NULL,
  human_role text NOT NULL CHECK (human_role IN ('requester','reviewer','approver')),
  request_digest text NOT NULL CHECK (request_digest ~ '^sha256:[0-9a-f]{64}$'),
  started_at timestamptz NOT NULL,
  completed_at timestamptz NOT NULL CHECK (completed_at >= started_at),
  inspection_digest text NOT NULL CHECK (inspection_digest ~ '^sha256:[0-9a-f]{64}$'),
  safe_record jsonb NOT NULL CHECK (jsonb_typeof(safe_record)='object'),
  observed_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY (exercise_id, checkpoint_id, step_id),
  FOREIGN KEY (exercise_id, checkpoint_id, step_id)
    REFERENCES public.pr_c_controlled_human_step_contracts(exercise_id, checkpoint_id, step_id) ON DELETE RESTRICT
);

-- A human keeps only the safe_record returned by the server. Raw target,
-- request, receipt, and audit identities stay behind RLS and are rechecked by
-- the post-exercise observer. One step can bind one exact attempted action.
CREATE TABLE public.pr_c_controlled_human_action_bindings (
  exercise_id uuid NOT NULL REFERENCES public.pr_c_controlled_human_exercises(id) ON DELETE RESTRICT,
  checkpoint_id text NOT NULL,
  step_id text NOT NULL,
  persona_key text NOT NULL,
  actor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  observation_kind text NOT NULL CHECK (observation_kind IN ('server_event','negative_attempt')),
  action text NOT NULL CHECK (length(action) BETWEEN 3 AND 120),
  result text NOT NULL CHECK (result IN ('succeeded','denied')),
  denial_proof_kind text NOT NULL CHECK (denial_proof_kind IN ('not_applicable','denied_audit','server_denied_attempt')),
  resource_family text NOT NULL CHECK (resource_family ~ '^[a-z][a-z0-9_]{2,80}$'),
  resource_id uuid NOT NULL,
  expected_version bigint NOT NULL CHECK (expected_version >= 0),
  observed_version bigint NOT NULL CHECK (observed_version >= 0),
  request_id uuid NOT NULL,
  receipt_source text,
  receipt_id uuid,
  audit_id uuid REFERENCES public.privileged_audit_events(id) ON DELETE RESTRICT,
  intent_digest text NOT NULL CHECK (intent_digest ~ '^sha256:[0-9a-f]{64}$'),
  denial_code_digest text NOT NULL CHECK (denial_code_digest ~ '^sha256:[0-9a-f]{64}$'),
  binding_token text NOT NULL UNIQUE CHECK (binding_token ~ '^sha256:[0-9a-f]{64}$'),
  safe_record jsonb NOT NULL CHECK (jsonb_typeof(safe_record)='object'),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY (exercise_id, checkpoint_id, step_id),
  UNIQUE (exercise_id, request_id),
  FOREIGN KEY (exercise_id, checkpoint_id, step_id)
    REFERENCES public.pr_c_controlled_human_step_contracts(exercise_id, checkpoint_id, step_id) ON DELETE RESTRICT,
  FOREIGN KEY (exercise_id, persona_key)
    REFERENCES public.pr_c_controlled_human_persona_bindings(exercise_id, persona_key) ON DELETE RESTRICT,
  CHECK ((observation_kind='server_event' AND result='succeeded' AND denial_proof_kind='not_applicable'
      AND receipt_source IS NOT NULL AND receipt_id IS NOT NULL
      AND (audit_id IS NOT NULL OR receipt_source='enterprise_ai'))
    OR (observation_kind='negative_attempt' AND result='denied' AND denial_proof_kind<>'not_applicable'
      AND receipt_source IS NULL AND receipt_id IS NULL)),
  CHECK ((denial_proof_kind='denied_audit' AND audit_id IS NOT NULL)
    OR (denial_proof_kind='server_denied_attempt' AND audit_id IS NULL)
    OR denial_proof_kind='not_applicable')
);

-- Phase one is append-only and exists before the production operation. The
-- raw selector and target stay server-side; only safe_anchor may leave RLS.
CREATE TABLE public.pr_c_controlled_human_action_anchors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exercise_id uuid NOT NULL REFERENCES public.pr_c_controlled_human_exercises(id) ON DELETE RESTRICT,
  checkpoint_id text NOT NULL,
  step_id text NOT NULL,
  persona_key text NOT NULL,
  actor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  observation_kind text NOT NULL CHECK (observation_kind IN ('server_event','negative_attempt')),
  action text NOT NULL CHECK (length(action) BETWEEN 3 AND 120),
  target_family text NOT NULL CHECK (target_family ~ '^[a-z][a-z0-9_]{2,80}$'),
  target_id uuid NOT NULL,
  expected_version bigint NOT NULL CHECK (expected_version >= 0),
  transition_kind text NOT NULL CHECK (transition_kind IN ('same','increment_one','create_one','create_zero','replay_existing')),
  created_family text,
  request_id uuid NOT NULL,
  actor_authorization_version bigint NOT NULL CHECK (actor_authorization_version > 0),
  selector_bindings jsonb NOT NULL CHECK (jsonb_typeof(selector_bindings)='object' AND pg_column_size(selector_bindings)<=32768),
  selector_digest text NOT NULL CHECK (selector_digest ~ '^sha256:[0-9a-f]{64}$'),
  intent_digest text NOT NULL CHECK (intent_digest ~ '^sha256:[0-9a-f]{64}$'),
  challenge_token text NOT NULL UNIQUE CHECK (challenge_token ~ '^sha256:[0-9a-f]{64}$'),
  safe_anchor jsonb NOT NULL CHECK (jsonb_typeof(safe_anchor)='object'),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  UNIQUE (exercise_id,checkpoint_id,step_id),
  UNIQUE (exercise_id,request_id),
  FOREIGN KEY (exercise_id,checkpoint_id,step_id)
    REFERENCES public.pr_c_controlled_human_step_contracts(exercise_id,checkpoint_id,step_id) ON DELETE RESTRICT,
  FOREIGN KEY (exercise_id,persona_key)
    REFERENCES public.pr_c_controlled_human_persona_bindings(exercise_id,persona_key) ON DELETE RESTRICT,
  CHECK ((transition_kind IN ('create_one','create_zero','replay_existing'))=(created_family IS NOT NULL)),
  CHECK (created_family IS NULL OR created_family ~ '^[a-z][a-z0-9_]{2,80}$')
);

ALTER TABLE public.pr_c_controlled_human_action_bindings
  ADD COLUMN anchor_id uuid UNIQUE REFERENCES public.pr_c_controlled_human_action_anchors(id) ON DELETE RESTRICT;

-- Server-owned action-intent catalog.  The provisioner may select a catalog
-- row, but cannot redefine its action, target/version dimension, effect,
-- transition, selector schema, resolver, replay lineage, or denial class.
CREATE TABLE public.pr_c_controlled_human_intent_catalog (
  checkpoint_id text NOT NULL CHECK (checkpoint_id ~ '^CH-[0-9]{2}$'),
  step_id text NOT NULL CHECK (step_id ~ '^[a-z][a-z0-9-]{2,100}$'),
  observation_kind text NOT NULL CHECK (observation_kind IN ('server_event','negative_attempt')),
  action text NOT NULL,
  target_family text NOT NULL,
  target_version_dimension text NOT NULL,
  effect_family text NOT NULL,
  transition_kind text NOT NULL CHECK (transition_kind IN ('same','increment_one','create_one','create_zero','replay_existing')),
  selector_schema text NOT NULL,
  effect_resolver text NOT NULL,
  expected_outcome text,
  expected_denial_code text,
  replay_of_step_id text,
  PRIMARY KEY(checkpoint_id,step_id),
  CHECK ((observation_kind='negative_attempt')=(expected_denial_code IS NOT NULL)),
  CHECK ((transition_kind='replay_existing')=(replay_of_step_id IS NOT NULL))
);

INSERT INTO public.pr_c_controlled_human_intent_catalog
 (checkpoint_id,step_id,observation_kind,action,target_family,target_version_dimension,effect_family,transition_kind,selector_schema,effect_resolver,expected_outcome,expected_denial_code,replay_of_step_id)
VALUES
 ('CH-01','resolve-material-assess-conflict','server_event','transcript.assess.conflict.resolve','assess_conflict','current_resolution_version','assess_conflict_resolution','increment_one','assess_conflict','enterprise_ai_conflict',NULL,NULL,NULL),
 ('CH-01','approve-assess-result','server_event','assessment_v2.review.resolve','assess_case','version','assess_review_resolution','increment_one','assess_review','assess_review_resolution','approved',NULL,NULL),
 ('CH-02','review-studio-document','server_event','studio.artifact.review.resolve','studio_artifact','aggregate_version','studio_artifact_review','increment_one','studio_artifact_decision','studio_artifact_review','approve',NULL,NULL),
 ('CH-02','approve-studio-document','server_event','studio.artifact.approval.resolve','studio_artifact','aggregate_version','studio_artifact_approval','increment_one','studio_artifact_decision','studio_artifact_approval','approve',NULL,NULL),
 ('CH-03','request-studio-handoff','server_event','handoff.request','assess_studio_handoff','upstream_version','module_handoff','create_one','module_handoff_request','module_handoff_request',NULL,NULL,NULL),
 ('CH-03','review-studio-handoff','server_event','handoff.review.resolve','module_handoff','current_version','module_handoff_review','increment_one','module_handoff_decision','module_handoff_review','approve',NULL,NULL),
 ('CH-03','approve-studio-handoff','server_event','handoff.approval.resolve','module_handoff','current_version','module_handoff_approval','increment_one','module_handoff_decision','module_handoff_approval','approve',NULL,NULL),
 ('CH-03','accept-studio-handoff','server_event','handoff.consume','module_handoff','current_version','studio_artifact','create_zero','module_handoff_consume','module_handoff_consume','consumed',NULL,NULL),
 ('CH-03','generate-source-bound-document','server_event','pr_c.controlled_human.synthetic_studio_generate','studio_artifact','aggregate_version','studio_artifact_version','increment_one','synthetic_generation','synthetic_generation',NULL,NULL,NULL),
 ('CH-03','approve-hybrid-studio-document','server_event','studio.artifact.approval.resolve','studio_artifact','aggregate_version','studio_artifact_approval','increment_one','studio_artifact_decision','studio_artifact_approval','approve',NULL,NULL),
 ('CH-04','request-exact-studio-handoff','server_event','delivery.handoff.request','studio_artifact','aggregate_version','delivery_handoff','create_one','delivery_handoff_request','delivery_effect',NULL,NULL,NULL),
 ('CH-04','request-handoff-changes','server_event','delivery.handoff.review.resolve','delivery_handoff','current_version','delivery_handoff_review','increment_one','delivery_handoff_decision','delivery_effect','changes_requested',NULL,NULL),
 ('CH-04','reject-new-exact-handoff-request','server_event','delivery.handoff.review.resolve','delivery_handoff','current_version','delivery_handoff_review','increment_one','delivery_handoff_decision','delivery_effect','rejected',NULL,NULL),
 ('CH-05','request-fresh-exact-handoff','server_event','delivery.handoff.request','studio_artifact','aggregate_version','delivery_handoff','create_one','delivery_handoff_request','delivery_effect',NULL,NULL,NULL),
 ('CH-05','review-handoff-independently','server_event','delivery.handoff.review.resolve','delivery_handoff','current_version','delivery_handoff_review','increment_one','delivery_handoff_decision','delivery_effect','approved',NULL,NULL),
 ('CH-05','approve-handoff-independently','server_event','delivery.handoff.approval.resolve','delivery_handoff','current_version','delivery_handoff_approval','increment_one','delivery_handoff_decision','delivery_effect','approved',NULL,NULL),
 ('CH-05','consume-approved-handoff-once','server_event','delivery.handoff.consume','delivery_handoff','current_version','delivery_work_package','create_one','delivery_handoff_consume','delivery_effect',NULL,NULL,NULL),
 ('CH-05','replay-consumption-same-target','server_event','delivery.handoff.consume','delivery_handoff','current_version','delivery_work_package','replay_existing','delivery_handoff_consume','delivery_replay',NULL,NULL,'consume-approved-handoff-once'),
 ('CH-06','edit-one-item-with-rationale','server_event','delivery.item.review','delivery_item','aggregate_version','delivery_item_version','increment_one','delivery_item_decision','delivery_effect','edited',NULL,NULL),
 ('CH-06','decide-every-current-proposal','server_event','delivery.item.review','delivery_item','aggregate_version','delivery_item_version','increment_one','delivery_complete_set','delivery_complete_set','accepted',NULL,NULL),
 ('CH-07','request-package-changes','server_event','delivery.package.review.resolve','delivery_work_package','current_version','delivery_package_review','create_one','delivery_package_decision','delivery_effect','changes_requested',NULL,NULL),
 ('CH-07','commit-only-explicitly-edited-descendants','server_event','delivery.package.revision.commit','delivery_work_package','aggregate_version','delivery_work_package','increment_one','delivery_package_revision','delivery_effect',NULL,NULL,NULL),
 ('CH-07','review-complete-revised-package','server_event','delivery.package.review.resolve','delivery_work_package','current_version','delivery_package_review','create_one','delivery_package_decision','delivery_effect','approved',NULL,NULL),
 ('CH-07','approve-exact-revised-package','server_event','delivery.package.approval.resolve','delivery_work_package','current_version','delivery_package_approval','create_one','delivery_package_decision','delivery_effect','approved',NULL,NULL),
 ('CH-08','create-baseline-with-exact-package-selectors','server_event','monitor.baseline.create','delivery_work_package','current_version','monitor_baseline','create_one','delivery_baseline','delivery_effect',NULL,NULL,NULL),
 ('CH-08','replay-baseline-creation','server_event','monitor.baseline.create','delivery_work_package','current_version','monitor_baseline','replay_existing','delivery_baseline','delivery_replay',NULL,NULL,'create-baseline-with-exact-package-selectors'),
 ('CH-10','create-direct-studio-plan','server_event','studio.source-package.create','input_bundle','current_version','studio_source_package','create_one','studio_source_package','studio_source_package',NULL,NULL,NULL),
 ('CH-10','handoff-direct-studio-plan','server_event','delivery.handoff.request','studio_artifact','aggregate_version','delivery_handoff','create_one','delivery_handoff_request','delivery_effect',NULL,NULL,NULL),
 ('CH-10','approve-direct-planning-package','server_event','delivery.package.approval.resolve','delivery_work_package','current_version','delivery_package_approval','create_one','delivery_package_decision','delivery_effect','approved',NULL,NULL),
 ('CH-11','create-manual-delivery-package','server_event','delivery.package.create.manual','workspace','actor_authorization_version','delivery_work_package','create_one','delivery_manual_package','delivery_effect',NULL,NULL,NULL),
 ('CH-11','review-manual-delivery-package','server_event','delivery.package.review.resolve','delivery_work_package','current_version','delivery_package_review','create_one','delivery_package_decision','delivery_effect','approved',NULL,NULL),
 ('CH-11','approve-manual-delivery-package','server_event','delivery.package.approval.resolve','delivery_work_package','current_version','delivery_package_approval','create_one','delivery_package_decision','delivery_effect','approved',NULL,NULL),
 ('CH-11','create-read-only-manual-baseline','server_event','monitor.baseline.create','delivery_work_package','current_version','monitor_baseline','create_one','delivery_baseline','delivery_effect',NULL,NULL,NULL),
 ('CH-13','simulate-response-loss','server_event','delivery.package.revision.commit','delivery_work_package','aggregate_version','delivery_work_package','increment_one','delivery_package_revision','delivery_response_loss','committed_once',NULL,NULL),
 ('CH-12','revoked-actor-projection-denied','negative_attempt','delivery.workspace.projection','workspace','actor_authorization_version','none','same','negative_projection','delivery_negative','revoked_actor','ENTERPRISE_DELIVERY_PERMISSION_DENIED',NULL),
 ('CH-12','revoked-actor-mutation-denied','negative_attempt','delivery.package.create.manual','workspace','actor_authorization_version','none','same','negative_manual','delivery_negative','revoked_actor','ENTERPRISE_DELIVERY_PERMISSION_DENIED',NULL),
 ('CH-12','same-org-other-workspace-projection-denied','negative_attempt','delivery.workspace.projection','workspace','actor_authorization_version','none','same','negative_projection','delivery_negative','same_org_other_workspace','ENTERPRISE_DELIVERY_PERMISSION_DENIED',NULL),
 ('CH-12','same-org-other-workspace-mutation-denied','negative_attempt','delivery.package.create.manual','workspace','actor_authorization_version','none','same','negative_manual','delivery_negative','same_org_other_workspace','ENTERPRISE_DELIVERY_PERMISSION_DENIED',NULL),
 ('CH-12','cross-org-projection-denied','negative_attempt','delivery.workspace.projection','workspace','actor_authorization_version','none','same','negative_projection','delivery_negative','cross_org','ENTERPRISE_DELIVERY_PERMISSION_DENIED',NULL),
 ('CH-12','cross-org-mutation-denied','negative_attempt','delivery.package.create.manual','workspace','actor_authorization_version','none','same','negative_manual','delivery_negative','cross_org','ENTERPRISE_DELIVERY_PERMISSION_DENIED',NULL),
 ('CH-13','reject-stale-authorization','negative_attempt','delivery.package.revision.commit','delivery_work_package','aggregate_version','none','same','negative_revision','delivery_negative','stale_authorization','ENTERPRISE_DELIVERY_RESOURCE_STALE',NULL),
 ('CH-13','reject-stale-source-change','negative_attempt','delivery.handoff.request','studio_artifact','aggregate_version','none','same','negative_handoff','delivery_negative','stale_source','ENTERPRISE_DELIVERY_RESOURCE_UNAVAILABLE',NULL);

-- The exercise also contains human-attestation rows.  Do not put those rows
-- behind a foreign key to this deliberately exhaustive 42-row machine-action
-- catalog; anchor_step performs the mandatory catalog join for every
-- server_event/negative_attempt and rejects everything else.

CREATE OR REPLACE FUNCTION public.pr_c_controlled_human_list_step_bindings(p_exercise_digest text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE exercise public.pr_c_controlled_human_exercises; actor uuid:=auth.uid();
BEGIN
  PERFORM public.pr_c_controlled_human_assert_marker();
  SELECT stored.* INTO exercise FROM public.pr_c_controlled_human_exercises stored
  WHERE stored.exercise_digest=p_exercise_digest AND stored.lifecycle='active';
  IF exercise.id IS NULL OR actor IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.pr_c_controlled_human_persona_bindings binding
    WHERE binding.exercise_id=exercise.id AND binding.auth_user_id=actor
  ) THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_STEP_BINDING_REJECTED'; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'checkpointId',contract.checkpoint_id,'stepId',contract.step_id,'action',contract.expected_actions[1],
      'observationKind',contract.observation_kind,
      'state',CASE WHEN bound.step_id IS NOT NULL THEN 'completed' WHEN anchor.step_id IS NOT NULL THEN 'anchored' ELSE 'unanchored' END,
      'safeAnchor',anchor.safe_anchor,'safeBinding',bound.safe_record
    ) ORDER BY contract.checkpoint_id,contract.created_at,contract.step_id)
    FROM public.pr_c_controlled_human_step_contracts contract
    JOIN public.pr_c_controlled_human_persona_bindings binding
      ON binding.exercise_id=contract.exercise_id AND binding.persona_key=contract.persona_key AND binding.auth_user_id=actor
    LEFT JOIN public.pr_c_controlled_human_action_bindings bound
      ON bound.exercise_id=contract.exercise_id AND bound.checkpoint_id=contract.checkpoint_id AND bound.step_id=contract.step_id
    LEFT JOIN public.pr_c_controlled_human_action_anchors anchor
      ON anchor.exercise_id=contract.exercise_id AND anchor.checkpoint_id=contract.checkpoint_id AND anchor.step_id=contract.step_id
    WHERE contract.exercise_id=exercise.id AND contract.observation_kind IN ('server_event','negative_attempt')
  ),'[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.pr_c_controlled_human_issue_step_binding(
  p_exercise_digest text,p_checkpoint_id text,p_step_id text,p_attempt_request_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  -- This compatibility symbol intentionally has no inference or write path.
  -- Controlled-human proof requires anchor -> production operation -> complete.
  RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_PREANCHOR_REQUIRED';
END $$;

CREATE OR REPLACE FUNCTION public.pr_c_controlled_human_current_resource_version(
  p_exercise_id uuid,p_actor_id uuid,p_family text,p_resource_id uuid
) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE table_name text; payload jsonb; actual bigint;
BEGIN
  IF p_family='workspace' THEN
    SELECT version INTO actual FROM public.authorization_versions authority
    WHERE authority.org_id=(SELECT binding.org_id FROM public.pr_c_controlled_human_persona_bindings binding
      WHERE binding.exercise_id=p_exercise_id AND binding.auth_user_id=p_actor_id)
      AND authority.user_id=p_actor_id;
    RETURN actual;
  END IF;
  table_name:=CASE p_family
    WHEN 'assess_case' THEN 'assess_v2_cases'
    WHEN 'assess_studio_handoff' THEN 'assess_v2_studio_handoffs'
    WHEN 'assess_conflict' THEN 'enterprise_assess_evidence_conflicts'
    WHEN 'source_set' THEN 'enterprise_source_sets'
    WHEN 'input_bundle' THEN 'enterprise_module_input_bundles'
    WHEN 'tenant_template' THEN 'studio_tenant_template_aggregates'
    WHEN 'module_handoff' THEN 'enterprise_module_handoffs'
    WHEN 'studio_artifact' THEN 'studio_artifact_aggregates'
    WHEN 'studio_source_package' THEN 'studio_artifact_source_packages'
    WHEN 'delivery_handoff' THEN 'enterprise_delivery_handoffs'
    WHEN 'delivery_work_package' THEN 'enterprise_delivery_work_packages'
    WHEN 'delivery_item' THEN 'enterprise_delivery_work_item_aggregates'
    WHEN 'monitor_baseline' THEN 'enterprise_monitor_baselines'
    ELSE NULL END;
  IF table_name IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.pr_c_controlled_human_resource_ownership ownership
    WHERE ownership.exercise_id=p_exercise_id AND ownership.resource_family=p_family AND ownership.resource_id=p_resource_id
  ) THEN RETURN NULL; END IF;
  EXECUTE format('SELECT to_jsonb(resource) FROM public.%I resource WHERE resource.id=$1',table_name) INTO payload USING p_resource_id;
  IF payload IS NULL THEN RETURN NULL; END IF;
  BEGIN
    actual:=COALESCE(NULLIF(payload->>'aggregate_version','')::bigint,NULLIF(payload->>'current_resolution_version','')::bigint,
      NULLIF(payload->>'current_version','')::bigint,NULLIF(payload->>'version','')::bigint,NULLIF(payload->>'source_case_version','')::bigint,1);
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN NULL; END;
  RETURN actual;
END $$;

CREATE OR REPLACE FUNCTION public.pr_c_controlled_human_jsonb_exact_keys(p_value jsonb,p_keys text[])
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_typeof(p_value)='object' AND p_value ?& p_keys
   AND (SELECT count(*) FROM jsonb_object_keys(p_value))=cardinality(p_keys)
$$;

-- Cross-runtime canonical JSON intentionally does not depend on PostgreSQL's
-- presentation whitespace or jsonb's internal object-key ordering. Browser
-- clients use this same compact, lexicographically-keyed representation.
CREATE OR REPLACE FUNCTION public.pr_c_controlled_human_canonical_json(p_value jsonb)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE kind text:=jsonb_typeof(p_value); rendered text:=''; entry record; first_entry boolean:=true;
BEGIN
  IF kind='object' THEN
    rendered:='{';
    FOR entry IN SELECT key,value FROM jsonb_each(p_value) ORDER BY key LOOP
      IF NOT first_entry THEN rendered:=rendered||','; END IF; first_entry:=false;
      rendered:=rendered||to_jsonb(entry.key)::text||':'||public.pr_c_controlled_human_canonical_json(entry.value);
    END LOOP;
    RETURN rendered||'}';
  ELSIF kind='array' THEN
    rendered:='[';
    FOR entry IN SELECT value FROM jsonb_array_elements(p_value) WITH ORDINALITY ordered(value,ordinal) ORDER BY ordinal LOOP
      IF NOT first_entry THEN rendered:=rendered||','; END IF; first_entry:=false;
      rendered:=rendered||public.pr_c_controlled_human_canonical_json(entry.value);
    END LOOP;
    RETURN rendered||']';
  END IF;
  RETURN COALESCE(p_value,'null'::jsonb)::text;
END $$;

CREATE OR REPLACE FUNCTION public.pr_c_controlled_human_sha256_jsonb(p_value jsonb)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT encode(public.digest(convert_to(public.pr_c_controlled_human_canonical_json(COALESCE(p_value,'null'::jsonb)),'UTF8'),'sha256'),'hex')
$$;

CREATE OR REPLACE FUNCTION public.pr_c_controlled_human_selector_is_safe(p_value jsonb,p_depth integer DEFAULT 0)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 -- Arbitrary nested values are never accepted.  The action-specific validator
 -- below is the sole allow-list and admits only scalar IDs, versions, enums,
 -- counts, hashes, and digests.
 SELECT jsonb_typeof(p_value)='object' AND pg_column_size(p_value)<=8192
   AND NOT EXISTS(SELECT 1 FROM jsonb_each(p_value) entry WHERE jsonb_typeof(entry.value) IN ('object','array'))
$$;

CREATE OR REPLACE FUNCTION public.pr_c_controlled_human_selector_contract_valid(
 p_schema text,p_selector jsonb,p_target_family text,p_target_id uuid,p_expected_version bigint,p_expected_outcome text
) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE uuid_re constant text:='^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
 digest_re constant text:='^sha256:[0-9a-f]{64}$'; hash_re constant text:='^[0-9a-f]{64}$';
BEGIN
 IF NOT public.pr_c_controlled_human_selector_is_safe(p_selector) THEN RETURN false; END IF;
 IF p_schema='assess_conflict' THEN
  RETURN public.pr_c_controlled_human_jsonb_exact_keys(p_selector,ARRAY['conflictId','resolutionVersion','resolution','candidateId','authoredValueDigest','rationaleDigest'])
   AND p_target_family='assess_conflict' AND p_selector->>'conflictId'=p_target_id::text AND (p_selector->>'resolutionVersion')::bigint=p_expected_version
   AND p_selector->>'resolution' IN('choose_candidate','retain_manual','authored_resolution','unresolved')
   AND (p_selector->'candidateId'='null'::jsonb OR p_selector->>'candidateId'~uuid_re)
   AND p_selector->>'authoredValueDigest'~digest_re AND p_selector->>'rationaleDigest'~digest_re;
 ELSIF p_schema='assess_review' THEN
  RETURN public.pr_c_controlled_human_jsonb_exact_keys(p_selector,ARRAY['caseId','decisionId','reviewSequence','resolution','rationaleDigest','conditionsDigest'])
   AND p_target_family='assess_case' AND p_selector->>'caseId'=p_target_id::text AND p_selector->>'decisionId'~uuid_re
   AND (p_selector->>'reviewSequence')~'^[1-9][0-9]*$' AND p_selector->>'resolution'=p_expected_outcome
   AND p_selector->>'rationaleDigest'~digest_re AND p_selector->>'conditionsDigest'~digest_re;
 ELSIF p_schema='studio_artifact_decision' THEN
  RETURN public.pr_c_controlled_human_jsonb_exact_keys(p_selector,ARRAY['artifactId','artifactVersionId','outcome','rationaleDigest','conditionsDigest'])
   AND p_target_family='studio_artifact' AND p_selector->>'artifactId'=p_target_id::text AND p_selector->>'artifactVersionId'~uuid_re
   AND p_selector->>'outcome'=p_expected_outcome AND p_selector->>'rationaleDigest'~digest_re AND p_selector->>'conditionsDigest'~digest_re;
 ELSIF p_schema='module_handoff_request' THEN
  RETURN public.pr_c_controlled_human_jsonb_exact_keys(p_selector,ARRAY['upstreamHandoffId','artifactType','targetInputBundleId','targetInputBundleVersionId','targetInputBundleVersion'])
   AND p_target_family='assess_studio_handoff' AND p_selector->>'upstreamHandoffId'=p_target_id::text AND p_selector->>'artifactType' IN('brd','frd','pdd')
   AND p_selector->>'targetInputBundleId'~uuid_re AND p_selector->>'targetInputBundleVersionId'~uuid_re AND (p_selector->>'targetInputBundleVersion')~'^[1-9][0-9]*$';
 ELSIF p_schema='module_handoff_decision' THEN
  RETURN public.pr_c_controlled_human_jsonb_exact_keys(p_selector,ARRAY['handoffId','handoffVersion','outcome','rationaleDigest','conditionsDigest'])
   AND p_target_family='module_handoff' AND p_selector->>'handoffId'=p_target_id::text AND (p_selector->>'handoffVersion')::bigint=p_expected_version
   AND p_selector->>'outcome'=p_expected_outcome AND p_selector->>'rationaleDigest'~digest_re AND p_selector->>'conditionsDigest'~digest_re;
 ELSIF p_schema='module_handoff_consume' THEN
  RETURN public.pr_c_controlled_human_jsonb_exact_keys(p_selector,ARRAY['handoffId','handoffVersion'])
   AND p_target_family='module_handoff' AND p_selector->>'handoffId'=p_target_id::text AND (p_selector->>'handoffVersion')::bigint=p_expected_version;
 ELSIF p_schema='synthetic_generation' THEN
  RETURN ((p_selector->>'templateKind'='tenant' AND public.pr_c_controlled_human_jsonb_exact_keys(p_selector,ARRAY['artifactId','sourcePackageId','sourcePackageVersion','sourcePackageHash','templateKind','templateId','templateVersionId','templateVersionDigest','templateHash','expectedCurrentVersionId','expectedApprovedVersionId']) AND p_selector->>'templateId'~uuid_re)
    OR (p_selector->>'templateKind'='system' AND public.pr_c_controlled_human_jsonb_exact_keys(p_selector,ARRAY['artifactId','sourcePackageId','sourcePackageVersion','sourcePackageHash','templateKind','templateVersionId','templateVersionDigest','templateHash','expectedCurrentVersionId','expectedApprovedVersionId'])))
   AND p_target_family='studio_artifact' AND p_selector->>'artifactId'=p_target_id::text AND p_selector->>'sourcePackageId'~uuid_re
   AND (p_selector->>'sourcePackageVersion')~'^[1-9][0-9]*$' AND p_selector->>'sourcePackageHash'~hash_re
   AND p_selector->>'templateVersionId'~uuid_re AND p_selector->>'templateVersionDigest'~digest_re AND p_selector->>'templateHash'~hash_re
   AND (p_selector->'expectedCurrentVersionId'='null'::jsonb OR p_selector->>'expectedCurrentVersionId'~uuid_re)
   AND (p_selector->'expectedApprovedVersionId'='null'::jsonb OR p_selector->>'expectedApprovedVersionId'~uuid_re);
 ELSIF p_schema='delivery_handoff_request' OR p_schema='negative_handoff' THEN
  RETURN public.pr_c_controlled_human_jsonb_exact_keys(p_selector,ARRAY['targetWorkspaceId','studioArtifactId','studioArtifactVersionId','expectedAggregateVersion','expectedCurrentVersionId','expectedApprovedVersionId'])
   AND p_target_family='studio_artifact' AND p_selector->>'studioArtifactId'=p_target_id::text AND (p_selector->>'expectedAggregateVersion')::bigint=p_expected_version
   AND p_selector->>'targetWorkspaceId'~uuid_re AND p_selector->>'studioArtifactVersionId'~uuid_re
   AND p_selector->>'expectedCurrentVersionId'~uuid_re AND p_selector->>'expectedApprovedVersionId'~uuid_re;
 ELSIF p_schema='delivery_handoff_decision' THEN
  RETURN public.pr_c_controlled_human_jsonb_exact_keys(p_selector,ARRAY['handoffId','expectedHandoffVersion','outcome','rationaleDigest'])
   AND p_target_family='delivery_handoff' AND p_selector->>'handoffId'=p_target_id::text AND (p_selector->>'expectedHandoffVersion')::bigint=p_expected_version
   AND p_selector->>'outcome'=p_expected_outcome AND p_selector->>'rationaleDigest'~digest_re;
 ELSIF p_schema='delivery_handoff_consume' THEN
  RETURN public.pr_c_controlled_human_jsonb_exact_keys(p_selector,ARRAY['handoffId','expectedHandoffVersion'])
   AND p_target_family='delivery_handoff' AND p_selector->>'handoffId'=p_target_id::text AND (p_selector->>'expectedHandoffVersion')::bigint=p_expected_version;
  ELSIF p_schema='delivery_item_decision' THEN
   RETURN ((p_selector->>'outcome'='edited' AND public.pr_c_controlled_human_jsonb_exact_keys(p_selector,ARRAY['itemAggregateId','expectedAggregateVersion','expectedItemVersionId','outcome','rationaleDigest','authoredItemDigest']) AND p_selector->>'authoredItemDigest'~digest_re)
     OR (p_selector->>'outcome'<>'edited' AND public.pr_c_controlled_human_jsonb_exact_keys(p_selector,ARRAY['itemAggregateId','expectedAggregateVersion','expectedItemVersionId','outcome','rationaleDigest'])))
   AND p_target_family='delivery_item' AND p_selector->>'itemAggregateId'=p_target_id::text AND (p_selector->>'expectedAggregateVersion')::bigint=p_expected_version
   AND p_selector->>'expectedItemVersionId'~uuid_re AND p_selector->>'outcome'=p_expected_outcome
    AND p_selector->>'rationaleDigest'~digest_re;
  ELSIF p_schema='delivery_complete_set' THEN
   RETURN public.pr_c_controlled_human_jsonb_exact_keys(p_selector,ARRAY['itemAggregateId','expectedAggregateVersion','expectedItemVersionId','outcome','rationaleDigest','completeItemSetDigest','completeItemCount'])
    AND p_target_family='delivery_item' AND p_selector->>'itemAggregateId'=p_target_id::text AND (p_selector->>'expectedAggregateVersion')::bigint=p_expected_version
    AND p_selector->>'expectedItemVersionId'~uuid_re AND p_selector->>'outcome'=p_expected_outcome
    AND p_selector->>'rationaleDigest'~digest_re
    AND p_selector->>'completeItemSetDigest'~digest_re AND (p_selector->>'completeItemCount')~'^[1-9][0-9]*$';
 ELSIF p_schema IN('delivery_package_revision','negative_revision') THEN
  RETURN public.pr_c_controlled_human_jsonb_exact_keys(p_selector,ARRAY['workPackageId','expectedPackageVersion','expectedPackageVersionId','expectedPackageAggregateVersion','expectedItemsDigest','expectedItemCount','itemRevisionsDigest','revisionCount'])
   AND p_target_family='delivery_work_package' AND p_selector->>'workPackageId'=p_target_id::text
   AND (p_selector->>'expectedPackageAggregateVersion')::bigint=p_expected_version AND p_selector->>'expectedPackageVersionId'~uuid_re
   AND p_selector->>'expectedItemsDigest'~digest_re AND p_selector->>'itemRevisionsDigest'~digest_re
   AND (p_selector->>'expectedItemCount')~'^[1-9][0-9]*$' AND (p_selector->>'revisionCount')~'^[1-9][0-9]*$';
 ELSIF p_schema='delivery_package_decision' THEN
  RETURN public.pr_c_controlled_human_jsonb_exact_keys(p_selector,ARRAY['workPackageId','expectedPackageVersion','expectedPackageVersionId','expectedPackageAggregateVersion','outcome','rationaleDigest'])
   AND p_target_family='delivery_work_package' AND p_selector->>'workPackageId'=p_target_id::text AND (p_selector->>'expectedPackageVersion')::bigint=p_expected_version
   AND p_selector->>'expectedPackageVersionId'~uuid_re AND (p_selector->>'expectedPackageAggregateVersion')~'^[1-9][0-9]*$'
   AND p_selector->>'outcome'=p_expected_outcome AND p_selector->>'rationaleDigest'~digest_re;
 ELSIF p_schema='delivery_baseline' THEN
  RETURN public.pr_c_controlled_human_jsonb_exact_keys(p_selector,ARRAY['workPackageId','expectedPackageVersion','expectedPackageVersionId'])
   AND p_target_family='delivery_work_package' AND p_selector->>'workPackageId'=p_target_id::text AND (p_selector->>'expectedPackageVersion')::bigint=p_expected_version
   AND p_selector->>'expectedPackageVersionId'~uuid_re;
 ELSIF p_schema='studio_source_package' THEN
  RETURN p_selector->>'artifactType' IN('brd','frd','pdd') AND (
    (p_selector->>'sourceMode'='direct_transcript_bundle' AND public.pr_c_controlled_human_jsonb_exact_keys(p_selector,ARRAY['sourceMode','artifactType','studioInputBundleId','studioInputBundleVersionId','studioInputBundleVersion'])
      AND p_target_family='input_bundle' AND p_selector->>'studioInputBundleId'=p_target_id::text AND (p_selector->>'studioInputBundleVersion')::bigint=p_expected_version AND p_selector->>'studioInputBundleVersionId'~uuid_re)
    OR (p_selector->>'sourceMode'='manual_brief' AND public.pr_c_controlled_human_jsonb_exact_keys(p_selector,ARRAY['sourceMode','artifactType','manualBriefDigest'])
      AND p_target_family='workspace' AND p_selector->>'manualBriefDigest'~digest_re));
 ELSIF p_schema IN('delivery_manual_package','negative_manual') THEN
  RETURN public.pr_c_controlled_human_jsonb_exact_keys(p_selector,ARRAY['manualBriefDigest','orderedItemsDigest','itemCount'])
   AND p_target_family='workspace' AND p_selector->>'manualBriefDigest'~digest_re AND p_selector->>'orderedItemsDigest'~digest_re
   AND (p_selector->>'itemCount')~'^[1-9][0-9]*$';
 ELSIF p_schema='negative_projection' THEN RETURN p_selector='{}'::jsonb AND p_target_family='workspace';
 END IF;
 RETURN false;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;

CREATE OR REPLACE FUNCTION public.pr_c_controlled_human_anchor_step(
  p_exercise_digest text,p_checkpoint_id text,p_step_id text,p_target_family text,p_target_id uuid,
  p_expected_version bigint,p_selector_bindings jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE exercise public.pr_c_controlled_human_exercises; contract public.pr_c_controlled_human_step_contracts;
 spec public.pr_c_controlled_human_intent_catalog; persona public.pr_c_controlled_human_persona_bindings; actor uuid:=auth.uid(); actual_version bigint; authorization_version bigint; transition text; created text;
 request_id uuid:=gen_random_uuid(); selector_digest text; intent_digest text; token text; safe jsonb; business_key text; replay_binding public.pr_c_controlled_human_action_bindings;
BEGIN
  PERFORM public.pr_c_controlled_human_assert_marker();
  SELECT stored.* INTO exercise FROM public.pr_c_controlled_human_exercises stored WHERE stored.exercise_digest=p_exercise_digest AND stored.lifecycle='active' FOR SHARE;
  SELECT stored.* INTO contract FROM public.pr_c_controlled_human_step_contracts stored WHERE stored.exercise_id=exercise.id AND stored.checkpoint_id=p_checkpoint_id AND stored.step_id=p_step_id;
  SELECT stored.* INTO spec FROM public.pr_c_controlled_human_intent_catalog stored WHERE stored.checkpoint_id=p_checkpoint_id AND stored.step_id=p_step_id;
  SELECT stored.* INTO persona FROM public.pr_c_controlled_human_persona_bindings stored WHERE stored.exercise_id=exercise.id AND stored.persona_key=contract.persona_key AND stored.auth_user_id=actor;
  IF exercise.id IS NULL OR actor IS NULL OR contract.exercise_id IS NULL OR persona.exercise_id IS NULL
    OR spec.step_id IS NULL OR contract.observation_kind<>spec.observation_kind OR cardinality(contract.expected_actions)<>1
    OR contract.expected_actions[1]<>spec.action OR p_selector_bindings IS NULL OR jsonb_typeof(p_selector_bindings)<>'object'
    OR NOT COALESCE(public.pr_c_controlled_human_selector_contract_valid(spec.selector_schema,p_selector_bindings,p_target_family,p_target_id,p_expected_version,spec.expected_outcome),false)
    OR EXISTS (SELECT 1 FROM public.pr_c_controlled_human_action_anchors anchor WHERE anchor.exercise_id=exercise.id AND anchor.checkpoint_id=p_checkpoint_id AND anchor.step_id=p_step_id)
  THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_ANCHOR_REJECTED'; END IF;
  transition:=spec.transition_kind; created:=CASE WHEN transition IN('create_one','create_zero','replay_existing') THEN spec.effect_family ELSE NULL END;
  IF p_target_family<>spec.target_family THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_ANCHOR_TARGET_REJECTED';
  ELSIF p_target_family='workspace' AND p_target_id=exercise.workspace_id THEN
    NULL;
  ELSIF NOT EXISTS (SELECT 1 FROM public.pr_c_controlled_human_resource_ownership ownership WHERE ownership.exercise_id=exercise.id AND ownership.resource_family=p_target_family AND ownership.resource_id=p_target_id) THEN
    RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_ANCHOR_TARGET_REJECTED';
  END IF;
  actual_version:=public.pr_c_controlled_human_current_resource_version(exercise.id,actor,p_target_family,p_target_id);
  -- A resource may expose more than one concurrency/version axis.  The catalog,
  -- not COALESCE column order, selects the exact immutable pre-action dimension.
  IF p_target_family='delivery_work_package' AND spec.target_version_dimension='current_version' THEN
    SELECT package.current_version INTO actual_version
    FROM public.enterprise_delivery_work_packages package
    WHERE package.id=p_target_id AND package.org_id=exercise.org_id AND package.workspace_id=exercise.workspace_id;
  ELSIF p_target_family='assess_case' AND spec.target_version_dimension='version' THEN
    SELECT assess_case.version INTO actual_version
    FROM public.assess_v2_cases assess_case
    WHERE assess_case.id=p_target_id AND assess_case.org_id=exercise.org_id AND assess_case.workspace_id=exercise.workspace_id;
  END IF;
  IF transition='replay_existing' THEN
    SELECT source.* INTO replay_binding FROM public.pr_c_controlled_human_action_bindings source
    WHERE source.exercise_id=exercise.id AND source.step_id=spec.replay_of_step_id AND source.result='succeeded' FOR SHARE;
    IF replay_binding.step_id IS NULL OR replay_binding.action<>spec.action OR replay_binding.expected_version<>p_expected_version
      OR (spec.action='delivery.handoff.consume' AND actual_version<>p_expected_version+1)
      OR (spec.action='monitor.baseline.create' AND actual_version<>p_expected_version)
    THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_ANCHOR_REPLAY_REJECTED'; END IF;
    SELECT receipt.idempotency_key INTO business_key FROM public.enterprise_delivery_monitor_command_receipts receipt
    WHERE receipt.id=replay_binding.receipt_id AND replay_binding.receipt_source='delivery' AND receipt.action=spec.action AND receipt.status='committed';
    IF business_key IS NULL THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_ANCHOR_REPLAY_REJECTED'; END IF;
  ELSIF actual_version IS NULL OR p_expected_version IS DISTINCT FROM actual_version THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_ANCHOR_VERSION_REJECTED'; END IF;
  SELECT authority.version INTO authorization_version FROM public.authorization_versions authority WHERE authority.org_id=persona.org_id AND authority.user_id=actor;
  IF authorization_version IS NULL THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_ANCHOR_REJECTED'; END IF;
  selector_digest:='sha256:'||public.pr_c_controlled_human_sha256_jsonb(p_selector_bindings);
  intent_digest:='sha256:'||public.pr_c_controlled_human_sha256_jsonb(jsonb_build_object('checkpointId',p_checkpoint_id,'stepId',p_step_id,'action',spec.action,'targetFamily',p_target_family,
    'targetVersionDimension',spec.target_version_dimension,'targetId',p_target_id,'expectedVersion',p_expected_version,'effectFamily',spec.effect_family,
    'transitionKind',transition,'effectResolver',spec.effect_resolver,'requestId',request_id,'selectorBindings',p_selector_bindings));
  token:='sha256:'||public.pr_c_controlled_human_sha256_jsonb(jsonb_build_object('exerciseDigest',exercise.exercise_digest,'checkpointId',p_checkpoint_id,'stepId',p_step_id,'personaKey',contract.persona_key,'intentDigest',intent_digest,'authorizationVersion',authorization_version));
  safe:=jsonb_build_object('contractVersion','pr-c-controlled-human-step-anchor-1','stepId',p_step_id,'action',contract.expected_actions[1],
    'targetFamily',p_target_family,'targetDigest','sha256:'||public.pr_c_controlled_human_sha256_jsonb(jsonb_build_object('resourceFamily',p_target_family,'resourceId',p_target_id)),
    'expectedVersion',p_expected_version,'transitionKind',transition,'selectorDigest',selector_digest,'intentDigest',intent_digest,'requestDigest','sha256:'||public.pr_c_controlled_human_sha256_jsonb(jsonb_build_object('requestId',request_id)),
    'challengeToken',token,'anchoredAt',to_char(statement_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
  INSERT INTO public.pr_c_controlled_human_action_anchors(exercise_id,checkpoint_id,step_id,persona_key,actor_id,observation_kind,action,target_family,target_id,expected_version,transition_kind,created_family,request_id,actor_authorization_version,selector_bindings,selector_digest,intent_digest,challenge_token,safe_anchor)
  VALUES(exercise.id,p_checkpoint_id,p_step_id,contract.persona_key,actor,contract.observation_kind,spec.action,p_target_family,p_target_id,p_expected_version,transition,created,request_id,authorization_version,p_selector_bindings,selector_digest,intent_digest,token,safe);
  RETURN jsonb_build_object('safeAnchor',safe,'execution',jsonb_strip_nulls(jsonb_build_object('requestId',request_id,'businessIdempotencyKey',business_key)));
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_ANCHOR_REPLAY_REJECTED';
END $$;

-- Reconstruct the exact CH-03 causal chain from immutable server-owned state.
-- The returned values are digest-only and may be retained in sanitized proof;
-- raw resource identities never leave the protected controller boundary.
CREATE OR REPLACE FUNCTION public.pr_c_controlled_human_step_causal_proof(
  p_exercise_id uuid,
  p_step_id text,
  p_bound_resource_id uuid
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  anchor public.pr_c_controlled_human_action_anchors;
  requested public.pr_c_controlled_human_action_bindings;
  reviewed public.pr_c_controlled_human_action_bindings;
  approved public.pr_c_controlled_human_action_bindings;
  consumed public.pr_c_controlled_human_action_bindings;
  generated public.pr_c_controlled_human_action_bindings;
  parent_binding text;
  parent_resource text;
  lineage text;
  sentinel text:='sha256:'||public.pr_c_controlled_human_sha256_jsonb(jsonb_build_object('proof','not_applicable'));
BEGIN
  SELECT stored.* INTO anchor FROM public.pr_c_controlled_human_action_anchors stored
  WHERE stored.exercise_id=p_exercise_id AND stored.checkpoint_id='CH-03' AND stored.step_id=p_step_id;
  IF anchor.id IS NULL OR p_bound_resource_id IS NULL THEN
    RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_CAUSAL_CHAIN_REJECTED';
  END IF;
  IF p_step_id NOT IN ('request-studio-handoff','review-studio-handoff','approve-studio-handoff','accept-studio-handoff','generate-source-bound-document','approve-hybrid-studio-document') THEN
    RETURN jsonb_build_object('causalParentBindingToken',sentinel,'causalParentResourceDigest',sentinel,'causalLineageDigest',sentinel);
  END IF;
  SELECT stored.* INTO requested FROM public.pr_c_controlled_human_action_bindings stored
  WHERE stored.exercise_id=p_exercise_id AND stored.checkpoint_id='CH-03' AND stored.step_id='request-studio-handoff';
  IF p_step_id='request-studio-handoff' THEN
    IF NOT EXISTS(SELECT 1 FROM public.enterprise_module_handoffs handoff
      JOIN public.assess_v2_studio_handoffs upstream ON upstream.id=handoff.upstream_handoff_id
      JOIN public.enterprise_module_input_bundles bundle ON bundle.id=handoff.target_input_bundle_id
      JOIN public.enterprise_module_input_bundle_versions bundle_version
        ON bundle_version.id=handoff.target_input_bundle_version_id AND bundle_version.input_bundle_id=bundle.id
      WHERE handoff.id=p_bound_resource_id AND handoff.upstream_handoff_id=anchor.target_id
        AND handoff.target_input_bundle_id=(anchor.selector_bindings->>'targetInputBundleId')::uuid
        AND handoff.target_input_bundle_version_id=(anchor.selector_bindings->>'targetInputBundleVersionId')::uuid
        AND handoff.target_input_bundle_version=(anchor.selector_bindings->>'targetInputBundleVersion')::bigint
        AND handoff.target_input_bundle_hash=bundle_version.bundle_hash
        AND upstream.package_hash=handoff.upstream_package_hash)
    THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_CAUSAL_CHAIN_REJECTED'; END IF;
    SELECT 'sha256:'||public.pr_c_controlled_human_sha256_jsonb(jsonb_build_object(
      'moduleHandoffId',handoff.id,'upstreamAssessHandoffId',handoff.upstream_handoff_id,
      'upstreamPackageHash',handoff.upstream_package_hash,'targetInputBundleId',handoff.target_input_bundle_id,
      'targetInputBundleVersionId',handoff.target_input_bundle_version_id,'targetInputBundleVersion',handoff.target_input_bundle_version,
      'targetInputBundleHash',handoff.target_input_bundle_hash)) INTO lineage
    FROM public.enterprise_module_handoffs handoff WHERE handoff.id=p_bound_resource_id;
    RETURN jsonb_build_object('causalParentBindingToken',sentinel,'causalParentResourceDigest',sentinel,'causalLineageDigest',lineage);
  END IF;
  IF requested.exercise_id IS NULL THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_CAUSAL_CHAIN_REJECTED'; END IF;
  SELECT stored.* INTO reviewed FROM public.pr_c_controlled_human_action_bindings stored
  WHERE stored.exercise_id=p_exercise_id AND stored.checkpoint_id='CH-03' AND stored.step_id='review-studio-handoff';
  SELECT stored.* INTO approved FROM public.pr_c_controlled_human_action_bindings stored
  WHERE stored.exercise_id=p_exercise_id AND stored.checkpoint_id='CH-03' AND stored.step_id='approve-studio-handoff';
  SELECT stored.* INTO consumed FROM public.pr_c_controlled_human_action_bindings stored
  WHERE stored.exercise_id=p_exercise_id AND stored.checkpoint_id='CH-03' AND stored.step_id='accept-studio-handoff';
  SELECT stored.* INTO generated FROM public.pr_c_controlled_human_action_bindings stored
  WHERE stored.exercise_id=p_exercise_id AND stored.checkpoint_id='CH-03' AND stored.step_id='generate-source-bound-document';
  parent_resource:='sha256:'||public.pr_c_controlled_human_sha256_jsonb(jsonb_build_object('resourceFamily','module_handoff','resourceId',requested.resource_id));
  IF p_step_id='review-studio-handoff' THEN
    IF anchor.target_id<>requested.resource_id THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_CAUSAL_CHAIN_REJECTED'; END IF;
    parent_binding:=requested.binding_token;
  ELSIF p_step_id='approve-studio-handoff' THEN
    IF reviewed.exercise_id IS NULL OR anchor.target_id<>requested.resource_id
      OR NOT EXISTS(SELECT 1 FROM public.pr_c_controlled_human_action_anchors prior WHERE prior.id=reviewed.anchor_id AND prior.target_id=requested.resource_id)
    THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_CAUSAL_CHAIN_REJECTED'; END IF;
    parent_binding:=reviewed.binding_token;
  ELSIF p_step_id='accept-studio-handoff' THEN
    IF reviewed.exercise_id IS NULL OR approved.exercise_id IS NULL OR anchor.target_id<>requested.resource_id
      OR NOT EXISTS(SELECT 1 FROM public.pr_c_controlled_human_action_anchors prior WHERE prior.id=approved.anchor_id AND prior.target_id=requested.resource_id)
    THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_CAUSAL_CHAIN_REJECTED'; END IF;
    parent_binding:=approved.binding_token;
  END IF;
  IF p_step_id IN ('review-studio-handoff','approve-studio-handoff') THEN
    SELECT 'sha256:'||public.pr_c_controlled_human_sha256_jsonb(jsonb_build_object(
      'moduleHandoffId',handoff.id,'upstreamAssessHandoffId',handoff.upstream_handoff_id,
      'upstreamPackageHash',handoff.upstream_package_hash,'targetInputBundleId',handoff.target_input_bundle_id,
      'targetInputBundleVersionId',handoff.target_input_bundle_version_id,'targetInputBundleVersion',handoff.target_input_bundle_version,
      'targetInputBundleHash',handoff.target_input_bundle_hash)) INTO lineage
    FROM public.enterprise_module_handoffs handoff WHERE handoff.id=requested.resource_id;
  ELSIF p_step_id='accept-studio-handoff' THEN
    IF p_bound_resource_id IS DISTINCT FROM (
      SELECT consumption.artifact_id FROM public.enterprise_module_handoff_consumptions consumption
      WHERE consumption.handoff_id=requested.resource_id AND consumption.artifact_id=p_bound_resource_id
        AND consumption.source_package_hash IS NOT NULL)
    THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_CAUSAL_CHAIN_REJECTED'; END IF;
    SELECT 'sha256:'||public.pr_c_controlled_human_sha256_jsonb(jsonb_build_object(
      'moduleHandoffId',handoff.id,'upstreamAssessHandoffId',handoff.upstream_handoff_id,
      'upstreamPackageHash',handoff.upstream_package_hash,'targetInputBundleId',handoff.target_input_bundle_id,
      'targetInputBundleVersionId',handoff.target_input_bundle_version_id,'targetInputBundleVersion',handoff.target_input_bundle_version,
      'targetInputBundleHash',handoff.target_input_bundle_hash,'artifactId',source.artifact_id,
      'sourcePackageId',source.id,'sourcePackageVersion',source.version,'sourcePackageHash',source.package_hash,
      'assessHandoffId',source.assess_handoff_id,'assessPackageHash',source.assess_package_hash,
      'studioBundleHash',source.studio_bundle_hash)) INTO lineage
    FROM public.enterprise_module_handoffs handoff
    JOIN public.enterprise_module_handoff_consumptions consumption ON consumption.handoff_id=handoff.id
    JOIN public.studio_artifact_source_packages source ON source.id=consumption.source_package_id
      AND source.artifact_id=consumption.artifact_id AND source.package_hash=consumption.source_package_hash
    WHERE handoff.id=requested.resource_id AND consumption.artifact_id=p_bound_resource_id;
  ELSIF p_step_id='generate-source-bound-document' THEN
    IF consumed.exercise_id IS NULL OR anchor.target_id<>consumed.resource_id THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_CAUSAL_CHAIN_REJECTED'; END IF;
    parent_binding:=consumed.binding_token;
    parent_resource:='sha256:'||public.pr_c_controlled_human_sha256_jsonb(jsonb_build_object('resourceFamily','studio_artifact','resourceId',consumed.resource_id));
    SELECT 'sha256:'||public.pr_c_controlled_human_sha256_jsonb(jsonb_build_object(
      'moduleHandoffId',handoff.id,'upstreamAssessHandoffId',handoff.upstream_handoff_id,
      'upstreamPackageHash',handoff.upstream_package_hash,'targetInputBundleId',handoff.target_input_bundle_id,
      'targetInputBundleVersionId',handoff.target_input_bundle_version_id,'targetInputBundleVersion',handoff.target_input_bundle_version,
      'targetInputBundleHash',handoff.target_input_bundle_hash,'artifactId',source.artifact_id,
      'sourcePackageId',source.id,'sourcePackageVersion',source.version,'sourcePackageHash',source.package_hash,
      'assessHandoffId',source.assess_handoff_id,'assessPackageHash',source.assess_package_hash,
      'studioBundleHash',source.studio_bundle_hash)) INTO lineage
    FROM public.enterprise_module_handoffs handoff
    JOIN public.enterprise_module_handoff_consumptions consumption ON consumption.handoff_id=handoff.id
    JOIN public.studio_artifact_source_packages source ON source.id=consumption.source_package_id
      AND source.artifact_id=consumption.artifact_id AND source.package_hash=consumption.source_package_hash
    WHERE handoff.id=requested.resource_id AND consumption.artifact_id=anchor.target_id
      AND source.id=(anchor.selector_bindings->>'sourcePackageId')::uuid
      AND source.version=(anchor.selector_bindings->>'sourcePackageVersion')::bigint
      AND source.package_hash=anchor.selector_bindings->>'sourcePackageHash';
  ELSIF p_step_id='approve-hybrid-studio-document' THEN
    IF consumed.exercise_id IS NULL OR generated.exercise_id IS NULL OR anchor.target_id<>consumed.resource_id
      OR (anchor.selector_bindings->>'artifactVersionId')::uuid<>generated.resource_id
      OR NOT EXISTS(SELECT 1 FROM public.studio_artifact_versions version
        WHERE version.id=generated.resource_id AND version.artifact_id=anchor.target_id)
    THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_CAUSAL_CHAIN_REJECTED'; END IF;
    parent_binding:=generated.binding_token;
    parent_resource:='sha256:'||public.pr_c_controlled_human_sha256_jsonb(jsonb_build_object('resourceFamily','studio_artifact_version','resourceId',generated.resource_id));
    SELECT generated.safe_record->>'causalLineageDigest' INTO lineage;
  END IF;
  IF parent_binding IS NULL OR parent_resource IS NULL OR lineage IS NULL THEN
    RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_CAUSAL_CHAIN_REJECTED';
  END IF;
  RETURN jsonb_build_object('causalParentBindingToken',parent_binding,'causalParentResourceDigest',parent_resource,'causalLineageDigest',lineage);
END $$;

CREATE OR REPLACE FUNCTION public.pr_c_controlled_human_complete_step(p_exercise_digest text,p_challenge_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE exercise public.pr_c_controlled_human_exercises; anchor public.pr_c_controlled_human_action_anchors; actor uuid:=auth.uid();
 spec public.pr_c_controlled_human_intent_catalog; audit_count integer; receipt_count integer; audit public.privileged_audit_events; receipt_source text; matched_receipt_id uuid; receipt_resource_id uuid; receipt_response jsonb; receipt_at timestamptz;
 ai_effect public.enterprise_ai_effect_journal; delivery_effect public.enterprise_delivery_monitor_effects; actual_intent jsonb; actual_intent_digest text; replay_attempt_count integer; replay_distinct_request_count integer;
 observed_version bigint; bound_family text; bound_resource_id uuid; resource_digest text; request_digest text; receipt_digest text; audit_digest text; denial_code_digest text; token text; safe jsonb; causal_proof jsonb;
BEGIN
  PERFORM public.pr_c_controlled_human_assert_marker();
  SELECT stored.* INTO exercise FROM public.pr_c_controlled_human_exercises stored WHERE stored.exercise_digest=p_exercise_digest AND stored.lifecycle='active' FOR SHARE;
  SELECT stored.* INTO anchor FROM public.pr_c_controlled_human_action_anchors stored WHERE stored.exercise_id=exercise.id AND stored.challenge_token=p_challenge_token AND stored.actor_id=actor;
  SELECT stored.* INTO spec FROM public.pr_c_controlled_human_intent_catalog stored WHERE stored.checkpoint_id=anchor.checkpoint_id AND stored.step_id=anchor.step_id;
  IF exercise.id IS NULL OR actor IS NULL OR anchor.id IS NULL OR anchor.observation_kind<>'server_event'
    OR EXISTS (SELECT 1 FROM public.pr_c_controlled_human_action_bindings binding WHERE binding.anchor_id=anchor.id)
  THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_COMPLETION_PREANCHOR_REQUIRED'; END IF;
  IF spec.step_id IS NULL OR spec.action<>anchor.action THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_COMPLETION_INTENT_REJECTED'; END IF;
  SELECT count(*)::int INTO audit_count FROM public.privileged_audit_events event WHERE event.org_id=exercise.org_id AND event.actor_id=actor AND event.request_id=anchor.request_id AND event.action=anchor.action AND event.outcome='succeeded';
  IF spec.effect_resolver='enterprise_ai_conflict' THEN
    IF audit_count<>0 THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_COMPLETION_AUDIT_REJECTED'; END IF;
  ELSE
    IF spec.transition_kind='replay_existing' THEN
      SELECT event.* INTO audit FROM public.privileged_audit_events event
      JOIN public.pr_c_controlled_human_action_bindings prior ON prior.audit_id=event.id
      WHERE prior.exercise_id=exercise.id AND prior.step_id=spec.replay_of_step_id;
      IF audit.id IS NULL THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_COMPLETION_AUDIT_REJECTED'; END IF;
    ELSE
      IF audit_count<>1 THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_COMPLETION_AUDIT_REJECTED'; END IF;
      SELECT event.* INTO audit FROM public.privileged_audit_events event WHERE event.org_id=exercise.org_id AND event.actor_id=actor AND event.request_id=anchor.request_id AND event.action=anchor.action AND event.outcome='succeeded';
    END IF;
  END IF;
  SELECT count(*)::int INTO receipt_count FROM (
    SELECT id,request_id,command_type action,status,resource_id,response,coalesce(completed_at,created_at) event_at FROM public.studio_artifact_command_receipts WHERE org_id=exercise.org_id AND actor_id=actor
    UNION ALL SELECT id,request_id,command_type,status,resource_id,response,coalesce(completed_at,created_at) FROM public.studio_tenant_template_command_receipts WHERE org_id=exercise.org_id AND actor_id=actor
    UNION ALL SELECT id,request_id,command_type,status,resource_id,response,coalesce(completed_at,created_at) FROM public.enterprise_module_handoff_command_receipts WHERE org_id=exercise.org_id AND actor_id=actor
    UNION ALL SELECT id,request_id,action,status,resource_id,response,coalesce(completed_at,created_at) FROM public.enterprise_delivery_monitor_command_receipts WHERE org_id=exercise.org_id AND actor_id=actor
    UNION ALL SELECT id,request_id,'pr_c.controlled_human.synthetic_studio_generate',status,artifact_id,response,coalesce(completed_at,created_at) FROM public.pr_c_controlled_human_synthetic_generation_receipts WHERE exercise_id=exercise.id AND actor_id=actor
    UNION ALL SELECT id,request_id,command_type,status,CASE WHEN coalesce(response->>'resourceId','')~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN (response->>'resourceId')::uuid END,response,coalesce(completed_at,created_at) FROM public.assess_command_receipts WHERE org_id=exercise.org_id AND actor_id=actor
    UNION ALL SELECT id,initial_request_id,command_type,status,resource_id,response,coalesce(completed_at,created_at) FROM public.enterprise_ai_command_receipts WHERE org_id=exercise.org_id AND actor_id=actor
  ) r WHERE (r.request_id=anchor.request_id OR (spec.transition_kind='replay_existing' AND EXISTS(
    SELECT 1 FROM public.enterprise_delivery_monitor_command_attempts attempt WHERE attempt.receipt_id=r.id AND attempt.request_id=anchor.request_id
  ))) AND r.action=anchor.action AND r.status IN ('succeeded','committed');
  IF receipt_count<>1 THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_COMPLETION_RECEIPT_REJECTED'; END IF;
  SELECT r.source,r.id,r.resource_id,r.response,r.event_at INTO receipt_source,matched_receipt_id,receipt_resource_id,receipt_response,receipt_at FROM (
    SELECT 'studio' source,id,request_id,command_type action,status,resource_id,response,coalesce(completed_at,created_at) event_at FROM public.studio_artifact_command_receipts WHERE org_id=exercise.org_id AND actor_id=actor
    UNION ALL SELECT 'tenant_template',id,request_id,command_type,status,resource_id,response,coalesce(completed_at,created_at) FROM public.studio_tenant_template_command_receipts WHERE org_id=exercise.org_id AND actor_id=actor
    UNION ALL SELECT 'module_handoff',id,request_id,command_type,status,resource_id,response,coalesce(completed_at,created_at) FROM public.enterprise_module_handoff_command_receipts WHERE org_id=exercise.org_id AND actor_id=actor
    UNION ALL SELECT 'delivery',id,request_id,action,status,resource_id,response,coalesce(completed_at,created_at) FROM public.enterprise_delivery_monitor_command_receipts WHERE org_id=exercise.org_id AND actor_id=actor
    UNION ALL SELECT 'synthetic_generation',id,request_id,'pr_c.controlled_human.synthetic_studio_generate',status,artifact_id,response,coalesce(completed_at,created_at) FROM public.pr_c_controlled_human_synthetic_generation_receipts WHERE exercise_id=exercise.id AND actor_id=actor
    UNION ALL SELECT 'assess',id,request_id,command_type,status,CASE WHEN coalesce(response->>'resourceId','')~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN (response->>'resourceId')::uuid END,response,coalesce(completed_at,created_at) FROM public.assess_command_receipts WHERE org_id=exercise.org_id AND actor_id=actor
    UNION ALL SELECT 'enterprise_ai',id,initial_request_id,command_type,status,resource_id,response,coalesce(completed_at,created_at) FROM public.enterprise_ai_command_receipts WHERE org_id=exercise.org_id AND actor_id=actor
  ) r WHERE (r.request_id=anchor.request_id OR (spec.transition_kind='replay_existing' AND r.source='delivery' AND EXISTS(
    SELECT 1 FROM public.enterprise_delivery_monitor_command_attempts attempt WHERE attempt.receipt_id=r.id AND attempt.request_id=anchor.request_id
  ))) AND r.action=anchor.action AND r.status IN ('succeeded','committed');
  observed_version:=audit.resource_version; bound_resource_id:=audit.resource_id;
  IF spec.effect_resolver='enterprise_ai_conflict' THEN
    SELECT effect.* INTO ai_effect FROM public.enterprise_ai_effect_journal effect
    WHERE effect.receipt_id=matched_receipt_id AND effect.operation_type=anchor.action AND effect.effect_key='command'
      AND effect.resource_id=anchor.target_id AND effect.terminal_status='committed';
    SELECT resolution.id,resolution.version INTO bound_resource_id,observed_version
    FROM public.enterprise_assess_evidence_conflict_resolutions resolution
    WHERE resolution.conflict_id=anchor.target_id AND resolution.version=anchor.expected_version+1
      AND resolution.resolver_id=actor AND resolution.authorization_version=anchor.actor_authorization_version
      AND resolution.resolution=anchor.selector_bindings->>'resolution'
      AND COALESCE(resolution.chosen_candidate_id::text,'')=COALESCE(NULLIF(anchor.selector_bindings->>'candidateId',''),'')
      AND 'sha256:'||public.pr_c_controlled_human_sha256_jsonb(COALESCE(resolution.authored_value,'null'::jsonb))=anchor.selector_bindings->>'authoredValueDigest'
      AND 'sha256:'||public.pr_c_controlled_human_sha256_jsonb(to_jsonb(resolution.rationale))=anchor.selector_bindings->>'rationaleDigest';
    IF ai_effect.id IS NULL OR ai_effect.safe_result IS DISTINCT FROM receipt_response OR bound_resource_id IS NULL THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_COMPLETION_INTENT_REJECTED'; END IF;
  ELSIF spec.effect_resolver='assess_review_resolution' THEN
    SELECT resolution.id INTO bound_resource_id
    FROM public.assess_v2_review_resolutions resolution
    WHERE resolution.case_id=anchor.target_id AND resolution.decision_id=(anchor.selector_bindings->>'decisionId')::uuid
      AND resolution.review_sequence=(anchor.selector_bindings->>'reviewSequence')::bigint AND resolution.request_id=anchor.request_id
      AND resolution.receipt_id=matched_receipt_id AND resolution.audit_event_id=audit.id AND resolution.reviewer_id=actor
      AND resolution.resolution=anchor.selector_bindings->>'resolution'
      AND 'sha256:'||public.pr_c_controlled_human_sha256_jsonb(to_jsonb(resolution.rationale))=anchor.selector_bindings->>'rationaleDigest'
      AND 'sha256:'||public.pr_c_controlled_human_sha256_jsonb(resolution.conditions)=anchor.selector_bindings->>'conditionsDigest';
    observed_version:=audit.resource_version;
    IF bound_resource_id IS NULL OR audit.resource_id<>anchor.target_id OR observed_version<>anchor.expected_version+1
      OR NOT EXISTS(SELECT 1 FROM public.assess_v2_cases assess_case WHERE assess_case.id=anchor.target_id AND assess_case.version=observed_version)
    THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_COMPLETION_INTENT_REJECTED'; END IF;
  ELSIF spec.effect_resolver IN('studio_artifact_review','studio_artifact_approval') THEN
    IF spec.effect_resolver='studio_artifact_review' THEN
      SELECT event.id INTO bound_resource_id FROM public.studio_artifact_review_resolutions event
      WHERE event.artifact_id=anchor.target_id AND event.artifact_version_id=(anchor.selector_bindings->>'artifactVersionId')::uuid
        AND event.receipt_id=matched_receipt_id AND event.audit_event_id=audit.id AND event.reviewer_id=actor
        AND event.outcome=CASE anchor.selector_bindings->>'outcome' WHEN 'approve' THEN 'approved' WHEN 'reject' THEN 'rejected' ELSE 'changes_requested' END
        AND 'sha256:'||public.pr_c_controlled_human_sha256_jsonb(to_jsonb(event.rationale))=anchor.selector_bindings->>'rationaleDigest'
        AND 'sha256:'||public.pr_c_controlled_human_sha256_jsonb(event.conditions)=anchor.selector_bindings->>'conditionsDigest';
    ELSE
      SELECT event.id INTO bound_resource_id FROM public.studio_artifact_approval_resolutions event
      WHERE event.artifact_id=anchor.target_id AND event.artifact_version_id=(anchor.selector_bindings->>'artifactVersionId')::uuid
        AND event.receipt_id=matched_receipt_id AND event.audit_event_id=audit.id AND event.approver_id=actor
        AND event.outcome=CASE anchor.selector_bindings->>'outcome' WHEN 'approve' THEN 'approved' ELSE 'rejected' END
        AND 'sha256:'||public.pr_c_controlled_human_sha256_jsonb(to_jsonb(event.rationale))=anchor.selector_bindings->>'rationaleDigest'
        AND 'sha256:'||public.pr_c_controlled_human_sha256_jsonb(event.conditions)=anchor.selector_bindings->>'conditionsDigest';
    END IF;
    observed_version:=audit.resource_version; IF bound_resource_id IS NULL OR audit.resource_id<>anchor.target_id OR observed_version<>anchor.expected_version+1 THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_COMPLETION_INTENT_REJECTED'; END IF;
  ELSIF spec.effect_resolver='module_handoff_request' THEN
    bound_resource_id:=receipt_resource_id; observed_version:=1;
    IF audit.resource_id<>bound_resource_id OR NOT EXISTS(SELECT 1 FROM public.enterprise_module_handoffs handoff
      WHERE handoff.id=bound_resource_id AND handoff.upstream_handoff_id=anchor.target_id AND handoff.requested_by=actor AND handoff.current_version=1
       AND handoff.artifact_type=anchor.selector_bindings->>'artifactType'
       AND COALESCE(handoff.target_input_bundle_id::text,'')=COALESCE(NULLIF(anchor.selector_bindings->>'targetInputBundleId',''),'')
       AND COALESCE(handoff.target_input_bundle_version_id::text,'')=COALESCE(NULLIF(anchor.selector_bindings->>'targetInputBundleVersionId',''),'')
       AND COALESCE(handoff.target_input_bundle_version::text,'')=COALESCE(NULLIF(anchor.selector_bindings->>'targetInputBundleVersion',''),''))
    THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_COMPLETION_INTENT_REJECTED'; END IF;
  ELSIF spec.effect_resolver IN('module_handoff_review','module_handoff_approval') THEN
    IF spec.effect_resolver='module_handoff_review' THEN
      SELECT event.id INTO bound_resource_id FROM public.enterprise_module_handoff_review_events event
      WHERE event.handoff_id=anchor.target_id AND event.reviewer_id=actor AND event.created_at>=anchor.created_at
       AND event.outcome=CASE anchor.selector_bindings->>'outcome' WHEN 'approve' THEN 'approved' WHEN 'reject' THEN 'rejected' ELSE 'changes_requested' END
       AND 'sha256:'||public.pr_c_controlled_human_sha256_jsonb(to_jsonb(event.rationale))=anchor.selector_bindings->>'rationaleDigest';
    ELSE
      SELECT event.id INTO bound_resource_id FROM public.enterprise_module_handoff_approval_events event
      WHERE event.handoff_id=anchor.target_id AND event.approver_id=actor AND event.created_at>=anchor.created_at
       AND event.outcome=CASE anchor.selector_bindings->>'outcome' WHEN 'approve' THEN 'approved' ELSE 'rejected' END
       AND 'sha256:'||public.pr_c_controlled_human_sha256_jsonb(to_jsonb(event.rationale))=anchor.selector_bindings->>'rationaleDigest';
    END IF;
    observed_version:=audit.resource_version;
    IF bound_resource_id IS NULL THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_COMPLETION_INTENT_REJECTED'; END IF;
    IF audit.resource_id<>anchor.target_id OR observed_version<>anchor.expected_version+1 THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_COMPLETION_INTENT_REJECTED'; END IF;
    IF anchor.selector_bindings->>'conditionsDigest'<>'sha256:'||public.pr_c_controlled_human_sha256_jsonb('[]'::jsonb) THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_COMPLETION_INTENT_REJECTED'; END IF;
  ELSIF spec.effect_resolver='module_handoff_consume' THEN
    bound_resource_id:=(receipt_response->>'resourceId')::uuid; observed_version:=0;
    IF audit.resource_id<>anchor.target_id OR receipt_resource_id<>bound_resource_id OR NOT EXISTS(SELECT 1 FROM public.enterprise_module_handoff_consumptions consumed
      JOIN public.studio_artifact_source_packages source ON source.id=consumed.source_package_id AND source.artifact_id=consumed.artifact_id
      WHERE consumed.handoff_id=anchor.target_id AND consumed.artifact_id=bound_resource_id AND consumed.consumed_by=actor
       AND source.package_hash=consumed.source_package_hash AND receipt_response->>'sourcePackageId'=source.id::text AND receipt_response->>'sourcePackageHash'=source.package_hash)
    THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_COMPLETION_INTENT_REJECTED'; END IF;
  ELSIF spec.effect_resolver='studio_source_package' THEN
    bound_resource_id:=(receipt_response->>'sourcePackageId')::uuid;
    SELECT package.version INTO observed_version FROM public.studio_artifact_source_packages package
    JOIN public.studio_artifact_aggregates artifact ON artifact.id=package.artifact_id
    WHERE package.id=bound_resource_id AND package.artifact_id=audit.resource_id AND package.source_mode=anchor.selector_bindings->>'sourceMode'
      AND artifact.artifact_type=anchor.selector_bindings->>'artifactType'
      AND COALESCE(package.studio_input_bundle_id::text,'')=COALESCE(NULLIF(anchor.selector_bindings->>'studioInputBundleId',''),'')
      AND COALESCE(package.studio_input_bundle_version_id::text,'')=COALESCE(NULLIF(anchor.selector_bindings->>'studioInputBundleVersionId',''),'')
      AND COALESCE(package.studio_input_bundle_version::text,'')=COALESCE(NULLIF(anchor.selector_bindings->>'studioInputBundleVersion',''),'')
      AND (package.source_mode<>'manual_brief' OR 'sha256:'||package.manual_brief_hash=anchor.selector_bindings->>'manualBriefDigest');
    IF bound_resource_id IS NULL OR observed_version IS DISTINCT FROM 1 OR receipt_resource_id<>audit.resource_id THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_COMPLETION_INTENT_REJECTED'; END IF;
  ELSIF spec.effect_resolver='synthetic_generation' THEN
    bound_resource_id:=(receipt_response#>>'{resource,versionId}')::uuid; observed_version:=audit.resource_version;
    IF audit.resource_id<>anchor.target_id OR NOT EXISTS(SELECT 1 FROM public.studio_artifact_versions version
      JOIN public.studio_artifact_source_packages source ON source.id=version.source_package_id AND source.artifact_id=version.artifact_id
      JOIN public.studio_artifact_aggregates generated_artifact ON generated_artifact.id=version.artifact_id
      WHERE version.id=bound_resource_id AND version.artifact_id=anchor.target_id AND version.source_package_id=(anchor.selector_bindings->>'sourcePackageId')::uuid
       AND source.version=(anchor.selector_bindings->>'sourcePackageVersion')::bigint AND source.package_hash=anchor.selector_bindings->>'sourcePackageHash'
       AND source.source_mode='assess_plus_transcript_bundle'
       AND source.studio_input_bundle_id IS NOT NULL AND source.studio_input_bundle_version_id IS NOT NULL
       AND version.parent_version_id IS NOT DISTINCT FROM (anchor.selector_bindings->>'expectedCurrentVersionId')::uuid
       AND generated_artifact.current_version_id=version.id
       AND generated_artifact.current_approved_version_id IS NOT DISTINCT FROM (anchor.selector_bindings->>'expectedApprovedVersionId')::uuid
       AND version.source_package_hash=source.package_hash AND version.template_kind=anchor.selector_bindings->>'templateKind'
       AND COALESCE(version.template_id,version.tenant_template_version_id)=(anchor.selector_bindings->>'templateVersionId')::uuid
       AND (version.template_kind='system' OR EXISTS(SELECT 1 FROM public.studio_tenant_template_versions template
          WHERE template.id=version.tenant_template_version_id AND template.template_id=(anchor.selector_bindings->>'templateId')::uuid))
       AND version.template_hash=anchor.selector_bindings->>'templateHash'
       AND EXISTS(SELECT 1 FROM public.enterprise_module_handoffs handoff
         JOIN public.enterprise_module_handoff_consumptions consumption ON consumption.handoff_id=handoff.id
           AND consumption.artifact_id=source.artifact_id AND consumption.source_package_id=source.id
           AND consumption.source_package_hash=source.package_hash
         JOIN public.assess_v2_studio_handoffs upstream ON upstream.id=handoff.upstream_handoff_id
           AND upstream.id=source.assess_handoff_id AND upstream.package_hash=source.assess_package_hash
         WHERE handoff.org_id=source.org_id AND handoff.workspace_id=source.workspace_id AND handoff.status='consumed'
           AND handoff.target_input_bundle_id=source.studio_input_bundle_id
           AND handoff.target_input_bundle_version_id=source.studio_input_bundle_version_id
           AND handoff.target_input_bundle_version=source.studio_input_bundle_version
           AND handoff.target_input_bundle_hash=source.studio_bundle_hash)
       AND ((version.template_kind='tenant' AND 'sha256:'||public.pr_c_controlled_human_sha256_jsonb(to_jsonb(version.template_version::bigint))=anchor.selector_bindings->>'templateVersionDigest')
         OR (version.template_kind='system' AND 'sha256:'||public.pr_c_controlled_human_sha256_jsonb(to_jsonb(version.template_version))=anchor.selector_bindings->>'templateVersionDigest')))
    THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_COMPLETION_INTENT_REJECTED'; END IF;
  ELSIF spec.effect_resolver IN('delivery_effect','delivery_replay','delivery_response_loss','delivery_complete_set') THEN
    SELECT effect.* INTO delivery_effect FROM public.enterprise_delivery_monitor_effects effect
    WHERE effect.receipt_id=matched_receipt_id AND effect.action=anchor.action AND effect.audit_id=audit.id AND effect.result=receipt_response;
    IF delivery_effect.id IS NULL THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_COMPLETION_INTENT_REJECTED'; END IF;
    bound_resource_id:=delivery_effect.resource_id; observed_version:=(delivery_effect.result->>'resourceVersion')::bigint;
    IF anchor.action='delivery.handoff.request' AND NOT EXISTS(SELECT 1 FROM public.enterprise_delivery_handoffs handoff WHERE handoff.id=bound_resource_id
      AND handoff.studio_artifact_id=anchor.target_id AND handoff.studio_artifact_version_id=(anchor.selector_bindings->>'studioArtifactVersionId')::uuid
      AND handoff.target_workspace_id=(anchor.selector_bindings->>'targetWorkspaceId')::uuid
      AND handoff.current_version=1
      AND handoff.studio_artifact_version_id=(anchor.selector_bindings->>'expectedCurrentVersionId')::uuid
      AND handoff.studio_artifact_version_id=(anchor.selector_bindings->>'expectedApprovedVersionId')::uuid)
    THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_COMPLETION_INTENT_REJECTED';
    ELSIF anchor.action='delivery.handoff.review.resolve' THEN
      SELECT event.id INTO bound_resource_id FROM public.enterprise_delivery_handoff_review_events event
      WHERE event.handoff_id=anchor.target_id AND event.handoff_version=anchor.expected_version AND event.reviewer_id=actor
        AND event.outcome=anchor.selector_bindings->>'outcome'
        AND 'sha256:'||public.pr_c_controlled_human_sha256_jsonb(to_jsonb(event.rationale))=anchor.selector_bindings->>'rationaleDigest';
      observed_version:=(delivery_effect.result->>'resourceVersion')::bigint;
      IF bound_resource_id IS NULL OR delivery_effect.resource_id<>anchor.target_id OR observed_version<>anchor.expected_version+1
        OR (anchor.selector_bindings->>'outcome'='approved' AND delivery_effect.result->>'status'<>'approval_ready')
        OR (anchor.selector_bindings->>'outcome'<>'approved' AND delivery_effect.result->>'status'<>anchor.selector_bindings->>'outcome')
      THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_COMPLETION_INTENT_REJECTED'; END IF;
    ELSIF anchor.action='delivery.handoff.approval.resolve' THEN
      SELECT event.id INTO bound_resource_id FROM public.enterprise_delivery_handoff_approval_events event
      WHERE event.handoff_id=anchor.target_id AND event.handoff_version=anchor.expected_version AND event.approved_by=actor
        AND event.outcome=anchor.selector_bindings->>'outcome'
        AND 'sha256:'||public.pr_c_controlled_human_sha256_jsonb(to_jsonb(event.rationale))=anchor.selector_bindings->>'rationaleDigest';
      observed_version:=(delivery_effect.result->>'resourceVersion')::bigint;
      IF bound_resource_id IS NULL OR delivery_effect.resource_id<>anchor.target_id OR observed_version<>anchor.expected_version+1
        OR delivery_effect.result->>'status'<>anchor.selector_bindings->>'outcome'
      THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_COMPLETION_INTENT_REJECTED'; END IF;
    ELSIF anchor.action='delivery.item.review' AND NOT EXISTS(SELECT 1 FROM public.enterprise_delivery_work_item_versions version
      WHERE version.item_aggregate_id=anchor.target_id AND version.id=(delivery_effect.result->>'itemVersionId')::uuid
       AND version.parent_version_id=(anchor.selector_bindings->>'expectedItemVersionId')::uuid AND version.status=anchor.selector_bindings->>'outcome'
       AND 'sha256:'||public.pr_c_controlled_human_sha256_jsonb(to_jsonb(version.rationale))=anchor.selector_bindings->>'rationaleDigest'
       AND (anchor.selector_bindings->>'outcome'<>'edited' OR 'sha256:'||public.pr_c_controlled_human_sha256_jsonb(jsonb_build_object('itemType',version.item_type,'title',version.title,'description',version.description,'acceptanceCriteria',version.acceptance_criteria,'nonFunctionalRequirements',version.non_functional_requirements))=anchor.selector_bindings->>'authoredItemDigest'))
    THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_COMPLETION_INTENT_REJECTED';
    ELSIF anchor.action='delivery.item.review' THEN
      bound_resource_id:=(delivery_effect.result->>'itemVersionId')::uuid;
      IF spec.effect_resolver='delivery_complete_set' THEN
        SELECT jsonb_agg(jsonb_build_object('itemAggregateId',aggregate.id,
          'expectedAggregateVersion',CASE WHEN aggregate.id=anchor.target_id THEN aggregate.aggregate_version-1 ELSE aggregate.aggregate_version END,
          'expectedItemVersionId',CASE WHEN aggregate.id=anchor.target_id THEN version.parent_version_id ELSE aggregate.current_version_id END)
          ORDER BY aggregate.id) INTO actual_intent
        FROM public.enterprise_delivery_work_item_aggregates aggregate
        JOIN public.enterprise_delivery_work_item_versions version ON version.id=aggregate.current_version_id
        WHERE aggregate.work_package_id=(delivery_effect.result->>'workPackageId')::uuid
          AND aggregate.org_id=exercise.org_id AND aggregate.workspace_id=exercise.workspace_id;
        IF jsonb_array_length(COALESCE(actual_intent,'[]'::jsonb))<>(anchor.selector_bindings->>'completeItemCount')::integer
          OR 'sha256:'||public.pr_c_controlled_human_sha256_jsonb(actual_intent)<>anchor.selector_bindings->>'completeItemSetDigest'
          OR EXISTS(SELECT 1 FROM public.enterprise_delivery_work_item_aggregates aggregate
            JOIN public.enterprise_delivery_work_item_versions version ON version.id=aggregate.current_version_id
            WHERE aggregate.work_package_id=(delivery_effect.result->>'workPackageId')::uuid
              AND aggregate.org_id=exercise.org_id AND aggregate.workspace_id=exercise.workspace_id
              AND version.status NOT IN('accepted','rejected'))
        THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_COMPLETION_INTENT_REJECTED'; END IF;
      END IF;
    ELSIF anchor.action='delivery.package.revision.commit' AND NOT EXISTS(SELECT 1 FROM public.enterprise_delivery_work_package_versions version
      WHERE version.work_package_id=anchor.target_id AND version.id=(delivery_effect.result->>'packageVersionId')::uuid AND version.version=(anchor.selector_bindings->>'expectedPackageVersion')::bigint+1)
    THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_COMPLETION_INTENT_REJECTED';
    ELSIF anchor.action='delivery.package.revision.commit' THEN
      SELECT jsonb_agg(jsonb_build_object(
        'itemAggregateId',aggregate.id,'expectedAggregateVersion',aggregate.aggregate_version-1,
        'expectedItemVersionId',version.parent_version_id) ORDER BY aggregate.id)
      INTO actual_intent
      FROM public.enterprise_delivery_work_item_aggregates aggregate
      JOIN public.enterprise_delivery_work_item_versions version ON version.id=aggregate.current_version_id
      WHERE aggregate.work_package_id=anchor.target_id AND aggregate.org_id=exercise.org_id
        AND aggregate.workspace_id=exercise.workspace_id AND version.package_version_id=(delivery_effect.result->>'packageVersionId')::uuid;
      IF jsonb_array_length(COALESCE(actual_intent,'[]'::jsonb))<>(anchor.selector_bindings->>'expectedItemCount')::integer
        OR 'sha256:'||public.pr_c_controlled_human_sha256_jsonb(actual_intent)<>anchor.selector_bindings->>'expectedItemsDigest'
      THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_COMPLETION_INTENT_REJECTED'; END IF;
      SELECT jsonb_agg(jsonb_build_object(
        'itemAggregateId',aggregate.id,'expectedAggregateVersion',aggregate.aggregate_version-1,
        'expectedItemVersionId',version.parent_version_id,'rationale',version.rationale,
        'item',jsonb_build_object('itemType',version.item_type,'title',version.title,'description',version.description,
          'acceptanceCriteria',version.acceptance_criteria,'nonFunctionalRequirements',version.non_functional_requirements)
        ) ORDER BY aggregate.id)
      INTO actual_intent
      FROM public.enterprise_delivery_work_item_aggregates aggregate
      JOIN public.enterprise_delivery_work_item_versions version ON version.id=aggregate.current_version_id
      WHERE aggregate.work_package_id=anchor.target_id AND aggregate.org_id=exercise.org_id
        AND aggregate.workspace_id=exercise.workspace_id AND version.package_version_id=(delivery_effect.result->>'packageVersionId')::uuid
        AND version.status='edited';
      IF jsonb_array_length(COALESCE(actual_intent,'[]'::jsonb))<>(anchor.selector_bindings->>'revisionCount')::integer
        OR 'sha256:'||public.pr_c_controlled_human_sha256_jsonb(actual_intent)<>anchor.selector_bindings->>'itemRevisionsDigest'
        OR jsonb_array_length(COALESCE(delivery_effect.result->'items','[]'::jsonb))<>(anchor.selector_bindings->>'expectedItemCount')::integer
      THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_COMPLETION_INTENT_REJECTED'; END IF;
      SELECT package.aggregate_version INTO observed_version
      FROM public.enterprise_delivery_work_packages package
      WHERE package.id=anchor.target_id AND package.org_id=exercise.org_id AND package.workspace_id=exercise.workspace_id
        AND delivery_effect.resource_id=package.id
        AND package.current_version=(anchor.selector_bindings->>'expectedPackageVersion')::bigint+1
        AND package.current_version_id=(delivery_effect.result->>'packageVersionId')::uuid;
      IF observed_version IS NULL THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_COMPLETION_INTENT_REJECTED'; END IF;
    ELSIF anchor.action='delivery.package.review.resolve' THEN
      SELECT event.id INTO bound_resource_id FROM public.enterprise_delivery_package_review_events event
      WHERE event.id=delivery_effect.resource_id AND event.work_package_id=anchor.target_id
        AND event.package_version_id=(anchor.selector_bindings->>'expectedPackageVersionId')::uuid
        AND event.package_version=(anchor.selector_bindings->>'expectedPackageVersion')::bigint
        AND event.package_aggregate_version=(anchor.selector_bindings->>'expectedPackageAggregateVersion')::bigint
        AND event.reviewer_id=actor AND event.outcome=anchor.selector_bindings->>'outcome'
        AND 'sha256:'||public.pr_c_controlled_human_sha256_jsonb(to_jsonb(event.rationale))=anchor.selector_bindings->>'rationaleDigest'
        AND event.accepted_set_hash=delivery_effect.result->>'acceptedSetHash'
        AND event.accepted_item_count=(delivery_effect.result->>'acceptedItemCount')::integer;
      IF bound_resource_id IS NULL OR (delivery_effect.result->>'resourceVersion')::bigint<>(anchor.selector_bindings->>'expectedPackageVersion')::bigint
      THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_COMPLETION_INTENT_REJECTED'; END IF;
      observed_version:=1;
    ELSIF anchor.action='delivery.package.approval.resolve' THEN
      SELECT event.id INTO bound_resource_id FROM public.enterprise_delivery_package_approval_events event
      WHERE event.id=delivery_effect.resource_id AND event.work_package_id=anchor.target_id
        AND event.package_version_id=(anchor.selector_bindings->>'expectedPackageVersionId')::uuid
        AND event.package_version=(anchor.selector_bindings->>'expectedPackageVersion')::bigint
        AND event.package_aggregate_version=(anchor.selector_bindings->>'expectedPackageAggregateVersion')::bigint
        AND event.approved_by=actor AND event.outcome=anchor.selector_bindings->>'outcome'
        AND 'sha256:'||public.pr_c_controlled_human_sha256_jsonb(to_jsonb(event.rationale))=anchor.selector_bindings->>'rationaleDigest'
        AND event.accepted_set_hash=delivery_effect.result->>'acceptedSetHash'
        AND event.accepted_item_count=(delivery_effect.result->>'acceptedItemCount')::integer;
      IF bound_resource_id IS NULL OR (delivery_effect.result->>'resourceVersion')::bigint<>(anchor.selector_bindings->>'expectedPackageVersion')::bigint
      THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_COMPLETION_INTENT_REJECTED'; END IF;
      observed_version:=1;
    ELSIF anchor.action='monitor.baseline.create' AND NOT EXISTS(SELECT 1 FROM public.enterprise_monitor_baselines baseline
      WHERE baseline.id=bound_resource_id AND baseline.work_package_id=anchor.target_id AND baseline.work_package_version_id=(anchor.selector_bindings->>'expectedPackageVersionId')::uuid
       AND baseline.package_version=(anchor.selector_bindings->>'expectedPackageVersion')::bigint AND baseline.package_approval_id=(delivery_effect.result->>'packageApprovalId')::uuid
       AND baseline.accepted_set_hash=delivery_effect.result->>'acceptedSetHash')
    THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_COMPLETION_INTENT_REJECTED';
    ELSIF anchor.action='delivery.handoff.consume' THEN
      IF NOT EXISTS(SELECT 1 FROM public.enterprise_delivery_handoff_consumptions consumed
        JOIN public.enterprise_delivery_source_packages source ON source.id=consumed.source_package_id AND source.work_package_id=consumed.work_package_id
        JOIN public.enterprise_delivery_work_packages package ON package.id=consumed.work_package_id AND package.source_package_id=source.id
        JOIN public.enterprise_delivery_handoffs handoff ON handoff.id=consumed.handoff_id
        WHERE consumed.handoff_id=anchor.target_id AND consumed.work_package_id=bound_resource_id AND consumed.consumed_by=actor
          AND handoff.current_version=anchor.expected_version+1 AND handoff.status='consumed'
          AND source.delivery_handoff_id=anchor.target_id AND source.package_hash=package.source_package_hash
          AND delivery_effect.result->>'sourcePackageId'=source.id::text
          AND delivery_effect.result->>'packageVersionId'=package.current_version_id::text)
      THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_COMPLETION_INTENT_REJECTED'; END IF;
    ELSIF anchor.action='delivery.package.create.manual' THEN
      SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'clientKey',entry.value->>'clientKey','itemType',version.item_type,'title',version.title,'description',version.description,
        'acceptanceCriteria',version.acceptance_criteria,'nonFunctionalRequirements',version.non_functional_requirements,
        'parentClientKey',parent_entry.value->>'clientKey')) ORDER BY entry.value->>'clientKey') INTO actual_intent
      FROM jsonb_array_elements(delivery_effect.result->'items') entry(value)
      JOIN public.enterprise_delivery_work_item_aggregates aggregate ON aggregate.id=(entry.value->>'aggregateId')::uuid
      JOIN public.enterprise_delivery_work_item_versions version ON version.id=(entry.value->>'versionId')::uuid AND version.item_aggregate_id=aggregate.id
      LEFT JOIN LATERAL (SELECT parent.value FROM jsonb_array_elements(delivery_effect.result->'items') parent(value)
        WHERE (parent.value->>'aggregateId')::uuid=aggregate.parent_aggregate_id) parent_entry ON true;
      IF observed_version<>1 OR jsonb_array_length(COALESCE(actual_intent,'[]'::jsonb))<>(anchor.selector_bindings->>'itemCount')::integer
        OR 'sha256:'||public.pr_c_controlled_human_sha256_jsonb(actual_intent)<>anchor.selector_bindings->>'orderedItemsDigest'
        OR NOT EXISTS(SELECT 1 FROM public.enterprise_delivery_work_packages package
          JOIN public.enterprise_delivery_source_packages source ON source.id=package.source_package_id
          WHERE package.id=bound_resource_id AND package.current_version=1
            AND source.work_package_id=package.id AND source.source_mode='manual'
            AND 'sha256:'||source.manual_brief_hash=anchor.selector_bindings->>'manualBriefDigest')
      THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_COMPLETION_INTENT_REJECTED'; END IF;
    END IF;
    IF spec.transition_kind='replay_existing' THEN
      SELECT count(*),count(DISTINCT attempt.request_id) INTO replay_attempt_count,replay_distinct_request_count
      FROM public.enterprise_delivery_monitor_command_attempts attempt
      WHERE attempt.receipt_id=matched_receipt_id AND attempt.binding_hash=delivery_effect.binding_hash;
      IF replay_attempt_count<>2 OR replay_distinct_request_count<>2
        OR (SELECT count(*) FROM public.enterprise_delivery_monitor_command_attempts attempt
            WHERE attempt.receipt_id=matched_receipt_id AND attempt.request_id=anchor.request_id AND attempt.binding_hash=delivery_effect.binding_hash)<>1
        OR (SELECT count(*) FROM public.enterprise_delivery_monitor_effects effect WHERE effect.receipt_id=matched_receipt_id)<>1
      THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_COMPLETION_REPLAY_REJECTED'; END IF;
    END IF;
    IF spec.effect_resolver='delivery_response_loss' THEN
      SELECT count(DISTINCT attempt.request_id) INTO replay_attempt_count
      FROM public.enterprise_delivery_monitor_command_attempts attempt
      WHERE attempt.receipt_id=matched_receipt_id AND attempt.binding_hash=delivery_effect.binding_hash;
      IF replay_attempt_count<>2 OR (SELECT count(*) FROM public.enterprise_delivery_monitor_effects effect WHERE effect.receipt_id=matched_receipt_id)<>1
      THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_COMPLETION_INTENT_REJECTED'; END IF;
    END IF;
  ELSE RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_COMPLETION_INTENT_REJECTED';
  END IF;
  IF observed_version IS NULL OR bound_resource_id IS NULL THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_COMPLETION_TARGET_REJECTED'; END IF;
  IF anchor.transition_kind IN ('create_one','create_zero') THEN
    SELECT ownership.resource_family INTO bound_family FROM public.pr_c_controlled_human_resource_ownership ownership
    WHERE ownership.exercise_id=exercise.id AND ownership.resource_family=anchor.created_family
      AND ownership.resource_id=bound_resource_id AND ownership.created_at>=anchor.created_at;
    IF bound_family IS NULL OR observed_version<>(CASE WHEN anchor.transition_kind='create_zero' THEN 0 ELSE 1 END) THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_COMPLETION_TRANSITION_REJECTED'; END IF;
  ELSIF anchor.transition_kind='replay_existing' THEN
    SELECT prior.resource_family INTO bound_family FROM public.pr_c_controlled_human_action_bindings prior
    WHERE prior.exercise_id=exercise.id AND prior.step_id=spec.replay_of_step_id
      AND prior.resource_id=bound_resource_id
      AND prior.observed_version=(delivery_effect.result->>'resourceVersion')::bigint;
    IF bound_family IS NULL THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_COMPLETION_TRANSITION_REJECTED'; END IF;
  ELSIF anchor.transition_kind='increment_one' THEN
    SELECT ownership.resource_family INTO bound_family FROM public.pr_c_controlled_human_resource_ownership ownership
    WHERE ownership.exercise_id=exercise.id AND ownership.resource_family=spec.effect_family
      AND ownership.resource_id=bound_resource_id
      AND (spec.effect_family=anchor.target_family OR ownership.created_at>=anchor.created_at);
    IF bound_family IS NULL OR observed_version<>anchor.expected_version+1 THEN
      RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_COMPLETION_TRANSITION_REJECTED';
    END IF;
  ELSE
    IF audit.resource_id<>anchor.target_id OR observed_version<>anchor.expected_version THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_COMPLETION_TRANSITION_REJECTED'; END IF;
    bound_family:=anchor.target_family;
  END IF;
  resource_digest:='sha256:'||public.pr_c_controlled_human_sha256_jsonb(jsonb_build_object('resourceFamily',bound_family,'resourceId',bound_resource_id));
  IF anchor.checkpoint_id='CH-03' THEN
    causal_proof:=public.pr_c_controlled_human_step_causal_proof(exercise.id,anchor.step_id,bound_resource_id);
  ELSE
    causal_proof:=jsonb_build_object(
      'causalParentBindingToken','sha256:'||public.pr_c_controlled_human_sha256_jsonb(jsonb_build_object('proof','not_applicable')),
      'causalParentResourceDigest','sha256:'||public.pr_c_controlled_human_sha256_jsonb(jsonb_build_object('proof','not_applicable')),
      'causalLineageDigest','sha256:'||public.pr_c_controlled_human_sha256_jsonb(jsonb_build_object('proof','not_applicable')));
  END IF;
  request_digest:='sha256:'||public.pr_c_controlled_human_sha256_jsonb(jsonb_build_object('requestId',anchor.request_id));receipt_digest:='sha256:'||public.pr_c_controlled_human_sha256_jsonb(jsonb_build_object('source',receipt_source,'receiptId',matched_receipt_id));audit_digest:='sha256:'||public.pr_c_controlled_human_sha256_jsonb(jsonb_build_object('auditId',audit.id));
  denial_code_digest:='sha256:'||public.pr_c_controlled_human_sha256_jsonb(jsonb_build_object('denialCode','not_applicable'));
  token:='sha256:'||public.pr_c_controlled_human_sha256_jsonb(jsonb_build_object('anchorToken',anchor.challenge_token,'intentDigest',anchor.intent_digest,'action',anchor.action,'resourceFamily',bound_family,'resourceId',bound_resource_id,'expectedVersion',anchor.expected_version,'observedVersion',observed_version,'requestId',anchor.request_id,'receiptId',matched_receipt_id,'auditId',audit.id,'denialCodeDigest',denial_code_digest));
  safe:=jsonb_build_object('contractVersion','pr-c-controlled-human-step-binding-3','stepId',anchor.step_id,'action',anchor.action,'result','succeeded','resourceFamily',bound_family,'resourceDigest',resource_digest,'expectedVersion',anchor.expected_version,'observedVersion',observed_version,'requestDigest',request_digest,'receiptDigest',receipt_digest,'auditDigest',audit_digest,'intentDigest',anchor.intent_digest,'denialCodeDigest',denial_code_digest,'bindingToken',token,'anchorToken',anchor.challenge_token,
    'causalParentBindingToken',causal_proof->>'causalParentBindingToken','causalParentResourceDigest',causal_proof->>'causalParentResourceDigest','causalLineageDigest',causal_proof->>'causalLineageDigest',
    'issuedAt',to_char(statement_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
  INSERT INTO public.pr_c_controlled_human_action_bindings(exercise_id,checkpoint_id,step_id,persona_key,actor_id,observation_kind,action,result,denial_proof_kind,resource_family,resource_id,expected_version,observed_version,request_id,receipt_source,receipt_id,audit_id,intent_digest,denial_code_digest,binding_token,safe_record,anchor_id)
  VALUES(exercise.id,anchor.checkpoint_id,anchor.step_id,anchor.persona_key,actor,'server_event',anchor.action,'succeeded','not_applicable',bound_family,bound_resource_id,anchor.expected_version,observed_version,anchor.request_id,receipt_source,matched_receipt_id,audit.id,anchor.intent_digest,denial_code_digest,token,safe,anchor.id);
  RETURN safe;
END $$;

CREATE OR REPLACE FUNCTION public.pr_c_controlled_human_execute_denied_step(p_exercise_digest text,p_challenge_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE exercise public.pr_c_controlled_human_exercises; anchor public.pr_c_controlled_human_action_anchors; persona public.pr_c_controlled_human_persona_bindings;
 spec public.pr_c_controlled_human_intent_catalog;
 actor uuid:=auth.uid(); command jsonb; result jsonb; denial text; authorization_version bigint; denial_code_digest text;
 resource_digest text; request_digest text; sentinel text; token text; safe jsonb;
BEGIN
  PERFORM public.pr_c_controlled_human_assert_marker();
  SELECT stored.* INTO exercise FROM public.pr_c_controlled_human_exercises stored WHERE stored.exercise_digest=p_exercise_digest AND stored.lifecycle='active' FOR SHARE;
  SELECT stored.* INTO anchor FROM public.pr_c_controlled_human_action_anchors stored WHERE stored.exercise_id=exercise.id AND stored.challenge_token=p_challenge_token AND stored.actor_id=actor;
  SELECT stored.* INTO persona FROM public.pr_c_controlled_human_persona_bindings stored WHERE stored.exercise_id=exercise.id AND stored.persona_key=anchor.persona_key AND stored.auth_user_id=actor;
  SELECT stored.* INTO spec FROM public.pr_c_controlled_human_intent_catalog stored WHERE stored.checkpoint_id=anchor.checkpoint_id AND stored.step_id=anchor.step_id;
  IF exercise.id IS NULL OR anchor.id IS NULL OR persona.exercise_id IS NULL OR anchor.observation_kind<>'negative_attempt'
    OR spec.step_id IS NULL OR spec.observation_kind<>'negative_attempt' OR spec.action<>anchor.action
    OR EXISTS (SELECT 1 FROM public.pr_c_controlled_human_action_bindings binding WHERE binding.anchor_id=anchor.id)
  THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_DENIED_PREANCHOR_REQUIRED'; END IF;
  SELECT authority.version INTO authorization_version FROM public.authorization_versions authority
  WHERE authority.org_id=persona.org_id AND authority.user_id=actor;
  IF authorization_version IS NULL THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_DENIED_ATTEMPT_REJECTED'; END IF;
  IF anchor.step_id='reject-stale-authorization' THEN
    IF persona.expected_state<>'active' OR authorization_version<>anchor.actor_authorization_version THEN
      RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_STALE_PRECONDITION_REJECTED';
    END IF;
    UPDATE public.authorization_versions SET version=version+1,updated_at=statement_timestamp()
    WHERE org_id=persona.org_id AND user_id=actor AND version=anchor.actor_authorization_version;
    IF NOT FOUND THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_STALE_PRECONDITION_REJECTED'; END IF;
    authorization_version:=anchor.actor_authorization_version;
  END IF;
  IF (spec.expected_outcome='revoked_actor' AND persona.expected_state<>'revoked')
    OR (spec.expected_outcome='same_org_other_workspace' AND (persona.expected_state<>'active' OR persona.org_id<>exercise.org_id OR persona.workspace_id=exercise.workspace_id))
    OR (spec.expected_outcome='cross_org' AND (persona.expected_state<>'active' OR persona.org_id=exercise.org_id))
    OR (spec.expected_outcome IN('stale_authorization','stale_source') AND (persona.expected_state<>'active' OR persona.org_id<>exercise.org_id OR persona.workspace_id<>exercise.workspace_id))
  THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_DENIED_PRECONDITION_REJECTED'; END IF;
  IF (anchor.action='delivery.package.create.manual' AND (anchor.target_family<>'workspace' OR anchor.target_id<>exercise.workspace_id))
    OR (anchor.action='delivery.package.revision.commit' AND (anchor.target_family<>'delivery_work_package' OR anchor.selector_bindings->>'workPackageId'<>anchor.target_id::text))
    OR (anchor.action='delivery.handoff.request' AND (anchor.target_family<>'studio_artifact' OR anchor.selector_bindings->>'studioArtifactId'<>anchor.target_id::text))
    OR (anchor.action='delivery.workspace.projection' AND (anchor.target_family<>'workspace' OR anchor.target_id<>exercise.workspace_id))
  THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_DENIED_ATTEMPT_TARGET_REJECTED'; END IF;
  IF anchor.action='delivery.workspace.projection' THEN
    result:=public.enterprise_delivery_workspace_projection(exercise.org_id,exercise.workspace_id,jsonb_build_object('actorId',actor,'authorizationVersion',authorization_version));
    IF result IS NULL THEN denial:='ENTERPRISE_DELIVERY_PERMISSION_DENIED';
    ELSE RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_NEGATIVE_UNEXPECTED_SUCCESS'; END IF;
  ELSE
    BEGIN
      command:=jsonb_build_object('action',anchor.action,'actorId',actor,'organizationId',exercise.org_id,'workspaceId',exercise.workspace_id,
        'authorizationVersion',authorization_version,
        'requestId',anchor.request_id,'receiptId',gen_random_uuid(),'executionToken',gen_random_uuid(),'executionFence',1,'idempotencyKey','pr264-denied-'||replace(anchor.id::text,'-',''));
      IF anchor.action='delivery.package.create.manual' THEN
        IF anchor.selector_bindings->>'manualBriefDigest'<>'sha256:'||encode(public.digest(convert_to('Synthetic controlled-human denial probe','UTF8'),'sha256'),'hex')
          OR anchor.selector_bindings->>'orderedItemsDigest'<>'sha256:'||public.pr_c_controlled_human_sha256_jsonb(jsonb_build_array(jsonb_build_object(
            'clientKey','item-0001','itemType','Task','title','Synthetic denial probe','description','Synthetic non-production authorization denial probe.',
            'acceptanceCriteria',jsonb_build_array('The real production authority rejects this request.'),'nonFunctionalRequirements',jsonb_build_array('No side effect is committed.'))))
          OR (anchor.selector_bindings->>'itemCount')::integer<>1
        THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_DENIED_ATTEMPT_TARGET_REJECTED'; END IF;
        command:=command||jsonb_build_object('manualBrief','Synthetic controlled-human denial probe',
        'items',jsonb_build_array(jsonb_build_object('clientKey','item-0001','itemType','Task','title','Synthetic denial probe','description','Synthetic non-production authorization denial probe.',
          'acceptanceCriteria',jsonb_build_array('The real production authority rejects this request.'),'nonFunctionalRequirements',jsonb_build_array('No side effect is committed.'))));
      ELSIF anchor.action='delivery.package.revision.commit' THEN
        command:=command||jsonb_build_object('workPackageId',anchor.target_id,'expectedPackageVersion',(anchor.selector_bindings->>'expectedPackageVersion')::bigint,
          'expectedPackageVersionId',(anchor.selector_bindings->>'expectedPackageVersionId')::uuid,
          'expectedPackageAggregateVersion',(anchor.selector_bindings->>'expectedPackageAggregateVersion')::bigint,
          'expectedItems','[]'::jsonb,'itemRevisions','[]'::jsonb);
      ELSIF anchor.action='delivery.handoff.request' THEN
        -- Make the exact anchored source stale only inside this exception
        -- subtransaction.  Catching the expected production denial rolls the
        -- precondition mutation back; unexpected success is also rolled back.
        UPDATE public.enterprise_module_input_bundles bundle
        SET current_version=bundle.current_version+1,updated_at=statement_timestamp()
        FROM public.studio_artifact_aggregates artifact
        JOIN public.studio_artifact_source_packages source
          ON source.id=artifact.source_package_id AND source.artifact_id=artifact.id
        WHERE artifact.id=anchor.target_id AND artifact.org_id=exercise.org_id AND artifact.workspace_id=exercise.workspace_id
          AND source.source_mode IN('direct_transcript_bundle','assess_plus_transcript_bundle')
          AND bundle.id=source.studio_input_bundle_id AND bundle.org_id=exercise.org_id AND bundle.workspace_id=exercise.workspace_id
          AND bundle.current_version=source.studio_input_bundle_version;
        IF NOT FOUND THEN
          INSERT INTO public.assess_v2_case_versions(
            id,case_id,org_id,workspace_id,version,name,description,agent_necessity,source_kind,source_snapshot,created_by
          )
          SELECT gen_random_uuid(),current_version.case_id,current_version.org_id,current_version.workspace_id,
            current_version.version+1,current_version.name,current_version.description,current_version.agent_necessity,
            'draft_upsert',current_version.source_snapshot,actor
          FROM public.studio_artifact_aggregates artifact
          JOIN public.studio_artifact_source_packages source
            ON source.id=artifact.source_package_id AND source.artifact_id=artifact.id
          JOIN public.assess_v2_studio_handoffs upstream ON upstream.id=source.assess_handoff_id
          JOIN public.assess_v2_case_versions current_version ON current_version.id=upstream.source_version_id
          WHERE artifact.id=anchor.target_id AND artifact.org_id=exercise.org_id AND artifact.workspace_id=exercise.workspace_id
            AND source.source_mode IN('assess_handoff','assess_plus_transcript_bundle')
            AND NOT EXISTS(SELECT 1 FROM public.assess_v2_case_versions existing
              WHERE existing.case_id=current_version.case_id AND existing.version=current_version.version+1);
          UPDATE public.assess_v2_cases assess_case
          SET head_version_id=alternate.id,version=alternate.version,updated_at=statement_timestamp()
          FROM public.studio_artifact_aggregates artifact
          JOIN public.studio_artifact_source_packages source
            ON source.id=artifact.source_package_id AND source.artifact_id=artifact.id
          JOIN public.assess_v2_studio_handoffs upstream ON upstream.id=source.assess_handoff_id
          JOIN public.assess_v2_case_versions alternate
            ON alternate.case_id=upstream.case_id AND alternate.org_id=upstream.org_id AND alternate.workspace_id=upstream.workspace_id
           AND alternate.id<>upstream.source_version_id
          WHERE artifact.id=anchor.target_id AND artifact.org_id=exercise.org_id AND artifact.workspace_id=exercise.workspace_id
            AND source.source_mode IN('assess_handoff','assess_plus_transcript_bundle')
            AND assess_case.id=upstream.case_id AND assess_case.org_id=exercise.org_id AND assess_case.workspace_id=exercise.workspace_id
            AND alternate.id=(SELECT candidate.id FROM public.assess_v2_case_versions candidate
              WHERE candidate.case_id=upstream.case_id AND candidate.org_id=upstream.org_id AND candidate.workspace_id=upstream.workspace_id
                AND candidate.id<>upstream.source_version_id ORDER BY candidate.version DESC,candidate.id LIMIT 1);
        END IF;
        IF NOT FOUND THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_STALE_PRECONDITION_REJECTED'; END IF;
        command:=command||jsonb_build_object('targetWorkspaceId',(anchor.selector_bindings->>'targetWorkspaceId')::uuid,
          'studioArtifactId',anchor.target_id,'studioArtifactVersionId',(anchor.selector_bindings->>'studioArtifactVersionId')::uuid,
          'expectedAggregateVersion',(anchor.selector_bindings->>'expectedAggregateVersion')::bigint,
          'expectedCurrentVersionId',(anchor.selector_bindings->>'expectedCurrentVersionId')::uuid,
          'expectedApprovedVersionId',(anchor.selector_bindings->>'expectedApprovedVersionId')::uuid);
      END IF;
      result:=public.enterprise_delivery_monitor_command(command);
      RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_NEGATIVE_UNEXPECTED_SUCCESS';
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM='PR_C_CONTROLLED_HUMAN_NEGATIVE_UNEXPECTED_SUCCESS' THEN RAISE; END IF;
      denial:=SQLERRM;
    END;
  END IF;
  IF denial IS DISTINCT FROM spec.expected_denial_code THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_NEGATIVE_DENIAL_REJECTED'; END IF;
  denial_code_digest:='sha256:'||public.pr_c_controlled_human_sha256_jsonb(jsonb_build_object('denialCode',denial));
  resource_digest:='sha256:'||public.pr_c_controlled_human_sha256_jsonb(jsonb_build_object('resourceFamily',anchor.target_family,'resourceId',anchor.target_id));request_digest:='sha256:'||public.pr_c_controlled_human_sha256_jsonb(jsonb_build_object('requestId',anchor.request_id));sentinel:='sha256:'||public.pr_c_controlled_human_sha256_jsonb(jsonb_build_object('proof','not_applicable'));
  token:='sha256:'||public.pr_c_controlled_human_sha256_jsonb(jsonb_build_object('anchorToken',anchor.challenge_token,'intentDigest',anchor.intent_digest,'action',anchor.action,'resourceFamily',anchor.target_family,'resourceId',anchor.target_id,
    'expectedVersion',anchor.expected_version,'observedVersion',anchor.expected_version,'requestId',anchor.request_id,'receiptId',NULL,'auditId',NULL,'denialCodeDigest',denial_code_digest));
  safe:=jsonb_build_object('contractVersion','pr-c-controlled-human-step-binding-3','stepId',anchor.step_id,'action',anchor.action,'result','denied','resourceFamily',anchor.target_family,'resourceDigest',resource_digest,'expectedVersion',anchor.expected_version,'observedVersion',anchor.expected_version,'requestDigest',request_digest,'receiptDigest',sentinel,'auditDigest',sentinel,'intentDigest',anchor.intent_digest,'denialCodeDigest',denial_code_digest,'bindingToken',token,'anchorToken',anchor.challenge_token,
    'causalParentBindingToken',sentinel,'causalParentResourceDigest',sentinel,'causalLineageDigest',sentinel,
    'issuedAt',to_char(statement_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
  INSERT INTO public.pr_c_controlled_human_action_bindings(exercise_id,checkpoint_id,step_id,persona_key,actor_id,observation_kind,action,result,denial_proof_kind,resource_family,resource_id,expected_version,observed_version,request_id,intent_digest,denial_code_digest,binding_token,safe_record,anchor_id)
  VALUES(exercise.id,anchor.checkpoint_id,anchor.step_id,anchor.persona_key,actor,'negative_attempt',anchor.action,'denied','server_denied_attempt',anchor.target_family,anchor.target_id,anchor.expected_version,anchor.expected_version,anchor.request_id,anchor.intent_digest,denial_code_digest,token,safe,anchor.id);
  RETURN safe;
END $$;

CREATE OR REPLACE FUNCTION public.pr_c_controlled_human_register_resource()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE exercise_id uuid;
BEGIN
  SELECT exercise.id INTO exercise_id
  FROM public.pr_c_controlled_human_exercises exercise
  WHERE exercise.org_id = NEW.org_id
    AND exercise.workspace_id = NEW.workspace_id
    AND exercise.lifecycle = 'active'
  FOR SHARE;
  IF exercise_id IS NOT NULL THEN
    INSERT INTO public.pr_c_controlled_human_resource_ownership(
      exercise_id, resource_family, resource_id, org_id, workspace_id
    ) VALUES (exercise_id, TG_ARGV[0], NEW.id, NEW.org_id, NEW.workspace_id);
  END IF;
  RETURN NEW;
END
$$;

DO $$
DECLARE binding text[];
BEGIN
  FOREACH binding SLICE 1 IN ARRAY ARRAY[
    ARRAY['assess_process','assess_processes'], ARRAY['assess_case','assess_v2_cases'], ARRAY['assess_review_resolution','assess_v2_review_resolutions'], ARRAY['assess_studio_handoff','assess_v2_studio_handoffs'],
    ARRAY['evidence_source','enterprise_evidence_sources'], ARRAY['evidence_source_version','enterprise_evidence_source_versions'],
    ARRAY['source_set','enterprise_source_sets'], ARRAY['source_set_version','enterprise_source_set_versions'],
    ARRAY['input_bundle','enterprise_module_input_bundles'], ARRAY['input_bundle_version','enterprise_module_input_bundle_versions'],
    ARRAY['evidence_candidate','enterprise_evidence_candidates'], ARRAY['candidate_relationship_review','enterprise_evidence_candidate_relationship_reviews'],
    ARRAY['assess_conflict','enterprise_assess_evidence_conflicts'], ARRAY['assess_conflict_resolution','enterprise_assess_evidence_conflict_resolutions'],
    ARRAY['tenant_template','studio_tenant_template_aggregates'], ARRAY['tenant_template_version','studio_tenant_template_versions'],
    ARRAY['tenant_template_review','studio_tenant_template_review_events'], ARRAY['tenant_template_approval','studio_tenant_template_approval_events'],
    ARRAY['module_handoff','enterprise_module_handoffs'], ARRAY['module_handoff_review','enterprise_module_handoff_review_events'], ARRAY['module_handoff_approval','enterprise_module_handoff_approval_events'],
    ARRAY['studio_artifact','studio_artifact_aggregates'], ARRAY['studio_artifact_review','studio_artifact_review_resolutions'], ARRAY['studio_artifact_approval','studio_artifact_approval_resolutions'],
    ARRAY['studio_source_package','studio_artifact_source_packages'], ARRAY['studio_artifact_version','studio_artifact_versions'],
    ARRAY['delivery_handoff','enterprise_delivery_handoffs'], ARRAY['delivery_source_package','enterprise_delivery_source_packages'],
    ARRAY['delivery_handoff_review','enterprise_delivery_handoff_review_events'], ARRAY['delivery_handoff_approval','enterprise_delivery_handoff_approval_events'],
    ARRAY['delivery_work_package','enterprise_delivery_work_packages'], ARRAY['delivery_item','enterprise_delivery_work_item_aggregates'],
    ARRAY['delivery_item_version','enterprise_delivery_work_item_versions'], ARRAY['delivery_item_decision','enterprise_delivery_work_item_decisions'],
    ARRAY['delivery_package_review','enterprise_delivery_package_review_events'], ARRAY['delivery_package_approval','enterprise_delivery_package_approval_events'],
    ARRAY['delivery_package_blocker','enterprise_delivery_package_blocker_events'], ARRAY['monitor_baseline','enterprise_monitor_baselines'],
    ARRAY['pilot_environment','pilot_operations_environments'], ARRAY['pilot_tenant','pilot_operations_tenants']
  ]::text[][] LOOP
    EXECUTE format(
      'CREATE TRIGGER pr_c_controlled_human_own_%1$I AFTER INSERT ON public.%1$I FOR EACH ROW EXECUTE FUNCTION public.pr_c_controlled_human_register_resource(%2$L)',
      binding[2], binding[1]
    );
  END LOOP;
END
$$;

CREATE OR REPLACE FUNCTION public.pr_c_controlled_human_ownership_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_HISTORY_IMMUTABLE';
END
$$;
CREATE TRIGGER pr_c_controlled_human_ownership_immutable
  BEFORE UPDATE OR DELETE ON public.pr_c_controlled_human_resource_ownership
  FOR EACH ROW EXECUTE FUNCTION public.pr_c_controlled_human_ownership_immutable();
CREATE TRIGGER pr_c_controlled_human_step_contracts_immutable
  BEFORE UPDATE OR DELETE ON public.pr_c_controlled_human_step_contracts
  FOR EACH ROW EXECUTE FUNCTION public.pr_c_controlled_human_ownership_immutable();
CREATE TRIGGER pr_c_controlled_human_step_observations_immutable
  BEFORE UPDATE OR DELETE ON public.pr_c_controlled_human_step_observations
  FOR EACH ROW EXECUTE FUNCTION public.pr_c_controlled_human_ownership_immutable();
CREATE TRIGGER pr_c_controlled_human_action_bindings_immutable
  BEFORE UPDATE OR DELETE ON public.pr_c_controlled_human_action_bindings
  FOR EACH ROW EXECUTE FUNCTION public.pr_c_controlled_human_ownership_immutable();
CREATE TRIGGER pr_c_controlled_human_action_anchors_immutable
  BEFORE UPDATE OR DELETE ON public.pr_c_controlled_human_action_anchors
  FOR EACH ROW EXECUTE FUNCTION public.pr_c_controlled_human_ownership_immutable();
CREATE TRIGGER pr_c_controlled_human_intent_catalog_immutable
  BEFORE UPDATE OR DELETE ON public.pr_c_controlled_human_intent_catalog
  FOR EACH ROW EXECUTE FUNCTION public.pr_c_controlled_human_ownership_immutable();

CREATE OR REPLACE FUNCTION public.pr_c_controlled_human_public_attestation(
  p_release_sha text,
  p_review_head_sha text,
  p_deploy_id text,
  p_deploy_origin text,
  p_exercise_digest text,
  p_public_target_digest text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE exercise public.pr_c_controlled_human_exercises;
BEGIN
  PERFORM public.pr_c_controlled_human_assert_marker();
  PERFORM public.pr_c_controlled_human_assert_provider_state();
  SELECT stored.* INTO exercise
  FROM public.pr_c_controlled_human_exercises stored
  WHERE stored.lifecycle IN ('active','read_only')
    AND stored.release_sha = p_release_sha
    AND stored.review_head_sha = p_review_head_sha
    AND stored.deploy_id = p_deploy_id
    AND stored.deploy_origin = p_deploy_origin
    AND stored.exercise_digest = p_exercise_digest
    AND stored.public_target_digest = p_public_target_digest;
  IF exercise.id IS NULL THEN
    RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_ATTESTATION_MISMATCH';
  END IF;
  RETURN jsonb_build_object(
    'attested', true,
    'contractVersion', 'pr-c-controlled-human-attestation-1',
    'environmentClass', exercise.environment_class,
    'prNumber', exercise.pull_request_number,
    'releaseSha', exercise.release_sha,
    'reviewHeadSha', exercise.review_head_sha,
    'deployId', exercise.deploy_id,
    'deployOrigin', exercise.deploy_origin,
    'exerciseDigest', exercise.exercise_digest,
    'targetFingerprint', exercise.target_fingerprint,
    'publicTargetDigest', exercise.public_target_digest,
    'personaManifestDigest', exercise.persona_manifest_digest,
    'fixtureManifestDigest', exercise.fixture_manifest_digest,
    'migrationTip', exercise.migration_tip,
    'productionAuthorized', false,
    'customerDataAuthorized', false,
    'realProviderCallsAuthorized', false
  );
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_ATTESTATION_MISMATCH';
END
$$;

CREATE OR REPLACE FUNCTION public.pr_c_controlled_human_quiesce(
  p_exercise_digest text,
  p_expected_version bigint,
  p_result_digest text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE exercise public.pr_c_controlled_human_exercises; next_sequence bigint; transitioned_at timestamptz;
BEGIN
  PERFORM public.pr_c_controlled_human_assert_marker();
  PERFORM public.pr_c_controlled_human_assert_provider_state();
  SELECT stored.* INTO exercise FROM public.pr_c_controlled_human_exercises stored
  WHERE stored.exercise_digest = p_exercise_digest FOR UPDATE;
  IF exercise.id IS NOT NULL AND exercise.lifecycle='read_only' AND exercise.concurrency_version=p_expected_version+1
    AND EXISTS(SELECT 1 FROM public.pr_c_controlled_human_operation_events event WHERE event.exercise_id=exercise.id AND event.operation='quiesced' AND event.safe_result_digest=p_result_digest) THEN
    RETURN jsonb_build_object('lifecycle','read_only','concurrencyVersion',exercise.concurrency_version,
      'featureFlagCountEnabled',0,'runtimeControlReadOnlyCount',2,'runtimeControlProviderEnabledCount',0,
      'operationEventSequence',(SELECT sequence FROM public.pr_c_controlled_human_operation_events event WHERE event.exercise_id=exercise.id AND event.operation='quiesced' AND event.safe_result_digest=p_result_digest),
      'operationEventDigest',p_result_digest,'transitionedAt',exercise.quiesced_at);
  END IF;
  IF exercise.id IS NULL OR exercise.lifecycle <> 'active'
    OR exercise.concurrency_version <> p_expected_version
    OR p_result_digest !~ '^sha256:[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_STATE_MISMATCH';
  END IF;
  UPDATE public.enterprise_transcript_workspace_flags SET
    transcript_source_sets_enabled = false,
    assess_multisource_apply_enabled = false,
    unified_byok_gateway_enabled = false,
    governed_journeys_enabled = false,
    studio_multisource_enabled = false,
    studio_tenant_templates_enabled = false,
    module_handoffs_enabled = false,
    direct_studio_planning_enabled = false,
    direct_delivery_planning_enabled = false,
    delivery_item_review_enabled = false,
    monitor_approved_baseline_enabled = false,
    version = version + 1,
    updated_at = statement_timestamp()
  WHERE org_id = exercise.org_id AND workspace_id = exercise.workspace_id;
  UPDATE public.enterprise_intelligence_runtime_control SET
    read_only = true, provider_enabled = false, updated_at = statement_timestamp()
  WHERE singleton;
  UPDATE public.studio_artifact_runtime_control SET
    read_only = true, provider_enabled = false, updated_at = statement_timestamp()
  WHERE singleton;
  UPDATE public.pilot_operations_environments SET
    lifecycle='maintenance',maintenance=true,read_only=true,version=version+1,updated_at=statement_timestamp()
  WHERE org_id=exercise.org_id AND workspace_id=exercise.workspace_id AND lifecycle<>'deactivated';
  UPDATE public.pr_c_controlled_human_exercises SET lifecycle = 'read_only',
    concurrency_version = concurrency_version + 1, quiesced_at = statement_timestamp()
  WHERE id = exercise.id RETURNING quiesced_at INTO transitioned_at;
  SELECT COALESCE(max(sequence), 0) + 1 INTO next_sequence
  FROM public.pr_c_controlled_human_operation_events WHERE exercise_id = exercise.id;
  INSERT INTO public.pr_c_controlled_human_operation_events(exercise_id, sequence, operation, safe_result_digest)
  VALUES(exercise.id, next_sequence, 'quiesced', p_result_digest);
  PERFORM public.pr_c_controlled_human_assert_provider_state();
  RETURN jsonb_build_object('lifecycle','read_only','concurrencyVersion',exercise.concurrency_version + 1,
    'featureFlagCountEnabled',0,'runtimeControlReadOnlyCount',2,'runtimeControlProviderEnabledCount',0,
    'operationEventSequence',next_sequence,'operationEventDigest',p_result_digest,'transitionedAt',transitioned_at);
END
$$;

CREATE OR REPLACE FUNCTION public.pr_c_controlled_human_bind_quiesced_history(
  p_exercise_digest text,p_expected_version bigint,p_history_digest text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE exercise public.pr_c_controlled_human_exercises;
BEGIN
  PERFORM public.pr_c_controlled_human_assert_marker();
  PERFORM public.pr_c_controlled_human_assert_provider_state();
  SELECT stored.* INTO exercise FROM public.pr_c_controlled_human_exercises stored
  WHERE stored.exercise_digest=p_exercise_digest FOR UPDATE;
  IF exercise.id IS NULL OR exercise.lifecycle<>'read_only' OR exercise.concurrency_version<>p_expected_version
    OR p_history_digest !~ '^sha256:[0-9a-f]{64}$' OR exercise.quiesced_history_digest IS NOT NULL AND exercise.quiesced_history_digest<>p_history_digest
  THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_STATE_MISMATCH'; END IF;
  UPDATE public.pr_c_controlled_human_exercises SET quiesced_history_digest=p_history_digest WHERE id=exercise.id AND quiesced_history_digest IS NULL;
  RETURN jsonb_build_object('quiescedHistoryDigest',p_history_digest,'concurrencyVersion',exercise.concurrency_version);
END $$;

CREATE TABLE public.pr_c_controlled_human_synthetic_generation_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exercise_id uuid NOT NULL REFERENCES public.pr_c_controlled_human_exercises(id) ON DELETE RESTRICT,
  org_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  request_id uuid NOT NULL,
  idempotency_key text NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'),
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  artifact_id uuid NOT NULL,
  source_package_id uuid NOT NULL,
  source_package_hash text NOT NULL CHECK (source_package_hash ~ '^[0-9a-f]{64}$'),
  version_id uuid,
  output_hash text CHECK (output_hash IS NULL OR output_hash ~ '^[0-9a-f]{64}$'),
  status text NOT NULL CHECK (status IN ('claimed','committed')),
  response jsonb,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  completed_at timestamptz,
  UNIQUE (exercise_id, actor_id, idempotency_key),
  UNIQUE (exercise_id, request_id),
  FOREIGN KEY (exercise_id, org_id, workspace_id)
    REFERENCES public.pr_c_controlled_human_exercises(id, org_id, workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY (source_package_id, artifact_id, org_id, workspace_id)
    REFERENCES public.studio_artifact_source_packages(id, artifact_id, org_id, workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY (version_id, artifact_id, org_id, workspace_id)
    REFERENCES public.studio_artifact_versions(id, artifact_id, org_id, workspace_id) DEFERRABLE INITIALLY DEFERRED,
  CHECK ((status='claimed' AND version_id IS NULL AND output_hash IS NULL AND response IS NULL AND completed_at IS NULL)
    OR (status='committed' AND version_id IS NOT NULL AND output_hash IS NOT NULL AND jsonb_typeof(response)='object' AND completed_at IS NOT NULL))
);
CREATE OR REPLACE FUNCTION public.pr_c_controlled_human_synthetic_receipt_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF TG_OP='UPDATE' AND OLD.status='claimed' AND NEW.status='committed'
    AND (to_jsonb(NEW)-ARRAY['status','version_id','output_hash','response','completed_at'])
      = (to_jsonb(OLD)-ARRAY['status','version_id','output_hash','response','completed_at']) THEN RETURN NEW;END IF;
  RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_HISTORY_IMMUTABLE';
END
$$;
CREATE TRIGGER pr_c_controlled_human_synthetic_receipt_immutable
  BEFORE UPDATE OR DELETE ON public.pr_c_controlled_human_synthetic_generation_receipts
  FOR EACH ROW EXECUTE FUNCTION public.pr_c_controlled_human_synthetic_receipt_guard();

-- Creates the minimum accepted extraction lineage required by the production
-- direct-source contract. This is not a provider execution path: it is allowed
-- only after the provider-free CH-03 generation has committed, and creates no
-- key, call, attempt, token, egress, simulation, or effect record.
CREATE OR REPLACE FUNCTION public.pr_c_controlled_human_prepare_offline_lineage(
  p_exercise_digest text,p_input_bundle_id uuid,p_expected_bundle_version bigint
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE exercise public.pr_c_controlled_human_exercises; bundle public.enterprise_module_input_bundles;
 bundle_version public.enterprise_module_input_bundle_versions; actor uuid; caller uuid:=auth.uid(); authorization_version bigint;
 config_id uuid; route_id uuid; source_record record; receipt_id uuid; extraction_request_id uuid; job_id uuid; candidate_id uuid; created_count integer:=0;
BEGIN
  PERFORM public.pr_c_controlled_human_assert_marker();
  PERFORM public.pr_c_controlled_human_assert_provider_state();
  SELECT stored.* INTO exercise FROM public.pr_c_controlled_human_exercises stored
    WHERE stored.exercise_digest=p_exercise_digest AND stored.lifecycle='active' FOR UPDATE;
  IF exercise.id IS NULL OR NOT EXISTS(SELECT 1 FROM public.pr_c_controlled_human_synthetic_generation_receipts receipt
      WHERE receipt.exercise_id=exercise.id AND receipt.status='committed')
  THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_OFFLINE_LINEAGE_REJECTED'; END IF;
  SELECT binding.auth_user_id INTO actor FROM public.pr_c_controlled_human_persona_bindings binding
    WHERE binding.exercise_id=exercise.id AND binding.persona_key='requester' AND binding.expected_state='active';
  SELECT authority.version INTO authorization_version FROM public.authorization_versions authority
    WHERE authority.org_id=exercise.org_id AND authority.user_id=actor;
  SELECT stored.* INTO bundle FROM public.enterprise_module_input_bundles stored
    WHERE stored.id=p_input_bundle_id AND stored.org_id=exercise.org_id AND stored.workspace_id=exercise.workspace_id
      AND stored.owner_module='studio' AND stored.current_version=p_expected_bundle_version;
  SELECT stored.* INTO bundle_version FROM public.enterprise_module_input_bundle_versions stored
    WHERE stored.input_bundle_id=bundle.id AND stored.version=p_expected_bundle_version AND stored.status='locked';
  IF caller IS NULL OR caller<>actor OR actor IS NULL OR authorization_version IS NULL OR bundle.id IS NULL OR bundle_version.id IS NULL
    OR NOT EXISTS(SELECT 1 FROM public.pr_c_controlled_human_resource_ownership ownership
      WHERE ownership.exercise_id=exercise.id AND ownership.resource_family='input_bundle' AND ownership.resource_id=bundle.id)
  THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_OFFLINE_LINEAGE_REJECTED'; END IF;

  SELECT config.id INTO config_id FROM public.ai_provider_configs config
    WHERE config.org_id=exercise.org_id AND config.evidence_ref='pr-c-controlled-human:'||exercise.exercise_digest;
  IF config_id IS NULL THEN
    config_id:=gen_random_uuid();
    INSERT INTO public.ai_provider_configs(id,org_id,provider,display_name,default_model,status,evidence_ref,created_by,updated_by)
    VALUES(config_id,exercise.org_id,'groq','PR C controlled-human offline provenance','synthetic-no-provider','disabled','pr-c-controlled-human:'||exercise.exercise_digest,actor,actor);
  END IF;
  SELECT route.id INTO route_id FROM public.enterprise_ai_capability_routes route
    WHERE route.org_id=exercise.org_id AND route.workspace_id=exercise.workspace_id AND route.provider_config_id=config_id
      AND route.capability='assess.evidence.extract' AND route.model='synthetic-no-provider' AND NOT route.enabled AND route.deleted_at IS NULL;
  IF route_id IS NULL THEN
    route_id:=gen_random_uuid();
    INSERT INTO public.enterprise_ai_capability_routes(id,org_id,workspace_id,provider_config_id,capability,model,enabled,created_by,updated_by)
    VALUES(route_id,exercise.org_id,exercise.workspace_id,config_id,'assess.evidence.extract','synthetic-no-provider',false,actor,actor);
  END IF;

  FOR source_record IN
    SELECT source.id source_id,source_version.id source_version_id,item.source_set_id,item.source_set_version_id,item.ordinal
    FROM public.enterprise_module_input_bundle_items bundle_item
    JOIN public.enterprise_source_set_version_items item ON item.source_set_version_id=bundle_item.source_set_version_id
    JOIN public.enterprise_evidence_source_versions source_version ON source_version.id=item.source_version_id
    JOIN public.enterprise_evidence_sources source ON source.id=source_version.source_id
    WHERE bundle_item.input_bundle_version_id=bundle_version.id ORDER BY item.ordinal
  LOOP
    SELECT job.id INTO job_id FROM public.enterprise_ai_job_ledger job
      WHERE job.org_id=exercise.org_id AND job.workspace_id=exercise.workspace_id AND job.source_version_id=source_record.source_version_id
        AND job.metadata->>'exerciseDigest'=exercise.exercise_digest AND job.metadata->>'controlledHumanSyntheticNoProvider'='true';
    IF job_id IS NULL THEN
      receipt_id:=gen_random_uuid();extraction_request_id:=gen_random_uuid();job_id:=gen_random_uuid();candidate_id:=gen_random_uuid();created_count:=created_count+1;
      INSERT INTO public.enterprise_ai_command_receipts(id,org_id,workspace_id,actor_id,command_type,runtime_area,idempotency_key,initial_request_id,last_request_id,request_hash,status,resource_id,response,completed_at)
      VALUES(receipt_id,exercise.org_id,exercise.workspace_id,actor,'evidence.extract','ingestion','pr264-offline-'||source_record.source_version_id,extraction_request_id,extraction_request_id,repeat('a',64),'committed',source_record.source_id,jsonb_build_object('offlineSynthetic',true,'exerciseDigest',exercise.exercise_digest),statement_timestamp());
      INSERT INTO public.enterprise_ai_job_ledger(id,org_id,workspace_id,capability,provider_config_id,provider,model,prompt_key,prompt_version,source_refs,actor_id,request_id,idempotency_key,status,output_hash,approval_state,receipt_id,source_id,source_version_id,route_id,metadata,completed_at)
      VALUES(job_id,exercise.org_id,exercise.workspace_id,'assess.evidence.extract',config_id,'groq','synthetic-no-provider','controlled-human-offline','1',jsonb_build_array(jsonb_build_object('sourceId',source_record.source_id,'sourceVersionId',source_record.source_version_id)),actor,gen_random_uuid(),'pr264-offline-job-'||source_record.source_version_id,'succeeded',repeat('b',64),'review_required',receipt_id,source_record.source_id,source_record.source_version_id,route_id,jsonb_build_object('controlledHumanSyntheticNoProvider',true,'exerciseDigest',exercise.exercise_digest),statement_timestamp());
      INSERT INTO public.enterprise_transcript_extraction_bindings(org_id,workspace_id,job_id,receipt_id,input_bundle_version_id,input_bundle_id,bundle_hash,source_id,source_version_id,provider_route_id,provider_config_id,model,authorization_version,created_by,source_set_id,source_set_version_id)
      VALUES(exercise.org_id,exercise.workspace_id,job_id,receipt_id,bundle_version.id,bundle.id,bundle_version.bundle_hash,source_record.source_id,source_record.source_version_id,route_id,config_id,'synthetic-no-provider',authorization_version,actor,source_record.source_set_id,source_record.source_set_version_id);
      INSERT INTO public.enterprise_evidence_candidates(id,source_id,source_version_id,org_id,workspace_id,field_key,value,safe_excerpt,excerpt_hash,provenance_hash,version,source_locator,confidence,ai_job_id,prompt_version,suggestion_status,created_by,reviewed_by,reviewed_at)
      VALUES(candidate_id,source_record.source_id,source_record.source_version_id,exercise.org_id,exercise.workspace_id,'process_objective','Synthetic controlled-human offline candidate','Synthetic offline candidate',repeat('c',64),repeat('d',64),1,'normalized-text:v1:chars:0-29',1,job_id,'1','accepted',actor,actor,statement_timestamp());
    END IF;
  END LOOP;
  IF NOT EXISTS(SELECT 1 FROM public.enterprise_transcript_extraction_bindings binding
    WHERE binding.input_bundle_id=bundle.id AND binding.input_bundle_version_id=bundle_version.id)
  THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_OFFLINE_LINEAGE_REJECTED'; END IF;
  PERFORM public.pr_c_controlled_human_assert_provider_state();
  RETURN jsonb_build_object('status','prepared','createdLineageCount',created_count,'bundleVersion',bundle_version.version,
    'lineageDigest','sha256:'||public.pr_c_controlled_human_sha256_jsonb(jsonb_build_object('exerciseDigest',exercise.exercise_digest,'bundleId',bundle.id,'bundleVersionId',bundle_version.id,'bundleVersion',bundle_version.version)));
END $$;

CREATE OR REPLACE FUNCTION public.pr_c_controlled_human_synthetic_studio_generate(p_command jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
#variable_conflict use_variable
DECLARE
  exercise public.pr_c_controlled_human_exercises; binding public.pr_c_controlled_human_persona_bindings;
  artifact public.studio_artifact_aggregates; package public.studio_artifact_source_packages;
  system_template public.studio_system_template_versions; tenant_template public.studio_tenant_template_versions; tenant_aggregate public.studio_tenant_template_aggregates;
  receipt public.pr_c_controlled_human_synthetic_generation_receipts; runtime public.studio_artifact_runtime_control;
  enterprise_runtime public.enterprise_intelligence_runtime_control;
  actor uuid; org uuid; workspace uuid; request_id uuid; artifact_id uuid; source_package_id uuid;
  authorization_version bigint; expected_aggregate bigint; expected_current uuid; expected_approved uuid;
  request_hash text; template_value jsonb; template_kind text; template_version_id uuid; template_version text; template_hash text;
  content_schema_version text; renderer_version text;
  version_id uuid; next_version bigint; content jsonb; content_hash text; audit_id uuid:=gen_random_uuid(); result jsonb;
  selected_source_ids jsonb; existing_keys text[]; required_keys text[]:=ARRAY[
   'actorId','artifactId','authorizationVersion','contractVersion','deployId','deployOrigin','environmentClass','exerciseDigest','expectedAggregateVersion',
   'expectedApprovedVersionId','expectedCurrentVersionId','idempotencyKey','organizationId','prNumber','releaseSha','requestId','reviewHeadSha','sourcePackageHash',
   'sourcePackageId','sourcePackageVersion','targetFingerprint','template','workspaceId'];
BEGIN
  PERFORM public.pr_c_controlled_human_assert_marker();
  IF jsonb_typeof(p_command)<>'object' THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_SYNTHETIC_GENERATION_REJECTED';END IF;
  SELECT array_agg(key ORDER BY key) INTO existing_keys FROM jsonb_object_keys(p_command) key;
  SELECT array_agg(value ORDER BY value) INTO required_keys FROM unnest(required_keys) value;
  IF existing_keys IS DISTINCT FROM required_keys OR p_command->>'contractVersion'<>'pr-c-controlled-human-synthetic-studio-generation-1'
    OR p_command->>'environmentClass'<>'hosted_nonproduction_pilot' OR p_command->>'prNumber'<>'264'
    OR p_command->>'releaseSha'!~'^[0-9a-f]{40}$' OR p_command->>'reviewHeadSha' IS DISTINCT FROM p_command->>'releaseSha'
    OR p_command->>'deployId'!~'^[0-9a-f]{24}$' OR p_command->>'deployOrigin'<>'https://deploy-preview-264--avalaos-pilot.netlify.app'
    OR p_command->>'exerciseDigest'!~'^sha256:[0-9a-f]{64}$' OR p_command->>'targetFingerprint'!~'^sha256:[0-9a-f]{64}$'
    OR COALESCE(p_command->>'idempotencyKey','')!~'^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$' THEN
    RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_SYNTHETIC_GENERATION_REJECTED';
  END IF;
  actor:=(p_command->>'actorId')::uuid;org:=(p_command->>'organizationId')::uuid;workspace:=(p_command->>'workspaceId')::uuid;
  request_id:=(p_command->>'requestId')::uuid;artifact_id:=(p_command->>'artifactId')::uuid;source_package_id:=(p_command->>'sourcePackageId')::uuid;
  authorization_version:=(p_command->>'authorizationVersion')::bigint;expected_aggregate:=(p_command->>'expectedAggregateVersion')::bigint;
  expected_current:=(p_command->>'expectedCurrentVersionId')::uuid;expected_approved:=(p_command->>'expectedApprovedVersionId')::uuid;
  IF authorization_version<1 OR expected_aggregate<0 OR (p_command->>'sourcePackageVersion')::bigint<1 THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_SYNTHETIC_GENERATION_REJECTED';END IF;
  SELECT stored.* INTO exercise FROM public.pr_c_controlled_human_exercises stored WHERE stored.exercise_digest=p_command->>'exerciseDigest' FOR UPDATE;
  IF exercise.id IS NULL OR exercise.lifecycle<>'active' OR exercise.org_id<>org OR exercise.workspace_id<>workspace OR exercise.pull_request_number<>264
    OR exercise.environment_class<>'hosted_nonproduction_pilot' OR exercise.release_sha<>p_command->>'releaseSha' OR exercise.review_head_sha<>p_command->>'reviewHeadSha'
    OR exercise.deploy_id<>p_command->>'deployId' OR exercise.deploy_origin<>p_command->>'deployOrigin' OR exercise.target_fingerprint<>p_command->>'targetFingerprint'
    OR NOT exercise.synthetic_only OR exercise.production_authorized OR exercise.customer_data_authorized OR exercise.real_provider_calls_authorized THEN
    RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_SYNTHETIC_GENERATION_REJECTED';
  END IF;
  SELECT stored.* INTO binding FROM public.pr_c_controlled_human_persona_bindings stored
  WHERE stored.exercise_id=exercise.id AND stored.persona_key='requester' AND stored.auth_user_id=actor AND stored.expected_state='active';
  IF binding.exercise_id IS NULL THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_SYNTHETIC_GENERATION_REJECTED';END IF;
  PERFORM public.pr1b_assert_command_authority(actor,org,workspace,'studio.artifacts.generate',authorization_version);
  SELECT * INTO runtime FROM public.studio_artifact_runtime_control WHERE singleton FOR SHARE;
  SELECT * INTO enterprise_runtime FROM public.enterprise_intelligence_runtime_control WHERE singleton FOR SHARE;
  PERFORM public.pr_c_controlled_human_assert_provider_state();
  IF runtime.singleton IS NULL OR enterprise_runtime.singleton IS NULL
    OR NOT runtime.enabled OR runtime.read_only OR runtime.provider_enabled
    OR NOT enterprise_runtime.enabled OR enterprise_runtime.read_only OR enterprise_runtime.provider_enabled THEN
    RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_SYNTHETIC_GENERATION_PROVIDER_STATE_REJECTED';
  END IF;
  request_hash:=public.enterprise_sha256_jsonb(p_command);
  SELECT stored.* INTO receipt FROM public.pr_c_controlled_human_synthetic_generation_receipts stored
  WHERE stored.exercise_id=exercise.id AND stored.actor_id=actor AND stored.idempotency_key=p_command->>'idempotencyKey' FOR UPDATE;
  IF receipt.id IS NOT NULL THEN
    IF receipt.request_hash<>request_hash OR receipt.status<>'committed' THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_SYNTHETIC_GENERATION_REPLAY_REJECTED';END IF;
    RETURN jsonb_set(receipt.response,'{outcome}','"replayed"'::jsonb);
  END IF;
  INSERT INTO public.pr_c_controlled_human_synthetic_generation_receipts(exercise_id,org_id,workspace_id,actor_id,request_id,idempotency_key,request_hash,artifact_id,source_package_id,source_package_hash,status)
  VALUES(exercise.id,org,workspace,actor,request_id,p_command->>'idempotencyKey',request_hash,artifact_id,source_package_id,p_command->>'sourcePackageHash','claimed') RETURNING * INTO receipt;
  SELECT stored.* INTO artifact FROM public.studio_artifact_aggregates stored WHERE stored.id=artifact_id AND stored.org_id=org AND stored.workspace_id=workspace FOR UPDATE;
  SELECT stored.* INTO package FROM public.studio_artifact_source_packages stored WHERE stored.id=source_package_id AND stored.artifact_id=artifact_id AND stored.org_id=org AND stored.workspace_id=workspace FOR SHARE;
  IF artifact.id IS NULL OR package.id IS NULL OR artifact.source_package_id<>package.id OR package.version<>(p_command->>'sourcePackageVersion')::bigint
    OR package.package_hash<>p_command->>'sourcePackageHash' OR artifact.source_package_hash<>package.package_hash OR artifact.aggregate_version<>expected_aggregate
    OR artifact.current_version_id IS DISTINCT FROM expected_current OR artifact.current_approved_version_id IS DISTINCT FROM expected_approved
    OR package.source_mode NOT IN('assess_handoff','assess_plus_transcript_bundle') OR package.assess_handoff_id IS NULL
    OR package.candidate_manifest_hash<>public.enterprise_sha256_jsonb(package.candidate_manifest) OR package.anchor_manifest_hash<>public.enterprise_sha256_jsonb(package.anchor_manifest)
    OR package.candidate_count<>jsonb_array_length(package.candidate_manifest) OR package.anchor_count<>jsonb_array_length(package.anchor_manifest)
    OR (package.studio_input_bundle_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.enterprise_module_input_bundle_versions version JOIN public.enterprise_module_input_bundles aggregate ON aggregate.id=version.input_bundle_id
      WHERE version.id=package.studio_input_bundle_version_id AND version.input_bundle_id=package.studio_input_bundle_id AND version.version=package.studio_input_bundle_version
       AND version.bundle_hash=package.studio_bundle_hash AND version.status='locked' AND aggregate.current_version=version.version AND version.org_id=org AND version.workspace_id=workspace))
    OR (package.source_mode='assess_plus_transcript_bundle' AND NOT EXISTS(SELECT 1 FROM public.enterprise_module_handoffs handoff
      JOIN public.enterprise_module_handoff_consumptions consumption ON consumption.handoff_id=handoff.id
        AND consumption.artifact_id=artifact.id AND consumption.source_package_id=package.id
        AND consumption.source_package_hash=package.package_hash
      JOIN public.assess_v2_studio_handoffs upstream ON upstream.id=handoff.upstream_handoff_id
        AND upstream.id=package.assess_handoff_id AND upstream.package_hash=package.assess_package_hash
      WHERE handoff.org_id=org AND handoff.workspace_id=workspace AND handoff.status='consumed'
        AND handoff.target_input_bundle_id=package.studio_input_bundle_id
        AND handoff.target_input_bundle_version_id=package.studio_input_bundle_version_id
        AND handoff.target_input_bundle_version=package.studio_input_bundle_version
        AND handoff.target_input_bundle_hash=package.studio_bundle_hash
        AND EXISTS(SELECT 1 FROM public.enterprise_module_input_bundle_items bundle_item
          JOIN public.enterprise_source_set_version_items source_item ON source_item.source_set_version_id=bundle_item.source_set_version_id
          WHERE bundle_item.input_bundle_version_id=package.studio_input_bundle_version_id
            AND source_item.source_version_id<>upstream.source_version_id)
        AND NOT EXISTS(SELECT 1 FROM public.enterprise_module_input_bundle_items bundle_item
          JOIN public.enterprise_source_set_version_items source_item ON source_item.source_set_version_id=bundle_item.source_set_version_id
          WHERE bundle_item.input_bundle_version_id=package.studio_input_bundle_version_id
            AND source_item.source_version_id=upstream.source_version_id))) THEN
    RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_SYNTHETIC_GENERATION_STALE_SOURCE';
  END IF;
  IF NOT public.studio_pr_b_lock_source_package_current(package.id,org,workspace) THEN
    RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_SYNTHETIC_GENERATION_STALE_SOURCE';
  END IF;
  template_value:=p_command->'template';
  IF jsonb_typeof(template_value)<>'object' OR NOT(template_value?'kind') THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_SYNTHETIC_GENERATION_TEMPLATE_REJECTED';END IF;
  template_kind:=template_value->>'kind';template_version_id:=(template_value->>'versionId')::uuid;template_hash:=template_value->>'hash';
  IF template_kind='system' THEN
    IF (SELECT count(*) FROM jsonb_object_keys(template_value))<>4 OR NOT(template_value?&ARRAY['kind','versionId','version','hash']) THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_SYNTHETIC_GENERATION_TEMPLATE_REJECTED';END IF;
    SELECT stored.* INTO system_template FROM public.studio_system_template_versions stored WHERE stored.id=template_version_id AND stored.superseded_at IS NULL;
    template_version:=template_value->>'version';
    IF system_template.id IS NULL OR system_template.template_version<>template_version OR system_template.template_hash<>template_hash
      OR system_template.artifact_type<>artifact.artifact_type THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_SYNTHETIC_GENERATION_TEMPLATE_REJECTED';END IF;
    content_schema_version:=system_template.content_schema_version;renderer_version:=system_template.renderer_version;
  ELSIF template_kind='tenant' THEN
    IF (SELECT count(*) FROM jsonb_object_keys(template_value))<>5 OR NOT(template_value?&ARRAY['kind','templateId','versionId','version','hash']) THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_SYNTHETIC_GENERATION_TEMPLATE_REJECTED';END IF;
    SELECT version.* INTO tenant_template FROM public.studio_tenant_template_versions version
    WHERE version.id=template_version_id AND version.template_id=(template_value->>'templateId')::uuid AND version.org_id=org AND version.workspace_id=workspace;
    SELECT aggregate.* INTO tenant_aggregate FROM public.studio_tenant_template_aggregates aggregate
    WHERE aggregate.id=(template_value->>'templateId')::uuid AND aggregate.org_id=org AND aggregate.workspace_id=workspace;
    template_version:=template_value->>'version';
    IF tenant_template.id IS NULL OR tenant_template.version::text<>template_version OR tenant_template.template_hash<>template_hash OR tenant_template.status<>'approved'
      OR tenant_template.artifact_class NOT IN ('custom',artifact.artifact_type) OR tenant_aggregate.artifact_class NOT IN ('custom',artifact.artifact_type)
      OR tenant_aggregate.current_version<>tenant_template.version OR tenant_aggregate.current_version_id<>tenant_template.id
      OR tenant_aggregate.current_approved_version_id<>tenant_template.id OR tenant_aggregate.lifecycle<>'approved' THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_SYNTHETIC_GENERATION_TEMPLATE_REJECTED';END IF;
    content_schema_version:=tenant_template.content_schema_version;renderer_version:=tenant_template.renderer_compatibility_version;
  ELSE RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_SYNTHETIC_GENERATION_TEMPLATE_REJECTED';END IF;
  SELECT COALESCE(jsonb_agg(value ORDER BY value),'[]'::jsonb) INTO selected_source_ids FROM (SELECT DISTINCT anchor->>'sourceVersionId' value FROM jsonb_array_elements(package.anchor_manifest) anchor) selected;
  content:=jsonb_build_object('contractVersion','studio-artifact-2','title','SYNTHETIC CONTROLLED-HUMAN TEST OUTPUT — NOT CUSTOMER OR PROVIDER CONTENT',
   'summary','SYNTHETIC CONTROLLED-HUMAN TEST OUTPUT — NOT CUSTOMER OR PROVIDER CONTENT',
   'sections',jsonb_build_array(jsonb_build_object('id','synthetic-controlled-human','title','Synthetic controlled-human verification','body','SYNTHETIC CONTROLLED-HUMAN TEST OUTPUT — NOT CUSTOMER OR PROVIDER CONTENT','sourceAnchors',package.anchor_manifest,'labels',jsonb_build_array('template_required'))),
   'coverage',jsonb_build_object('selectedSourceVersionIds',selected_source_ids,'coveredSourceVersionIds',selected_source_ids,'complete',true));
  IF NOT public.studio_pr_b_structured_artifact_content_safe(content,package) THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_SYNTHETIC_GENERATION_CONTENT_REJECTED';END IF;
  SELECT COALESCE(max(stored.version),0)+1 INTO next_version FROM public.studio_artifact_versions stored WHERE stored.artifact_id=artifact.id;
  version_id:=public.studio_pr_b_deterministic_uuid('pr264-controlled-human-synthetic-generation',receipt.id);content_hash:=public.enterprise_sha256_jsonb(content);
  INSERT INTO public.studio_artifact_versions(id,artifact_id,org_id,workspace_id,version,parent_version_id,template_id,content_schema_version,renderer_version,content,content_hash,lifecycle,generation_attempt_id,author_id,author_authorization_version,source_package_id,source_package_hash,template_kind,tenant_template_version_id,template_version,template_hash)
  VALUES(version_id,artifact.id,org,workspace,next_version,artifact.current_version_id,CASE WHEN template_kind='system' THEN template_version_id END,content_schema_version,renderer_version,content,content_hash,'draft',NULL,actor,authorization_version,package.id,package.package_hash,template_kind,CASE WHEN template_kind='tenant' THEN template_version_id END,template_version,template_hash);
  UPDATE public.studio_artifact_aggregates SET current_version_id=version_id,aggregate_version=aggregate_version+1,lifecycle='draft',updated_at=statement_timestamp() WHERE id=artifact.id;
  INSERT INTO public.privileged_audit_events(id,org_id,workspace_id,actor_id,request_id,action,resource_type,resource_id,outcome,resource_version,metadata)
  VALUES(audit_id,org,workspace,actor,request_id,'pr_c.controlled_human.synthetic_studio_generate','studio_artifact',artifact.id,'succeeded',artifact.aggregate_version+1,
   jsonb_build_object('generationKind','synthetic_controlled_human','exerciseDigest',exercise.exercise_digest,'sourcePackageId',package.id,'sourcePackageHash',package.package_hash,'templateVersionId',template_version_id,'templateHash',template_hash));
  result:=jsonb_build_object('outcome','committed','receiptId',receipt.id,'resourceId',artifact.id,'resource',jsonb_build_object('artifactId',artifact.id,'versionId',version_id,'version',next_version,
   'sourcePackageId',package.id,'sourcePackageVersion',package.version,'sourcePackageHash',package.package_hash,'templateVersionId',template_version_id,'templateVersion',CASE WHEN template_kind='tenant' THEN to_jsonb(template_version::bigint) ELSE to_jsonb(template_version) END,
   'templateHash',template_hash,'generationKind','synthetic_controlled_human','synthetic',true));
  UPDATE public.pr_c_controlled_human_synthetic_generation_receipts SET status='committed',version_id=version_id,output_hash=content_hash,response=result,completed_at=statement_timestamp() WHERE id=receipt.id;
  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION public.pr_c_controlled_human_finalize_deprovision(
  p_exercise_digest text,
  p_expected_version bigint,
  p_sessions_result_digest text,
  p_credentials_result_digest text,
  p_result_digest text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE exercise public.pr_c_controlled_human_exercises; next_sequence bigint; affected integer; late_sessions integer;
BEGIN
  PERFORM public.pr_c_controlled_human_assert_marker();
  PERFORM public.pr_c_controlled_human_assert_provider_state();
  SELECT stored.* INTO exercise FROM public.pr_c_controlled_human_exercises stored
  WHERE stored.exercise_digest = p_exercise_digest FOR UPDATE;
  IF exercise.id IS NULL OR exercise.lifecycle <> 'read_only'
    OR exercise.concurrency_version <> p_expected_version
    OR exercise.quiesced_history_digest IS NULL
    OR p_sessions_result_digest !~ '^sha256:[0-9a-f]{64}$'
    OR p_credentials_result_digest !~ '^sha256:[0-9a-f]{64}$'
    OR p_result_digest !~ '^sha256:[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_STATE_MISMATCH';
  END IF;
  SELECT COALESCE(max(sequence), 0) + 1 INTO next_sequence
  FROM public.pr_c_controlled_human_operation_events WHERE exercise_id = exercise.id;
  INSERT INTO public.pr_c_controlled_human_operation_events(exercise_id,sequence,operation,safe_result_digest)
  VALUES(exercise.id,next_sequence,'sessions_revoked',p_sessions_result_digest);
  INSERT INTO public.pr_c_controlled_human_operation_events(exercise_id,sequence,operation,safe_result_digest)
  VALUES(exercise.id,next_sequence+1,'credentials_disabled',p_credentials_result_digest);
  UPDATE public.workspace_memberships membership SET status='suspended',disabled_at=statement_timestamp(),updated_at=statement_timestamp()
  WHERE membership.user_id IN (
    SELECT binding.auth_user_id FROM public.pr_c_controlled_human_persona_bindings binding WHERE binding.exercise_id=exercise.id
  ) AND membership.status='active';
  GET DIAGNOSTICS affected = ROW_COUNT;
  UPDATE public.organization_members membership SET status='suspended',disabled_at=statement_timestamp(),updated_at=statement_timestamp()
  WHERE membership.user_id IN (
    SELECT binding.auth_user_id FROM public.pr_c_controlled_human_persona_bindings binding WHERE binding.exercise_id=exercise.id
  ) AND membership.status='active';
  UPDATE public.profiles profile SET status='disabled',updated_at=statement_timestamp()
  WHERE profile.id IN (
    SELECT binding.auth_user_id FROM public.pr_c_controlled_human_persona_bindings binding WHERE binding.exercise_id=exercise.id
  );
  -- Close the race between the external Admin credential ban and the earlier
  -- session sweep. Any session created during that window is revoked inside
  -- the same transaction that makes the exercise deprovisioned.
  WITH deleted AS (
    DELETE FROM auth.sessions session WHERE session.user_id IN (
      SELECT binding.auth_user_id FROM public.pr_c_controlled_human_persona_bindings binding WHERE binding.exercise_id=exercise.id
    ) RETURNING session.id
  ) SELECT count(*)::int INTO late_sessions FROM deleted;
  UPDATE public.hosted_pilot_synthetic_subjects SET lifecycle='deprovisioned',version=version+1,updated_at=statement_timestamp()
  WHERE org_id=exercise.org_id AND workspace_id=exercise.workspace_id AND lifecycle<>'deprovisioned';
  UPDATE public.pilot_operations_tenants SET lifecycle='deprovisioned',version=version+1,updated_at=statement_timestamp()
  WHERE org_id=exercise.org_id AND workspace_id=exercise.workspace_id AND lifecycle='active';
  UPDATE public.pilot_operations_environments SET lifecycle='deactivated',maintenance=true,read_only=true,version=version+1,updated_at=statement_timestamp()
  WHERE org_id=exercise.org_id AND workspace_id=exercise.workspace_id AND lifecycle<>'deactivated';
  UPDATE public.workspaces SET status='suspended',updated_at=statement_timestamp()
  WHERE id IN (SELECT DISTINCT binding.workspace_id FROM public.pr_c_controlled_human_persona_bindings binding WHERE binding.exercise_id=exercise.id);
  UPDATE public.organizations SET status='suspended',updated_at=statement_timestamp()
  WHERE id IN (SELECT DISTINCT binding.org_id FROM public.pr_c_controlled_human_persona_bindings binding WHERE binding.exercise_id=exercise.id);
  UPDATE public.pr_c_controlled_human_exercises SET lifecycle='deprovisioned',
    concurrency_version=concurrency_version+1,deprovisioned_at=statement_timestamp()
  WHERE id=exercise.id;
  INSERT INTO public.pr_c_controlled_human_operation_events(exercise_id,sequence,operation,safe_result_digest)
  VALUES(exercise.id,next_sequence+2,'deprovisioned',p_result_digest);
  PERFORM public.pr_c_controlled_human_assert_provider_state();
  RETURN jsonb_build_object('lifecycle','deprovisioned','concurrencyVersion',exercise.concurrency_version+1,
    'operationEventSequence',next_sequence+2,'lateSessionsRevoked',late_sessions,
    'workspaceMembershipsDisabled',affected,'quiescedHistoryDigest',exercise.quiesced_history_digest);
END
$$;

ALTER TABLE public.pr_c_controlled_human_exercises ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pr_c_controlled_human_exercises FORCE ROW LEVEL SECURITY;
ALTER TABLE public.pr_c_controlled_human_recovery_authorities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pr_c_controlled_human_recovery_authorities FORCE ROW LEVEL SECURITY;
ALTER TABLE public.pr_c_controlled_human_persona_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pr_c_controlled_human_persona_bindings FORCE ROW LEVEL SECURITY;
ALTER TABLE public.pr_c_controlled_human_operation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pr_c_controlled_human_operation_events FORCE ROW LEVEL SECURITY;
ALTER TABLE public.pr_c_controlled_human_resource_ownership ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pr_c_controlled_human_resource_ownership FORCE ROW LEVEL SECURITY;
ALTER TABLE public.pr_c_controlled_human_step_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pr_c_controlled_human_step_contracts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.pr_c_controlled_human_step_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pr_c_controlled_human_step_observations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.pr_c_controlled_human_action_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pr_c_controlled_human_action_bindings FORCE ROW LEVEL SECURITY;
ALTER TABLE public.pr_c_controlled_human_action_anchors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pr_c_controlled_human_action_anchors FORCE ROW LEVEL SECURITY;
ALTER TABLE public.pr_c_controlled_human_intent_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pr_c_controlled_human_intent_catalog FORCE ROW LEVEL SECURITY;
ALTER TABLE public.pr_c_controlled_human_synthetic_generation_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pr_c_controlled_human_synthetic_generation_receipts FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.pr_c_controlled_human_exercises,
  public.pr_c_controlled_human_recovery_authorities,
  public.pr_c_controlled_human_persona_bindings,
  public.pr_c_controlled_human_operation_events,
  public.pr_c_controlled_human_resource_ownership,
  public.pr_c_controlled_human_step_contracts,
  public.pr_c_controlled_human_step_observations,
      public.pr_c_controlled_human_action_anchors,
      public.pr_c_controlled_human_action_bindings,
      public.pr_c_controlled_human_intent_catalog,
      public.pr_c_controlled_human_synthetic_generation_receipts FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.pr_c_controlled_human_assert_marker(),
  public.pr_c_controlled_human_provider_state(),
  public.pr_c_controlled_human_assert_provider_state(),
  public.pr_c_controlled_human_prepare_recovery(text,text,text,text,text,text,bigint,timestamptz),
  public.pr_c_controlled_human_record_auth_user(text,text,uuid),
  public.pr_c_controlled_human_complete_recovery(text,text,text),
  public.pr_c_controlled_human_quiesce(text,bigint,text),
  public.pr_c_controlled_human_bind_quiesced_history(text,bigint,text),
  public.pr_c_controlled_human_finalize_deprovision(text,bigint,text,text,text),
  public.pr_c_controlled_human_list_step_bindings(text),
      public.pr_c_controlled_human_issue_step_binding(text,text,text,uuid),
          public.pr_c_controlled_human_current_resource_version(uuid,uuid,text,uuid),
          public.pr_c_controlled_human_jsonb_exact_keys(jsonb,text[]),
          public.pr_c_controlled_human_canonical_json(jsonb),
          public.pr_c_controlled_human_sha256_jsonb(jsonb),
          public.pr_c_controlled_human_selector_is_safe(jsonb,integer),
      public.pr_c_controlled_human_selector_contract_valid(text,jsonb,text,uuid,bigint,text),
  public.pr_c_controlled_human_step_causal_proof(uuid,text,uuid),
  public.pr_c_controlled_human_anchor_step(text,text,text,text,uuid,bigint,jsonb),
  public.pr_c_controlled_human_complete_step(text,text),
  public.pr_c_controlled_human_execute_denied_step(text,text),
  public.pr_c_controlled_human_prepare_offline_lineage(text,uuid,bigint),
  public.pr_c_controlled_human_synthetic_studio_generate(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pr_c_controlled_human_assert_marker(),
  public.pr_c_controlled_human_prepare_recovery(text,text,text,text,text,text,bigint,timestamptz),
  public.pr_c_controlled_human_record_auth_user(text,text,uuid),
  public.pr_c_controlled_human_complete_recovery(text,text,text),
  public.pr_c_controlled_human_quiesce(text,bigint,text),
  public.pr_c_controlled_human_bind_quiesced_history(text,bigint,text),
  public.pr_c_controlled_human_finalize_deprovision(text,bigint,text,text,text),
  public.pr_c_controlled_human_list_step_bindings(text),
  public.pr_c_controlled_human_anchor_step(text,text,text,text,uuid,bigint,jsonb),
  public.pr_c_controlled_human_complete_step(text,text),
  public.pr_c_controlled_human_execute_denied_step(text,text),
  public.pr_c_controlled_human_prepare_offline_lineage(text,uuid,bigint),
  public.pr_c_controlled_human_synthetic_studio_generate(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.pr_c_controlled_human_list_step_bindings(text),
  public.pr_c_controlled_human_anchor_step(text,text,text,text,uuid,bigint,jsonb),
  public.pr_c_controlled_human_complete_step(text,text),
  public.pr_c_controlled_human_execute_denied_step(text,text),
  public.pr_c_controlled_human_prepare_offline_lineage(text,uuid,bigint) TO authenticated;
REVOKE ALL ON FUNCTION public.pr_c_controlled_human_public_attestation(text,text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pr_c_controlled_human_public_attestation(text,text,text,text,text,text) TO anon, authenticated, service_role;

COMMENT ON TABLE public.pr_c_controlled_human_exercises IS
  'Dedicated synthetic PR 264 exercise bindings. Raw credentials, customer data, provider data, and production authority are prohibited.';
COMMENT ON FUNCTION public.pr_c_controlled_human_public_attestation(text,text,text,text,text,text) IS
  'Public-safe exact preview/exercise attestation. Returns no tenant, workspace, user, credential, or object identifiers.';

ALTER TABLE public.hosted_pilot_environment_identity
  DROP CONSTRAINT hosted_pilot_environment_identity_migration_tip_check;
UPDATE public.hosted_pilot_environment_identity
SET migration_tip = '20260904120000'
WHERE singleton;
ALTER TABLE public.hosted_pilot_environment_identity
  ADD CONSTRAINT hosted_pilot_environment_identity_migration_tip_check
  CHECK (migration_tip = '20260904120000');
