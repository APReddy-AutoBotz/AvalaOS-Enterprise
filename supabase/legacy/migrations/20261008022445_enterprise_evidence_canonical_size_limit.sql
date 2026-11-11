-- Match the existing application/Edge source limit and advance only reusable
-- current hosted-pilot identity consumers. The single DO statement is atomic:
-- incompatible immutable history or identity drift aborts without rewriting
-- any row, function or constraint.
DO $source_size_limit$
DECLARE marker public.hosted_pilot_environment_identity;
  marker_constraint text;exercise_constraint text;
  final_activation_definition text;bootstrap_definition text;
  assert_marker_definition text;brd_v3_activation_definition text;
  old_not_equal text:='marker.migration_tip<>''20261004112232''';
  new_not_equal text:='marker.migration_tip<>''20261008022445''';
  old_equal text:='marker.migration_tip=''20261004112232''';
  new_equal text:='marker.migration_tip=''20261008022445''';
  old_assert text:='marker.migration_tip = ''20261004112232''';
  new_assert text:='marker.migration_tip = ''20261008022445''';
BEGIN
  LOCK TABLE public.enterprise_evidence_source_versions IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.hosted_pilot_environment_identity IN SHARE ROW EXCLUSIVE MODE;
  SELECT * INTO STRICT marker FROM public.hosted_pilot_environment_identity WHERE singleton FOR UPDATE;
  SELECT pg_get_expr(conbin,conrelid,false) INTO STRICT marker_constraint FROM pg_constraint
    WHERE conrelid='public.hosted_pilot_environment_identity'::regclass
      AND conname='hosted_pilot_environment_identity_migration_tip_check';
  SELECT pg_get_expr(conbin,conrelid,false) INTO STRICT exercise_constraint FROM pg_constraint
    WHERE conrelid='public.pr_c_controlled_human_exercises'::regclass
      AND conname='pr_c_controlled_human_exercises_migration_tip_check';
  SELECT replace(pg_get_functiondef('public.synthetic_ai_campaign_activate_final_continuation(uuid,uuid,uuid,bigint,text,text,uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,integer)'::regprocedure),chr(13)||chr(10),chr(10))
    INTO STRICT final_activation_definition;
  SELECT replace(pg_get_functiondef('public.synthetic_ai_campaign_bootstrap(uuid,uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,uuid,timestamptz)'::regprocedure),chr(13)||chr(10),chr(10))
    INTO STRICT bootstrap_definition;
  SELECT replace(pg_get_functiondef('public.pr_c_controlled_human_assert_marker()'::regprocedure),chr(13)||chr(10),chr(10))
    INTO STRICT assert_marker_definition;
  SELECT replace(pg_get_functiondef('public.synthetic_ai_campaign_activate_brd_v3_quality_validation(uuid,uuid,uuid,bigint,text,text,uuid,uuid,uuid,uuid,uuid,uuid,uuid,bigint,uuid,text,uuid,uuid,uuid,uuid,text,text,integer)'::regprocedure),chr(13)||chr(10),chr(10))
    INTO STRICT brd_v3_activation_definition;
  IF marker.product_key<>'avalaos-core'
    OR marker.environment_class<>'hosted_nonproduction_pilot'
    OR marker.schema_contract<>'hosted-pilot-2026-08'
    OR marker.migration_tip<>'20261004112232'
    OR marker.production_authorized OR marker.customer_data_authorized OR marker.real_provider_calls_authorized
    OR marker_constraint<>'(migration_tip = ''20261004112232''::text)'
    OR exercise_constraint<>'(migration_tip = ANY (ARRAY[''20260904120000''::text, ''20260924113000''::text, ''20260926053818''::text, ''20260928060000''::text, ''20261003015246''::text, ''20261003055918''::text, ''20261003123459''::text, ''20261003150800''::text, ''20261004025101''::text, ''20261004112232''::text]))'
    OR (length(final_activation_definition)-length(replace(final_activation_definition,old_not_equal,'')))/length(old_not_equal)<>1
    OR (length(bootstrap_definition)-length(replace(bootstrap_definition,old_equal,'')))/length(old_equal)<>1
    OR (length(assert_marker_definition)-length(replace(assert_marker_definition,old_assert,'')))/length(old_assert)<>1
    OR (length(brd_v3_activation_definition)-length(replace(brd_v3_activation_definition,old_not_equal,'')))/length(old_not_equal)<>1
    OR EXISTS(SELECT 1 FROM public.pr_c_controlled_human_exercises WHERE lifecycle<>'deprovisioned')
  THEN RAISE EXCEPTION 'ENTERPRISE_SOURCE_SIZE_IDENTITY_SOURCE_MISMATCH';END IF;
  IF EXISTS (
    SELECT 1 FROM public.enterprise_evidence_source_versions
    WHERE content_bytes <= 0 OR content_bytes > 12000000
  ) THEN
    RAISE EXCEPTION 'ENTERPRISE_SOURCE_SIZE_HISTORY_REQUIRES_REVIEW';
  END IF;

  -- The Enterprise Intelligence Edge command boundary performs its final
  -- current-version authority check through this existing server function.
  -- Keep browser roles denied while making that exact check callable by the
  -- server-held service role. This changes no function body or capability.
  REVOKE EXECUTE ON FUNCTION public.pr1b_assert_command_authority(uuid,uuid,uuid,text,bigint)
    FROM PUBLIC,anon,authenticated;
  GRANT EXECUTE ON FUNCTION public.pr1b_assert_command_authority(uuid,uuid,uuid,text,bigint)
    TO service_role;

  ALTER TABLE public.enterprise_evidence_source_versions
    ADD CONSTRAINT enterprise_evidence_source_versions_size_limit_check
    CHECK (content_bytes > 0 AND content_bytes <= 12000000);
  ALTER TABLE public.enterprise_evidence_source_versions
    DROP CONSTRAINT enterprise_evidence_source_versions_content_bytes_check;
  EXECUTE replace(final_activation_definition,old_not_equal,new_not_equal);
  EXECUTE replace(bootstrap_definition,old_equal,new_equal);
  EXECUTE replace(assert_marker_definition,old_assert,new_assert);
  EXECUTE replace(brd_v3_activation_definition,old_not_equal,new_not_equal);
  ALTER TABLE public.pr_c_controlled_human_exercises
    DROP CONSTRAINT pr_c_controlled_human_exercises_migration_tip_check;
  ALTER TABLE public.pr_c_controlled_human_exercises
    ADD CONSTRAINT pr_c_controlled_human_exercises_migration_tip_check
    CHECK(migration_tip IN('20260904120000','20260924113000','20260926053818','20260928060000','20261003015246','20261003055918','20261003123459','20261003150800','20261004025101','20261004112232','20261008022445'));
  ALTER TABLE public.hosted_pilot_environment_identity
    DROP CONSTRAINT hosted_pilot_environment_identity_migration_tip_check;
  UPDATE public.hosted_pilot_environment_identity SET migration_tip='20261008022445' WHERE singleton;
  ALTER TABLE public.hosted_pilot_environment_identity
    ADD CONSTRAINT hosted_pilot_environment_identity_migration_tip_check
    CHECK(migration_tip='20261008022445');
END
$source_size_limit$;
