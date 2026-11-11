-- Hosted verification results bound to one exact synthetic exercise run.
-- Forward-only and non-production; this ledger cannot authorize live activation.
CREATE TABLE public.hosted_pilot_verification_run_results (
  org_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  exercise_run_id uuid NOT NULL,
  release_sha text NOT NULL CHECK (release_sha ~ '^[0-9a-f]{40}$'),
  recovery_actor_id uuid NOT NULL REFERENCES public.profiles(id),
  recovery_authorization_version bigint NOT NULL CHECK (recovery_authorization_version > 0),
  result_sha256 text NOT NULL CHECK (result_sha256 ~ '^[0-9a-f]{64}$'),
  tenant_adversarial boolean NOT NULL CHECK (tenant_adversarial),
  provider_zero_egress boolean NOT NULL CHECK (provider_zero_egress),
  canonical_journey boolean NOT NULL CHECK (canonical_journey),
  backup_restore boolean NOT NULL CHECK (backup_restore),
  recovery_rollback boolean NOT NULL CHECK (recovery_rollback),
  production_authorized boolean NOT NULL DEFAULT false CHECK (NOT production_authorized),
  customer_data_used boolean NOT NULL DEFAULT false CHECK (NOT customer_data_used),
  real_provider_calls_used boolean NOT NULL DEFAULT false CHECK (NOT real_provider_calls_used),
  recorded_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY(org_id,workspace_id,exercise_run_id),
  FOREIGN KEY(workspace_id,org_id) REFERENCES public.workspaces(id,org_id) ON DELETE RESTRICT
);
ALTER TABLE public.hosted_pilot_verification_run_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_pilot_verification_run_results FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.hosted_pilot_verification_run_results FROM PUBLIC,anon,authenticated;
GRANT SELECT ON TABLE public.hosted_pilot_verification_run_results TO service_role;

CREATE FUNCTION public.hosted_pilot_record_verification_result(
  p_org uuid,p_workspace uuid,p_exercise_run uuid,p_release_sha text,p_result_sha256 text,
  p_recovery_actor uuid,p_recovery_authorization_version bigint
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE existing public.hosted_pilot_verification_run_results;
BEGIN
  IF p_release_sha !~ '^[0-9a-f]{40}$' OR p_result_sha256 !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'VALIDATION_FAILED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.hosted_pilot_recovery_operators operator
    JOIN public.authorization_versions version ON version.org_id=operator.org_id AND version.user_id=operator.actor_id
    WHERE operator.org_id=p_org AND operator.workspace_id=p_workspace AND operator.actor_id=p_recovery_actor
      AND operator.lifecycle='active' AND version.version=p_recovery_authorization_version)
    THEN RAISE EXCEPTION 'PR1B_NOT_FOUND'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('hosted-verification:'||p_org::text||':'||p_workspace::text||':'||p_exercise_run::text,0));
  SELECT * INTO existing FROM public.hosted_pilot_verification_run_results
    WHERE org_id=p_org AND workspace_id=p_workspace AND exercise_run_id=p_exercise_run FOR UPDATE;
  IF FOUND THEN
    IF existing.release_sha<>p_release_sha OR existing.result_sha256<>p_result_sha256
      OR existing.recovery_actor_id<>p_recovery_actor OR existing.recovery_authorization_version<>p_recovery_authorization_version
      THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF;
    RETURN jsonb_build_object('status','exact_replay','exerciseRunId',p_exercise_run,'productionAuthorized',false);
  END IF;
  INSERT INTO public.hosted_pilot_verification_run_results(org_id,workspace_id,exercise_run_id,release_sha,result_sha256,
    recovery_actor_id,recovery_authorization_version,
    tenant_adversarial,provider_zero_egress,canonical_journey,backup_restore,recovery_rollback)
  VALUES(p_org,p_workspace,p_exercise_run,p_release_sha,p_result_sha256,p_recovery_actor,p_recovery_authorization_version,true,true,true,true,true);
  RETURN jsonb_build_object('status','recorded','exerciseRunId',p_exercise_run,'productionAuthorized',false);
END$$;
REVOKE ALL ON FUNCTION public.hosted_pilot_record_verification_result(uuid,uuid,uuid,text,text,uuid,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.hosted_pilot_record_verification_result(uuid,uuid,uuid,text,text,uuid,bigint) TO service_role;

ALTER TABLE public.hosted_pilot_environment_identity DROP CONSTRAINT hosted_pilot_environment_identity_migration_tip_check;
UPDATE public.hosted_pilot_environment_identity SET migration_tip='20260811170000' WHERE singleton;
ALTER TABLE public.hosted_pilot_environment_identity ADD CONSTRAINT hosted_pilot_environment_identity_migration_tip_check CHECK(migration_tip='20260811170000');
CREATE OR REPLACE FUNCTION public.hosted_pilot_bootstrap_synthetic(
  p_actor uuid,p_org uuid,p_workspace uuid,p_authorization_version bigint,p_operation text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE lifecycle_value text; subject_count integer;
BEGIN
  PERFORM public.pr1b_assert_command_authority(p_actor,p_org,p_workspace,'org.admin',p_authorization_version);
  IF NOT EXISTS (SELECT 1 FROM public.hosted_pilot_environment_identity WHERE singleton AND product_key='avalaos-core'
    AND environment_class='hosted_nonproduction_pilot' AND migration_tip='20260811170000'
    AND NOT production_authorized AND NOT customer_data_authorized AND NOT real_provider_calls_authorized) THEN RAISE EXCEPTION 'HOSTED_PILOT_IDENTITY_MISMATCH'; END IF;
  IF p_operation NOT IN ('bootstrap','deprovision','replay') THEN RAISE EXCEPTION 'VALIDATION_FAILED'; END IF;
  IF p_operation IN ('bootstrap','replay') THEN
    INSERT INTO public.hosted_pilot_synthetic_subjects(org_id,workspace_id,subject_key,test_role,lifecycle,created_by)
    SELECT p_org,p_workspace,v.subject_key,v.test_role,CASE WHEN v.test_role='revoked' THEN 'revoked' ELSE 'active' END,p_actor
    FROM (VALUES ('synthetic_owner','owner'),('synthetic_operator','operator'),('synthetic_reviewer','reviewer'),('synthetic_revoked','revoked'),('synthetic_cross_tenant','cross_tenant')) v(subject_key,test_role)
    ON CONFLICT(org_id,workspace_id,subject_key) DO UPDATE SET lifecycle=CASE WHEN hosted_pilot_synthetic_subjects.lifecycle='deprovisioned' THEN hosted_pilot_synthetic_subjects.lifecycle ELSE excluded.lifecycle END,updated_at=statement_timestamp();
  ELSE
    UPDATE public.hosted_pilot_synthetic_subjects SET lifecycle='deprovisioned',version=version+1,updated_at=statement_timestamp() WHERE org_id=p_org AND workspace_id=p_workspace AND lifecycle<>'deprovisioned';
  END IF;
  SELECT count(*),min(lifecycle) INTO subject_count,lifecycle_value FROM public.hosted_pilot_synthetic_subjects WHERE org_id=p_org AND workspace_id=p_workspace;
  RETURN jsonb_build_object('syntheticOnly',true,'customerDataUsed',false,'subjectCount',subject_count,'lifecycle',CASE WHEN p_operation='deprovision' THEN 'deprovisioned' ELSE 'bounded_synthetic' END,'productionAuthorized',false);
END$$;
REVOKE ALL ON FUNCTION public.hosted_pilot_bootstrap_synthetic(uuid,uuid,uuid,bigint,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.hosted_pilot_bootstrap_synthetic(uuid,uuid,uuid,bigint,text) TO service_role;
