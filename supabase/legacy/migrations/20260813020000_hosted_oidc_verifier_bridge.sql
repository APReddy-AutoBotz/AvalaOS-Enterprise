-- Credentialless GitHub OIDC -> Supabase hosted-pilot verification bridge.
-- GitHub never receives a database password. Only service_role may invoke these
-- narrowly scoped SECURITY DEFINER routines, and the Edge Function verifies the
-- signed GitHub OIDC identity before using service_role.

CREATE OR REPLACE FUNCTION public.hosted_pilot_oidc_preflight(
  p_expected_target_fingerprint text,
  p_expected_migration_count bigint,
  p_expected_ledger_digest text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  actual_target_fingerprint text;
  actual_migration_count bigint;
  actual_ledger_digest text;
  actual_tip text;
  authority_table_count bigint;
  authority_violation_count bigint;
  evidence_service_mutation_count bigint;
  service_routine_count bigint;
  service_routine_violation_count bigint;
  expected_authority_tables constant text[] := ARRAY[
    'hosted_pilot_environment_identity',
    'hosted_pilot_exercise_evidence_families',
    'hosted_pilot_provider_simulations',
    'hosted_pilot_recovery_operators',
    'hosted_pilot_synthetic_subjects',
    'hosted_pilot_verification_run_results',
    'pilot_operations_audit_events',
    'pilot_operations_candidate_history',
    'pilot_operations_candidate_sequences',
    'pilot_operations_command_receipts',
    'pilot_operations_environments',
    'pilot_operations_evidence_manifests',
    'pilot_operations_promotion_history',
    'pilot_operations_promotion_sequences',
    'pilot_operations_recovery_drills',
    'pilot_operations_recovery_evidence_ingestions',
    'pilot_operations_release_candidates',
    'pilot_operations_release_events',
    'pilot_operations_rollback_events',
    'pilot_operations_tenant_rebind_results'
  ]::text[];
  expected_service_routines constant text[] := ARRAY[
    'hosted_pilot_bootstrap_synthetic(uuid,uuid,uuid,bigint,text)',
    'hosted_pilot_simulate_provider(uuid,uuid,uuid,bigint,text,text,text)',
    'hosted_pilot_provision_recovery_operator(uuid,uuid,uuid,bigint,uuid)',
    'hosted_pilot_record_verification_result(uuid,uuid,uuid,text,text,text,bigint,text,text,uuid,bigint)',
    'pilot_operations_command(uuid,uuid,uuid,text,uuid,text,text,bigint,bigint,jsonb)',
    'pilot_operations_ingest_recovery_evidence(uuid,uuid,uuid,text,text,text,text,text,text,uuid)',
    'pilot_operations_projection(uuid,uuid,uuid,bigint)',
    'hosted_pilot_oidc_preflight(text,bigint,text)',
    'hosted_pilot_oidc_status(uuid,uuid,uuid,text,text,text,bigint,text,text,bigint,text)',
    'hosted_pilot_oidc_finalize(uuid,uuid,uuid,text,text,text,bigint,text,text,uuid,bigint,bigint,text)'
  ]::text[];
BEGIN
  IF p_expected_target_fingerprint IS NULL OR p_expected_target_fingerprint !~ '^sha256:[0-9a-f]{64}$'
    OR p_expected_migration_count IS NULL OR p_expected_migration_count < 1
    OR p_expected_ledger_digest IS NULL OR p_expected_ledger_digest !~ '^sha256:[0-9a-f]{64}$'
  THEN RAISE EXCEPTION 'HOSTED_OIDC_PREFLIGHT_INPUT_INVALID'; END IF;

  actual_tip := public.hosted_pilot_assert_current_identity();
  actual_target_fingerprint := 'sha256:' || encode(
    extensions.digest(
      convert_to((SELECT system_identifier::text FROM pg_control_system()),'UTF8') || decode('00','hex') ||
      convert_to(current_database(),'UTF8') || decode('00','hex') || convert_to(current_user,'UTF8'),
      'sha256'
    ), 'hex'
  );
  IF actual_target_fingerprint <> p_expected_target_fingerprint
    THEN RAISE EXCEPTION 'HOSTED_PILOT_TARGET_FINGERPRINT_MISMATCH'; END IF;

  SELECT count(*)::bigint,
    'sha256:' || encode(extensions.digest(convert_to(coalesce(string_agg(filename || ':' || content_sha256, E'\n' ORDER BY filename),''),'UTF8'),'sha256'),'hex')
    INTO actual_migration_count,actual_ledger_digest
    FROM avalaos_migrations.applied;
  IF actual_migration_count <> p_expected_migration_count OR actual_ledger_digest <> p_expected_ledger_digest
    THEN RAISE EXCEPTION 'HOSTED_PILOT_MIGRATION_LEDGER_MISMATCH'; END IF;

  SELECT count(*)::bigint,
    count(*) FILTER (WHERE owner.rolname <> 'postgres' OR NOT c.relrowsecurity OR NOT c.relforcerowsecurity
      OR EXISTS (SELECT 1 FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl
        WHERE acl.grantee=0 AND acl.privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'))
      OR has_table_privilege('anon',c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      OR has_table_privilege('authenticated',c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))::bigint
    INTO authority_table_count,authority_violation_count
    FROM pg_class c JOIN pg_roles owner ON owner.oid=c.relowner
    WHERE c.relnamespace='public'::regnamespace AND c.relkind IN ('r','p') AND c.relname=ANY(expected_authority_tables);
  IF authority_table_count <> cardinality(expected_authority_tables) OR authority_violation_count <> 0
    THEN RAISE EXCEPTION 'HOSTED_PILOT_AUTHORITY_TABLE_MISMATCH'; END IF;

  SELECT count(*) FILTER (WHERE has_table_privilege('service_role',c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))::bigint
    INTO evidence_service_mutation_count FROM pg_class c
    WHERE c.relnamespace='public'::regnamespace AND c.relname IN ('hosted_pilot_exercise_evidence_families','hosted_pilot_verification_run_results');
  IF evidence_service_mutation_count <> 0 THEN RAISE EXCEPTION 'HOSTED_PILOT_EVIDENCE_TABLE_ACL_MISMATCH'; END IF;

  -- Re-check the exact privileged RPC authority in the connected target. Static
  -- source tests are not sufficient here: any PUBLIC/browser execution drift or
  -- unsafe SECURITY DEFINER/search_path drift blocks hosted finalization.
  SELECT count(*)::bigint,
    count(*) FILTER (WHERE owner.rolname <> 'postgres' OR NOT p.prosecdef
      OR NOT (coalesce(p.proconfig @> ARRAY['search_path=pg_catalog']::text[],false)
        OR coalesce(p.proconfig @> ARRAY['search_path=pg_catalog, public']::text[],false))
      OR EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
        WHERE acl.grantee=0 AND acl.privilege_type='EXECUTE')
      OR has_function_privilege('anon',p.oid,'EXECUTE')
      OR has_function_privilege('authenticated',p.oid,'EXECUTE')
      OR NOT has_function_privilege('service_role',p.oid,'EXECUTE'))::bigint
    INTO service_routine_count,service_routine_violation_count
    FROM pg_proc p JOIN pg_roles owner ON owner.oid=p.proowner
    WHERE p.pronamespace='public'::regnamespace
      AND (p.proname || '(' || replace(oidvectortypes(p.proargtypes),' ','') || ')')=ANY(expected_service_routines);
  IF service_routine_count <> cardinality(expected_service_routines) OR service_routine_violation_count <> 0
    THEN RAISE EXCEPTION 'HOSTED_PILOT_RPC_ACL_MISMATCH'; END IF;

  RETURN jsonb_build_object(
    'status','passed','targetFingerprint',actual_target_fingerprint,'migrationTip',actual_tip,
    'migrationCount',actual_migration_count,'ledgerDigest',actual_ledger_digest,
    'authorityTableCount',authority_table_count,'serviceRoutineCount',service_routine_count,
    'browserTableAuthority',false,'browserServiceRpcAuthority',false,
    'serviceRoleEvidenceMutationAuthority',false,'productionAuthorized',false
  );
END
$function$;

CREATE OR REPLACE FUNCTION public.hosted_pilot_oidc_status(
  p_org uuid,
  p_workspace uuid,
  p_exercise_run uuid,
  p_release_sha text,
  p_producer_workflow_path text,
  p_producer_run_id text,
  p_producer_run_attempt bigint,
  p_target_fingerprint text,
  p_deployment_fingerprint text,
  p_expected_migration_count bigint,
  p_expected_ledger_digest text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  preflight jsonb;
  families text[];
  family_count bigint;
  result_count bigint;
BEGIN
  preflight := public.hosted_pilot_oidc_preflight(p_target_fingerprint,p_expected_migration_count,p_expected_ledger_digest);
  IF p_org IS NULL OR p_workspace IS NULL OR p_exercise_run IS NULL
    OR p_release_sha IS NULL OR p_release_sha !~ '^[0-9a-f]{40}$'
    OR p_producer_workflow_path IS DISTINCT FROM '.github/workflows/hosted-pilot-activation-evidence-producer.yml'
    OR p_producer_run_id IS NULL OR p_producer_run_id !~ '^[1-9][0-9]{0,19}$'
    OR p_producer_run_attempt IS NULL OR p_producer_run_attempt < 1
    OR p_deployment_fingerprint IS NULL OR p_deployment_fingerprint !~ '^sha256:[0-9a-f]{64}$'
  THEN RAISE EXCEPTION 'HOSTED_OIDC_STATUS_INPUT_INVALID'; END IF;

  SELECT coalesce(array_agg(evidence_family ORDER BY evidence_family),ARRAY[]::text[]),count(*)::bigint
    INTO families,family_count
    FROM public.hosted_pilot_exercise_evidence_families
    WHERE org_id=p_org AND workspace_id=p_workspace AND exercise_run_id=p_exercise_run
      AND release_sha=p_release_sha AND producer_workflow_path=p_producer_workflow_path
      AND producer_run_id=p_producer_run_id AND producer_run_attempt=p_producer_run_attempt
      AND target_fingerprint=p_target_fingerprint AND deployment_fingerprint=p_deployment_fingerprint
      AND hosted_target='hosted_nonproduction_pilot' AND disposition='executed_hosted_evidence';

  SELECT count(*)::bigint INTO result_count FROM public.hosted_pilot_verification_run_results
    WHERE org_id=p_org AND workspace_id=p_workspace AND exercise_run_id=p_exercise_run
      AND release_sha=p_release_sha AND producer_workflow_path=p_producer_workflow_path
      AND producer_run_id=p_producer_run_id AND producer_run_attempt=p_producer_run_attempt
      AND target_fingerprint=p_target_fingerprint AND deployment_fingerprint=p_deployment_fingerprint;

  RETURN jsonb_build_object('status','waiting','evidenceFamilyCount',family_count,'evidenceFamilies',to_jsonb(families),
    'verificationResultCount',result_count,'preflight',preflight,'productionAuthorized',false);
END
$function$;

CREATE OR REPLACE FUNCTION public.hosted_pilot_oidc_finalize(
  p_org uuid,
  p_workspace uuid,
  p_exercise_run uuid,
  p_release_sha text,
  p_producer_workflow_path text,
  p_producer_run_id text,
  p_producer_run_attempt bigint,
  p_target_fingerprint text,
  p_deployment_fingerprint text,
  p_recovery_actor uuid,
  p_recovery_authorization_version bigint,
  p_expected_migration_count bigint,
  p_expected_ledger_digest text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  preflight jsonb;
  recorded jsonb;
  exact_result_count bigint;
BEGIN
  preflight := public.hosted_pilot_oidc_preflight(p_target_fingerprint,p_expected_migration_count,p_expected_ledger_digest);
  IF NOT EXISTS (SELECT 1 FROM public.pilot_operations_environments
    WHERE org_id=p_org AND workspace_id=p_workspace AND maintenance AND read_only AND lifecycle='configured')
    THEN RAISE EXCEPTION 'HOSTED_PILOT_NOT_FAIL_CLOSED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.pilot_operations_recovery_evidence_ingestions
    WHERE org_id=p_org AND workspace_id=p_workspace AND workflow_name='Pilot Operations' AND workflow_head_sha=p_release_sha)
    THEN RAISE EXCEPTION 'HOSTED_PILOT_RECOVERY_EVIDENCE_MISSING'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.pilot_operations_rollback_events rollback
    JOIN public.pilot_operations_release_candidates candidate ON candidate.id=rollback.from_candidate_id
      AND candidate.org_id=rollback.org_id AND candidate.workspace_id=rollback.workspace_id
    WHERE rollback.org_id=p_org AND rollback.workspace_id=p_workspace AND candidate.git_sha=p_release_sha)
    THEN RAISE EXCEPTION 'HOSTED_PILOT_ROLLBACK_EVIDENCE_MISSING'; END IF;

  recorded := public.hosted_pilot_record_verification_result(p_org,p_workspace,p_exercise_run,p_release_sha,p_producer_workflow_path,
    p_producer_run_id,p_producer_run_attempt,p_target_fingerprint,p_deployment_fingerprint,p_recovery_actor,p_recovery_authorization_version);

  SELECT count(*)::bigint INTO exact_result_count FROM public.hosted_pilot_verification_run_results result
    WHERE result.org_id=p_org AND result.workspace_id=p_workspace AND result.exercise_run_id=p_exercise_run
      AND result.release_sha=p_release_sha AND result.producer_workflow_path=p_producer_workflow_path
      AND result.producer_run_id=p_producer_run_id AND result.producer_run_attempt=p_producer_run_attempt
      AND result.target_fingerprint=p_target_fingerprint AND result.deployment_fingerprint=p_deployment_fingerprint
      AND result.recovery_actor_id=p_recovery_actor AND result.recovery_authorization_version=p_recovery_authorization_version
      AND result.tenant_adversarial AND result.provider_zero_egress AND result.canonical_journey
      AND result.backup_restore AND result.recovery_rollback
      AND NOT result.production_authorized AND NOT result.customer_data_used AND NOT result.real_provider_calls_used;
  IF exact_result_count <> 1 THEN RAISE EXCEPTION 'HOSTED_PILOT_FINAL_VERIFICATION_MISMATCH'; END IF;

  RETURN jsonb_build_object('status','passed','recording',recorded,'preflight',preflight,
    'exactVerificationResultCount',exact_result_count,'productionAuthorized',false);
END
$function$;

REVOKE ALL ON FUNCTION public.hosted_pilot_oidc_preflight(text,bigint,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.hosted_pilot_oidc_status(uuid,uuid,uuid,text,text,text,bigint,text,text,bigint,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.hosted_pilot_oidc_finalize(uuid,uuid,uuid,text,text,text,bigint,text,text,uuid,bigint,bigint,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.hosted_pilot_oidc_preflight(text,bigint,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.hosted_pilot_oidc_status(uuid,uuid,uuid,text,text,text,bigint,text,text,bigint,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.hosted_pilot_oidc_finalize(uuid,uuid,uuid,text,text,text,bigint,text,text,uuid,bigint,bigint,text) TO service_role;

ALTER TABLE public.hosted_pilot_environment_identity
  DROP CONSTRAINT hosted_pilot_environment_identity_migration_tip_check;
UPDATE public.hosted_pilot_environment_identity SET migration_tip='20260813020000' WHERE singleton;
ALTER TABLE public.hosted_pilot_environment_identity
  ADD CONSTRAINT hosted_pilot_environment_identity_migration_tip_check CHECK(migration_tip='20260813020000');
