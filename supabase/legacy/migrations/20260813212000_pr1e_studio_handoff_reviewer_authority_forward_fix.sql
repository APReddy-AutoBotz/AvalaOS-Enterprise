-- PR 1E forward fix: keep Studio handoff bound to the still-current authority
-- of the exact reviewer assignment that produced the approved review.
-- Historical PR 1E rows remain immutable. Previously committed idempotent replays
-- bypass this new preflight and continue to replay through pr1e_review_command.

CREATE OR REPLACE FUNCTION public.pr1e_assert_current_approved_review_authority(
    p_org_id uuid,
    p_workspace_id uuid,
    p_case_id uuid,
    p_decision_id uuid,
    p_review_sequence bigint
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_resolution public.assess_v2_review_resolutions;
    v_assignment public.assess_v2_review_assignments;
    v_current_reviewer_authorization_version bigint;
BEGIN
    IF p_org_id IS NULL
       OR p_workspace_id IS NULL
       OR p_case_id IS NULL
       OR p_decision_id IS NULL
       OR p_review_sequence IS NULL
       OR p_review_sequence <= 0 THEN
        RAISE EXCEPTION 'PR1E_REVIEW_LINEAGE_INVALID';
    END IF;

    SELECT *
    INTO v_resolution
    FROM public.assess_v2_review_resolutions
    WHERE org_id = p_org_id
      AND workspace_id = p_workspace_id
      AND case_id = p_case_id
      AND decision_id = p_decision_id
      AND review_sequence = p_review_sequence
      AND resolution = 'approved'
    ORDER BY resolved_at DESC, id DESC
    LIMIT 1
    FOR SHARE;

    -- Missing approval remains an ordinary invalid handoff and is handled by the
    -- canonical command below. This helper only strengthens authority of an
    -- approval that actually exists.
    IF v_resolution.id IS NULL THEN
        RETURN;
    END IF;

    SELECT *
    INTO v_assignment
    FROM public.assess_v2_review_assignments
    WHERE id = v_resolution.review_id
      AND org_id = p_org_id
      AND workspace_id = p_workspace_id
      AND case_id = p_case_id
      AND decision_id = p_decision_id
    FOR SHARE;

    IF v_assignment.id IS NULL
       OR v_assignment.source_version_id IS DISTINCT FROM v_resolution.source_version_id
       OR v_assignment.source_case_version IS DISTINCT FROM v_resolution.source_case_version
       OR v_assignment.decision_version IS DISTINCT FROM v_resolution.decision_version
       OR v_assignment.review_schema_version IS DISTINCT FROM v_resolution.review_schema_version
       OR v_assignment.review_sequence IS DISTINCT FROM v_resolution.review_sequence
       OR v_assignment.reviewer_id IS DISTINCT FROM v_resolution.reviewer_id
       OR v_assignment.assigned_reviewer_authorization_version IS DISTINCT FROM v_resolution.reviewer_authorization_version THEN
        RAISE EXCEPTION 'PR1E_REVIEW_LINEAGE_INVALID';
    END IF;

    -- Every attestation under this immutable assignment must carry the same
    -- reviewer identity and authorization snapshot as the assignment/approval.
    IF EXISTS (
        SELECT 1
        FROM public.assess_v2_evidence_attestations att
        WHERE att.review_id = v_assignment.id
          AND (
              att.org_id IS DISTINCT FROM p_org_id
              OR att.workspace_id IS DISTINCT FROM p_workspace_id
              OR att.case_id IS DISTINCT FROM p_case_id
              OR att.source_version_id IS DISTINCT FROM v_assignment.source_version_id
              OR att.source_case_version IS DISTINCT FROM v_assignment.source_case_version
              OR att.decision_id IS DISTINCT FROM p_decision_id
              OR att.decision_version IS DISTINCT FROM v_assignment.decision_version
              OR att.review_schema_version IS DISTINCT FROM v_assignment.review_schema_version
              OR att.review_sequence IS DISTINCT FROM v_assignment.review_sequence
              OR att.reviewer_id IS DISTINCT FROM v_assignment.reviewer_id
              OR att.reviewer_authorization_version IS DISTINCT FROM v_assignment.assigned_reviewer_authorization_version
          )
    ) THEN
        RAISE EXCEPTION 'PR1E_REVIEW_LINEAGE_INVALID';
    END IF;

    SELECT version
    INTO v_current_reviewer_authorization_version
    FROM public.authorization_versions
    WHERE org_id = p_org_id
      AND user_id = v_assignment.reviewer_id
    FOR SHARE;

    IF v_current_reviewer_authorization_version IS NULL
       OR v_current_reviewer_authorization_version IS DISTINCT FROM v_assignment.assigned_reviewer_authorization_version THEN
        RAISE EXCEPTION 'PR1E_REVIEW_AUTHORIZATION_STALE';
    END IF;

    -- Reuse the canonical authority primitive. Its FOR SHARE locks on profile,
    -- memberships, org/workspace, role/capability and authorization version stay
    -- held until the delegated handoff transaction commits, closing the TOCTOU
    -- window against concurrent reviewer revocation.
    BEGIN
        PERFORM public.pr1b_assert_command_authority(
            v_assignment.reviewer_id,
            p_org_id,
            p_workspace_id,
            'assess.v2.review',
            v_assignment.assigned_reviewer_authorization_version
        );
        PERFORM public.pr1b_assert_command_authority(
            v_assignment.reviewer_id,
            p_org_id,
            p_workspace_id,
            'assess.v2.evidence.attest',
            v_assignment.assigned_reviewer_authorization_version
        );
        PERFORM public.pr1b_assert_command_authority(
            v_assignment.reviewer_id,
            p_org_id,
            p_workspace_id,
            'assess.v2.approve',
            v_assignment.assigned_reviewer_authorization_version
        );
    EXCEPTION
        WHEN OTHERS THEN
            IF SQLERRM LIKE '%PR1B_AUTHORIZATION_STALE%'
               OR SQLERRM LIKE '%PR1B_NOT_FOUND%' THEN
                RAISE EXCEPTION 'PR1E_REVIEW_AUTHORIZATION_STALE';
            END IF;
            RAISE;
    END;
END;
$$;

REVOKE ALL ON FUNCTION public.pr1e_assert_current_approved_review_authority(uuid,uuid,uuid,uuid,bigint)
FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.pr1e_handoff_assess_v2_studio(
    p_actor_id uuid,
    p_org_id uuid,
    p_workspace_id uuid,
    p_case_id uuid,
    p_decision_id uuid,
    p_expected_version bigint,
    p_request_id uuid,
    p_idempotency_key text,
    p_authorization_version bigint,
    p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_existing_receipt public.assess_command_receipts;
    v_review_sequence bigint;
BEGIN
    -- Preserve the existing current-actor freshness gate before both first-time
    -- execution and replay.
    PERFORM public.pr1b_assert_command_authority(
        p_actor_id,
        p_org_id,
        p_workspace_id,
        'assess.v2.studio.handoff',
        p_authorization_version
    );

    -- A committed response-loss replay must remain replayable even if the
    -- historical reviewer is revoked later. The canonical command still verifies
    -- request hash, workspace and succeeded status for the existing receipt.
    SELECT *
    INTO v_existing_receipt
    FROM public.assess_command_receipts
    WHERE org_id = p_org_id
      AND actor_id = p_actor_id
      AND command_type = 'assessment_v2.studio.handoff'
      AND idempotency_key = p_idempotency_key
    FOR UPDATE;

    IF v_existing_receipt.id IS NULL THEN
        BEGIN
            v_review_sequence := NULLIF(p_payload ->> 'reviewSequence', '')::bigint;
        EXCEPTION
            WHEN invalid_text_representation OR numeric_value_out_of_range THEN
                RETURN public.pr1e_review_result('INVALID_COMMAND');
        END;

        IF v_review_sequence IS NULL OR v_review_sequence <= 0 THEN
            RETURN public.pr1e_review_result('INVALID_COMMAND');
        END IF;

        BEGIN
            PERFORM public.pr1e_assert_current_approved_review_authority(
                p_org_id,
                p_workspace_id,
                p_case_id,
                p_decision_id,
                v_review_sequence
            );
        EXCEPTION
            WHEN OTHERS THEN
                IF SQLERRM LIKE '%PR1E_REVIEW_AUTHORIZATION_STALE%' THEN
                    RETURN public.pr1e_review_result('AUTHORIZATION_STALE');
                ELSIF SQLERRM LIKE '%PR1E_REVIEW_LINEAGE_INVALID%' THEN
                    RETURN public.pr1e_review_result('INVALID_COMMAND');
                END IF;
                RAISE;
        END;
    END IF;

    RETURN public.pr1e_review_command(
        'assessment_v2.studio.handoff',
        p_actor_id,
        p_org_id,
        p_workspace_id,
        p_case_id,
        p_decision_id,
        p_expected_version,
        p_request_id,
        p_idempotency_key,
        p_authorization_version,
        p_payload
    );
EXCEPTION
    WHEN OTHERS THEN
        IF SQLERRM LIKE '%PR1B_AUTHORIZATION_STALE%' THEN
            RETURN public.pr1e_review_result('AUTHORIZATION_STALE');
        ELSIF SQLERRM LIKE '%PR1B_NOT_FOUND%' THEN
            RETURN public.pr1e_review_result('NOT_FOUND');
        END IF;
        RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.pr1e_handoff_assess_v2_studio(uuid,uuid,uuid,uuid,uuid,bigint,uuid,text,bigint,jsonb)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pr1e_handoff_assess_v2_studio(uuid,uuid,uuid,uuid,uuid,bigint,uuid,text,bigint,jsonb)
TO service_role;
