-- PR A hosted-pilot identity convergence.
-- Additive correction only: advance the fail-closed hosted marker to the
-- canonical migration tip after the governed transcript migrations.

ALTER TABLE public.hosted_pilot_environment_identity
  DROP CONSTRAINT hosted_pilot_environment_identity_migration_tip_check;

UPDATE public.hosted_pilot_environment_identity
SET migration_tip = '20260827173000'
WHERE singleton;

ALTER TABLE public.hosted_pilot_environment_identity
  ADD CONSTRAINT hosted_pilot_environment_identity_migration_tip_check
  CHECK (migration_tip = '20260827173000');
