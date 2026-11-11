-- A real FRD provider response was staged but could not be finalized: the
-- trusted system template uses camelCase section IDs while the PostgreSQL
-- content trigger accepted lowercase IDs only. Match the existing Edge and
-- template contract without changing source, approvals, or historical data.
DO $precondition$
DECLARE marker public.hosted_pilot_environment_identity;
  validator regprocedure:='public.studio_pr_b_structured_artifact_content_safe(jsonb,public.studio_artifact_source_packages)'::regprocedure;
  definition text; old_pattern text:='''^[a-z][a-z0-9_.-]{0,79}$''';
  replacement text:='''^[A-Za-z][A-Za-z0-9_.-]{0,79}$''';
BEGIN
  LOCK TABLE public.hosted_pilot_environment_identity IN SHARE ROW EXCLUSIVE MODE;
  SELECT * INTO STRICT marker FROM public.hosted_pilot_environment_identity WHERE singleton FOR UPDATE;
  IF marker.product_key <> 'avalaos-core'
    OR marker.environment_class <> 'hosted_nonproduction_pilot'
    OR marker.schema_contract <> 'hosted-pilot-2026-08'
    OR marker.migration_tip <> '20260923062439'
    OR marker.production_authorized OR marker.customer_data_authorized OR marker.real_provider_calls_authorized
  THEN RAISE EXCEPTION 'STUDIO_FRD_SECTION_ID_PRECONDITION_FAILED'; END IF;
  IF has_function_privilege('anon',validator,'EXECUTE')
    OR has_function_privilege('authenticated',validator,'EXECUTE')
  THEN RAISE EXCEPTION 'STUDIO_FRD_VALIDATOR_ROLE_EXPOSURE'; END IF;
  SELECT pg_get_functiondef(validator) INTO STRICT definition;
  IF length(definition)-length(replace(definition,old_pattern,''))<>length(old_pattern)
    OR position(replacement IN definition)>0
  THEN RAISE EXCEPTION 'STUDIO_FRD_VALIDATOR_DRIFT'; END IF;
  EXECUTE replace(definition,old_pattern,replacement);
END
$precondition$;

-- The fresh synthetic bootstrap remains bound to the exact full-chain tip.
DO $bootstrap_forward$
DECLARE fn regprocedure:='public.synthetic_ai_campaign_bootstrap(uuid,uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,uuid,timestamptz)'::regprocedure;
  definition text; old text:='marker.migration_tip=''20260923062439''';
  replacement text:='marker.migration_tip=''20260923082000''';
BEGIN
  SELECT pg_get_functiondef(fn) INTO STRICT definition;
  IF length(definition)-length(replace(definition,old,''))<>length(old)
    OR position(replacement IN definition)>0
  THEN RAISE EXCEPTION 'STUDIO_FRD_BOOTSTRAP_DRIFT'; END IF;
  EXECUTE replace(definition,old,replacement);
END
$bootstrap_forward$;

ALTER TABLE public.hosted_pilot_environment_identity DROP CONSTRAINT hosted_pilot_environment_identity_migration_tip_check;
UPDATE public.hosted_pilot_environment_identity SET migration_tip='20260923082000'
 WHERE singleton AND migration_tip='20260923062439'
   AND NOT production_authorized AND NOT customer_data_authorized AND NOT real_provider_calls_authorized;
DO $tip$
BEGIN
  IF (SELECT count(*) FROM public.hosted_pilot_environment_identity WHERE singleton
    AND migration_tip='20260923082000' AND NOT production_authorized
    AND NOT customer_data_authorized AND NOT real_provider_calls_authorized)<>1
  THEN RAISE EXCEPTION 'STUDIO_FRD_SECTION_ID_TIP_FAILED'; END IF;
END
$tip$;
ALTER TABLE public.hosted_pilot_environment_identity ADD CONSTRAINT hosted_pilot_environment_identity_migration_tip_check
  CHECK(migration_tip='20260923082000');

-- Read-only fallback: keep Studio provider runtime disabled and leave the
-- staged response untouched. Restore the previous validator only in a
-- separately reviewed forward migration after resolving every camelCase FRD
-- version; never delete a charged provider effect or rewrite its response.
