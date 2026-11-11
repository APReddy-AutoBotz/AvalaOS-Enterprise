-- The two read-model RPCs revalidate authorization through a row-locking
-- authority function. PostgreSQL must therefore execute them as VOLATILE;
-- their bodies, ownership, grants, security and search path stay unchanged.
DO $projection_rpc_volatility_authority$
DECLARE
  marker public.hosted_pilot_environment_identity;
  marker_count bigint;
  exercise_count bigint;
  recovery_count bigint;
  old_constraint_expression text;
  changed_count bigint;
  delivery_oid oid;
  monitor_oid oid;
  delivery_before pg_catalog.pg_proc%ROWTYPE;
  delivery_after pg_catalog.pg_proc%ROWTYPE;
  monitor_before pg_catalog.pg_proc%ROWTYPE;
  monitor_after pg_catalog.pg_proc%ROWTYPE;
  delivery_body_hash text;
  monitor_body_hash text;
  delivery_acl_count bigint;
  monitor_acl_count bigint;
BEGIN
  LOCK TABLE public.hosted_pilot_environment_identity IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.pr_c_controlled_human_exercises,
    public.pr_c_controlled_human_recovery_authorities IN SHARE MODE;

  SELECT count(*) INTO marker_count
  FROM public.hosted_pilot_environment_identity;
  SELECT * INTO marker
  FROM public.hosted_pilot_environment_identity stored
  WHERE stored.singleton IS TRUE
  FOR UPDATE;
  IF marker_count <> 1
     OR marker.singleton IS DISTINCT FROM TRUE
     OR marker.product_key <> 'avalaos-core'
     OR marker.environment_class <> 'hosted_nonproduction_pilot'
     OR marker.schema_contract <> 'hosted-pilot-2026-08'
     OR marker.migration_tip <> '20260916181916'
     OR marker.production_authorized
     OR marker.customer_data_authorized
     OR marker.real_provider_calls_authorized THEN
    RAISE EXCEPTION 'PROJECTION_RPC_VOLATILITY_PRECONDITION_FAILED';
  END IF;

  SELECT pg_catalog.pg_get_expr(constraint_row.conbin, constraint_row.conrelid, false)
  INTO old_constraint_expression
  FROM pg_catalog.pg_constraint constraint_row
  WHERE constraint_row.conrelid = 'public.hosted_pilot_environment_identity'::regclass
    AND constraint_row.conname = 'hosted_pilot_environment_identity_migration_tip_check'
    AND constraint_row.contype = 'c'
    AND constraint_row.convalidated;
  IF old_constraint_expression IS DISTINCT FROM '(migration_tip = ''20260916181916''::text)' THEN
    RAISE EXCEPTION 'PROJECTION_RPC_VOLATILITY_PRECONDITION_FAILED';
  END IF;

  SELECT count(*) INTO exercise_count FROM public.pr_c_controlled_human_exercises;
  SELECT count(*) INTO recovery_count FROM public.pr_c_controlled_human_recovery_authorities;
  IF exercise_count <> 0 OR recovery_count <> 0 THEN
    -- Preserve the single prior deprovisioned exercise and its exact recovery
    -- receipts; all live, unbound, or differently staged history still fails.
    IF exercise_count <> 1 OR recovery_count <> 4 OR NOT EXISTS (
      SELECT 1 FROM public.pr_c_controlled_human_exercises historical
      WHERE historical.lifecycle = 'deprovisioned'
        AND historical.migration_tip = '20260904120000'
        AND historical.synthetic_only
        AND NOT historical.production_authorized
        AND NOT historical.customer_data_authorized
        AND NOT historical.real_provider_calls_authorized
        AND (
          SELECT count(*) FROM public.pr_c_controlled_human_recovery_authorities recovery
          WHERE recovery.exercise_digest = historical.exercise_digest
            AND recovery.release_sha = historical.release_sha
            AND recovery.deploy_id = historical.deploy_id
            AND recovery.target_fingerprint = historical.target_fingerprint
            AND (recovery.operation <> 'apply' OR cardinality(recovery.auth_user_ids) = 12)
            AND ((recovery.operation IN ('apply','quiesce','deprovision') AND recovery.state = 'completed')
              OR (recovery.operation = 'abort' AND recovery.state = 'prepared'))
        ) = 4
    ) THEN
      RAISE EXCEPTION 'PROJECTION_RPC_VOLATILITY_PRECONDITION_FAILED';
    END IF;
  END IF;

  delivery_oid := pg_catalog.to_regprocedure(
    'public.enterprise_delivery_workspace_projection(uuid,uuid,jsonb)'
  );
  monitor_oid := pg_catalog.to_regprocedure(
    'public.enterprise_monitor_approved_baselines_projection(uuid,uuid,jsonb)'
  );
  IF delivery_oid IS NULL OR monitor_oid IS NULL OR delivery_oid = monitor_oid THEN
    RAISE EXCEPTION 'PROJECTION_RPC_VOLATILITY_PRECONDITION_FAILED';
  END IF;

  SELECT function_row.* INTO delivery_before
  FROM pg_catalog.pg_proc function_row
  WHERE function_row.oid = delivery_oid;
  SELECT function_row.* INTO monitor_before
  FROM pg_catalog.pg_proc function_row
  WHERE function_row.oid = monitor_oid;

  delivery_body_hash := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    pg_catalog.replace(delivery_before.prosrc, E'\r\n', E'\n'), 'UTF8'
  )), 'hex');
  monitor_body_hash := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    pg_catalog.replace(monitor_before.prosrc, E'\r\n', E'\n'), 'UTF8'
  )), 'hex');
  SELECT count(*) INTO delivery_acl_count
  FROM pg_catalog.aclexplode(delivery_before.proacl) acl
  WHERE acl.privilege_type = 'EXECUTE'
    AND NOT acl.is_grantable
    AND acl.grantee IN (
      delivery_before.proowner,
      'authenticated'::regrole::oid,
      'service_role'::regrole::oid
    );
  SELECT count(*) INTO monitor_acl_count
  FROM pg_catalog.aclexplode(monitor_before.proacl) acl
  WHERE acl.privilege_type = 'EXECUTE'
    AND NOT acl.is_grantable
    AND acl.grantee IN (
      monitor_before.proowner,
      'authenticated'::regrole::oid,
      'service_role'::regrole::oid
    );

  IF delivery_before.oid IS DISTINCT FROM delivery_oid
     OR delivery_before.proowner <> 'postgres'::regrole
     OR delivery_before.prokind <> 'f'
     OR delivery_before.prorettype <> 'pg_catalog.jsonb'::regtype
     OR delivery_before.pronargs <> 3
     OR delivery_before.proargtypes <> '2950 2950 3802'::pg_catalog.oidvector
     OR delivery_before.proargnames IS DISTINCT FROM ARRAY['p_org','p_workspace','p_query']::text[]
     OR delivery_before.prosecdef IS FALSE
     OR delivery_before.proleakproof
     OR delivery_before.proisstrict
     OR delivery_before.provolatile <> 's'
     OR delivery_before.proparallel <> 'u'
     OR delivery_before.prolang <> (
       SELECT language_row.oid FROM pg_catalog.pg_language language_row
       WHERE language_row.lanname = 'plpgsql'
     )
     OR delivery_before.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
     OR delivery_before.proacl IS NULL
     OR delivery_acl_count <> 3
     OR pg_catalog.cardinality(delivery_before.proacl) <> 3
     OR delivery_body_hash IS DISTINCT FROM '5e5f103ab825a120fb97b22a31f06d99323d735fc99b26053a91098a99076068' THEN
    RAISE EXCEPTION 'PROJECTION_RPC_VOLATILITY_PRECONDITION_FAILED';
  END IF;
  IF monitor_before.oid IS DISTINCT FROM monitor_oid
     OR monitor_before.proowner <> 'postgres'::regrole
     OR monitor_before.prokind <> 'f'
     OR monitor_before.prorettype <> 'pg_catalog.jsonb'::regtype
     OR monitor_before.pronargs <> 3
     OR monitor_before.proargtypes <> '2950 2950 3802'::pg_catalog.oidvector
     OR monitor_before.proargnames IS DISTINCT FROM ARRAY['p_org','p_workspace','p_query']::text[]
     OR monitor_before.prosecdef IS FALSE
     OR monitor_before.proleakproof
     OR monitor_before.proisstrict
     OR monitor_before.provolatile <> 's'
     OR monitor_before.proparallel <> 'u'
     OR monitor_before.prolang <> (
       SELECT language_row.oid FROM pg_catalog.pg_language language_row
       WHERE language_row.lanname = 'plpgsql'
     )
     OR monitor_before.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
     OR monitor_before.proacl IS NULL
     OR monitor_acl_count <> 3
     OR pg_catalog.cardinality(monitor_before.proacl) <> 3
     OR monitor_body_hash IS DISTINCT FROM '16d0e6206cacff577253c75f8d0b3f1d43ba05d4030e81c6bcde66a127580a80' THEN
    RAISE EXCEPTION 'PROJECTION_RPC_VOLATILITY_PRECONDITION_FAILED';
  END IF;

  ALTER FUNCTION public.enterprise_delivery_workspace_projection(uuid,uuid,jsonb) VOLATILE;
  ALTER FUNCTION public.enterprise_monitor_approved_baselines_projection(uuid,uuid,jsonb) VOLATILE;

  SELECT function_row.* INTO delivery_after
  FROM pg_catalog.pg_proc function_row
  WHERE function_row.oid = delivery_oid;
  SELECT function_row.* INTO monitor_after
  FROM pg_catalog.pg_proc function_row
  WHERE function_row.oid = monitor_oid;
  IF delivery_after.provolatile <> 'v'
     OR monitor_after.provolatile <> 'v'
     OR (pg_catalog.to_jsonb(delivery_after) - 'provolatile')
       IS DISTINCT FROM (pg_catalog.to_jsonb(delivery_before) - 'provolatile')
     OR (pg_catalog.to_jsonb(monitor_after) - 'provolatile')
       IS DISTINCT FROM (pg_catalog.to_jsonb(monitor_before) - 'provolatile') THEN
    RAISE EXCEPTION 'PROJECTION_RPC_VOLATILITY_REPLACEMENT_FAILED';
  END IF;

  ALTER TABLE public.hosted_pilot_environment_identity
    DROP CONSTRAINT hosted_pilot_environment_identity_migration_tip_check;
  UPDATE public.hosted_pilot_environment_identity
  SET migration_tip = '20260916203406'
  WHERE singleton IS TRUE
    AND product_key = 'avalaos-core'
    AND environment_class = 'hosted_nonproduction_pilot'
    AND schema_contract = 'hosted-pilot-2026-08'
    AND migration_tip = '20260916181916'
    AND NOT production_authorized
    AND NOT customer_data_authorized
    AND NOT real_provider_calls_authorized;
  GET DIAGNOSTICS changed_count = ROW_COUNT;
  IF changed_count <> 1 THEN
    RAISE EXCEPTION 'PROJECTION_RPC_VOLATILITY_REPLACEMENT_FAILED';
  END IF;
  ALTER TABLE public.hosted_pilot_environment_identity
    ADD CONSTRAINT hosted_pilot_environment_identity_migration_tip_check
    CHECK (migration_tip = '20260916203406');

  SELECT pg_catalog.pg_get_expr(constraint_row.conbin, constraint_row.conrelid, false)
  INTO old_constraint_expression
  FROM pg_catalog.pg_constraint constraint_row
  WHERE constraint_row.conrelid = 'public.hosted_pilot_environment_identity'::regclass
    AND constraint_row.conname = 'hosted_pilot_environment_identity_migration_tip_check'
    AND constraint_row.contype = 'c'
    AND constraint_row.convalidated;
  IF old_constraint_expression IS DISTINCT FROM '(migration_tip = ''20260916203406''::text)' THEN
    RAISE EXCEPTION 'PROJECTION_RPC_VOLATILITY_REPLACEMENT_FAILED';
  END IF;
END
$projection_rpc_volatility_authority$;
