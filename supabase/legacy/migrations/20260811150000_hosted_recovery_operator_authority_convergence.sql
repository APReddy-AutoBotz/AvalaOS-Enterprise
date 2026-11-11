-- Hosted recovery authority convergence: exact-workspace, active provisioning, and rollback fencing.
-- Forward-only and non-production; historical migration state is intentionally preserved.

-- Serialize provisioning with rollback for the same tenant/workspace. Replace broad
-- organization authority with a capability-free identity role and an exact-workspace role.
CREATE OR REPLACE FUNCTION public.hosted_pilot_provision_recovery_operator(
  p_actor uuid,p_org uuid,p_workspace uuid,p_authorization_version bigint,p_recovery_actor uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE recovery_role uuid; identity_role uuid; recovery_email text;
BEGIN
  PERFORM public.pr1b_assert_command_authority(p_actor,p_org,p_workspace,'org.admin',p_authorization_version);
  IF p_recovery_actor=p_actor THEN RAISE EXCEPTION 'SEPARATION_OF_DUTY_REQUIRED'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('hosted-recovery:'||p_org::text||':'||p_workspace::text,0));
  IF NOT EXISTS (SELECT 1 FROM public.hosted_pilot_environment_identity WHERE singleton
    AND migration_tip='20260811150000' AND environment_class='hosted_nonproduction_pilot'
    AND NOT production_authorized AND NOT customer_data_authorized AND NOT real_provider_calls_authorized) THEN
    RAISE EXCEPTION 'HOSTED_PILOT_IDENTITY_MISMATCH';
  END IF;
  SELECT lower(email) INTO recovery_email FROM public.profiles
   WHERE id=p_recovery_actor AND status='active' AND deleted_at IS NULL FOR UPDATE;
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
  VALUES(p_org,'Hosted Recovery Identity','hosted-recovery-identity','organization','[]','active',false,p_actor,p_actor)
  ON CONFLICT (org_id,lower(slug)) WHERE scope='organization' AND deleted_at IS NULL AND status='active'
  DO UPDATE SET updated_by=excluded.updated_by,updated_at=statement_timestamp() RETURNING id INTO identity_role;
  DELETE FROM public.role_capabilities WHERE role_id=identity_role;
  INSERT INTO public.roles(org_id,workspace_id,name,slug,scope,permissions,status,is_system,created_by,updated_by)
  VALUES(p_org,p_workspace,'Hosted Recovery Promotion Operator','hosted-recovery-promotion-operator','workspace','[]','active',false,p_actor,p_actor)
  ON CONFLICT (workspace_id,lower(slug)) WHERE scope='workspace' AND deleted_at IS NULL AND status='active'
  DO UPDATE SET updated_by=excluded.updated_by,updated_at=statement_timestamp() RETURNING id INTO recovery_role;
  DELETE FROM public.role_capabilities WHERE role_id=recovery_role;
  INSERT INTO public.role_capabilities(role_id,capability_key)
  SELECT recovery_role,capability_key FROM public.capabilities
   WHERE capability_key IN ('operations.read','release.promote') ON CONFLICT DO NOTHING;
  UPDATE public.organization_members SET role_id=identity_role,updated_by=p_actor,updated_at=statement_timestamp()
   WHERE org_id=p_org AND user_id=p_recovery_actor;
  UPDATE public.workspace_memberships SET role_id=recovery_role,updated_by=p_actor,updated_at=statement_timestamp()
   WHERE org_id=p_org AND workspace_id=p_workspace AND user_id=p_recovery_actor;
  IF EXISTS (
    SELECT 1 FROM public.role_capabilities rc
    JOIN public.organization_members om ON om.role_id=rc.role_id
    WHERE om.org_id=p_org AND om.user_id=p_recovery_actor AND rc.capability_key NOT IN ('operations.read','release.promote')
    UNION ALL
    SELECT 1 FROM public.role_capabilities rc
    JOIN public.workspace_memberships wm ON wm.role_id=rc.role_id
    WHERE wm.org_id=p_org AND wm.workspace_id=p_workspace AND wm.user_id=p_recovery_actor
      AND rc.capability_key NOT IN ('operations.read','release.promote')
  ) THEN RAISE EXCEPTION 'RECOVERY_OPERATOR_AUTHORITY_INVALID'; END IF;
  INSERT INTO public.hosted_pilot_recovery_operators(org_id,workspace_id,actor_id,provisioned_by,role_id)
  VALUES(p_org,p_workspace,p_recovery_actor,p_actor,recovery_role)
  ON CONFLICT(org_id,workspace_id,actor_id) DO UPDATE SET provisioned_by=excluded.provisioned_by,
    role_id=excluded.role_id,lifecycle='active';
  RETURN jsonb_build_object('actorId',p_recovery_actor,'workspaceId',p_workspace,'syntheticOnly',true,
    'capabilities',jsonb_build_array('operations.read','release.promote'),'approvalAuthority',false,
    'productionAuthorized',false,'customerDataAuthorized',false,'realProviderCallsAuthorized',false);
END$$;
REVOKE ALL ON FUNCTION public.hosted_pilot_provision_recovery_operator(uuid,uuid,uuid,bigint,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.hosted_pilot_provision_recovery_operator(uuid,uuid,uuid,bigint,uuid) TO service_role;

-- Gate rollback before the delegated implementation can inspect receipts or mutate lifecycle.
ALTER FUNCTION public.pilot_operations_command(uuid,uuid,uuid,text,uuid,text,text,bigint,bigint,jsonb)
  RENAME TO pilot_operations_command_v7;
REVOKE ALL ON FUNCTION public.pilot_operations_command_v7(uuid,uuid,uuid,text,uuid,text,text,bigint,bigint,jsonb)
  FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.pilot_operations_command(
  p_actor uuid,p_org uuid,p_workspace uuid,p_operation text,p_request uuid,p_idempotency_key text,
  p_request_payload text,p_authorization_version bigint,p_expected_version bigint,p_payload jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE operator_record public.hosted_pilot_recovery_operators;
BEGIN
  IF p_operation='rollback_non_live_promotion' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('hosted-recovery:'||p_org::text||':'||p_workspace::text,0));
    SELECT * INTO operator_record FROM public.hosted_pilot_recovery_operators
     WHERE org_id=p_org AND workspace_id=p_workspace AND actor_id=p_actor AND lifecycle='active'
       AND synthetic_only AND NOT production_authorized AND NOT customer_data_authorized
       AND NOT real_provider_calls_authorized FOR UPDATE;
    IF operator_record.actor_id IS NULL THEN RAISE EXCEPTION 'PR1B_NOT_FOUND'; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.workspace_memberships wm JOIN public.roles r ON r.id=wm.role_id
      WHERE wm.org_id=p_org AND wm.workspace_id=p_workspace AND wm.user_id=p_actor
        AND wm.status='active' AND wm.disabled_at IS NULL AND wm.deleted_at IS NULL
        AND r.id=operator_record.role_id AND r.scope='workspace' AND r.org_id=p_org
        AND r.workspace_id=p_workspace AND r.status='active' AND r.deleted_at IS NULL
    ) THEN RAISE EXCEPTION 'PR1B_NOT_FOUND'; END IF;
    IF EXISTS (
      SELECT 1 FROM public.role_capabilities rc
      JOIN public.workspace_memberships wm ON wm.role_id=rc.role_id
      WHERE wm.org_id=p_org AND wm.workspace_id=p_workspace AND wm.user_id=p_actor
        AND rc.capability_key NOT IN ('operations.read','release.promote')
      UNION ALL
      SELECT 1 FROM public.role_capabilities rc
      JOIN public.organization_members om ON om.role_id=rc.role_id
      WHERE om.org_id=p_org AND om.user_id=p_actor
    ) OR 2 IS DISTINCT FROM (
      SELECT count(*) FROM public.role_capabilities
      WHERE role_id=operator_record.role_id
        AND capability_key IN ('operations.read','release.promote')
    ) THEN RAISE EXCEPTION 'PR1B_NOT_FOUND'; END IF;
  END IF;
  RETURN public.pilot_operations_command_v7(p_actor,p_org,p_workspace,p_operation,p_request,
    p_idempotency_key,p_request_payload,p_authorization_version,p_expected_version,p_payload);
END$$;
REVOKE ALL ON FUNCTION public.pilot_operations_command(uuid,uuid,uuid,text,uuid,text,text,bigint,bigint,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pilot_operations_command(uuid,uuid,uuid,text,uuid,text,text,bigint,bigint,jsonb) TO service_role;

ALTER TABLE public.hosted_pilot_environment_identity DROP CONSTRAINT hosted_pilot_environment_identity_migration_tip_check;
UPDATE public.hosted_pilot_environment_identity SET migration_tip='20260811150000' WHERE singleton;
ALTER TABLE public.hosted_pilot_environment_identity ADD CONSTRAINT hosted_pilot_environment_identity_migration_tip_check CHECK(migration_tip='20260811150000');

CREATE OR REPLACE FUNCTION public.hosted_pilot_bootstrap_synthetic(
  p_actor uuid,p_org uuid,p_workspace uuid,p_authorization_version bigint,p_operation text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE lifecycle_value text; subject_count integer;
BEGIN
  PERFORM public.pr1b_assert_command_authority(p_actor,p_org,p_workspace,'org.admin',p_authorization_version);
  IF NOT EXISTS (SELECT 1 FROM public.hosted_pilot_environment_identity WHERE singleton AND product_key='avalaos-core'
    AND environment_class='hosted_nonproduction_pilot' AND migration_tip='20260811150000'
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
