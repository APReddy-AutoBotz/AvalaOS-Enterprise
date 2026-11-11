-- Repair the observed Studio source-package service-role call chain without
-- exposing its helpers to browser roles. This performs no provider action.
DO $precondition$
DECLARE marker public.hosted_pilot_environment_identity;
  helper regprocedure;
BEGIN
  LOCK TABLE public.hosted_pilot_environment_identity IN SHARE ROW EXCLUSIVE MODE;
  SELECT * INTO STRICT marker FROM public.hosted_pilot_environment_identity WHERE singleton FOR UPDATE;
  IF marker.product_key <> 'avalaos-core'
    OR marker.environment_class <> 'hosted_nonproduction_pilot'
    OR marker.schema_contract <> 'hosted-pilot-2026-08'
    OR marker.migration_tip <> '20260922112911'
    OR marker.production_authorized OR marker.customer_data_authorized OR marker.real_provider_calls_authorized
  THEN RAISE EXCEPTION 'STUDIO_HELPER_PERMISSION_PRECONDITION_FAILED'; END IF;
  FOREACH helper IN ARRAY ARRAY[
    'public.enterprise_sha256_jsonb(jsonb)'::regprocedure,
    'public.studio_pr_b_anchor_manifest(jsonb,uuid,text)'::regprocedure,
    'public.studio_pr_b_anchor_manifest_safe(jsonb)'::regprocedure,
    'public.enterprise_direct_studio_route_policy()'::regprocedure
  ] LOOP
    IF has_function_privilege('anon',helper,'EXECUTE')
      OR has_function_privilege('authenticated',helper,'EXECUTE')
    THEN RAISE EXCEPTION 'STUDIO_HELPER_BROWSER_ROLE_EXPOSURE'; END IF;
  END LOOP;
END
$precondition$;

GRANT EXECUTE ON FUNCTION public.enterprise_sha256_jsonb(jsonb),
  public.studio_pr_b_anchor_manifest(jsonb,uuid,text),
  public.studio_pr_b_anchor_manifest_safe(jsonb),
  public.enterprise_direct_studio_route_policy()
TO service_role;

-- Fresh synthetic campaign bootstrap is bound to the new exact chain tip.
DO $bootstrap_forward$
DECLARE fn regprocedure:='public.synthetic_ai_campaign_bootstrap(uuid,uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,uuid,timestamptz)'::regprocedure;
  definition text; old text:='marker.migration_tip=''20260922112911''';
  replacement text:='marker.migration_tip=''20260923062439''';
BEGIN
  SELECT pg_get_functiondef(fn) INTO STRICT definition;
  IF length(definition)-length(replace(definition,old,''))<>length(old)
    OR position(replacement IN definition)>0
  THEN RAISE EXCEPTION 'STUDIO_HELPER_BOOTSTRAP_DRIFT'; END IF;
  EXECUTE replace(definition,old,replacement);
END
$bootstrap_forward$;

ALTER TABLE public.hosted_pilot_environment_identity DROP CONSTRAINT hosted_pilot_environment_identity_migration_tip_check;
UPDATE public.hosted_pilot_environment_identity SET migration_tip='20260923062439'
 WHERE singleton AND migration_tip='20260922112911'
   AND NOT production_authorized AND NOT customer_data_authorized AND NOT real_provider_calls_authorized;
DO $tip$
BEGIN
  IF (SELECT count(*) FROM public.hosted_pilot_environment_identity WHERE singleton
    AND migration_tip='20260923062439' AND NOT production_authorized
    AND NOT customer_data_authorized AND NOT real_provider_calls_authorized)<>1
  THEN RAISE EXCEPTION 'STUDIO_HELPER_PERMISSION_TIP_FAILED'; END IF;
END
$tip$;
ALTER TABLE public.hosted_pilot_environment_identity ADD CONSTRAINT hosted_pilot_environment_identity_migration_tip_check
  CHECK(migration_tip='20260923062439');

-- Rollback/read-only fallback: keep both provider runtimes disabled and stop
-- Studio package commands. A future forward migration may revoke these four
-- service-role grants after replacing the affected call chain; do not alter
-- historical receipts, source packages, campaign debits, or renewal history.
