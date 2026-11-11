-- Fail closed when the superseded Enterprise promotion function has already
-- committed immutable Assess versions with lost or replaced ancestry.
-- This preflight is intentionally the first executable statement: affected
-- databases require governed review and a forward corrective decision; this
-- migration never rewrites or certifies their immutable history.

DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.enterprise_evidence_assess_promotions promotion
    JOIN public.assess_v2_case_versions promoted
      ON promoted.id = promotion.assess_case_version_id
     AND promoted.case_id = promotion.assess_case_id
     AND promoted.org_id = promotion.org_id
     AND promoted.workspace_id = promotion.workspace_id
    LEFT JOIN public.assess_v2_case_versions prior
      ON prior.case_id = promoted.case_id
     AND prior.org_id = promoted.org_id
     AND prior.workspace_id = promoted.workspace_id
     AND prior.version = promoted.version - 1
    WHERE prior.id IS NULL
       OR promoted.source_snapshot IS DISTINCT FROM prior.source_snapshot
       OR promoted.imported_facts IS DISTINCT FROM prior.imported_facts
       OR promoted.agent_necessity IS DISTINCT FROM prior.agent_necessity
  ) THEN
    RAISE EXCEPTION 'ENTERPRISE_PROMOTION_ANCESTRY_HISTORY_REQUIRES_REVIEW';
  END IF;
END;
$migration$;

COMMENT ON FUNCTION public.enterprise_promote_evidence_batch_to_assess_v2(
  UUID,JSONB,UUID,BIGINT,UUID,UUID,UUID,BIGINT,UUID,UUID,BIGINT
)
IS 'Atomically promotes reviewed Enterprise candidates as strict Assess evidence. Upgrade preflight rejects immutable promotion history that does not preserve the exact prior source_snapshot, imported_facts, and agent_necessity.';
