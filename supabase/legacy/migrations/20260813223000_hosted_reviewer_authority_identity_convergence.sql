-- Converge the hosted non-production pilot migration marker after the additive
-- PR1E Studio handoff reviewer-authority forward fix. The identity assertion
-- derives the authoritative tip from the DB-owned migration ledger; this marker
-- is deliberately pinned to this forward migration's own timestamp so any later
-- migration must explicitly advance hosted-pilot identity again.
--
-- Forward-only. Historical migrations remain immutable. This migration does not
-- authorize production, customer data, or real provider calls.

ALTER TABLE public.hosted_pilot_environment_identity
  DROP CONSTRAINT hosted_pilot_environment_identity_migration_tip_check;

UPDATE public.hosted_pilot_environment_identity
SET migration_tip = '20260813223000'
WHERE singleton;

ALTER TABLE public.hosted_pilot_environment_identity
  ADD CONSTRAINT hosted_pilot_environment_identity_migration_tip_check
  CHECK (migration_tip = '20260813223000');
