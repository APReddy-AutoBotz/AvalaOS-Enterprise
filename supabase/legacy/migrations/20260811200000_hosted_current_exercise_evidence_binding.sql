-- Hosted closure evidence families must belong to the current hosted exercise.
-- Forward-only; raw evidence ingestion remains controller/database-owner only.
CREATE TABLE public.hosted_pilot_exercise_evidence_families (
  org_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  exercise_run_id uuid NOT NULL,
  release_sha text NOT NULL CHECK (release_sha ~ '^[0-9a-f]{40}$'),
  producer_workflow_path text NOT NULL CHECK (producer_workflow_path='.github/workflows/hosted-pilot-activation-evidence-producer.yml'),
  producer_run_id text NOT NULL CHECK (producer_run_id ~ '^[1-9][0-9]{0,19}$'),
  producer_run_attempt bigint NOT NULL CHECK (producer_run_attempt > 0),
  target_fingerprint text NOT NULL CHECK (target_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  deployment_fingerprint text NOT NULL CHECK (deployment_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  hosted_target text NOT NULL CHECK (hosted_target='hosted_nonproduction_pilot'),
  evidence_family text NOT NULL CHECK (evidence_family IN (
    'tenant-adversarial','provider-simulation-zero-egress','canonical-journey','backup-restore','recovery-rollback')),
  evidence_sha256 text NOT NULL CHECK (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  disposition text NOT NULL CHECK (disposition='executed_hosted_evidence'),
  recorded_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY(org_id,workspace_id,exercise_run_id,evidence_family),
  FOREIGN KEY(workspace_id,org_id) REFERENCES public.workspaces(id,org_id) ON DELETE RESTRICT
);
ALTER TABLE public.hosted_pilot_exercise_evidence_families ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_pilot_exercise_evidence_families FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.hosted_pilot_exercise_evidence_families FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.hosted_pilot_exercise_evidence_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'HOSTED_EXERCISE_EVIDENCE_IMMUTABLE'; END$$;
CREATE TRIGGER hosted_pilot_exercise_evidence_immutable BEFORE UPDATE OR DELETE ON public.hosted_pilot_exercise_evidence_families
FOR EACH ROW EXECUTE FUNCTION public.hosted_pilot_exercise_evidence_immutable();
REVOKE ALL ON FUNCTION public.hosted_pilot_exercise_evidence_immutable() FROM PUBLIC,anon,authenticated,service_role;

-- This ingestion surface is deliberately database-owner/controller only. The
-- service-authorized final recorder below consumes proof but cannot mint it.
CREATE FUNCTION public.hosted_pilot_ingest_exercise_evidence_family(
  p_org uuid,p_workspace uuid,p_exercise_run uuid,p_release_sha text,
  p_producer_workflow_path text,p_producer_run_id text,p_producer_run_attempt bigint,
  p_target_fingerprint text,p_deployment_fingerprint text,p_hosted_target text,
  p_evidence_family text,p_evidence_sha256 text,p_disposition text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE existing public.hosted_pilot_exercise_evidence_families;
BEGIN
  IF session_user IS DISTINCT FROM (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database())
    THEN RAISE EXCEPTION 'HOSTED_EVIDENCE_INGESTION_FORBIDDEN'; END IF;
  IF p_org IS NULL OR p_workspace IS NULL OR p_exercise_run IS NULL
    OR p_release_sha IS NULL OR p_release_sha !~ '^[0-9a-f]{40}$'
    OR p_producer_workflow_path IS DISTINCT FROM '.github/workflows/hosted-pilot-activation-evidence-producer.yml'
    OR p_producer_run_id IS NULL OR p_producer_run_id !~ '^[1-9][0-9]{0,19}$'
    OR p_producer_run_attempt IS NULL OR p_producer_run_attempt < 1
    OR p_target_fingerprint IS NULL OR p_target_fingerprint !~ '^sha256:[0-9a-f]{64}$'
    OR p_deployment_fingerprint IS NULL OR p_deployment_fingerprint !~ '^sha256:[0-9a-f]{64}$'
    OR p_hosted_target IS DISTINCT FROM 'hosted_nonproduction_pilot'
    OR p_evidence_family NOT IN ('tenant-adversarial','provider-simulation-zero-egress','canonical-journey','backup-restore','recovery-rollback')
    OR p_evidence_sha256 IS NULL OR p_evidence_sha256 !~ '^[0-9a-f]{64}$'
    OR p_disposition IS DISTINCT FROM 'executed_hosted_evidence'
    THEN RAISE EXCEPTION 'HOSTED_EXERCISE_EVIDENCE_INVALID'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('hosted-exercise-evidence:'||p_org::text||':'||p_workspace::text||':'||p_exercise_run::text,0));
  SELECT * INTO existing FROM public.hosted_pilot_exercise_evidence_families
    WHERE org_id=p_org AND workspace_id=p_workspace AND exercise_run_id=p_exercise_run AND evidence_family=p_evidence_family FOR UPDATE;
  IF FOUND THEN
    IF existing.release_sha<>p_release_sha OR existing.producer_workflow_path<>p_producer_workflow_path
      OR existing.producer_run_id<>p_producer_run_id OR existing.producer_run_attempt<>p_producer_run_attempt
      OR existing.target_fingerprint<>p_target_fingerprint OR existing.deployment_fingerprint<>p_deployment_fingerprint
      OR existing.hosted_target<>p_hosted_target OR existing.evidence_sha256<>p_evidence_sha256 OR existing.disposition<>p_disposition
      THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF;
    RETURN jsonb_build_object('status','exact_replay','exerciseRunId',p_exercise_run,'evidenceFamily',p_evidence_family);
  END IF;
  INSERT INTO public.hosted_pilot_exercise_evidence_families(org_id,workspace_id,exercise_run_id,release_sha,
    producer_workflow_path,producer_run_id,producer_run_attempt,target_fingerprint,deployment_fingerprint,hosted_target,
    evidence_family,evidence_sha256,disposition)
  VALUES(p_org,p_workspace,p_exercise_run,p_release_sha,p_producer_workflow_path,p_producer_run_id,p_producer_run_attempt,
    p_target_fingerprint,p_deployment_fingerprint,p_hosted_target,p_evidence_family,p_evidence_sha256,p_disposition);
  RETURN jsonb_build_object('status','recorded','exerciseRunId',p_exercise_run,'evidenceFamily',p_evidence_family);
END$$;
REVOKE ALL ON FUNCTION public.hosted_pilot_ingest_exercise_evidence_family(uuid,uuid,uuid,text,text,text,bigint,text,text,text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.hosted_pilot_record_verification_result(
  p_org uuid,p_workspace uuid,p_exercise_run uuid,p_release_sha text,
  p_producer_workflow_path text,p_producer_run_id text,p_producer_run_attempt bigint,
  p_target_fingerprint text,p_deployment_fingerprint text,
  p_recovery_actor uuid,p_recovery_authorization_version bigint
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE existing public.hosted_pilot_verification_run_results; computed_hash text;
BEGIN
  IF p_org IS NULL OR p_workspace IS NULL OR p_exercise_run IS NULL OR p_recovery_actor IS NULL
    OR p_recovery_authorization_version IS NULL OR p_recovery_authorization_version < 1
    OR p_release_sha IS NULL OR p_release_sha !~ '^[0-9a-f]{40}$'
    OR p_producer_workflow_path IS DISTINCT FROM '.github/workflows/hosted-pilot-activation-evidence-producer.yml'
    OR p_producer_run_id IS NULL OR p_producer_run_id !~ '^[1-9][0-9]{0,19}$'
    OR p_producer_run_attempt IS NULL OR p_producer_run_attempt < 1
    OR p_target_fingerprint IS NULL OR p_target_fingerprint !~ '^sha256:[0-9a-f]{64}$'
    OR p_deployment_fingerprint IS NULL OR p_deployment_fingerprint !~ '^sha256:[0-9a-f]{64}$'
    THEN RAISE EXCEPTION 'HOSTED_EXECUTED_EVIDENCE_INVALID'; END IF;
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
  IF (SELECT count(DISTINCT evidence_family) FROM public.hosted_pilot_exercise_evidence_families
      WHERE org_id=p_org AND workspace_id=p_workspace AND exercise_run_id=p_exercise_run AND release_sha=p_release_sha
        AND producer_workflow_path=p_producer_workflow_path AND producer_run_id=p_producer_run_id
        AND producer_run_attempt=p_producer_run_attempt AND target_fingerprint=p_target_fingerprint
        AND deployment_fingerprint=p_deployment_fingerprint AND hosted_target='hosted_nonproduction_pilot'
        AND disposition='executed_hosted_evidence') <> 5
    THEN RAISE EXCEPTION 'HOSTED_CURRENT_EXERCISE_PROOF_MISSING'; END IF;
  computed_hash=public.hosted_pilot_executed_evidence_digest(p_release_sha,p_producer_workflow_path,p_producer_run_id,p_producer_run_attempt,
    p_target_fingerprint,p_deployment_fingerprint,p_org,p_workspace,p_exercise_run,p_recovery_actor,p_recovery_authorization_version);
  PERFORM pg_advisory_xact_lock(hashtextextended('hosted-verification:'||p_org::text||':'||p_workspace::text||':'||p_exercise_run::text,0));
  SELECT * INTO existing FROM public.hosted_pilot_verification_run_results WHERE org_id=p_org AND workspace_id=p_workspace AND exercise_run_id=p_exercise_run FOR UPDATE;
  IF FOUND THEN
    IF existing.result_sha256<>computed_hash OR existing.release_sha<>p_release_sha OR existing.producer_workflow_path<>p_producer_workflow_path
      OR existing.producer_run_id<>p_producer_run_id OR existing.producer_run_attempt<>p_producer_run_attempt
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
UPDATE public.hosted_pilot_environment_identity SET migration_tip='20260811200000' WHERE singleton;
ALTER TABLE public.hosted_pilot_environment_identity ADD CONSTRAINT hosted_pilot_environment_identity_migration_tip_check CHECK(migration_tip='20260811200000');
