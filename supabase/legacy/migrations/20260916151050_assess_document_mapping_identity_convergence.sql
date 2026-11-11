-- Forward-only identity convergence for the reviewed Assess supporting-document
-- mapping successor. This migration changes no feature defaults, grants, runtime
-- guards, scoring law, controlled-human authority, or provider configuration.
-- Apply this single DO statement transactionally.
DO $assess_mapping_identity$
DECLARE
  marker public.hosted_pilot_environment_identity;
  singleton_count bigint;
  exercise_count bigint;
  recovery_count bigint;
  missing_relation text;
  old_constraint_expression text;
  changed_count bigint;
BEGIN
  -- Serialize marker changes and freeze both history inventories until commit;
  -- a concurrent exercise/recovery insert must not race the empty-state gate.
  LOCK TABLE public.hosted_pilot_environment_identity IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.pr_c_controlled_human_exercises,
    public.pr_c_controlled_human_recovery_authorities IN SHARE MODE;
  SELECT count(*) INTO singleton_count
  FROM public.hosted_pilot_environment_identity;
  IF singleton_count <> 1 THEN
    RAISE EXCEPTION 'ASSESS_MAPPING_IDENTITY_PRECONDITION_FAILED';
  END IF;

  SELECT stored.* INTO STRICT marker
  FROM public.hosted_pilot_environment_identity stored
  WHERE stored.singleton IS TRUE
  FOR UPDATE;

  IF marker.product_key <> 'avalaos-core'
     OR marker.environment_class <> 'hosted_nonproduction_pilot'
     OR marker.schema_contract <> 'hosted-pilot-2026-08'
     OR marker.migration_tip <> '20260916003000'
     OR marker.production_authorized
     OR marker.customer_data_authorized
     OR marker.real_provider_calls_authorized THEN
    RAISE EXCEPTION 'ASSESS_MAPPING_IDENTITY_PRECONDITION_FAILED';
  END IF;

  SELECT pg_catalog.pg_get_expr(constraint_row.conbin, constraint_row.conrelid, false)
  INTO old_constraint_expression
  FROM pg_catalog.pg_constraint constraint_row
  WHERE constraint_row.conrelid = 'public.hosted_pilot_environment_identity'::regclass
    AND constraint_row.conname = 'hosted_pilot_environment_identity_migration_tip_check'
    AND constraint_row.contype = 'c';
  IF old_constraint_expression IS DISTINCT FROM '(migration_tip = ''20260916003000''::text)' THEN
    RAISE EXCEPTION 'ASSESS_MAPPING_IDENTITY_PRECONDITION_FAILED';
  END IF;

  SELECT relation_name INTO missing_relation
  FROM unnest(ARRAY[
    'public.enterprise_assess_document_mapping_catalogs',
    'public.enterprise_assess_document_mapping_targets',
    'public.enterprise_assess_document_mapping_runs',
    'public.enterprise_assess_document_mapping_run_sources',
    'public.enterprise_assess_document_mapping_proposals',
    'public.enterprise_assess_document_mapping_reviews',
    'public.enterprise_assess_document_mapping_preview_batches',
    'public.enterprise_assess_document_mapping_preview_items',
    'public.enterprise_assess_document_mapping_conflicts',
    'public.enterprise_assess_document_mapping_conflict_resolutions',
    'public.enterprise_assess_document_mapping_preview_manifests',
    'public.enterprise_assess_document_mapping_applications'
  ]) relation_name
  WHERE pg_catalog.to_regclass(relation_name) IS NULL
  LIMIT 1;
  IF missing_relation IS NOT NULL
     OR NOT EXISTS(
       SELECT 1 FROM pg_catalog.pg_attribute attribute_row
       WHERE attribute_row.attrelid = 'public.enterprise_transcript_workspace_flags'::regclass
         AND attribute_row.attname = 'assess_document_mapping_enabled'
         AND attribute_row.attnum > 0 AND NOT attribute_row.attisdropped
     )
     OR pg_catalog.to_regprocedure('public.enterprise_commit_assess_document_mapping_preview_v1(uuid,uuid,text,uuid,bigint,uuid,uuid,jsonb,uuid,uuid,uuid,bigint,uuid,uuid,bigint)') IS NULL THEN
    RAISE EXCEPTION 'ASSESS_MAPPING_IDENTITY_PRECONDITION_FAILED';
  END IF;

  SELECT count(*) INTO exercise_count
  FROM public.pr_c_controlled_human_exercises;
  SELECT count(*) INTO recovery_count
  FROM public.pr_c_controlled_human_recovery_authorities;
  IF exercise_count <> 0 OR recovery_count <> 0 THEN
    -- The prior controlled exercise may be retained only after its exact
    -- deprovision receipt. Preserve that immutable history through the chain.
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
      RAISE EXCEPTION 'ASSESS_MAPPING_IDENTITY_PRECONDITION_FAILED';
    END IF;
  END IF;

  ALTER TABLE public.hosted_pilot_environment_identity
    DROP CONSTRAINT hosted_pilot_environment_identity_migration_tip_check;
  UPDATE public.hosted_pilot_environment_identity
  SET migration_tip = '20260916151050'
  WHERE singleton IS TRUE
    AND product_key = 'avalaos-core'
    AND environment_class = 'hosted_nonproduction_pilot'
    AND schema_contract = 'hosted-pilot-2026-08'
    AND migration_tip = '20260916003000'
    AND NOT production_authorized
    AND NOT customer_data_authorized
    AND NOT real_provider_calls_authorized;
  GET DIAGNOSTICS changed_count = ROW_COUNT;
  IF changed_count <> 1 THEN
    RAISE EXCEPTION 'ASSESS_MAPPING_IDENTITY_PRECONDITION_FAILED';
  END IF;
  ALTER TABLE public.hosted_pilot_environment_identity
    ADD CONSTRAINT hosted_pilot_environment_identity_migration_tip_check
    CHECK (migration_tip = '20260916151050');
END
$assess_mapping_identity$;
