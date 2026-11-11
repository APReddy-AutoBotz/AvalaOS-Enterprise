-- Ready-review correction: database-canonical review identity, action identity,
-- and receipt replay authorization. Historical migrations remain unchanged.

CREATE OR REPLACE FUNCTION public.enterprise_resolve_high_impact_review_authority(
  p_resource_type TEXT,
  p_resource_id UUID,
  p_actor UUID,
  p_org UUID,
  p_workspace UUID,
  p_authorization_version BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  snapshot RECORD;
  review RECORD;
  actor_authorization BIGINT;
BEGIN
  SELECT * INTO snapshot
  FROM public.enterprise_resource_snapshot(p_resource_type, p_resource_id, p_org, p_workspace);

  IF snapshot.created_by IS NULL
     OR snapshot.created_by = p_actor
     OR snapshot.resource_status IN ('approved', 'rejected', 'stale', 'blocked') THEN
    RAISE EXCEPTION 'ENTERPRISE_APPROVAL_SEPARATION_OR_STATE_INVALID';
  END IF;

  SELECT version INTO actor_authorization
  FROM public.authorization_versions
  WHERE org_id = p_org AND user_id = p_actor;
  IF actor_authorization IS NULL
     OR actor_authorization IS DISTINCT FROM p_authorization_version THEN
    RAISE EXCEPTION 'ENTERPRISE_APPROVAL_AUTHORIZATION_STALE';
  END IF;
  PERFORM public.pr1b_assert_command_authority(
    p_actor, p_org, p_workspace, 'approvals.review', actor_authorization
  );

  SELECT e.id, e.reviewer_id, e.reviewer_authorization_version
  INTO review
  FROM public.enterprise_high_impact_review_events e
  JOIN public.authorization_versions av
    ON av.org_id = e.org_id
   AND av.user_id = e.reviewer_id
   AND av.version = e.reviewer_authorization_version
  WHERE e.org_id = p_org
    AND e.workspace_id = p_workspace
    AND e.resource_type = p_resource_type
    AND e.resource_id = p_resource_id
    AND e.resource_version = snapshot.resource_version
    AND e.resource_hash = snapshot.resource_hash
    AND e.outcome = 'approved'
    AND e.reviewer_id <> p_actor
    AND e.reviewer_id <> snapshot.created_by
  ORDER BY e.created_at DESC, e.id DESC
  LIMIT 1;

  IF review.id IS NULL THEN
    RAISE EXCEPTION 'ENTERPRISE_APPROVAL_REVIEW_REQUIRED';
  END IF;
  PERFORM public.pr1b_assert_command_authority(
    review.reviewer_id, p_org, p_workspace, 'approvals.review',
    review.reviewer_authorization_version
  );

  RETURN jsonb_build_object(
    'resourceType', p_resource_type,
    'resourceId', p_resource_id,
    'resourceCreatedBy', snapshot.created_by,
    'resourceVersion', snapshot.resource_version,
    'resourceHash', snapshot.resource_hash,
    'resourceStatus', snapshot.resource_status,
    'reviewEventId', review.id,
    'reviewerId', review.reviewer_id,
    'reviewerAuthorizationVersion', review.reviewer_authorization_version
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.enterprise_record_high_impact_review_v2(
  p_event_id UUID,
  p_resource_type TEXT,
  p_resource_id UUID,
  p_actor UUID,
  p_org UUID,
  p_workspace UUID,
  p_authorization_version BIGINT,
  p_rationale TEXT,
  p_receipt UUID,
  p_execution_token UUID,
  p_execution_fence BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  event RECORD;
  result JSONB;
BEGIN
  PERFORM public.enterprise_assert_writable(
    CASE WHEN p_resource_type = 'assemble_blueprint' THEN 'assemble' ELSE 'delivery' END
  );

  INSERT INTO public.enterprise_high_impact_review_events(
    id, org_id, workspace_id, resource_type, resource_id, reviewer_id,
    reviewer_authorization_version, rationale
  ) VALUES (
    p_event_id, p_org, p_workspace, p_resource_type, p_resource_id, p_actor,
    p_authorization_version, p_rationale
  )
  RETURNING * INTO event;

  result := jsonb_build_object(
    'reviewEventId', event.id,
    'resourceType', event.resource_type,
    'resourceId', event.resource_id,
    'reviewerId', event.reviewer_id,
    'reviewerAuthorizationVersion', event.reviewer_authorization_version,
    'resourceVersion', event.resource_version,
    'resourceHash', event.resource_hash,
    'outcome', event.outcome
  );

  PERFORM public.enterprise_ai_record_effect(
    p_receipt, p_org, p_workspace, p_execution_token, p_execution_fence,
    'approval.review.record', 'command', p_resource_id, result, 'committed'
  );
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.enterprise_commit_high_impact_approval_v2(
  p_resource_type TEXT,
  p_resource_id UUID,
  p_actor UUID,
  p_org UUID,
  p_workspace UUID,
  p_authorization_version BIGINT,
  p_review_event_id UUID,
  p_outcome TEXT,
  p_rationale TEXT,
  p_receipt UUID,
  p_execution_token UUID,
  p_execution_fence BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  authority JSONB;
  committed JSONB;
  result JSONB;
  next_status TEXT;
BEGIN
  PERFORM public.enterprise_assert_writable(
    CASE WHEN p_resource_type = 'assemble_blueprint' THEN 'assemble' ELSE 'delivery' END
  );
  next_status := CASE p_outcome
    WHEN 'approved' THEN 'approved'
    WHEN 'rejected' THEN 'rejected'
    ELSE NULL
  END;
  IF next_status IS NULL THEN
    RAISE EXCEPTION 'ENTERPRISE_APPROVAL_OUTCOME_INVALID';
  END IF;

  authority := public.enterprise_resolve_high_impact_review_authority(
    p_resource_type, p_resource_id, p_actor, p_org, p_workspace,
    p_authorization_version
  );
  IF authority->>'reviewEventId' IS DISTINCT FROM p_review_event_id::text THEN
    RAISE EXCEPTION 'ENTERPRISE_APPROVAL_REVIEW_IDENTITY_MISMATCH';
  END IF;

  committed := public.enterprise_commit_high_impact_approval(
    jsonb_build_object(
      'created_by', authority->>'resourceCreatedBy',
      'reviewed_by', authority->>'reviewerId',
      'approved_by', p_actor,
      'review_event_id', p_review_event_id,
      'outcome', p_outcome,
      'rationale', p_rationale
    ),
    p_resource_type, p_resource_id, p_org, p_workspace, next_status
  );
  result := committed || jsonb_build_object(
    'reviewEventId', p_review_event_id,
    'reviewedBy', authority->>'reviewerId',
    'approvedBy', p_actor
  );

  PERFORM public.enterprise_ai_record_effect(
    p_receipt, p_org, p_workspace, p_execution_token, p_execution_fence,
    'approval.record', 'command', p_resource_id, result, 'committed'
  );
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION
  public.enterprise_resolve_high_impact_review_authority(TEXT,UUID,UUID,UUID,UUID,BIGINT),
  public.enterprise_record_high_impact_review_v2(UUID,TEXT,UUID,UUID,UUID,UUID,BIGINT,TEXT,UUID,UUID,BIGINT),
  public.enterprise_commit_high_impact_approval_v2(TEXT,UUID,UUID,UUID,UUID,BIGINT,UUID,TEXT,TEXT,UUID,UUID,BIGINT)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.enterprise_resolve_high_impact_review_authority(TEXT,UUID,UUID,UUID,UUID,BIGINT),
  public.enterprise_record_high_impact_review_v2(UUID,TEXT,UUID,UUID,UUID,UUID,BIGINT,TEXT,UUID,UUID,BIGINT),
  public.enterprise_commit_high_impact_approval_v2(TEXT,UUID,UUID,UUID,UUID,BIGINT,UUID,TEXT,TEXT,UUID,UUID,BIGINT)
TO service_role;

-- Edge must no longer call wrappers that accept an application-supplied hash
-- or application-supplied review identity.
REVOKE ALL ON FUNCTION
  public.enterprise_record_high_impact_review(JSONB,UUID,UUID,BIGINT,JSONB),
  public.enterprise_commit_high_impact_approval(JSONB,TEXT,UUID,UUID,UUID,TEXT,UUID,UUID,BIGINT,JSONB)
FROM service_role;
