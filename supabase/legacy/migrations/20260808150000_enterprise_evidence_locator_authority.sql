-- Forward-only evidence provenance correction. Provider output is never source-
-- position authority; canonical locators are server-derived normalized-text
-- Unicode code-point ranges and are enforced at stage and canonical storage.

CREATE OR REPLACE FUNCTION public.enterprise_evidence_source_locator_is_canonical(p_locator TEXT)
RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE STRICT SET search_path = pg_catalog
AS $$
  SELECT p_locator ~ '^normalized-text:v1:chars:(0|[1-9][0-9]{0,11})-(0|[1-9][0-9]{0,11})$'
    AND split_part(split_part(p_locator, ':', 4), '-', 1)::bigint
      < split_part(split_part(p_locator, ':', 4), '-', 2)::bigint;
$$;

CREATE OR REPLACE FUNCTION public.enterprise_evidence_candidate_locators_are_canonical(p_candidates JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE STRICT SET search_path = pg_catalog
AS $$
DECLARE item JSONB;
BEGIN
  IF jsonb_typeof(p_candidates) <> 'array' OR jsonb_array_length(p_candidates) > 200 THEN
    RETURN false;
  END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_candidates) LOOP
    IF jsonb_typeof(item) <> 'object'
       OR item->>'sourceLocator' IS NULL
       OR NOT public.enterprise_evidence_source_locator_is_canonical(item->>'sourceLocator') THEN
      RETURN false;
    END IF;
  END LOOP;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.enterprise_evidence_excerpt_anchor_hash(
  p_source_version UUID,
  p_source_content_hash TEXT,
  p_extracted_text_hash TEXT,
  p_source_locator TEXT,
  p_safe_excerpt TEXT,
  p_value TEXT
)
RETURNS TEXT
LANGUAGE sql IMMUTABLE STRICT SET search_path = pg_catalog
AS $$
  SELECT encode(public.digest(convert_to(
    'evidence-excerpt-anchor-v1|'
    || octet_length(convert_to(p_source_version::text, 'UTF8'))::text || ':' || p_source_version::text || '|'
    || octet_length(convert_to(p_source_content_hash, 'UTF8'))::text || ':' || p_source_content_hash || '|'
    || octet_length(convert_to(p_extracted_text_hash, 'UTF8'))::text || ':' || p_extracted_text_hash || '|'
    || octet_length(convert_to(p_source_locator, 'UTF8'))::text || ':' || p_source_locator || '|'
    || octet_length(convert_to(p_safe_excerpt, 'UTF8'))::text || ':' || p_safe_excerpt || '|'
    || octet_length(convert_to(p_value, 'UTF8'))::text || ':' || p_value,
    'UTF8'
  ), 'sha256'), 'hex');
$$;

ALTER TABLE public.enterprise_evidence_source_versions
  ALTER COLUMN source_locator_schema SET DEFAULT 'normalized-text-char-range-1',
  ADD CONSTRAINT enterprise_evidence_source_versions_locator_schema
    CHECK (source_locator_schema = 'normalized-text-char-range-1');

ALTER TABLE public.enterprise_evidence_candidates
  ADD CONSTRAINT enterprise_evidence_candidates_canonical_locator
    CHECK (public.enterprise_evidence_source_locator_is_canonical(source_locator));

ALTER TABLE public.enterprise_ai_extraction_staged_results
  ADD CONSTRAINT enterprise_ai_extraction_stage_canonical_locators
    CHECK (public.enterprise_evidence_candidate_locators_are_canonical(candidates));

CREATE OR REPLACE FUNCTION public.enterprise_candidate_derive()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE version public.enterprise_evidence_source_versions;
BEGIN
  SELECT * INTO version
  FROM public.enterprise_evidence_source_versions
  WHERE id = NEW.source_version_id AND source_id = NEW.source_id
    AND org_id = NEW.org_id AND workspace_id = NEW.workspace_id
  FOR SHARE;
  IF version.id IS NULL OR version.extraction_status <> 'parsed' OR version.extracted_text_hash IS NULL THEN
    RAISE EXCEPTION 'ENTERPRISE_EVIDENCE_SOURCE_NOT_PARSED';
  END IF;
  IF NEW.safe_excerpt IS NULL OR length(btrim(NEW.safe_excerpt)) = 0 THEN
    RAISE EXCEPTION 'ENTERPRISE_EVIDENCE_ANCHOR_REQUIRED';
  END IF;
  IF NOT public.enterprise_evidence_source_locator_is_canonical(NEW.source_locator) THEN
    RAISE EXCEPTION 'ENTERPRISE_EVIDENCE_LOCATOR_INVALID';
  END IF;
  NEW.excerpt_hash := public.enterprise_evidence_excerpt_anchor_hash(
    version.id, version.content_hash, version.extracted_text_hash,
    NEW.source_locator, NEW.safe_excerpt, NEW.value
  );
  NEW.provenance_hash := public.enterprise_sha256_jsonb(jsonb_build_object(
    'sourceVersionId', version.id, 'sourceContentHash', version.content_hash,
    'extractedTextHash', version.extracted_text_hash, 'sourceLocator', NEW.source_locator,
    'safeExcerpt', NEW.safe_excerpt, 'fieldKey', NEW.field_key, 'value', NEW.value,
    'candidateVersion', NEW.version
  ));
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.enterprise_candidate_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE
  source_version public.enterprise_evidence_source_versions;
  expected_excerpt_hash TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'ENTERPRISE_APPEND_ONLY';
  END IF;
  IF NEW.value IS DISTINCT FROM OLD.value THEN
    SELECT * INTO source_version
    FROM public.enterprise_evidence_source_versions
    WHERE id = NEW.source_version_id
      AND source_id = NEW.source_id
      AND org_id = NEW.org_id
      AND workspace_id = NEW.workspace_id
    FOR SHARE;
    IF source_version.id IS NULL
       OR source_version.extraction_status <> 'parsed'
       OR source_version.extracted_text_hash IS NULL THEN
      RAISE EXCEPTION 'ENTERPRISE_EVIDENCE_CANDIDATE_STALE';
    END IF;
    expected_excerpt_hash := public.enterprise_evidence_excerpt_anchor_hash(
      NEW.source_version_id,
      source_version.content_hash,
      source_version.extracted_text_hash,
      NEW.source_locator,
      NEW.safe_excerpt,
      NEW.value
    );
  END IF;
  IF (to_jsonb(NEW) - ARRAY[
        'value','suggestion_status','reviewed_by','reviewed_at','updated_at',
        'version','excerpt_hash','provenance_hash'
      ]) IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY[
        'value','suggestion_status','reviewed_by','reviewed_at','updated_at',
        'version','excerpt_hash','provenance_hash'
      ])
     OR OLD.suggestion_status IN ('accepted','rejected')
     OR NEW.suggestion_status NOT IN ('edited','accepted','rejected')
     OR (
       NEW.value IS DISTINCT FROM OLD.value
       AND (
         NEW.version <> OLD.version + 1
         OR NEW.provenance_hash = OLD.provenance_hash
         OR NEW.excerpt_hash IS DISTINCT FROM expected_excerpt_hash
       )
     )
     OR (
       NEW.value IS NOT DISTINCT FROM OLD.value
       AND (
         NEW.version <> OLD.version
         OR NEW.excerpt_hash IS DISTINCT FROM OLD.excerpt_hash
       )
     ) THEN
    RAISE EXCEPTION 'ENTERPRISE_CANDIDATE_IMMUTABLE_OR_TRANSITION_INVALID';
  END IF;
  RETURN NEW;
END;
$$;

-- Review keeps the source locator immutable and derives the edited anchor from
-- database-owned source/version state. p_excerpt_hash remains in the accepted
-- RPC ABI but is intentionally not trusted as persistence authority.
CREATE OR REPLACE FUNCTION public.enterprise_review_evidence_candidate(
  p_candidate_id UUID, p_org UUID, p_workspace UUID, p_value TEXT,
  p_excerpt_hash TEXT, p_status TEXT, p_actor UUID,
  p_previous_value TEXT, p_reason TEXT
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  candidate public.enterprise_evidence_candidates;
  source_version public.enterprise_evidence_source_versions;
  next_hash TEXT;
  next_excerpt_hash TEXT;
  auth_version BIGINT;
BEGIN
  PERFORM public.enterprise_assert_writable('ingestion');
  SELECT version INTO auth_version
  FROM public.authorization_versions
  WHERE org_id = p_org AND user_id = p_actor;
  PERFORM public.pr1b_assert_command_authority(
    p_actor, p_org, p_workspace, 'evidence.review', auth_version
  );
  SELECT * INTO candidate
  FROM public.enterprise_evidence_candidates
  WHERE id = p_candidate_id AND org_id = p_org AND workspace_id = p_workspace
  FOR UPDATE;
  IF candidate.id IS NULL THEN
    RAISE EXCEPTION 'ENTERPRISE_AI_CANDIDATE_NOT_FOUND';
  END IF;
  IF candidate.suggestion_status IN ('accepted', 'rejected')
     OR candidate.value IS DISTINCT FROM p_previous_value
     OR p_status NOT IN ('accepted', 'rejected', 'edited') THEN
    RAISE EXCEPTION 'ENTERPRISE_EVIDENCE_VERSION_CONFLICT';
  END IF;
  SELECT * INTO source_version
  FROM public.enterprise_evidence_source_versions
  WHERE id = candidate.source_version_id
    AND source_id = candidate.source_id
    AND org_id = p_org
    AND workspace_id = p_workspace
  FOR SHARE;
  IF source_version.id IS NULL
     OR source_version.extraction_status <> 'parsed'
     OR source_version.extracted_text_hash IS NULL THEN
    RAISE EXCEPTION 'ENTERPRISE_EVIDENCE_CANDIDATE_STALE';
  END IF;
  next_excerpt_hash := public.enterprise_evidence_excerpt_anchor_hash(
    candidate.source_version_id,
    source_version.content_hash,
    source_version.extracted_text_hash,
    candidate.source_locator,
    candidate.safe_excerpt,
    p_value
  );
  next_hash := public.enterprise_sha256_jsonb(jsonb_build_object(
    'sourceVersionId', candidate.source_version_id,
    'sourceContentHash', source_version.content_hash,
    'extractedTextHash', source_version.extracted_text_hash,
    'sourceLocator', candidate.source_locator,
    'safeExcerpt', candidate.safe_excerpt,
    'fieldKey', candidate.field_key,
    'value', p_value,
    'candidateVersion', candidate.version + CASE WHEN p_status = 'edited' THEN 1 ELSE 0 END
  ));
  IF p_status = 'edited' THEN
    INSERT INTO public.enterprise_evidence_candidate_edits(
      candidate_id, org_id, workspace_id, actor_id, previous_value, next_value,
      previous_version, resulting_version, previous_provenance_hash,
      resulting_provenance_hash, reason
    ) VALUES (
      candidate.id, p_org, p_workspace, p_actor, candidate.value, p_value,
      candidate.version, candidate.version + 1, candidate.provenance_hash,
      next_hash, p_reason
    );
  END IF;
  UPDATE public.enterprise_evidence_candidates
  SET value = p_value,
      excerpt_hash = next_excerpt_hash,
      suggestion_status = p_status,
      reviewed_by = p_actor,
      reviewed_at = statement_timestamp(),
      updated_at = statement_timestamp(),
      version = version + CASE WHEN p_status = 'edited' THEN 1 ELSE 0 END,
      provenance_hash = next_hash
  WHERE id = candidate.id;
  RETURN jsonb_build_object(
    'candidateId', candidate.id,
    'status', p_status,
    'reviewedBy', p_actor,
    'version', candidate.version + CASE WHEN p_status = 'edited' THEN 1 ELSE 0 END,
    'excerptHash', next_excerpt_hash,
    'provenanceHash', next_hash
  );
END;
$$;

-- Preserve both accepted promotion transactions verbatim while advancing their
-- anchor verification to the same locator-bound hash contract. The guarded
-- rewrite fails migration application if either accepted predecessor body is
-- not the exact expected definition; it cannot silently weaken or partially
-- replace either transaction.
DO $migration$
DECLARE
  promotion_function REGPROCEDURE;
  definition TEXT;
  old_anchor TEXT := $old$current_excerpt := encode(public.digest(convert_to(candidate.safe_excerpt, 'UTF8'), 'sha256'), 'hex');$old$;
  new_anchor TEXT := $new$current_excerpt := public.enterprise_evidence_excerpt_anchor_hash(
      candidate.source_version_id, source_version.content_hash, source_version.extracted_text_hash,
      candidate.source_locator, candidate.safe_excerpt, candidate.value
    );$new$;
BEGIN
  FOREACH promotion_function IN ARRAY ARRAY[
    'public.enterprise_promote_evidence_to_assess_v2(uuid,uuid,bigint,uuid,uuid,uuid,uuid,text,bigint)'::regprocedure,
    'public.enterprise_promote_evidence_batch_to_assess_v2(uuid,jsonb,uuid,bigint,uuid,uuid,uuid,bigint,uuid,uuid,bigint)'::regprocedure
  ] LOOP
    SELECT pg_get_functiondef(promotion_function) INTO definition;
    IF definition IS NULL
       OR position(old_anchor IN definition) = 0
       OR position('enterprise_evidence_excerpt_anchor_hash' IN definition) > 0 THEN
      RAISE EXCEPTION 'ENTERPRISE_EVIDENCE_PROMOTION_ANCHOR_CONTRACT_DRIFT: %', promotion_function;
    END IF;
    EXECUTE replace(definition, old_anchor, new_anchor);
  END LOOP;
END;
$migration$;

REVOKE ALL ON FUNCTION
  public.enterprise_evidence_source_locator_is_canonical(TEXT),
  public.enterprise_evidence_candidate_locators_are_canonical(JSONB),
  public.enterprise_evidence_excerpt_anchor_hash(UUID,TEXT,TEXT,TEXT,TEXT,TEXT)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.enterprise_evidence_source_locator_is_canonical(TEXT),
  public.enterprise_evidence_candidate_locators_are_canonical(JSONB),
  public.enterprise_evidence_excerpt_anchor_hash(UUID,TEXT,TEXT,TEXT,TEXT,TEXT)
TO service_role;

COMMENT ON FUNCTION public.enterprise_evidence_source_locator_is_canonical(TEXT)
IS 'Validates normalized-text:v1:chars:<start>-<end>, a zero-based half-open Unicode code-point range derived only from governed extracted text.';
COMMENT ON FUNCTION public.enterprise_evidence_excerpt_anchor_hash(UUID,TEXT,TEXT,TEXT,TEXT,TEXT)
IS 'Hashes a length-framed server-derived evidence anchor; provider locator fields never enter this contract.';
COMMENT ON FUNCTION public.enterprise_promote_evidence_to_assess_v2(
  UUID,UUID,BIGINT,UUID,UUID,UUID,UUID,TEXT,BIGINT
)
IS 'Private single-candidate promotion implementation with locator-bound evidence-anchor verification.';
COMMENT ON FUNCTION public.enterprise_promote_evidence_batch_to_assess_v2(
  UUID,JSONB,UUID,BIGINT,UUID,UUID,UUID,BIGINT,UUID,UUID,BIGINT
)
IS 'Service-only fenced all-or-nothing promotion of a receipt-owned candidate set with locator-bound evidence-anchor verification.';
