-- Hosted evidence execution gate closure.
-- Forward-only: preserve the service-authorized recorder while removing direct
-- service-role mutation authority from owner-controlled verification evidence.
REVOKE ALL ON TABLE public.hosted_pilot_verification_run_results FROM PUBLIC,anon,authenticated,service_role;

-- Keep the final recorder callable by service_role. It remains SECURITY DEFINER
-- and can only derive a successful row after all five database-owner-ingested
-- evidence families for the exact hosted exercise already exist.
REVOKE ALL ON FUNCTION public.hosted_pilot_record_verification_result(uuid,uuid,uuid,text,text,text,bigint,text,text,uuid,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.hosted_pilot_record_verification_result(uuid,uuid,uuid,text,text,text,bigint,text,text,uuid,bigint) TO service_role;

ALTER TABLE public.hosted_pilot_environment_identity
  DROP CONSTRAINT hosted_pilot_environment_identity_migration_tip_check;
UPDATE public.hosted_pilot_environment_identity
  SET migration_tip='20260812171000'
  WHERE singleton;
ALTER TABLE public.hosted_pilot_environment_identity
  ADD CONSTRAINT hosted_pilot_environment_identity_migration_tip_check
  CHECK(migration_tip='20260812171000');
