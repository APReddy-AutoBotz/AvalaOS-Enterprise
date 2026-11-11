-- PR C's deferred constraint triggers must execute while the service-only
-- command still holds its SECURITY DEFINER context. Do not grant the API role
-- raw Delivery/Monitor table access or broaden the trigger functions.
DO $pr_c_deferred$
DECLARE
  marker public.hosted_pilot_environment_identity;
  constraint_expression text;
  command_definition text;
  bootstrap_definition text;
  old_anchor text := 'IF result IS NULL OR resource_id IS NULL THEN RAISE EXCEPTION ''COMMAND_RESULT_MISSING''; END IF;';
  new_anchor text := old_anchor || E'\n SET CONSTRAINTS public.enterprise_pr_c_package_binding, public.enterprise_pr_c_item_current_binding, public.enterprise_pr_c_baseline_item_binding, public.enterprise_pr_c_baseline_manifest_binding IMMEDIATE;';
  old_bootstrap text := 'marker.migration_tip=''20260923151115''';
  new_bootstrap text := 'marker.migration_tip=''20260923190853''';
  old_count integer;
  new_count integer;
  old_bootstrap_count integer;
  new_bootstrap_count integer;
BEGIN
  LOCK TABLE public.hosted_pilot_environment_identity IN SHARE ROW EXCLUSIVE MODE;
  SELECT * INTO STRICT marker FROM public.hosted_pilot_environment_identity WHERE singleton FOR UPDATE;
  IF marker.product_key <> 'avalaos-core' OR marker.environment_class <> 'hosted_nonproduction_pilot'
    OR marker.schema_contract <> 'hosted-pilot-2026-08' OR marker.production_authorized
    OR marker.customer_data_authorized OR marker.real_provider_calls_authorized
  THEN RAISE EXCEPTION 'PR_C_DEFERRED_IDENTITY_MISMATCH'; END IF;
  SELECT pg_get_expr(conbin,conrelid,false) INTO STRICT constraint_expression FROM pg_constraint
    WHERE conrelid='public.hosted_pilot_environment_identity'::regclass
      AND conname='hosted_pilot_environment_identity_migration_tip_check';
  IF (SELECT count(*) FROM pg_trigger trigger_row JOIN pg_class relation ON relation.oid=trigger_row.tgrelid
      JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace
      JOIN pg_proc validator ON validator.oid=trigger_row.tgfoid
      WHERE namespace.nspname='public' AND trigger_row.tgname IN
       ('enterprise_pr_c_package_binding','enterprise_pr_c_item_current_binding','enterprise_pr_c_baseline_item_binding','enterprise_pr_c_baseline_manifest_binding')
       AND trigger_row.tgdeferrable AND trigger_row.tginitdeferred AND NOT validator.prosecdef
       AND validator.proconfig @> ARRAY['search_path=pg_catalog']::text[]) <> 4
  THEN RAISE EXCEPTION 'PR_C_DEFERRED_TRIGGER_MISMATCH'; END IF;
  IF NOT (SELECT command.prosecdef AND command.proconfig @> ARRAY['search_path=pg_catalog']::text[]
      AND command.proowner='postgres'::regrole
      FROM pg_proc command WHERE command.oid='public.enterprise_delivery_monitor_command(jsonb)'::regprocedure)
  THEN RAISE EXCEPTION 'PR_C_DEFERRED_COMMAND_OWNER_MISMATCH'; END IF;
  SELECT pg_get_functiondef('public.enterprise_delivery_monitor_command(jsonb)'::regprocedure) INTO STRICT command_definition;
  SELECT pg_get_functiondef('public.synthetic_ai_campaign_bootstrap(uuid,uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,uuid,timestamptz)'::regprocedure)
    INTO STRICT bootstrap_definition;
  old_count := (length(command_definition)-length(replace(command_definition,old_anchor,'')))/length(old_anchor);
  new_count := (length(command_definition)-length(replace(command_definition,new_anchor,'')))/length(new_anchor);
  old_bootstrap_count := (length(bootstrap_definition)-length(replace(bootstrap_definition,old_bootstrap,'')))/length(old_bootstrap);
  new_bootstrap_count := (length(bootstrap_definition)-length(replace(bootstrap_definition,new_bootstrap,'')))/length(new_bootstrap);
  IF marker.migration_tip='20260923151115'
    AND constraint_expression='(migration_tip = ''20260923151115''::text)'
    AND old_count=1 AND new_count=0 AND old_bootstrap_count=1 AND new_bootstrap_count=0
  THEN
    EXECUTE replace(command_definition,old_anchor,new_anchor);
    EXECUTE replace(bootstrap_definition,old_bootstrap,new_bootstrap);
    ALTER TABLE public.hosted_pilot_environment_identity DROP CONSTRAINT hosted_pilot_environment_identity_migration_tip_check;
    UPDATE public.hosted_pilot_environment_identity SET migration_tip='20260923190853' WHERE singleton;
    ALTER TABLE public.hosted_pilot_environment_identity ADD CONSTRAINT hosted_pilot_environment_identity_migration_tip_check
      CHECK (migration_tip='20260923190853');
  ELSIF marker.migration_tip='20260923190853'
    AND constraint_expression='(migration_tip = ''20260923190853''::text)'
    AND old_count=1 AND new_count=1 AND old_bootstrap_count=0 AND new_bootstrap_count=1
  THEN
    NULL; -- Exact migration reapplication; immutable domain history is untouched.
  ELSE
    RAISE EXCEPTION 'PR_C_DEFERRED_SOURCE_MISMATCH';
  END IF;
  IF has_table_privilege('service_role','public.enterprise_delivery_source_packages','SELECT')
    OR has_function_privilege('service_role','public.enterprise_pr_c_package_binding_validate()','EXECUTE')
  THEN RAISE EXCEPTION 'PR_C_DEFERRED_ACL_MISMATCH'; END IF;
END
$pr_c_deferred$;
