-- Hosted non-production security hardening discovered by the real Supabase advisor.
-- Forward-only. Keeps the pilot non-production and preserves all existing server-authority boundaries.

-- Trigger-only SECURITY DEFINER function: it must never be callable as a public RPC.
REVOKE ALL ON FUNCTION public.enterprise_provider_route_role_guard() FROM PUBLIC, anon, authenticated;

-- Raw review projection deliberately has no caller authority check. It is an internal primitive
-- used by guarded wrappers/service commands, so direct browser execution must be impossible.
REVOKE ALL ON FUNCTION public.pr1e_review_projection(uuid,uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pr1e_review_projection(uuid,uuid,uuid,uuid) TO service_role;

-- Immutable trigger helpers do not resolve user-controlled names. Pin their lookup path anyway so
-- hosted security posture does not depend on a role-mutable search_path.
ALTER FUNCTION public.pr1b_reject_immutable_event_mutation() SET search_path = pg_catalog;
ALTER FUNCTION public.pr1d_reject_immutable() SET search_path = pg_catalog;
ALTER FUNCTION public.pr1f_reject_immutable() SET search_path = pg_catalog;
ALTER FUNCTION public.pr1f_outcome_review_only() SET search_path = pg_catalog;

-- Advance the hosted identity marker to this forward hardening migration while retaining the
-- non-production/customer-data/provider stop gates.
ALTER TABLE public.hosted_pilot_environment_identity
  DROP CONSTRAINT hosted_pilot_environment_identity_migration_tip_check;
UPDATE public.hosted_pilot_environment_identity
SET migration_tip = '20260811130000'
WHERE singleton = true;
ALTER TABLE public.hosted_pilot_environment_identity
  ADD CONSTRAINT hosted_pilot_environment_identity_migration_tip_check
  CHECK (migration_tip = '20260811130000');

-- Keep the synthetic bootstrap fail-closed against the exact hosted schema tip.
CREATE OR REPLACE FUNCTION public.hosted_pilot_bootstrap_synthetic(
  p_actor uuid,p_org uuid,p_workspace uuid,p_authorization_version bigint,p_operation text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE lifecycle_value text; subject_count integer;
BEGIN
  PERFORM public.pr1b_assert_command_authority(p_actor,p_org,p_workspace,'org.admin',p_authorization_version);
  IF NOT EXISTS (SELECT 1 FROM public.hosted_pilot_environment_identity WHERE singleton
    AND product_key='avalaos-core' AND environment_class='hosted_nonproduction_pilot'
    AND migration_tip='20260811130000' AND NOT production_authorized
    AND NOT customer_data_authorized AND NOT real_provider_calls_authorized) THEN
    RAISE EXCEPTION 'HOSTED_PILOT_IDENTITY_MISMATCH';
  END IF;
  IF p_operation NOT IN ('bootstrap','deprovision','replay') THEN RAISE EXCEPTION 'VALIDATION_FAILED'; END IF;
  IF p_operation IN ('bootstrap','replay') THEN
    INSERT INTO public.hosted_pilot_synthetic_subjects(org_id,workspace_id,subject_key,test_role,lifecycle,created_by)
    SELECT p_org,p_workspace,v.subject_key,v.test_role,
      CASE WHEN v.test_role='revoked' THEN 'revoked' ELSE 'active' END,p_actor
    FROM (VALUES ('synthetic_owner','owner'),('synthetic_operator','operator'),
      ('synthetic_reviewer','reviewer'),('synthetic_revoked','revoked'),
      ('synthetic_cross_tenant','cross_tenant')) AS v(subject_key,test_role)
    ON CONFLICT(org_id,workspace_id,subject_key) DO UPDATE SET
      lifecycle=CASE WHEN public.hosted_pilot_synthetic_subjects.lifecycle='deprovisioned'
        THEN public.hosted_pilot_synthetic_subjects.lifecycle ELSE excluded.lifecycle END,
      updated_at=statement_timestamp();
  ELSE
    UPDATE public.hosted_pilot_synthetic_subjects SET lifecycle='deprovisioned',version=version+1,
      updated_at=statement_timestamp() WHERE org_id=p_org AND workspace_id=p_workspace
      AND lifecycle<>'deprovisioned';
  END IF;
  SELECT count(*),min(lifecycle) INTO subject_count,lifecycle_value
    FROM public.hosted_pilot_synthetic_subjects WHERE org_id=p_org AND workspace_id=p_workspace;
  RETURN jsonb_build_object('syntheticOnly',true,'customerDataUsed',false,'subjectCount',subject_count,
    'lifecycle',CASE WHEN p_operation='deprovision' THEN 'deprovisioned' ELSE 'bounded_synthetic' END,
    'productionAuthorized',false);
END$$;

REVOKE ALL ON FUNCTION public.hosted_pilot_bootstrap_synthetic(uuid,uuid,uuid,bigint,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.hosted_pilot_bootstrap_synthetic(uuid,uuid,uuid,bigint,text)
  TO service_role;
