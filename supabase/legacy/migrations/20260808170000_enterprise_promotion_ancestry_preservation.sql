-- Preserve canonical Assess V2 ancestry through Enterprise evidence promotion.
-- Forward-only replacement of the active atomic batch function. Promotion
-- metadata remains in enterprise_evidence_assess_promotions and audit lineage;
-- canonical Assess source ancestry and imported facts are copied byte-for-byte.

CREATE OR REPLACE FUNCTION public.enterprise_promote_evidence_batch_to_assess_v2(
  p_source UUID,
  p_candidates JSONB,
  p_case UUID,
  p_expected_version BIGINT,
  p_actor UUID,
  p_org UUID,
  p_workspace UUID,
  p_authorization_version BIGINT,
  p_receipt UUID,
  p_execution_token UUID,
  p_execution_fence BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  receipt public.enterprise_ai_command_receipts;
  assess_case public.assess_v2_cases;
  candidate public.enterprise_evidence_candidates;
  source public.enterprise_evidence_sources;
  source_version public.enterprise_evidence_source_versions;
  edit public.enterprise_evidence_candidate_edits;
  old_version public.assess_v2_case_versions;
  new_version public.assess_v2_case_versions;
  promotion public.enterprise_evidence_assess_promotions;
  item JSONB;
  item_ordinal BIGINT;
  selected_count INTEGER;
  distinct_count INTEGER;
  current_provenance TEXT;
  current_excerpt TEXT;
  evidence_link_id UUID;
  candidate_ids JSONB := '[]'::jsonb;
  promotion_ids JSONB := '[]'::jsonb;
  evidence_link_ids JSONB := '[]'::jsonb;
  result JSONB;
BEGIN
  SELECT * INTO receipt
  FROM public.enterprise_ai_command_receipts
  WHERE id = p_receipt AND org_id = p_org AND workspace_id = p_workspace
  FOR UPDATE;
  IF receipt.id IS NULL OR receipt.status <> 'claimed'
     OR receipt.actor_id IS DISTINCT FROM p_actor
     OR receipt.command_type IS DISTINCT FROM 'evidence.assess.promote'
     OR receipt.execution_token IS DISTINCT FROM p_execution_token
     OR receipt.execution_fence IS DISTINCT FROM p_execution_fence THEN
    RAISE EXCEPTION 'ENTERPRISE_AI_STALE_EXECUTION_FENCE';
  END IF;

  PERFORM public.enterprise_assert_writable('ingestion');
  PERFORM public.pr1b_assert_command_authority(
    p_actor, p_org, p_workspace, 'assessment.edit', p_authorization_version
  );

  SELECT * INTO assess_case
  FROM public.assess_v2_cases
  WHERE id = p_case AND org_id = p_org AND workspace_id = p_workspace
    AND deleted_at IS NULL
  FOR UPDATE;
  IF assess_case.id IS NULL OR assess_case.status <> 'draft'
     OR assess_case.version IS DISTINCT FROM p_expected_version THEN
    RAISE EXCEPTION 'ENTERPRISE_EVIDENCE_ASSESS_VERSION_CONFLICT';
  END IF;
  SELECT * INTO old_version
  FROM public.assess_v2_case_versions
  WHERE id = assess_case.head_version_id AND case_id = assess_case.id
    AND org_id = p_org AND workspace_id = p_workspace
  FOR SHARE;
  IF old_version.id IS NULL THEN
    RAISE EXCEPTION 'ENTERPRISE_EVIDENCE_ASSESS_VERSION_CONFLICT';
  END IF;

  IF jsonb_typeof(COALESCE(p_candidates, 'null'::jsonb)) <> 'array'
     OR jsonb_array_length(p_candidates) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'ENTERPRISE_EVIDENCE_BATCH_INVALID';
  END IF;
  IF receipt.execution_plan->>'promotionSourceId' IS DISTINCT FROM p_source::text
     OR NULLIF(receipt.execution_plan->>'promotionStartVersion', '')::bigint IS DISTINCT FROM p_expected_version
     OR receipt.execution_plan->'promotionCandidates' IS DISTINCT FROM p_candidates THEN
    RAISE EXCEPTION 'ENTERPRISE_AI_EXECUTION_PLAN_CONFLICT';
  END IF;

  SELECT count(*)::integer, count(DISTINCT value->>'candidateId')::integer
  INTO selected_count, distinct_count
  FROM jsonb_array_elements(p_candidates);
  IF selected_count IS DISTINCT FROM distinct_count THEN
    RAISE EXCEPTION 'ENTERPRISE_EVIDENCE_BATCH_DUPLICATE';
  END IF;

  -- Lock the complete candidate/source/edit/promotion set before any write.
  FOR item, item_ordinal IN
    SELECT value, ordinality
    FROM jsonb_array_elements(p_candidates) WITH ORDINALITY
    ORDER BY ordinality
  LOOP
    IF jsonb_typeof(item) <> 'object'
       OR NOT (item ?& ARRAY['candidateId', 'expectedVersion', 'provenanceHash'])
       OR (item - ARRAY['candidateId', 'expectedVersion', 'provenanceHash']) <> '{}'::jsonb
       OR COALESCE(item->>'candidateId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       OR COALESCE(item->>'expectedVersion', '') !~ '^[1-9][0-9]*$'
       OR COALESCE(item->>'provenanceHash', '') !~ '^[0-9a-f]{64}$' THEN
      RAISE EXCEPTION 'ENTERPRISE_EVIDENCE_BATCH_INVALID';
    END IF;

    SELECT * INTO candidate
    FROM public.enterprise_evidence_candidates
    WHERE id = (item->>'candidateId')::uuid
    FOR UPDATE;
    IF candidate.id IS NOT NULL THEN
      PERFORM 1 FROM public.enterprise_evidence_sources
      WHERE id = candidate.source_id FOR SHARE;
      PERFORM 1 FROM public.enterprise_evidence_source_versions
      WHERE id = candidate.source_version_id FOR SHARE;
      IF candidate.suggestion_status = 'edited' THEN
        PERFORM 1 FROM public.enterprise_evidence_candidate_edits
        WHERE candidate_id = candidate.id
        ORDER BY created_at DESC LIMIT 1 FOR SHARE;
      END IF;
      PERFORM 1 FROM public.enterprise_evidence_assess_promotions
      WHERE candidate_id = candidate.id FOR SHARE;
    END IF;
  END LOOP;

  -- Validate the complete locked set before creating any version, evidence,
  -- promotion, audit, or effect row.
  FOR item, item_ordinal IN
    SELECT value, ordinality
    FROM jsonb_array_elements(p_candidates) WITH ORDINALITY
    ORDER BY ordinality
  LOOP
    SELECT * INTO candidate
    FROM public.enterprise_evidence_candidates
    WHERE id = (item->>'candidateId')::uuid;
    IF candidate.id IS NULL
       OR candidate.org_id IS DISTINCT FROM p_org
       OR candidate.workspace_id IS DISTINCT FROM p_workspace
       OR candidate.source_id IS DISTINCT FROM p_source
       OR candidate.suggestion_status NOT IN ('accepted', 'edited')
       OR candidate.reviewed_by IS NULL OR candidate.reviewed_at IS NULL
       OR candidate.version IS DISTINCT FROM (item->>'expectedVersion')::bigint
       OR candidate.provenance_hash IS DISTINCT FROM item->>'provenanceHash' THEN
      RAISE EXCEPTION 'ENTERPRISE_EVIDENCE_CANDIDATE_STALE';
    END IF;

    SELECT * INTO source
    FROM public.enterprise_evidence_sources
    WHERE id = candidate.source_id;
    SELECT * INTO source_version
    FROM public.enterprise_evidence_source_versions
    WHERE id = candidate.source_version_id;
    IF source.id IS NULL OR source.org_id IS DISTINCT FROM p_org
       OR source.workspace_id IS DISTINCT FROM p_workspace
       OR source.deleted_at IS NOT NULL
       OR source.current_version IS DISTINCT FROM source_version.version
       OR source_version.id IS NULL
       OR source_version.source_id IS DISTINCT FROM p_source
       OR source_version.org_id IS DISTINCT FROM p_org
       OR source_version.workspace_id IS DISTINCT FROM p_workspace
       OR source_version.extraction_status <> 'parsed'
       OR source_version.extracted_text_hash IS NULL THEN
      RAISE EXCEPTION 'ENTERPRISE_EVIDENCE_CANDIDATE_STALE';
    END IF;

    current_provenance := public.enterprise_sha256_jsonb(jsonb_build_object(
      'sourceVersionId', candidate.source_version_id,
      'sourceContentHash', source_version.content_hash,
      'extractedTextHash', source_version.extracted_text_hash,
      'sourceLocator', candidate.source_locator,
      'safeExcerpt', candidate.safe_excerpt,
      'fieldKey', candidate.field_key,
      'value', candidate.value,
      'candidateVersion', candidate.version
    ));
    current_excerpt := public.enterprise_evidence_excerpt_anchor_hash(
      candidate.source_version_id, source_version.content_hash, source_version.extracted_text_hash,
      candidate.source_locator, candidate.safe_excerpt, candidate.value
    );
    IF candidate.provenance_hash IS DISTINCT FROM current_provenance
       OR candidate.excerpt_hash IS DISTINCT FROM current_excerpt THEN
      RAISE EXCEPTION 'ENTERPRISE_EVIDENCE_CANDIDATE_STALE';
    END IF;

    IF candidate.suggestion_status = 'edited' THEN
      SELECT * INTO edit
      FROM public.enterprise_evidence_candidate_edits
      WHERE candidate_id = candidate.id AND org_id = p_org AND workspace_id = p_workspace
        AND resulting_version = candidate.version
      ORDER BY created_at DESC LIMIT 1;
      IF edit.id IS NULL OR edit.actor_id IS DISTINCT FROM candidate.reviewed_by
         OR edit.next_value IS DISTINCT FROM candidate.value
         OR edit.resulting_provenance_hash IS DISTINCT FROM candidate.provenance_hash
         OR edit.created_at > candidate.reviewed_at THEN
        RAISE EXCEPTION 'ENTERPRISE_EVIDENCE_EDIT_HISTORY_REQUIRED';
      END IF;
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.enterprise_evidence_assess_promotions
      WHERE candidate_id = candidate.id
    ) THEN
      RAISE EXCEPTION 'ENTERPRISE_EVIDENCE_ALREADY_PROMOTED';
    END IF;
  END LOOP;

  -- The accepted all-or-nothing transaction remains intact. Each candidate
  -- advances one immutable draft version and adds one strict Assess author
  -- evidence submission plus one relational Enterprise lineage row.
  FOR item, item_ordinal IN
    SELECT value, ordinality
    FROM jsonb_array_elements(p_candidates) WITH ORDINALITY
    ORDER BY ordinality
  LOOP
    SELECT * INTO candidate
    FROM public.enterprise_evidence_candidates
    WHERE id = (item->>'candidateId')::uuid;
    SELECT * INTO old_version
    FROM public.assess_v2_case_versions
    WHERE id = assess_case.head_version_id AND case_id = assess_case.id;

    INSERT INTO public.assess_v2_case_versions(
      case_id, org_id, workspace_id, version, name, description,
      agent_necessity, source_kind, source_snapshot, imported_facts, created_by
    ) VALUES (
      assess_case.id, p_org, p_workspace, assess_case.version + 1,
      old_version.name, old_version.description, old_version.agent_necessity,
      'draft_upsert', old_version.source_snapshot, old_version.imported_facts, p_actor
    ) RETURNING * INTO new_version;

    INSERT INTO public.assess_v2_primitives
      SELECT id, new_version.id, case_id, org_id, workspace_id, payload
      FROM public.assess_v2_primitives WHERE version_id = old_version.id;
    INSERT INTO public.assess_v2_edges
      SELECT id, new_version.id, case_id, org_id, workspace_id, payload
      FROM public.assess_v2_edges WHERE version_id = old_version.id;
    INSERT INTO public.assess_v2_decision_points
      SELECT id, new_version.id, case_id, org_id, workspace_id, payload
      FROM public.assess_v2_decision_points WHERE version_id = old_version.id;
    INSERT INTO public.assess_v2_exception_paths
      SELECT id, new_version.id, case_id, org_id, workspace_id, payload
      FROM public.assess_v2_exception_paths WHERE version_id = old_version.id;
    INSERT INTO public.assess_v2_application_assets
      SELECT id, new_version.id, case_id, org_id, workspace_id, payload
      FROM public.assess_v2_application_assets WHERE version_id = old_version.id;
    INSERT INTO public.assess_v2_application_interactions
      SELECT id, new_version.id, case_id, org_id, workspace_id, payload
      FROM public.assess_v2_application_interactions WHERE version_id = old_version.id;
    INSERT INTO public.assess_v2_evidence_links(id, version_id, case_id, org_id, workspace_id, payload)
      SELECT id, new_version.id, case_id, org_id, workspace_id, payload
      FROM public.assess_v2_evidence_links WHERE version_id = old_version.id;

    evidence_link_id := gen_random_uuid();
    INSERT INTO public.assess_v2_evidence_links(
      id, version_id, case_id, org_id, workspace_id, payload
    ) VALUES (
      evidence_link_id, new_version.id, assess_case.id, p_org, p_workspace,
      public.enterprise_build_assess_v2_evidence_submission(
        evidence_link_id, source.source_kind, source.mime_type
      )
    );

    UPDATE public.assess_v2_cases
    SET version = new_version.version, head_version_id = new_version.id,
        updated_at = statement_timestamp()
    WHERE id = assess_case.id;
    assess_case.version := new_version.version;
    assess_case.head_version_id := new_version.id;

    INSERT INTO public.enterprise_evidence_assess_promotions(
      org_id, workspace_id, candidate_id, source_id, source_version_id,
      assess_case_id, assess_case_version_id, assess_evidence_link_id,
      assess_case_version, candidate_version, candidate_provenance_hash,
      field_key, promoted_by
    ) VALUES (
      p_org, p_workspace, candidate.id, candidate.source_id, candidate.source_version_id,
      assess_case.id, new_version.id, evidence_link_id,
      new_version.version, candidate.version, candidate.provenance_hash,
      candidate.field_key, p_actor
    ) RETURNING * INTO promotion;

    INSERT INTO public.privileged_audit_events(
      org_id, workspace_id, actor_id, request_id, action, resource_type,
      resource_id, outcome, resource_version, metadata
    ) VALUES (
      p_org, p_workspace, p_actor, receipt.last_request_id,
      'evidence.candidate.promote', 'assess_v2_case', assess_case.id,
      'succeeded', new_version.version, jsonb_build_object(
        'promotionId', promotion.id, 'candidateId', candidate.id,
        'candidateVersion', candidate.version,
        'candidateProvenanceHash', candidate.provenance_hash,
        'assessEvidenceLinkId', evidence_link_id,
        'batchReceiptId', receipt.id, 'batchOrdinal', item_ordinal
      )
    );
    candidate_ids := candidate_ids || jsonb_build_array(candidate.id);
    promotion_ids := promotion_ids || jsonb_build_array(promotion.id);
    evidence_link_ids := evidence_link_ids || jsonb_build_array(evidence_link_id);
  END LOOP;

  result := jsonb_build_object(
    'resourceId', assess_case.id,
    'sourceId', p_source,
    'assessDraftId', assess_case.id,
    'startVersion', p_expected_version,
    'finalVersion', assess_case.version,
    'candidateIds', candidate_ids,
    'promotedCandidateCount', selected_count,
    'promotionIds', promotion_ids,
    'evidenceLinkIds', evidence_link_ids,
    'assessDraftVersionLabel', 'Assess draft version ' || assess_case.version::text,
    'status', 'promoted'
  );
  PERFORM public.enterprise_ai_record_effect(
    receipt.id, p_org, p_workspace, p_execution_token, p_execution_fence,
    'evidence.assess.promote', 'command', assess_case.id, result, 'committed'
  );
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION
  public.enterprise_assess_v2_source_type(TEXT,TEXT),
  public.enterprise_build_assess_v2_evidence_submission(UUID,TEXT,TEXT),
  public.enterprise_assess_v2_evidence_submission_is_canonical(UUID,JSONB),
  public.enterprise_promoted_assess_evidence_guard()
FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION
  public.enterprise_promote_evidence_batch_to_assess_v2(
    UUID,JSONB,UUID,BIGINT,UUID,UUID,UUID,BIGINT,UUID,UUID,BIGINT
  )
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.enterprise_promote_evidence_batch_to_assess_v2(
    UUID,JSONB,UUID,BIGINT,UUID,UUID,UUID,BIGINT,UUID,UUID,BIGINT
  )
TO service_role;

COMMENT ON FUNCTION public.enterprise_promote_evidence_batch_to_assess_v2(
  UUID,JSONB,UUID,BIGINT,UUID,UUID,UUID,BIGINT,UUID,UUID,BIGINT
)
IS 'Atomically promotes reviewed Enterprise candidates as strict Assess evidence while preserving the prior immutable Assess source_snapshot, imported_facts, and authoring state.';

