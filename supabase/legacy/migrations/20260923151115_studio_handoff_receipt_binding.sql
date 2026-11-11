-- A module handoff can commit while its Edge adapter reports failed-before-
-- commit: the SQL result omitted the receipt ID required by the response
-- contract. Add that ID to new committed responses and to exact replays,
-- including receipts committed before this forward fix. Preserve the stored
-- historical response and every authorization/separation/consume rule.
DO $fix$
DECLARE
  marker public.hosted_pilot_environment_identity;
  constraint_expression text;
  definition text;
  bootstrap_definition text;
  old_replay text := 'IF receipt.status=''committed'' THEN RETURN receipt.response||jsonb_build_object(''outcome'',''replayed'');END IF;';
  new_replay text := 'IF receipt.status=''committed'' THEN RETURN receipt.response||jsonb_build_object(''outcome'',''replayed'',''receiptId'',receipt.id);END IF;';
  old_commit text := 'result:=result||jsonb_build_object(''handoffVersionId'',handoff_version.id,''expiresAt'',handoff.expires_at);';
  new_commit text := 'result:=result||jsonb_build_object(''handoffVersionId'',handoff_version.id,''expiresAt'',handoff.expires_at,''receiptId'',receipt.id);';
  old_bootstrap text := 'marker.migration_tip=''20260923144653''';
  new_bootstrap text := 'marker.migration_tip=''20260923151115''';
  old_replay_count integer;
  new_replay_count integer;
  old_commit_count integer;
  new_commit_count integer;
  old_bootstrap_count integer;
  new_bootstrap_count integer;
BEGIN
  LOCK TABLE public.hosted_pilot_environment_identity IN SHARE ROW EXCLUSIVE MODE;
  SELECT * INTO STRICT marker FROM public.hosted_pilot_environment_identity WHERE singleton FOR UPDATE;
  IF marker.product_key <> 'avalaos-core'
    OR marker.environment_class <> 'hosted_nonproduction_pilot'
    OR marker.schema_contract <> 'hosted-pilot-2026-08'
    OR marker.production_authorized OR marker.customer_data_authorized OR marker.real_provider_calls_authorized
  THEN RAISE EXCEPTION 'STUDIO_HANDOFF_RECEIPT_IDENTITY_MISMATCH'; END IF;
  SELECT pg_get_expr(conbin,conrelid,false) INTO STRICT constraint_expression FROM pg_constraint
    WHERE conrelid='public.hosted_pilot_environment_identity'::regclass
      AND conname='hosted_pilot_environment_identity_migration_tip_check';
  SELECT pg_get_functiondef('public.enterprise_assess_studio_handoff_command(jsonb)'::regprocedure)
    INTO STRICT definition;
  SELECT pg_get_functiondef('public.synthetic_ai_campaign_bootstrap(uuid,uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,uuid,timestamptz)'::regprocedure)
    INTO STRICT bootstrap_definition;
  old_replay_count := (length(definition)-length(replace(definition,old_replay,'')))/length(old_replay);
  new_replay_count := (length(definition)-length(replace(definition,new_replay,'')))/length(new_replay);
  old_commit_count := (length(definition)-length(replace(definition,old_commit,'')))/length(old_commit);
  new_commit_count := (length(definition)-length(replace(definition,new_commit,'')))/length(new_commit);
  old_bootstrap_count := (length(bootstrap_definition)-length(replace(bootstrap_definition,old_bootstrap,'')))/length(old_bootstrap);
  new_bootstrap_count := (length(bootstrap_definition)-length(replace(bootstrap_definition,new_bootstrap,'')))/length(new_bootstrap);
  IF marker.migration_tip='20260923144653'
    AND constraint_expression='(migration_tip = ''20260923144653''::text)'
    AND old_replay_count=1 AND new_replay_count=0
    AND old_commit_count=1 AND new_commit_count=0
    AND old_bootstrap_count=1 AND new_bootstrap_count=0
  THEN
    EXECUTE replace(replace(definition,old_replay,new_replay),old_commit,new_commit);
    EXECUTE replace(bootstrap_definition,old_bootstrap,new_bootstrap);
    ALTER TABLE public.hosted_pilot_environment_identity DROP CONSTRAINT hosted_pilot_environment_identity_migration_tip_check;
    UPDATE public.hosted_pilot_environment_identity SET migration_tip='20260923151115' WHERE singleton;
    ALTER TABLE public.hosted_pilot_environment_identity ADD CONSTRAINT hosted_pilot_environment_identity_migration_tip_check
      CHECK (migration_tip='20260923151115');
  ELSIF marker.migration_tip='20260923151115'
    AND constraint_expression='(migration_tip = ''20260923151115''::text)'
    AND old_replay_count=0 AND new_replay_count=1
    AND old_commit_count=0 AND new_commit_count=1
    AND old_bootstrap_count=0 AND new_bootstrap_count=1
  THEN
    NULL; -- exact reapplication
  ELSE
    RAISE EXCEPTION 'STUDIO_HANDOFF_RECEIPT_SOURCE_MISMATCH';
  END IF;
END
$fix$;
