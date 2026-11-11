-- Forward-only correction: derive every modernization response and resource hash
-- from the rows PostgreSQL actually commits. Historical migrations remain intact.

ALTER FUNCTION public.enterprise_commit_modernization_assessment(JSONB, JSONB)
  RENAME TO enterprise_commit_modernization_assessment_before_canonical_projection;

CREATE OR REPLACE FUNCTION public.enterprise_modernization_canonical_decision(
  p_assessment JSONB,
  p_decision JSONB
) RETURNS JSONB
LANGUAGE plpgsql IMMUTABLE
SET search_path = pg_catalog
AS $$
DECLARE
  canonical JSONB;
BEGIN
  canonical := jsonb_build_object(
    'assessmentId', p_assessment->>'source_assessment_id',
    'assessmentVersion', p_assessment->>'source_assessment_version',
    'modelVersion', p_assessment->>'model_version',
    'primaryDisposition', p_decision->>'primary_disposition',
    'eligibleDispositions', p_decision->'eligible_dispositions',
    'factorBands', p_assessment->'factor_bands',
    'blockers', p_decision->'blockers',
    'conflicts', p_decision->'conflicts',
    'requiresHumanApproval', p_decision->'requires_human_approval',
    'aiRationaleStatus', 'not_requested'
  );
  IF p_decision->'alternative_disposition' IS DISTINCT FROM 'null'::jsonb THEN
    canonical := canonical || jsonb_build_object(
      'alternativeDisposition', p_decision->>'alternative_disposition'
    );
  END IF;
  RETURN canonical;
END;
$$;

CREATE OR REPLACE FUNCTION public.enterprise_modernization_canonical_resource(
  p_assessment JSONB,
  p_decision JSONB
) RETURNS JSONB
LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT jsonb_build_object(
    'resourceId', p_decision->>'id',
    'modernizationAssessmentId', p_assessment->>'id',
    'decisionId', p_decision->>'id',
    'decision', public.enterprise_modernization_canonical_decision(p_assessment, p_decision),
    'version', p_decision->'version'
  );
$$;

CREATE OR REPLACE FUNCTION public.enterprise_modernization_set_canonical_hash()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
  assessment_row public.enterprise_modernization_assessments;
BEGIN
  SELECT candidate.* INTO assessment_row
  FROM public.enterprise_modernization_assessments candidate
  WHERE candidate.id = NEW.modernization_assessment_id
    AND candidate.org_id = NEW.org_id
    AND candidate.workspace_id = NEW.workspace_id;
  IF assessment_row.id IS NULL THEN
    RAISE EXCEPTION 'ENTERPRISE_MODERNIZATION_CANONICAL_SOURCE_MISSING';
  END IF;
  NEW.resource_hash := public.enterprise_sha256_jsonb(
    public.enterprise_modernization_canonical_resource(to_jsonb(assessment_row), to_jsonb(NEW))
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enterprise_modernization_canonical_hash_before_insert
  ON public.enterprise_modernization_decisions;
CREATE TRIGGER enterprise_modernization_canonical_hash_before_insert
BEFORE INSERT ON public.enterprise_modernization_decisions
FOR EACH ROW EXECUTE FUNCTION public.enterprise_modernization_set_canonical_hash();

CREATE OR REPLACE FUNCTION public.enterprise_commit_modernization_assessment(
  p_assessment JSONB,
  p_decision JSONB
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  legacy_result JSONB;
  assessment_row public.enterprise_modernization_assessments;
  decision_row public.enterprise_modernization_decisions;
  canonical_resource JSONB;
BEGIN
  legacy_result := public.enterprise_commit_modernization_assessment_before_canonical_projection(
    p_assessment,
    p_decision
  );

  SELECT candidate.* INTO assessment_row
  FROM public.enterprise_modernization_assessments candidate
  WHERE candidate.id = (legacy_result->>'modernizationAssessmentId')::uuid
    AND candidate.org_id = (p_assessment->>'org_id')::uuid
    AND candidate.workspace_id = (p_assessment->>'workspace_id')::uuid;
  SELECT candidate.* INTO decision_row
  FROM public.enterprise_modernization_decisions candidate
  WHERE candidate.id = (legacy_result->>'decisionId')::uuid
    AND candidate.modernization_assessment_id = assessment_row.id
    AND candidate.org_id = assessment_row.org_id
    AND candidate.workspace_id = assessment_row.workspace_id;
  IF assessment_row.id IS NULL OR decision_row.id IS NULL THEN
    RAISE EXCEPTION 'ENTERPRISE_MODERNIZATION_CANONICAL_RESULT_MISSING';
  END IF;

  canonical_resource := public.enterprise_modernization_canonical_resource(
    to_jsonb(assessment_row),
    to_jsonb(decision_row)
  );
  RETURN canonical_resource || jsonb_build_object(
    'applicationId', assessment_row.application_ref,
    'sourceAssessmentId', assessment_row.source_assessment_id,
    'sourceAssessmentVersion', assessment_row.source_assessment_version,
    'sourceMetadataVersionId', assessment_row.source_metadata_version_id,
    'sourceDecisionModelVersion', assessment_row.source_decision_model_version,
    'primaryDisposition', decision_row.primary_disposition,
    'alternativeDisposition', decision_row.alternative_disposition,
    'eligibleDispositions', decision_row.eligible_dispositions,
    'factorBands', assessment_row.factor_bands,
    'blockers', decision_row.blockers,
    'conflicts', decision_row.conflicts,
    'requiresHumanApproval', decision_row.requires_human_approval,
    'resourceHash', decision_row.resource_hash
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.enterprise_commit_modernization_assessment(
  p_assessment JSONB,
  p_decision JSONB,
  p_receipt UUID,
  p_execution_token UUID,
  p_execution_fence BIGINT,
  p_result JSONB
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  committed JSONB;
  canonical_result JSONB;
BEGIN
  IF jsonb_typeof(COALESCE(p_result, 'null'::jsonb)) <> 'object'
     OR jsonb_typeof(COALESCE(p_result->'decision', 'null'::jsonb)) <> 'object'
     OR p_result->>'resourceId' IS DISTINCT FROM p_decision->>'id'
     OR p_result->>'decisionId' IS DISTINCT FROM p_decision->>'id'
     OR p_result->>'modernizationAssessmentId' IS DISTINCT FROM p_assessment->>'id' THEN
    RAISE EXCEPTION 'ENTERPRISE_MODERNIZATION_RESULT_IDENTITY_MISMATCH';
  END IF;

  committed := public.enterprise_commit_modernization_assessment(p_assessment, p_decision);
  canonical_result := jsonb_build_object(
    'resourceId', committed->>'resourceId',
    'modernizationAssessmentId', committed->>'modernizationAssessmentId',
    'decisionId', committed->>'decisionId',
    'decision', committed->'decision',
    'resourceHash', committed->>'resourceHash',
    'version', committed->'version'
  );

  PERFORM public.enterprise_ai_record_effect(
    p_receipt,
    (p_assessment->>'org_id')::uuid,
    (p_assessment->>'workspace_id')::uuid,
    p_execution_token,
    p_execution_fence,
    'modernization.evaluate',
    'command',
    (committed->>'decisionId')::uuid,
    canonical_result,
    'committed'
  );
  RETURN canonical_result;
END;
$$;

REVOKE ALL ON FUNCTION public.enterprise_modernization_canonical_decision(JSONB, JSONB)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.enterprise_modernization_canonical_resource(JSONB, JSONB)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.enterprise_modernization_set_canonical_hash()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.enterprise_commit_modernization_assessment_before_canonical_projection(JSONB, JSONB)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.enterprise_commit_modernization_assessment(JSONB, JSONB)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.enterprise_commit_modernization_assessment(JSONB, JSONB, UUID, UUID, BIGINT, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enterprise_commit_modernization_assessment(JSONB, JSONB, UUID, UUID, BIGINT, JSONB)
  TO service_role;
