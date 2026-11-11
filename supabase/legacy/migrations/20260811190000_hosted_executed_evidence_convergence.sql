-- Hosted closure evidence must be derived from executed repository-owned state.
-- Forward-only; no production, customer-data, external-user, or provider authority.
ALTER TABLE public.hosted_pilot_verification_run_results
  ADD COLUMN producer_workflow_path text,
  ADD COLUMN producer_run_id text,
  ADD COLUMN producer_run_attempt bigint,
  ADD COLUMN target_fingerprint text,
  ADD COLUMN deployment_fingerprint text;

-- Legacy verification rows predate producer selectors.  NOT VALID constraints
-- preserve those immutable historical rows while enforcing complete, formatted
-- selectors for every new insert/update performed after this migration.
ALTER TABLE public.hosted_pilot_verification_run_results
  ADD CONSTRAINT hosted_verification_producer_workflow_present CHECK (producer_workflow_path IS NOT NULL AND octet_length(producer_workflow_path) BETWEEN 1 AND 256) NOT VALID,
  ADD CONSTRAINT hosted_verification_producer_run_present CHECK (producer_run_id IS NOT NULL AND producer_run_id ~ '^[1-9][0-9]{0,19}$') NOT VALID,
  ADD CONSTRAINT hosted_verification_producer_attempt_present CHECK (producer_run_attempt IS NOT NULL AND producer_run_attempt > 0) NOT VALID,
  ADD CONSTRAINT hosted_verification_target_fingerprint_present CHECK (target_fingerprint IS NOT NULL AND target_fingerprint ~ '^sha256:[0-9a-f]{64}$') NOT VALID,
  ADD CONSTRAINT hosted_verification_deployment_fingerprint_present CHECK (deployment_fingerprint IS NOT NULL AND deployment_fingerprint ~ '^sha256:[0-9a-f]{64}$') NOT VALID;

CREATE FUNCTION public.hosted_pilot_executed_evidence_digest(
  p_release_sha text,p_producer_workflow_path text,p_producer_run_id text,p_producer_run_attempt bigint,
  p_target_fingerprint text,p_deployment_fingerprint text,p_org uuid,p_workspace uuid,p_exercise_run uuid,
  p_recovery_actor uuid,p_recovery_authorization_version bigint
) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
  SELECT encode(public.digest(
    convert_to(jsonb_build_array(
      p_release_sha,p_producer_workflow_path,p_producer_run_id,p_producer_run_attempt,
      p_target_fingerprint,p_deployment_fingerprint,p_org,p_workspace,p_exercise_run,
      p_recovery_actor,p_recovery_authorization_version
    )::text,'UTF8'),'sha256'),'hex')
$$;
REVOKE ALL ON FUNCTION public.hosted_pilot_executed_evidence_digest(text,text,text,bigint,text,text,uuid,uuid,uuid,uuid,bigint) FROM PUBLIC,anon,authenticated,service_role;

DROP FUNCTION public.hosted_pilot_record_verification_result(uuid,uuid,uuid,text,text,uuid,bigint);
CREATE FUNCTION public.hosted_pilot_record_verification_result(
  p_org uuid,p_workspace uuid,p_exercise_run uuid,p_release_sha text,
  p_producer_workflow_path text,p_producer_run_id text,p_producer_run_attempt bigint,
  p_target_fingerprint text,p_deployment_fingerprint text,
  p_recovery_actor uuid,p_recovery_authorization_version bigint
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE existing public.hosted_pilot_verification_run_results; computed_hash text; selected_candidate_id uuid;
BEGIN
  IF p_org IS NULL OR p_workspace IS NULL OR p_exercise_run IS NULL OR p_recovery_actor IS NULL
    OR p_recovery_authorization_version IS NULL OR p_recovery_authorization_version < 1
    OR p_release_sha IS NULL OR p_release_sha !~ '^[0-9a-f]{40}$'
    OR octet_length(p_release_sha) <> 40
    OR p_producer_workflow_path IS DISTINCT FROM '.github/workflows/hosted-pilot-activation-evidence-producer.yml'
    OR octet_length(p_producer_workflow_path) > 256
    OR p_producer_run_id IS NULL OR p_producer_run_id !~ '^[1-9][0-9]{0,19}$'
    OR p_producer_run_attempt IS NULL OR p_producer_run_attempt < 1
    OR p_target_fingerprint IS NULL OR p_target_fingerprint !~ '^sha256:[0-9a-f]{64}$'
    OR p_deployment_fingerprint IS NULL OR p_deployment_fingerprint !~ '^sha256:[0-9a-f]{64}$'
    THEN RAISE EXCEPTION 'HOSTED_EXECUTED_EVIDENCE_INVALID'; END IF;
  -- The same predicates used by rollback authority: active identity and membership,
  -- exact active workspace role/version, and only recovery capabilities.
  IF NOT EXISTS (SELECT 1 FROM public.hosted_pilot_recovery_operators o
    JOIN public.profiles p ON p.id=o.actor_id AND p.status='active' AND p.deleted_at IS NULL
    JOIN public.organization_members om ON om.org_id=o.org_id AND om.user_id=o.actor_id AND om.status='active' AND om.disabled_at IS NULL AND om.deleted_at IS NULL
    JOIN public.workspace_memberships wm ON wm.org_id=o.org_id AND wm.workspace_id=o.workspace_id AND wm.user_id=o.actor_id AND wm.role_id=o.role_id AND wm.status='active' AND wm.disabled_at IS NULL AND wm.deleted_at IS NULL
    JOIN public.roles r ON r.id=o.role_id AND r.org_id=o.org_id AND r.workspace_id=o.workspace_id AND r.scope='workspace' AND r.status='active' AND r.deleted_at IS NULL
    JOIN public.authorization_versions av ON av.org_id=o.org_id AND av.user_id=o.actor_id AND av.version=p_recovery_authorization_version
    WHERE o.org_id=p_org AND o.workspace_id=p_workspace AND o.actor_id=p_recovery_actor AND o.lifecycle='active'
      AND o.synthetic_only AND NOT o.production_authorized AND NOT o.customer_data_authorized AND NOT o.real_provider_calls_authorized
      AND (SELECT array_agg(rc.capability_key ORDER BY rc.capability_key) FROM public.role_capabilities rc WHERE rc.role_id=o.role_id)=ARRAY['operations.read','release.promote']::text[])
    THEN RAISE EXCEPTION 'PR1B_NOT_FOUND'; END IF;
  IF (SELECT count(DISTINCT test_role) FROM public.hosted_pilot_synthetic_subjects WHERE org_id=p_org AND workspace_id=p_workspace AND synthetic_only)=5
     IS NOT TRUE OR EXISTS (SELECT 1 FROM public.hosted_pilot_synthetic_subjects WHERE org_id=p_org AND workspace_id=p_workspace AND test_role='revoked' AND lifecycle<>'revoked')
    THEN RAISE EXCEPTION 'HOSTED_TENANT_PROOF_MISSING'; END IF;
  IF (SELECT count(DISTINCT scenario) FROM public.hosted_pilot_provider_simulations WHERE org_id=p_org AND workspace_id=p_workspace AND zero_egress)=5
     IS NOT TRUE THEN RAISE EXCEPTION 'HOSTED_PROVIDER_PROOF_MISSING'; END IF;
  SELECT id INTO selected_candidate_id FROM public.pilot_operations_release_candidates WHERE org_id=p_org AND workspace_id=p_workspace AND git_sha=p_release_sha AND lifecycle IN('approved_for_pilot_promotion','promoted_non_live') ORDER BY created_at DESC LIMIT 1;
  IF selected_candidate_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.pilot_operations_release_events e WHERE e.org_id=p_org AND e.workspace_id=p_workspace AND e.candidate_id=selected_candidate_id AND e.event_type IN('validated','approved','promoted_non_live'))
    OR NOT EXISTS (SELECT 1 FROM public.pilot_operations_rollback_events r WHERE r.org_id=p_org AND r.workspace_id=p_workspace AND r.from_candidate_id=selected_candidate_id)
    OR NOT EXISTS (SELECT 1 FROM public.pilot_operations_recovery_evidence_ingestions WHERE org_id=p_org AND workspace_id=p_workspace AND workflow_head_sha=p_release_sha)
    THEN RAISE EXCEPTION 'HOSTED_JOURNEY_RECOVERY_PROOF_MISSING'; END IF;
  computed_hash=public.hosted_pilot_executed_evidence_digest(p_release_sha,p_producer_workflow_path,p_producer_run_id,p_producer_run_attempt,
    p_target_fingerprint,p_deployment_fingerprint,p_org,p_workspace,p_exercise_run,p_recovery_actor,p_recovery_authorization_version);
  PERFORM pg_advisory_xact_lock(hashtextextended('hosted-verification:'||p_org::text||':'||p_workspace::text||':'||p_exercise_run::text,0));
  SELECT * INTO existing FROM public.hosted_pilot_verification_run_results WHERE org_id=p_org AND workspace_id=p_workspace AND exercise_run_id=p_exercise_run FOR UPDATE;
  IF FOUND THEN
    IF existing.result_sha256<>computed_hash OR existing.release_sha<>p_release_sha OR existing.producer_run_id<>p_producer_run_id OR existing.producer_run_attempt<>p_producer_run_attempt
      OR existing.target_fingerprint<>p_target_fingerprint OR existing.deployment_fingerprint<>p_deployment_fingerprint
      OR existing.recovery_actor_id<>p_recovery_actor OR existing.recovery_authorization_version<>p_recovery_authorization_version
      THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF;
    RETURN jsonb_build_object('status','exact_replay','exerciseRunId',p_exercise_run,'productionAuthorized',false);
  END IF;
  INSERT INTO public.hosted_pilot_verification_run_results(org_id,workspace_id,exercise_run_id,release_sha,recovery_actor_id,recovery_authorization_version,result_sha256,
    tenant_adversarial,provider_zero_egress,canonical_journey,backup_restore,recovery_rollback,producer_workflow_path,producer_run_id,producer_run_attempt,target_fingerprint,deployment_fingerprint)
  VALUES(p_org,p_workspace,p_exercise_run,p_release_sha,p_recovery_actor,p_recovery_authorization_version,computed_hash,true,true,true,true,true,
    p_producer_workflow_path,p_producer_run_id,p_producer_run_attempt,p_target_fingerprint,p_deployment_fingerprint);
  RETURN jsonb_build_object('status','recorded','exerciseRunId',p_exercise_run,'productionAuthorized',false);
END$$;
REVOKE ALL ON FUNCTION public.hosted_pilot_record_verification_result(uuid,uuid,uuid,text,text,text,bigint,text,text,uuid,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.hosted_pilot_record_verification_result(uuid,uuid,uuid,text,text,text,bigint,text,text,uuid,bigint) TO service_role;

ALTER TABLE public.hosted_pilot_environment_identity DROP CONSTRAINT hosted_pilot_environment_identity_migration_tip_check;
UPDATE public.hosted_pilot_environment_identity SET migration_tip='20260811190000' WHERE singleton;
ALTER TABLE public.hosted_pilot_environment_identity ADD CONSTRAINT hosted_pilot_environment_identity_migration_tip_check CHECK(migration_tip='20260811190000');
