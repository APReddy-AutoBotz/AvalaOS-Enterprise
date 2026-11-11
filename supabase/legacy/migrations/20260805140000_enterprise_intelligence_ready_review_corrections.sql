-- Forward-only corrections for the independent Ready review of PR #221.
-- This migration seeds and validates exact route-role authority, makes source
-- parsing recoverable, and admits fully reviewed edited evidence promotion.

CREATE OR REPLACE FUNCTION public.enterprise_provider_route_role_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE seeded_role UUID;
BEGIN
  -- Preserve the table's tenant-composite FK as the canonical rejection for a
  -- provider configuration from another organization.
  IF TG_OP = 'INSERT' AND NOT EXISTS (
    SELECT 1 FROM public.ai_provider_configs config
    WHERE config.id = NEW.provider_config_id AND config.org_id = NEW.org_id
  ) THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' AND COALESCE(cardinality(NEW.allowed_roles), 0) = 0 THEN
    SELECT r.id INTO seeded_role
    FROM public.workspace_memberships membership
    JOIN public.roles r ON r.id = membership.role_id
    WHERE membership.user_id = NEW.created_by
      AND membership.org_id = NEW.org_id AND membership.workspace_id = NEW.workspace_id
      AND membership.status = 'active' AND membership.deleted_at IS NULL
      AND r.scope = 'workspace' AND r.org_id = NEW.org_id AND r.workspace_id = NEW.workspace_id
      AND r.status = 'active' AND r.deleted_at IS NULL
    LIMIT 1;
    IF seeded_role IS NULL THEN
      SELECT r.id INTO seeded_role
      FROM public.organization_members membership
      JOIN public.roles r ON r.id = membership.role_id
      JOIN public.role_capabilities capability ON capability.role_id = r.id AND capability.capability_key = 'org.admin'
      WHERE membership.user_id = NEW.created_by AND membership.org_id = NEW.org_id
        AND membership.status = 'active' AND membership.deleted_at IS NULL
        AND r.scope = 'organization' AND r.org_id = NEW.org_id AND r.workspace_id IS NULL
        AND r.status = 'active' AND r.deleted_at IS NULL
      LIMIT 1;
    END IF;
    IF seeded_role IS NULL THEN RAISE EXCEPTION 'ENTERPRISE_PROVIDER_ROUTE_ROLE_REQUIRED'; END IF;
    NEW.allowed_roles := ARRAY[seeded_role::text];
  END IF;

  IF TG_OP = 'INSERT' OR NEW.allowed_roles IS DISTINCT FROM OLD.allowed_roles OR NEW.enabled THEN
    IF COALESCE(cardinality(NEW.allowed_roles), 0) = 0 OR EXISTS (
      SELECT 1 FROM unnest(NEW.allowed_roles) selected(role_id)
      WHERE selected.role_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
         OR NOT EXISTS (
           SELECT 1 FROM public.roles r
           WHERE r.id::text = selected.role_id AND r.org_id = NEW.org_id
             AND r.status = 'active' AND r.deleted_at IS NULL
             AND (
               (r.scope = 'workspace' AND r.workspace_id = NEW.workspace_id)
               OR (r.scope = 'organization' AND r.workspace_id IS NULL AND EXISTS (
                 SELECT 1 FROM public.role_capabilities capability
                 WHERE capability.role_id = r.id AND capability.capability_key = 'org.admin'
               ))
             )
         )
    ) THEN
      RAISE EXCEPTION 'ENTERPRISE_PROVIDER_ROUTE_ROLES_INVALID';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enterprise_provider_route_role_guard_before_write ON public.enterprise_ai_capability_routes;
CREATE TRIGGER enterprise_provider_route_role_guard_before_write
  BEFORE INSERT OR UPDATE OF allowed_roles, enabled ON public.enterprise_ai_capability_routes
  FOR EACH ROW EXECUTE FUNCTION public.enterprise_provider_route_role_guard();

CREATE OR REPLACE FUNCTION public.enterprise_create_evidence_source_record(
  p_source JSONB, p_version JSONB, p_receipt UUID, p_execution_token UUID,
  p_execution_fence BIGINT, p_result JSONB
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE committed JSONB;
BEGIN
  committed := public.enterprise_create_evidence_source(p_source, p_version);
  PERFORM public.enterprise_ai_record_effect(
    p_receipt, (p_source->>'org_id')::uuid, (p_source->>'workspace_id')::uuid,
    p_execution_token, p_execution_fence, 'evidence.source.create', 'source-record',
    (p_source->>'id')::uuid, p_result, 'committed'
  );
  RETURN committed;
END;
$$;

CREATE OR REPLACE FUNCTION public.enterprise_record_source_extraction_success(
  p_source_version UUID, p_org UUID, p_workspace UUID,
  p_extracted_text_hash TEXT, p_extracted_character_count INTEGER,
  p_receipt UUID, p_execution_token UUID, p_execution_fence BIGINT, p_result JSONB
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE version public.enterprise_evidence_source_versions;
BEGIN
  PERFORM public.enterprise_assert_writable('ingestion');
  IF p_extracted_text_hash !~ '^[0-9a-f]{64}$' OR p_extracted_character_count < 1 THEN
    RAISE EXCEPTION 'ENTERPRISE_EVIDENCE_EXTRACTION_SUCCESS_INVALID';
  END IF;
  SELECT * INTO version FROM public.enterprise_evidence_source_versions
  WHERE id = p_source_version AND org_id = p_org AND workspace_id = p_workspace FOR UPDATE;
  IF version.id IS NULL OR version.extraction_status <> 'pending' THEN
    RAISE EXCEPTION 'ENTERPRISE_EVIDENCE_VERSION_CONFLICT';
  END IF;
  UPDATE public.enterprise_evidence_source_versions
  SET extraction_status = 'parsed', extracted_text_hash = p_extracted_text_hash,
      extracted_character_count = p_extracted_character_count, extraction_failure_code = NULL
  WHERE id = version.id;
  UPDATE public.enterprise_evidence_sources
  SET status = 'review', lifecycle_version = lifecycle_version + 1, updated_at = statement_timestamp()
  WHERE id = version.source_id AND org_id = p_org AND workspace_id = p_workspace;
  PERFORM public.enterprise_ai_record_effect(
    p_receipt, p_org, p_workspace, p_execution_token, p_execution_fence,
    'evidence.source.create', 'command', version.source_id, p_result, 'committed'
  );
  RETURN jsonb_build_object('sourceVersionId', version.id, 'status', 'parsed');
END;
$$;

CREATE OR REPLACE FUNCTION public.enterprise_record_source_extraction_failure(
  p_source_version UUID, p_org UUID, p_workspace UUID, p_failure_code TEXT,
  p_receipt UUID, p_execution_token UUID, p_execution_fence BIGINT, p_result JSONB
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE committed JSONB; v_source_id UUID;
BEGIN
  SELECT version.source_id INTO v_source_id FROM public.enterprise_evidence_source_versions version
  WHERE version.id = p_source_version AND version.org_id = p_org AND version.workspace_id = p_workspace;
  committed := public.enterprise_record_source_extraction_failure(p_source_version, p_org, p_workspace, p_failure_code);
  PERFORM public.enterprise_ai_record_effect(
    p_receipt, p_org, p_workspace, p_execution_token, p_execution_fence,
    'evidence.source.create', 'command', v_source_id, p_result, 'committed'
  );
  RETURN committed;
END;
$$;

CREATE OR REPLACE FUNCTION public.enterprise_promote_evidence_to_assess_v2(
  p_candidate UUID, p_case UUID, p_expected_version BIGINT,
  p_actor UUID, p_org UUID, p_workspace UUID,
  p_request UUID, p_idempotency_key TEXT, p_authorization_version BIGINT
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE candidate public.enterprise_evidence_candidates; source public.enterprise_evidence_sources;
  source_version public.enterprise_evidence_source_versions; edit public.enterprise_evidence_candidate_edits;
  assess_case public.assess_v2_cases; old_version public.assess_v2_case_versions; new_version public.assess_v2_case_versions;
  receipt public.enterprise_ai_command_receipts; promotion public.enterprise_evidence_assess_promotions;
  request_hash TEXT; current_provenance TEXT; current_excerpt TEXT; result JSONB;
BEGIN
  PERFORM public.enterprise_assert_writable('ingestion');
  PERFORM public.pr1b_assert_command_authority(p_actor, p_org, p_workspace, 'assessment.edit', p_authorization_version);
  request_hash := public.enterprise_sha256_jsonb(jsonb_build_object(
    'candidateId', p_candidate, 'caseId', p_case, 'expectedVersion', p_expected_version,
    'organizationId', p_org, 'workspaceId', p_workspace
  ));
  receipt := public.enterprise_ai_claim_command(p_actor, p_org, p_workspace, 'evidence.assess.promote', p_idempotency_key, p_request, request_hash, NULL);
  IF receipt.status = 'committed' THEN
    RETURN jsonb_build_object('outcome', 'replayed', 'resource', receipt.response);
  ELSIF receipt.status <> 'claimed' OR receipt.created_at < statement_timestamp() - interval '5 minutes' THEN
    RAISE EXCEPTION 'ENTERPRISE_AI_COMMAND_NOT_EXECUTABLE';
  END IF;
  SELECT * INTO candidate FROM public.enterprise_evidence_candidates
  WHERE id = p_candidate AND org_id = p_org AND workspace_id = p_workspace FOR SHARE;
  IF candidate.id IS NULL OR candidate.suggestion_status NOT IN ('accepted', 'edited')
     OR candidate.reviewed_by IS NULL OR candidate.reviewed_at IS NULL THEN
    RAISE EXCEPTION 'ENTERPRISE_EVIDENCE_CANDIDATE_NOT_ACCEPTED';
  END IF;
  SELECT * INTO source_version FROM public.enterprise_evidence_source_versions
  WHERE id = candidate.source_version_id AND source_id = candidate.source_id
    AND org_id = p_org AND workspace_id = p_workspace FOR SHARE;
  SELECT * INTO source FROM public.enterprise_evidence_sources
  WHERE id = candidate.source_id AND org_id = p_org AND workspace_id = p_workspace FOR SHARE;
  IF source_version.id IS NULL OR source.id IS NULL OR source.current_version <> source_version.version
     OR source_version.extraction_status <> 'parsed' OR source_version.extracted_text_hash IS NULL THEN
    RAISE EXCEPTION 'ENTERPRISE_EVIDENCE_CANDIDATE_STALE';
  END IF;
  current_provenance := public.enterprise_sha256_jsonb(jsonb_build_object(
    'sourceVersionId', candidate.source_version_id, 'sourceContentHash', source_version.content_hash,
    'extractedTextHash', source_version.extracted_text_hash, 'sourceLocator', candidate.source_locator,
    'safeExcerpt', candidate.safe_excerpt, 'fieldKey', candidate.field_key, 'value', candidate.value,
    'candidateVersion', candidate.version
  ));
  current_excerpt := encode(public.digest(convert_to(candidate.safe_excerpt, 'UTF8'), 'sha256'), 'hex');
  IF candidate.provenance_hash IS DISTINCT FROM current_provenance
     OR candidate.excerpt_hash IS DISTINCT FROM current_excerpt THEN
    RAISE EXCEPTION 'ENTERPRISE_EVIDENCE_CANDIDATE_STALE';
  END IF;
  IF candidate.suggestion_status = 'edited' THEN
    SELECT * INTO edit FROM public.enterprise_evidence_candidate_edits
    WHERE candidate_id = candidate.id AND org_id = p_org AND workspace_id = p_workspace
      AND resulting_version = candidate.version ORDER BY created_at DESC LIMIT 1;
    IF edit.id IS NULL OR edit.actor_id IS DISTINCT FROM candidate.reviewed_by
       OR edit.next_value IS DISTINCT FROM candidate.value
       OR edit.resulting_provenance_hash IS DISTINCT FROM candidate.provenance_hash
       OR edit.created_at > candidate.reviewed_at THEN
      RAISE EXCEPTION 'ENTERPRISE_EVIDENCE_EDIT_HISTORY_REQUIRED';
    END IF;
  END IF;
  SELECT * INTO assess_case FROM public.assess_v2_cases
  WHERE id = p_case AND org_id = p_org AND workspace_id = p_workspace AND deleted_at IS NULL FOR UPDATE;
  IF assess_case.id IS NULL OR assess_case.status <> 'draft' OR assess_case.version <> p_expected_version THEN
    RAISE EXCEPTION 'ENTERPRISE_EVIDENCE_ASSESS_VERSION_CONFLICT';
  END IF;
  SELECT * INTO old_version FROM public.assess_v2_case_versions WHERE id = assess_case.head_version_id AND case_id = assess_case.id FOR SHARE;
  INSERT INTO public.assess_v2_case_versions(case_id,org_id,workspace_id,version,name,description,agent_necessity,source_kind,source_snapshot,created_by)
  VALUES(assess_case.id,p_org,p_workspace,assess_case.version+1,old_version.name,old_version.description,old_version.agent_necessity,'draft_upsert',
    jsonb_build_object('promotion',jsonb_build_object('candidateId',candidate.id,'candidateVersion',candidate.version,'candidateProvenanceHash',candidate.provenance_hash,'sourceId',candidate.source_id,'sourceVersionId',candidate.source_version_id)),p_actor)
  RETURNING * INTO new_version;
  INSERT INTO public.assess_v2_primitives SELECT id,new_version.id,case_id,org_id,workspace_id,payload FROM public.assess_v2_primitives WHERE version_id=old_version.id;
  INSERT INTO public.assess_v2_edges SELECT id,new_version.id,case_id,org_id,workspace_id,payload FROM public.assess_v2_edges WHERE version_id=old_version.id;
  INSERT INTO public.assess_v2_decision_points SELECT id,new_version.id,case_id,org_id,workspace_id,payload FROM public.assess_v2_decision_points WHERE version_id=old_version.id;
  INSERT INTO public.assess_v2_exception_paths SELECT id,new_version.id,case_id,org_id,workspace_id,payload FROM public.assess_v2_exception_paths WHERE version_id=old_version.id;
  INSERT INTO public.assess_v2_application_assets SELECT id,new_version.id,case_id,org_id,workspace_id,payload FROM public.assess_v2_application_assets WHERE version_id=old_version.id;
  INSERT INTO public.assess_v2_application_interactions SELECT id,new_version.id,case_id,org_id,workspace_id,payload FROM public.assess_v2_application_interactions WHERE version_id=old_version.id;
  INSERT INTO public.assess_v2_evidence_links(id,version_id,case_id,org_id,workspace_id,payload)
    SELECT id,new_version.id,case_id,org_id,workspace_id,payload FROM public.assess_v2_evidence_links WHERE version_id=old_version.id;
  INSERT INTO public.assess_v2_evidence_links(id,version_id,case_id,org_id,workspace_id,payload)
  VALUES(gen_random_uuid(),new_version.id,assess_case.id,p_org,p_workspace,jsonb_build_object(
    'status','submitted','validated',false,'reviewerIds','[]'::jsonb,'kind','enterprise_evidence_candidate',
    'candidateId',candidate.id,'sourceId',candidate.source_id,'sourceVersionId',candidate.source_version_id,
    'fieldKey',candidate.field_key,'value',candidate.value,'sourceLocator',candidate.source_locator,
    'safeExcerpt',candidate.safe_excerpt,'candidateVersion',candidate.version,'provenanceHash',candidate.provenance_hash));
  UPDATE public.assess_v2_cases SET version=new_version.version,head_version_id=new_version.id,updated_at=statement_timestamp() WHERE id=assess_case.id;
  INSERT INTO public.enterprise_evidence_assess_promotions(org_id,workspace_id,candidate_id,source_id,source_version_id,assess_case_id,assess_case_version_id,assess_case_version,candidate_version,candidate_provenance_hash,field_key,promoted_by)
  VALUES(p_org,p_workspace,candidate.id,candidate.source_id,candidate.source_version_id,assess_case.id,new_version.id,new_version.version,candidate.version,candidate.provenance_hash,candidate.field_key,p_actor)
  RETURNING * INTO promotion;
  INSERT INTO public.privileged_audit_events(org_id,workspace_id,actor_id,request_id,action,resource_type,resource_id,outcome,resource_version,metadata)
  VALUES(p_org,p_workspace,p_actor,p_request,'evidence.candidate.promote','assess_v2_case',assess_case.id,'succeeded',new_version.version,
    jsonb_build_object('promotionId',promotion.id,'candidateId',candidate.id,'candidateVersion',candidate.version,'candidateProvenanceHash',candidate.provenance_hash));
  result:=jsonb_build_object('promotionId',promotion.id,'candidateId',candidate.id,'caseId',assess_case.id,'caseVersionId',new_version.id,'caseVersion',new_version.version,'candidateProvenanceHash',candidate.provenance_hash);
  UPDATE public.enterprise_ai_command_receipts SET status='committed',response=result,resource_id=promotion.id,completed_at=statement_timestamp() WHERE id=receipt.id AND status='claimed';
  RETURN jsonb_build_object('outcome','committed','resource',result);
END;
$$;

REVOKE ALL ON FUNCTION public.enterprise_create_evidence_source_record(JSONB,JSONB,UUID,UUID,BIGINT,JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enterprise_record_source_extraction_success(UUID,UUID,UUID,TEXT,INTEGER,UUID,UUID,BIGINT,JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enterprise_record_source_extraction_failure(UUID,UUID,UUID,TEXT,UUID,UUID,BIGINT,JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enterprise_create_evidence_source_record(JSONB,JSONB,UUID,UUID,BIGINT,JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.enterprise_record_source_extraction_success(UUID,UUID,UUID,TEXT,INTEGER,UUID,UUID,BIGINT,JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.enterprise_record_source_extraction_failure(UUID,UUID,UUID,TEXT,UUID,UUID,BIGINT,JSONB) TO service_role;
