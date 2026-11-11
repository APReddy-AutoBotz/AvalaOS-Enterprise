-- Forward-only convergence for the separately approved, default-off creation-access
-- migration chain. The PR #264 controlled-human database remains at its frozen tip;
-- this migration is for the isolated creation-access target only. It grants no
-- hosted activation, production, customer-data, or real-provider authority.
-- Apply the single DO statement transactionally; preserve all prior migration bytes.
DO $creation_access_identity$
DECLARE
  marker public.hosted_pilot_environment_identity;
  singleton_count bigint;
  changed_count bigint;
BEGIN
  -- Both approved predecessors must exist. The frozen controlled-human target
  -- has neither table and must reject this migration before any marker change.
  IF pg_catalog.to_regclass('public.process_creation_workspace_controls') IS NULL
     OR pg_catalog.to_regclass('public.synthetic_admin_accounts') IS NULL THEN
    RAISE EXCEPTION 'CREATION_ACCESS_IDENTITY_PRECONDITION_FAILED';
  END IF;
  SELECT count(*) INTO singleton_count FROM public.hosted_pilot_environment_identity;
  IF singleton_count <> 1 THEN
    RAISE EXCEPTION 'CREATION_ACCESS_IDENTITY_PRECONDITION_FAILED';
  END IF;
  SELECT * INTO STRICT marker FROM public.hosted_pilot_environment_identity
    WHERE singleton IS TRUE FOR UPDATE;
  IF marker.product_key <> 'avalaos-core'
     OR marker.environment_class <> 'hosted_nonproduction_pilot'
     OR marker.schema_contract <> 'hosted-pilot-2026-08'
     OR marker.migration_tip <> '20260904120000'
     OR marker.production_authorized
     OR marker.customer_data_authorized
     OR marker.real_provider_calls_authorized THEN
    RAISE EXCEPTION 'CREATION_ACCESS_IDENTITY_PRECONDITION_FAILED';
  END IF;

  EXECUTE 'ALTER TABLE public.hosted_pilot_environment_identity DROP CONSTRAINT hosted_pilot_environment_identity_migration_tip_check';
  UPDATE public.hosted_pilot_environment_identity
    SET migration_tip = '20260916003000'
    WHERE singleton IS TRUE AND migration_tip = '20260904120000'
      AND NOT production_authorized AND NOT customer_data_authorized
      AND NOT real_provider_calls_authorized;
  GET DIAGNOSTICS changed_count = ROW_COUNT;
  IF changed_count <> 1 THEN
    RAISE EXCEPTION 'CREATION_ACCESS_IDENTITY_PRECONDITION_FAILED';
  END IF;
  EXECUTE 'ALTER TABLE public.hosted_pilot_environment_identity ADD CONSTRAINT hosted_pilot_environment_identity_migration_tip_check CHECK (migration_tip = ''20260916003000'')';
END
$creation_access_identity$;
