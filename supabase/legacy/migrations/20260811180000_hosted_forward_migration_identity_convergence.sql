-- Forward migration identity convergence: operational RPCs trust the DB-owned ledger, not a stale literal tip.
-- Forward-only, synthetic-only, and non-production. Historical migrations remain immutable.

CREATE OR REPLACE FUNCTION public.hosted_pilot_assert_current_identity()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE marker public.hosted_pilot_environment_identity; latest_filename text; latest_tip text;
BEGIN
  SELECT * INTO STRICT marker FROM public.hosted_pilot_environment_identity WHERE singleton;
  SELECT filename INTO latest_filename FROM avalaos_migrations.applied
    WHERE filename ~ '^[0-9]{14}_[a-z0-9_]+[.]sql$' ORDER BY filename DESC LIMIT 1;
  IF latest_filename IS NULL THEN RAISE EXCEPTION 'HOSTED_PILOT_IDENTITY_MISMATCH'; END IF;
  latest_tip := left(latest_filename,14);
  IF marker.product_key<>'avalaos-core' OR marker.environment_class<>'hosted_nonproduction_pilot'
    OR marker.migration_tip<>latest_tip OR marker.production_authorized
    OR marker.customer_data_authorized OR marker.real_provider_calls_authorized
    THEN RAISE EXCEPTION 'HOSTED_PILOT_IDENTITY_MISMATCH'; END IF;
  RETURN latest_tip;
EXCEPTION WHEN no_data_found OR too_many_rows OR undefined_table THEN
  RAISE EXCEPTION 'HOSTED_PILOT_IDENTITY_MISMATCH';
END$$;
REVOKE ALL ON FUNCTION public.hosted_pilot_assert_current_identity() FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.hosted_pilot_provision_recovery_operator(
  p_actor uuid,p_org uuid,p_workspace uuid,p_authorization_version bigint,p_recovery_actor uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE recovery_role uuid; identity_role uuid; recovery_email text;
BEGIN
  PERFORM public.pr1b_assert_command_authority(p_actor,p_org,p_workspace,'org.admin',p_authorization_version);
  IF p_recovery_actor=p_actor THEN RAISE EXCEPTION 'SEPARATION_OF_DUTY_REQUIRED'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('hosted-recovery:'||p_org::text||':'||p_workspace::text,0));
  PERFORM public.hosted_pilot_assert_current_identity();
  SELECT lower(email) INTO recovery_email FROM public.profiles
    WHERE id=p_recovery_actor AND status='active' AND deleted_at IS NULL FOR UPDATE;
  IF recovery_email IS NULL OR recovery_email !~ '^[a-z0-9._+-]+@([a-z0-9-]+\.)*invalid$'
    THEN RAISE EXCEPTION 'SYNTHETIC_IDENTITY_REQUIRED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organization_members WHERE org_id=p_org AND user_id=p_recovery_actor
      AND status='active' AND disabled_at IS NULL AND deleted_at IS NULL)
    OR NOT EXISTS (SELECT 1 FROM public.workspace_memberships WHERE org_id=p_org AND workspace_id=p_workspace
      AND user_id=p_recovery_actor AND status='active' AND disabled_at IS NULL AND deleted_at IS NULL)
    OR EXISTS (SELECT 1 FROM public.organization_members WHERE user_id=p_recovery_actor AND org_id<>p_org
      AND status='active' AND disabled_at IS NULL AND deleted_at IS NULL)
    THEN RAISE EXCEPTION 'RECOVERY_OPERATOR_AUTHORITY_INVALID'; END IF;
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
  -- Fence the prior owner and remove its effective recovery role in the same transaction.
  UPDATE public.workspace_memberships wm SET role_id=NULL,updated_by=p_actor,updated_at=statement_timestamp()
    FROM public.hosted_pilot_recovery_operators old
    WHERE old.org_id=p_org AND old.workspace_id=p_workspace AND old.lifecycle='active'
      AND old.actor_id<>p_recovery_actor AND wm.org_id=old.org_id AND wm.workspace_id=old.workspace_id
      AND wm.user_id=old.actor_id AND wm.role_id=old.role_id;
  UPDATE public.hosted_pilot_recovery_operators SET lifecycle='revoked'
    WHERE org_id=p_org AND workspace_id=p_workspace AND lifecycle='active' AND actor_id<>p_recovery_actor;
  UPDATE public.organization_members SET role_id=identity_role,updated_by=p_actor,updated_at=statement_timestamp()
    WHERE org_id=p_org AND user_id=p_recovery_actor;
  UPDATE public.workspace_memberships SET role_id=recovery_role,updated_by=p_actor,updated_at=statement_timestamp()
    WHERE org_id=p_org AND workspace_id=p_workspace AND user_id=p_recovery_actor;
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


ALTER TABLE public.hosted_pilot_environment_identity DROP CONSTRAINT hosted_pilot_environment_identity_migration_tip_check;
UPDATE public.hosted_pilot_environment_identity SET migration_tip='20260811180000' WHERE singleton;
ALTER TABLE public.hosted_pilot_environment_identity ADD CONSTRAINT hosted_pilot_environment_identity_migration_tip_check CHECK(migration_tip='20260811180000');

CREATE OR REPLACE FUNCTION public.hosted_pilot_bootstrap_synthetic(
  p_actor uuid,p_org uuid,p_workspace uuid,p_authorization_version bigint,p_operation text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE lifecycle_value text; subject_count integer;
BEGIN
  PERFORM public.pr1b_assert_command_authority(p_actor,p_org,p_workspace,'org.admin',p_authorization_version);
  PERFORM public.hosted_pilot_assert_current_identity();
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
