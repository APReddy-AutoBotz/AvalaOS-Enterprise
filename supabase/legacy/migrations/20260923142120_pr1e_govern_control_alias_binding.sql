-- The PR 1E Govern command declared a PL/pgSQL record named control and also
-- aggregated an unqualified derived-table column named control. PostgreSQL
-- rejected the command as ambiguous (42702) before any resolution committed.
-- Qualify only that aggregate; preserve every control/approval rule and ACL.
DO $fix$
DECLARE
  marker public.hosted_pilot_environment_identity;
  constraint_expression text;
  definition text;
  bootstrap_definition text;
  old_expression text := 'SELECT COALESCE(jsonb_agg(control ORDER BY control->>''controlId''),''[]'') INTO v_required_controls FROM (';
  new_expression text := 'SELECT COALESCE(jsonb_agg(required.control ORDER BY required.control->>''controlId''),''[]'') INTO v_required_controls FROM (';
  old_bootstrap text := 'marker.migration_tip=''20260923133000''';
  new_bootstrap text := 'marker.migration_tip=''20260923142120''';
  old_count integer;
  new_count integer;
  old_bootstrap_count integer;
  new_bootstrap_count integer;
BEGIN
  LOCK TABLE public.hosted_pilot_environment_identity IN SHARE ROW EXCLUSIVE MODE;
  SELECT * INTO STRICT marker FROM public.hosted_pilot_environment_identity WHERE singleton FOR UPDATE;
  IF marker.product_key <> 'avalaos-core'
    OR marker.environment_class <> 'hosted_nonproduction_pilot'
    OR marker.schema_contract <> 'hosted-pilot-2026-08'
    OR marker.production_authorized OR marker.customer_data_authorized OR marker.real_provider_calls_authorized
  THEN RAISE EXCEPTION 'PR1E_GOVERN_CONTROL_ALIAS_IDENTITY_MISMATCH'; END IF;
  SELECT pg_get_expr(conbin,conrelid,false) INTO STRICT constraint_expression FROM pg_constraint
    WHERE conrelid='public.hosted_pilot_environment_identity'::regclass
      AND conname='hosted_pilot_environment_identity_migration_tip_check';
  SELECT pg_get_functiondef('public.pr1e_review_command(text,uuid,uuid,uuid,uuid,uuid,bigint,uuid,text,bigint,jsonb)'::regprocedure)
    INTO STRICT definition;
  SELECT pg_get_functiondef('public.synthetic_ai_campaign_bootstrap(uuid,uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,uuid,timestamptz)'::regprocedure)
    INTO STRICT bootstrap_definition;
  old_count := (length(definition)-length(replace(definition,old_expression,'')))/length(old_expression);
  new_count := (length(definition)-length(replace(definition,new_expression,'')))/length(new_expression);
  old_bootstrap_count := (length(bootstrap_definition)-length(replace(bootstrap_definition,old_bootstrap,'')))/length(old_bootstrap);
  new_bootstrap_count := (length(bootstrap_definition)-length(replace(bootstrap_definition,new_bootstrap,'')))/length(new_bootstrap);
  IF marker.migration_tip='20260923133000'
    AND constraint_expression='(migration_tip = ''20260923133000''::text)'
    AND old_count=1 AND new_count=0 AND old_bootstrap_count=1 AND new_bootstrap_count=0
  THEN
    EXECUTE replace(definition,old_expression,new_expression);
    EXECUTE replace(bootstrap_definition,old_bootstrap,new_bootstrap);
    ALTER TABLE public.hosted_pilot_environment_identity DROP CONSTRAINT hosted_pilot_environment_identity_migration_tip_check;
    UPDATE public.hosted_pilot_environment_identity SET migration_tip='20260923142120' WHERE singleton;
    ALTER TABLE public.hosted_pilot_environment_identity ADD CONSTRAINT hosted_pilot_environment_identity_migration_tip_check
      CHECK (migration_tip='20260923142120');
  ELSIF marker.migration_tip='20260923142120'
    AND constraint_expression='(migration_tip = ''20260923142120''::text)'
    AND old_count=0 AND new_count=1 AND old_bootstrap_count=0 AND new_bootstrap_count=1
  THEN
    NULL; -- exact reapplication
  ELSE
    RAISE EXCEPTION 'PR1E_GOVERN_CONTROL_ALIAS_SOURCE_MISMATCH';
  END IF;
END
$fix$;
