-- Dedicated synthetic hosted recovery/promotion operator.
-- Additive, non-production only, and intentionally independent from approval authority.
CREATE TABLE public.hosted_pilot_recovery_operators (
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  provisioned_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  role_id uuid NOT NULL REFERENCES public.roles(id) ON DELETE RESTRICT,
  lifecycle text NOT NULL DEFAULT 'active' CHECK (lifecycle IN ('active','revoked','disabled')),
  synthetic_only boolean NOT NULL DEFAULT true CHECK (synthetic_only),
  production_authorized boolean NOT NULL DEFAULT false CHECK (NOT production_authorized),
  customer_data_authorized boolean NOT NULL DEFAULT false CHECK (NOT customer_data_authorized),
  real_provider_calls_authorized boolean NOT NULL DEFAULT false CHECK (NOT real_provider_calls_authorized),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY (org_id,workspace_id,actor_id),
  FOREIGN KEY (workspace_id,org_id) REFERENCES public.workspaces(id,org_id) ON DELETE RESTRICT
);
ALTER TABLE public.hosted_pilot_recovery_operators ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_pilot_recovery_operators FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.hosted_pilot_recovery_operators FROM PUBLIC,anon,authenticated;
GRANT SELECT ON TABLE public.hosted_pilot_recovery_operators TO service_role;

CREATE FUNCTION public.hosted_pilot_provision_recovery_operator(
  p_actor uuid,p_org uuid,p_workspace uuid,p_authorization_version bigint,p_recovery_actor uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE recovery_role uuid; recovery_email text;
BEGIN
  PERFORM public.pr1b_assert_command_authority(p_actor,p_org,p_workspace,'org.admin',p_authorization_version);
  IF p_recovery_actor=p_actor THEN RAISE EXCEPTION 'SEPARATION_OF_DUTY_REQUIRED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.hosted_pilot_environment_identity WHERE singleton
    AND migration_tip='20260811140000' AND environment_class='hosted_nonproduction_pilot'
    AND NOT production_authorized AND NOT customer_data_authorized AND NOT real_provider_calls_authorized) THEN
    RAISE EXCEPTION 'HOSTED_PILOT_IDENTITY_MISMATCH';
  END IF;
  SELECT lower(email) INTO recovery_email FROM public.profiles WHERE id=p_recovery_actor;
  IF recovery_email IS NULL OR recovery_email !~ '^[a-z0-9._+-]+@([a-z0-9-]+\.)*invalid$' THEN
    RAISE EXCEPTION 'SYNTHETIC_IDENTITY_REQUIRED';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organization_members WHERE org_id=p_org AND user_id=p_recovery_actor
      AND status='active' AND disabled_at IS NULL AND deleted_at IS NULL)
    OR NOT EXISTS (SELECT 1 FROM public.workspace_memberships WHERE org_id=p_org AND workspace_id=p_workspace
      AND user_id=p_recovery_actor AND status='active' AND disabled_at IS NULL AND deleted_at IS NULL)
    OR EXISTS (SELECT 1 FROM public.organization_members WHERE user_id=p_recovery_actor AND org_id<>p_org
      AND status='active' AND disabled_at IS NULL AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'RECOVERY_OPERATOR_AUTHORITY_INVALID';
  END IF;
  INSERT INTO public.roles(org_id,name,slug,scope,permissions,status,is_system,created_by,updated_by)
  VALUES(p_org,'Hosted Recovery Promotion Operator','hosted-recovery-promotion-operator','organization','[]','active',false,p_actor,p_actor)
  ON CONFLICT (org_id,lower(slug)) WHERE scope='organization' AND deleted_at IS NULL AND status='active'
  DO UPDATE SET status='active',updated_by=excluded.updated_by,updated_at=statement_timestamp()
  RETURNING id INTO recovery_role;
  INSERT INTO public.role_capabilities(role_id,capability_key)
  SELECT recovery_role,capability_key FROM public.capabilities
  WHERE capability_key IN ('operations.read','release.promote') ON CONFLICT DO NOTHING;
  DELETE FROM public.role_capabilities WHERE role_id=recovery_role
    AND capability_key NOT IN ('operations.read','release.promote');
  UPDATE public.organization_members SET role_id=recovery_role,updated_by=p_actor,updated_at=statement_timestamp()
  WHERE org_id=p_org AND user_id=p_recovery_actor;
  INSERT INTO public.hosted_pilot_recovery_operators(org_id,workspace_id,actor_id,provisioned_by,role_id)
  VALUES(p_org,p_workspace,p_recovery_actor,p_actor,recovery_role)
  ON CONFLICT(org_id,workspace_id,actor_id) DO UPDATE SET provisioned_by=excluded.provisioned_by,
    role_id=excluded.role_id,lifecycle='active';
  RETURN jsonb_build_object('actorId',p_recovery_actor,'syntheticOnly',true,
    'capabilities',jsonb_build_array('operations.read','release.promote'),
    'approvalAuthority',false,'productionAuthorized',false,'customerDataAuthorized',false,
    'realProviderCallsAuthorized',false);
END$$;
REVOKE ALL ON FUNCTION public.hosted_pilot_provision_recovery_operator(uuid,uuid,uuid,bigint,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.hosted_pilot_provision_recovery_operator(uuid,uuid,uuid,bigint,uuid) TO service_role;

ALTER TABLE public.hosted_pilot_environment_identity DROP CONSTRAINT hosted_pilot_environment_identity_migration_tip_check;
UPDATE public.hosted_pilot_environment_identity SET migration_tip='20260811140000' WHERE singleton;
ALTER TABLE public.hosted_pilot_environment_identity ADD CONSTRAINT hosted_pilot_environment_identity_migration_tip_check CHECK(migration_tip='20260811140000');

CREATE OR REPLACE FUNCTION public.hosted_pilot_bootstrap_synthetic(
  p_actor uuid,p_org uuid,p_workspace uuid,p_authorization_version bigint,p_operation text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE lifecycle_value text; subject_count integer;
BEGIN
  PERFORM public.pr1b_assert_command_authority(p_actor,p_org,p_workspace,'org.admin',p_authorization_version);
  IF NOT EXISTS (SELECT 1 FROM public.hosted_pilot_environment_identity WHERE singleton AND product_key='avalaos-core'
    AND environment_class='hosted_nonproduction_pilot' AND migration_tip='20260811140000'
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
