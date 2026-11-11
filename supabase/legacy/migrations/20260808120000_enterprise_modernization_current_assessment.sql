-- Forward-only correction for PR1G recommendation translation and current-assessment authority.

CREATE OR REPLACE FUNCTION public.enterprise_translate_pr1g_modernization_disposition(
  p_recommendation TEXT
) RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE
SET search_path = pg_catalog
AS $$
DECLARE translated TEXT;
BEGIN
  translated := CASE p_recommendation
    WHEN 'Retain and monitor' THEN 'retain'
    WHEN 'Enable native API/event integration' THEN 'integrate'
    WHEN 'Add API façade and semantic translation' THEN 'api_enable_wrap'
    WHEN 'Add event or CDC bridge' THEN 'integrate'
    WHEN 'Use governed workflow/RPA bridge' THEN 'automate_around'
    WHEN 'Use governed UI/vision bridge' THEN 'automate_around'
    WHEN 'Refactor through strangler or modular decomposition' THEN 'refactor'
    WHEN 'Replatform' THEN 'replatform'
    WHEN 'Replace with supported product or SaaS' THEN 'replace'
    WHEN 'Rebuild through controlled AI-assisted delivery' THEN 'rebuild'
    WHEN 'Consolidate duplicate applications' THEN 'optimize'
    WHEN 'Retire' THEN 'retire'
    WHEN 'Insufficient evidence' THEN 'insufficient_evidence'
    WHEN 'Blocked pending prerequisite' THEN 'blocked'
    ELSE NULL
  END;
  IF translated IS NULL THEN
    RAISE EXCEPTION 'ENTERPRISE_MODERNIZATION_RECOMMENDATION_INVALID';
  END IF;
  RETURN translated;
END;
$$;

-- Every assessment-version insert participates in the same application-scoped
-- transaction lock used by PR1G saves. Modernization takes this lock before
-- selecting MAX(version), so no lifecycle transition can insert around it.
CREATE OR REPLACE FUNCTION public.pr1g_serialize_application_assessment_insert()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'pr1g-assessment:' || NEW.org_id::text || ':' || NEW.workspace_id::text || ':' || NEW.application_id::text,
    0
  ));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS pr1g_application_assessment_insert_serialization
  ON public.assess_application_assessment_versions;
CREATE TRIGGER pr1g_application_assessment_insert_serialization
BEFORE INSERT ON public.assess_application_assessment_versions
FOR EACH ROW EXECUTE FUNCTION public.pr1g_serialize_application_assessment_insert();

-- Take the same lock before the accepted PR1G command reaches any row lock.
-- The insert trigger remains a final guard for any server-internal insert path.
ALTER FUNCTION public.pr1g_execute_application_command(
  UUID, UUID, UUID, UUID, TEXT, BIGINT, BIGINT, TEXT, JSONB
) RENAME TO pr1g_execute_application_command_before_current_assessment_lock;

CREATE OR REPLACE FUNCTION public.pr1g_execute_application_command(
  p_org_id UUID,
  p_workspace_id UUID,
  p_actor_id UUID,
  p_request_id UUID,
  p_command_type TEXT,
  p_expected_version BIGINT,
  p_authorization_version BIGINT,
  p_idempotency_key TEXT,
  p_payload JSONB
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF p_command_type IN (
    'application.assessment.save',
    'application.assessment.finalize',
    'application.assessment.review.resolve',
    'application.assessment.revision.start'
  ) THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'pr1g-assessment:' || p_org_id::text || ':' || p_workspace_id::text || ':' ||
        (p_payload->>'applicationId')::uuid::text,
      0
    ));
  END IF;
  RETURN public.pr1g_execute_application_command_before_current_assessment_lock(
    p_org_id,
    p_workspace_id,
    p_actor_id,
    p_request_id,
    p_command_type,
    p_expected_version,
    p_authorization_version,
    p_idempotency_key,
    p_payload
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.enterprise_commit_modernization_assessment(
  p_assessment JSONB,
  p_decision JSONB
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  source public.assess_application_assessment_versions;
  application public.assess_application_assets;
  metadata public.assess_application_metadata_versions;
  recommendation public.assess_application_modernization_recommendations;
  factors JSONB;
  blockers JSONB;
  translated_disposition TEXT;
  primary_disposition TEXT;
  insufficient_factor_count INTEGER;
  hard_stop_count INTEGER;
  assessment RECORD;
  decision RECORD;
  decision_hash TEXT;
  v_org_id UUID := (p_assessment->>'org_id')::uuid;
  v_workspace_id UUID := (p_assessment->>'workspace_id')::uuid;
  v_application_id UUID := (p_assessment->>'application_ref')::uuid;
  requested_source_id UUID := (p_assessment->>'source_assessment_id')::uuid;
  requested_metadata_id UUID := (p_assessment->>'source_metadata_version_id')::uuid;
BEGIN
  PERFORM public.enterprise_assert_writable('delivery');
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'pr1g-assessment:' || v_org_id::text || ':' || v_workspace_id::text || ':' || v_application_id::text,
    0
  ));

  SELECT candidate.* INTO source
  FROM public.assess_application_assessment_versions candidate
  WHERE candidate.application_id = v_application_id
    AND candidate.org_id = v_org_id
    AND candidate.workspace_id = v_workspace_id
  ORDER BY candidate.version DESC
  LIMIT 1
  FOR SHARE;

  IF source.id IS NULL THEN
    RAISE EXCEPTION 'ENTERPRISE_MODERNIZATION_SOURCE_NOT_APPROVED';
  END IF;
  IF source.id IS DISTINCT FROM requested_source_id
     OR source.metadata_version_id IS DISTINCT FROM requested_metadata_id THEN
    RAISE EXCEPTION 'ENTERPRISE_MODERNIZATION_SOURCE_NOT_CURRENT';
  END IF;
  IF source.lifecycle <> 'approved'
     OR source.decision_model_version <> 'assess-v2-application-portfolio-2026-07' THEN
    RAISE EXCEPTION 'ENTERPRISE_MODERNIZATION_SOURCE_NOT_APPROVED';
  END IF;

  SELECT candidate.* INTO application
  FROM public.assess_application_assets candidate
  WHERE candidate.id = source.application_id
    AND candidate.org_id = source.org_id
    AND candidate.workspace_id = source.workspace_id
    AND candidate.deleted_at IS NULL
  FOR SHARE;
  SELECT candidate.* INTO metadata
  FROM public.assess_application_metadata_versions candidate
  WHERE candidate.id = source.metadata_version_id
    AND candidate.application_id = source.application_id
    AND candidate.org_id = source.org_id
    AND candidate.workspace_id = source.workspace_id
  FOR SHARE;
  SELECT candidate.* INTO recommendation
  FROM public.assess_application_modernization_recommendations candidate
  WHERE candidate.assessment_version_id = source.id
    AND candidate.application_id = source.application_id
    AND candidate.metadata_version_id = source.metadata_version_id
    AND candidate.org_id = source.org_id
    AND candidate.workspace_id = source.workspace_id
  ORDER BY candidate.id
  LIMIT 1
  FOR SHARE;

  IF application.id IS NULL OR metadata.id IS NULL OR metadata.lifecycle <> 'approved'
     OR recommendation.id IS NULL
     OR (SELECT count(*) FROM public.assess_application_modernization_recommendations candidate
         WHERE candidate.assessment_version_id = source.id
           AND candidate.application_id = source.application_id
           AND candidate.metadata_version_id = source.metadata_version_id
           AND candidate.org_id = source.org_id
           AND candidate.workspace_id = source.workspace_id) <> 1 THEN
    RAISE EXCEPTION 'ENTERPRISE_MODERNIZATION_SOURCE_NOT_APPROVED';
  END IF;

  -- Translate before blocker overrides so unknown source vocabulary can never
  -- be hidden by an unrelated missing-evidence or hard-stop condition.
  translated_disposition := public.enterprise_translate_pr1g_modernization_disposition(
    recommendation.disposition
  );

  SELECT
    COALESCE(jsonb_object_agg(dimension, jsonb_build_object(
      'readinessBand', readiness_band,
      'evidenceConfidence', evidence_confidence,
      'hardGates', hard_gates,
      'missingEvidence', missing_evidence,
      'assessmentVersionId', assessment_version_id
    ) ORDER BY dimension), '{}'::jsonb),
    COALESCE(jsonb_agg(jsonb_build_object(
      'dimension', dimension,
      'missingEvidence', missing_evidence,
      'hardGates', hard_gates
    ) ORDER BY dimension) FILTER (
      WHERE evidence_confidence = 'Insufficient Evidence'
        OR cardinality(missing_evidence) > 0
        OR cardinality(hard_gates) > 0
    ), '[]'::jsonb),
    count(*) FILTER (
      WHERE evidence_confidence = 'Insufficient Evidence'
        OR cardinality(missing_evidence) > 0
    ),
    count(*) FILTER (WHERE cardinality(hard_gates) > 0)
  INTO factors, blockers, insufficient_factor_count, hard_stop_count
  FROM public.assess_application_dimension_results
  WHERE assessment_version_id = source.id
    AND org_id = source.org_id
    AND workspace_id = source.workspace_id;

  IF (SELECT count(*) FROM public.assess_application_dimension_results
      WHERE assessment_version_id = source.id
        AND org_id = source.org_id
        AND workspace_id = source.workspace_id) <> 7
     OR (SELECT count(DISTINCT dimension) FROM public.assess_application_dimension_results
         WHERE assessment_version_id = source.id
           AND org_id = source.org_id
           AND workspace_id = source.workspace_id) <> 7 THEN
    RAISE EXCEPTION 'ENTERPRISE_MODERNIZATION_INCOMPLETE_FACTORS';
  END IF;

  primary_disposition := CASE
    WHEN translated_disposition IN ('insufficient_evidence', 'blocked') THEN translated_disposition
    WHEN hard_stop_count > 0 THEN 'blocked'
    WHEN insufficient_factor_count > 0 THEN 'insufficient_evidence'
    ELSE translated_disposition
  END;

  INSERT INTO public.enterprise_modernization_assessments(
    id, org_id, workspace_id, application_ref, application_version,
    source_assessment_id, source_assessment_version, source_metadata_version_id,
    factor_bands, model_version, source_decision_model_version, status, created_by
  ) VALUES (
    (p_assessment->>'id')::uuid, source.org_id, source.workspace_id, source.application_id,
    source.version, source.id, source.version, source.metadata_version_id, factors,
    'modernization-disposition-1', source.decision_model_version, 'review',
    (p_assessment->>'created_by')::uuid
  ) RETURNING * INTO assessment;

  decision_hash := public.enterprise_sha256_jsonb(jsonb_build_object(
    'assessmentId', assessment.id,
    'applicationId', source.application_id,
    'sourceAssessmentId', source.id,
    'sourceAssessmentVersion', source.version,
    'sourceMetadataVersionId', source.metadata_version_id,
    'modelVersion', assessment.model_version,
    'factorBands', factors,
    'primaryDisposition', primary_disposition,
    'blockers', blockers,
    'eligibleDispositions', jsonb_build_array(primary_disposition),
    'version', 1
  ));

  INSERT INTO public.enterprise_modernization_decisions(
    id, modernization_assessment_id, org_id, workspace_id, primary_disposition,
    alternative_disposition, eligible_dispositions, blockers, conflicts, status,
    requires_human_approval, version, resource_hash, created_by
  ) VALUES (
    (p_decision->>'id')::uuid, assessment.id, source.org_id, source.workspace_id,
    primary_disposition, NULL, jsonb_build_array(primary_disposition), blockers,
    '[]'::jsonb, 'review', true, 1, decision_hash, (p_decision->>'created_by')::uuid
  ) RETURNING * INTO decision;

  RETURN jsonb_build_object(
    'modernizationAssessmentId', assessment.id,
    'decisionId', decision.id,
    'primaryDisposition', decision.primary_disposition,
    'alternativeDisposition', decision.alternative_disposition,
    'eligibleDispositions', decision.eligible_dispositions,
    'blockers', decision.blockers,
    'resourceHash', decision.resource_hash,
    'version', decision.version
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
  canonical_decision JSONB;
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
  canonical_decision := ((p_result -> ('decision'::text)) - ('alternativeDisposition'::text))
    || jsonb_build_object(
    'assessmentId', p_assessment->>'source_assessment_id',
    'assessmentVersion', p_assessment->>'source_assessment_version',
    'modelVersion', 'modernization-disposition-1',
    'primaryDisposition', committed->>'primaryDisposition',
    'eligibleDispositions', committed->'eligibleDispositions',
    'blockers', committed->'blockers'
  );
  canonical_result := p_result || jsonb_build_object(
    'resourceId', committed->>'decisionId',
    'modernizationAssessmentId', committed->>'modernizationAssessmentId',
    'decisionId', committed->>'decisionId',
    'decision', canonical_decision,
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

REVOKE ALL ON FUNCTION public.enterprise_translate_pr1g_modernization_disposition(TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.pr1g_serialize_application_assessment_insert()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.pr1g_execute_application_command_before_current_assessment_lock(
  UUID, UUID, UUID, UUID, TEXT, BIGINT, BIGINT, TEXT, JSONB
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.pr1g_execute_application_command(
  UUID, UUID, UUID, UUID, TEXT, BIGINT, BIGINT, TEXT, JSONB
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pr1g_execute_application_command(
  UUID, UUID, UUID, UUID, TEXT, BIGINT, BIGINT, TEXT, JSONB
) TO service_role;
REVOKE ALL ON FUNCTION public.enterprise_commit_modernization_assessment(JSONB, JSONB)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.enterprise_commit_modernization_assessment(JSONB, JSONB, UUID, UUID, BIGINT, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enterprise_commit_modernization_assessment(JSONB, JSONB, UUID, UUID, BIGINT, JSONB)
  TO service_role;
