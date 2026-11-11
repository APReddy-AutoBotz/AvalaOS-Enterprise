-- PR #217 post-merge forward fix.
-- Additive only: the accepted 20260729163251 migration remains immutable.

DO $preflight$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN ('studio_rendition_attempts','studio_rendition_deletion_attempts')
      AND column_name = 'execution_fence'
      AND data_type <> 'bigint'
  ) THEN
    RAISE EXCEPTION USING MESSAGE = 'PR217_FORWARD_FIX_DIRTY_UPGRADE';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'studio_rendition_attempts'
      AND column_name = 'reconciliation_phase'
      AND data_type <> 'text'
  ) THEN
    RAISE EXCEPTION USING MESSAGE = 'PR217_FORWARD_FIX_DIRTY_UPGRADE';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.studio_rendition_deletion_attempts a
    JOIN public.studio_renditions r ON r.id = a.rendition_id
    WHERE a.state IN ('requested', 'reconciliation_required', 'reconciling')
      AND r.lifecycle <> 'deleting'
  ) THEN
    RAISE EXCEPTION USING MESSAGE = 'PR217_FORWARD_FIX_DIRTY_UPGRADE';
  END IF;
END
$preflight$;

-- Historical deletion requests are immutable evidence. The accepted migration's
-- unconditional rendition uniqueness prevented a governed retry after a failed
-- deletion, so the effective command function now serializes the one-unresolved
-- request invariant under the rendition row/advisory lock instead.
DROP INDEX IF EXISTS public.studio_one_unresolved_deletion_request;
CREATE INDEX IF NOT EXISTS studio_deletion_requests_rendition_history
  ON public.studio_rendition_deletion_requests(rendition_id, created_at, id);

ALTER TABLE public.studio_rendition_attempts
  ADD COLUMN IF NOT EXISTS state_changed_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS execution_fence bigint NOT NULL DEFAULT 0 CHECK (execution_fence >= 0),
  ADD COLUMN IF NOT EXISTS reconciliation_phase text;

DO $rendition_phase_upgrade$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.studio_rendition_attempts attempt
    WHERE attempt.state IN ('reconciliation_required','reconciling')
      AND attempt.reconciliation_phase IS NULL
      AND NOT COALESCE((
        (
          attempt.storage_provider IS NULL
          AND attempt.bucket_id IS NULL
          AND attempt.object_key IS NULL
          AND attempt.content_hash IS NULL
          AND attempt.byte_length IS NULL
          AND attempt.mime_type IS NULL
          AND attempt.safe_filename IS NULL
        )
        OR (
          attempt.storage_provider = 'supabase'
          AND attempt.bucket_id = 'studio-private-artifacts'
          AND attempt.object_key = format(
            '%s/%s/studio-artifacts/%s.%s',
            attempt.org_id,
            attempt.workspace_id,
            attempt.opaque_object_id,
            CASE attempt.format WHEN 'markdown' THEN 'md' ELSE attempt.format END
          )
          AND attempt.content_hash ~ '^[0-9a-f]{64}$'
          AND attempt.byte_length > 0
          AND attempt.mime_type = CASE attempt.format
            WHEN 'markdown' THEN 'text/markdown; charset=utf-8'
            WHEN 'pdf' THEN 'application/pdf'
            ELSE 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
          END
          AND attempt.safe_filename ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$'
        )
      ), false)
  ) THEN
    RAISE EXCEPTION USING MESSAGE = 'PR217_FORWARD_FIX_DIRTY_UPGRADE';
  END IF;

  -- The accepted immutable-attempt trigger predates this private column. Suspend
  -- it only for this transaction-owned backfill; PostgreSQL rolls the trigger
  -- state back together with the migration if either statement fails.
  ALTER TABLE public.studio_rendition_attempts
    DISABLE TRIGGER trg_studio_rendition_attempt_guard;

  UPDATE public.studio_rendition_attempts attempt
  SET reconciliation_phase = CASE
    WHEN attempt.storage_provider IS NULL
      AND attempt.bucket_id IS NULL
      AND attempt.object_key IS NULL
      AND attempt.content_hash IS NULL
      AND attempt.byte_length IS NULL
      AND attempt.mime_type IS NULL
      AND attempt.safe_filename IS NULL
      THEN 'pre_render'
    ELSE 'verify_or_upload'
  END
  WHERE attempt.state IN ('reconciliation_required','reconciling')
    AND attempt.reconciliation_phase IS NULL;

  ALTER TABLE public.studio_rendition_attempts
    ENABLE TRIGGER trg_studio_rendition_attempt_guard;
END
$rendition_phase_upgrade$;

ALTER TABLE public.studio_rendition_attempts
  DROP CONSTRAINT IF EXISTS studio_rendition_attempts_reconciliation_phase_check;
ALTER TABLE public.studio_rendition_attempts
  ADD CONSTRAINT studio_rendition_attempts_reconciliation_phase_check
  CHECK (reconciliation_phase IS NULL OR reconciliation_phase IN ('pre_render','verify_or_upload'));

ALTER TABLE public.studio_rendition_deletion_attempts
  ADD COLUMN IF NOT EXISTS state_changed_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS execution_fence bigint NOT NULL DEFAULT 0 CHECK (execution_fence >= 0),
  ADD COLUMN IF NOT EXISTS execution_claimed_at timestamptz;

ALTER TABLE public.studio_rendition_deletion_attempts
  DROP CONSTRAINT IF EXISTS studio_rendition_deletion_attempts_state_check;
ALTER TABLE public.studio_rendition_deletion_attempts
  ADD CONSTRAINT studio_rendition_deletion_attempts_state_check
  CHECK (state IN ('requested', 'executing', 'completed', 'failed', 'reconciliation_required', 'reconciling'));

CREATE OR REPLACE FUNCTION public.studio_private_state_timestamp()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF NEW.state IS DISTINCT FROM OLD.state THEN
    NEW.state_changed_at := clock_timestamp();
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_studio_rendition_attempt_state_timestamp ON public.studio_rendition_attempts;
CREATE TRIGGER trg_studio_rendition_attempt_state_timestamp
BEFORE UPDATE ON public.studio_rendition_attempts
FOR EACH ROW EXECUTE FUNCTION public.studio_private_state_timestamp();

DROP TRIGGER IF EXISTS trg_studio_deletion_attempt_state_timestamp ON public.studio_rendition_deletion_attempts;
CREATE TRIGGER trg_studio_deletion_attempt_state_timestamp
BEFORE UPDATE ON public.studio_rendition_deletion_attempts
FOR EACH ROW EXECUTE FUNCTION public.studio_private_state_timestamp();

CREATE OR REPLACE FUNCTION public.studio_rendition_attempt_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF TG_OP = 'DELETE'
     OR (to_jsonb(NEW) - ARRAY[
       'state','storage_provider','bucket_id','object_key','content_hash','byte_length',
       'mime_type','safe_filename','failure_code','reconciliation_count',
       'reconciliation_claimed_at','reconciliation_phase','execution_fence','state_changed_at',
       'started_at','rendered_at','completed_at'
     ]) IS DISTINCT FROM
        (to_jsonb(OLD) - ARRAY[
          'state','storage_provider','bucket_id','object_key','content_hash','byte_length',
          'mime_type','safe_filename','failure_code','reconciliation_count',
          'reconciliation_claimed_at','reconciliation_phase','execution_fence','state_changed_at',
          'started_at','rendered_at','completed_at'
        ])
  THEN
    RAISE EXCEPTION USING MESSAGE = 'STUDIO_PRIVATE_IMMUTABLE';
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.studio_deletion_attempt_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF TG_OP = 'DELETE'
     OR (to_jsonb(NEW) - ARRAY[
       'state','failure_code','reconciliation_count','reconciliation_claimed_at',
       'execution_fence','execution_claimed_at','state_changed_at','completed_at'
     ]) IS DISTINCT FROM
        (to_jsonb(OLD) - ARRAY[
          'state','failure_code','reconciliation_count','reconciliation_claimed_at',
          'execution_fence','execution_claimed_at','state_changed_at','completed_at'
        ])
  THEN
    RAISE EXCEPTION USING MESSAGE = 'STUDIO_PRIVATE_IMMUTABLE';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_studio_deletion_attempt_status_guard ON public.studio_rendition_deletion_attempts;
CREATE TRIGGER trg_studio_deletion_attempt_status_guard
BEFORE UPDATE OR DELETE ON public.studio_rendition_deletion_attempts
FOR EACH ROW EXECUTE FUNCTION public.studio_deletion_attempt_guard();

CREATE INDEX IF NOT EXISTS studio_rendition_attempt_due_work
  ON public.studio_rendition_attempts(state, state_changed_at, reconciliation_claimed_at, created_at, id);
CREATE INDEX IF NOT EXISTS studio_deletion_attempt_due_work
  ON public.studio_rendition_deletion_attempts(state, state_changed_at, reconciliation_claimed_at, execution_claimed_at, created_at, id);

CREATE OR REPLACE FUNCTION public.studio_private_projection_unchecked(
  p_org uuid,
  p_workspace uuid,
  p_artifact_version uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
WITH version_scope AS (
  SELECT v.id, v.artifact_id, v.version, v.lifecycle, v.org_id, v.workspace_id, a.artifact_type
  FROM public.studio_artifact_versions v
  JOIN public.studio_artifact_aggregates a
    ON a.id = v.artifact_id
   AND a.org_id = v.org_id
   AND a.workspace_id = v.workspace_id
  WHERE v.id = p_artifact_version
    AND v.org_id = p_org
    AND v.workspace_id = p_workspace
),
canonical AS (
  SELECT
    r.format,
    0 AS source_rank,
    r.id,
    r.lifecycle_version AS version,
    CASE
      WHEN r.lifecycle = 'deleting' AND da.state = 'reconciliation_required' THEN 'deletion_reconciliation_required'
      WHEN r.lifecycle = 'deleting' AND da.state = 'reconciling' THEN 'deletion_reconciling'
      WHEN r.lifecycle = 'deleting' AND da.state = 'failed' THEN 'deletion_failed'
      ELSE r.lifecycle
    END AS public_state,
    r.mime_type,
    r.safe_filename,
    r.byte_length,
    r.content_hash,
    r.renderer_version,
    CASE WHEN retention.value ->> 'indefinite' = 'true' THEN 'indefinite' ELSE 'until' END AS retention_mode,
    CASE WHEN retention.value ->> 'indefinite' = 'true' THEN NULL ELSE retention.value ->> 'retentionUntil' END AS retention_until,
    COALESCE(holds.items, '[]'::jsonb) AS active_holds,
    CASE
      WHEN dr.id IS NULL THEN NULL
      ELSE jsonb_build_object(
        'requestId', dr.id,
        'state', CASE WHEN ds.id IS NULL THEN 'pending' ELSE ds.outcome END,
        'requesterIsCurrentActor', dr.requested_by IS NOT DISTINCT FROM auth.uid()
      )
    END AS deletion,
    da.failure_code,
    GREATEST(r.updated_at, COALESCE(da.state_changed_at, r.updated_at)) AS updated_at
  FROM version_scope v
  JOIN public.studio_renditions r
    ON r.artifact_version_id = v.id
   AND r.org_id = v.org_id
   AND r.workspace_id = v.workspace_id
  LEFT JOIN LATERAL (
    SELECT public.studio_effective_retention(r.id) AS value
  ) retention ON true
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(
      jsonb_build_object('holdId', h.hold_id, 'placedAt', h.created_at)
      ORDER BY h.created_at, h.hold_id
    ) AS items
    FROM public.studio_rendition_legal_hold_events h
    WHERE h.rendition_id = r.id
      AND h.event_type = 'placed'
      AND NOT EXISTS (
        SELECT 1
        FROM public.studio_rendition_legal_hold_events released
        WHERE released.hold_id = h.hold_id
          AND released.event_type = 'released'
      )
  ) holds ON true
  LEFT JOIN LATERAL (
    SELECT request.*
    FROM public.studio_rendition_deletion_requests request
    WHERE request.rendition_id = r.id
    ORDER BY request.created_at DESC, request.id DESC
    LIMIT 1
  ) dr ON true
  LEFT JOIN public.studio_rendition_deletion_resolutions ds ON ds.request_id = dr.id
  LEFT JOIN public.studio_rendition_deletion_attempts da ON da.resolution_id = ds.id
),
attempt_candidates AS (
  SELECT
    x.format,
    1 AS source_rank,
    x.rendition_id AS id,
    1::bigint AS version,
    CASE x.state
      WHEN 'uploaded' THEN 'uploading'
      ELSE x.state
    END AS public_state,
    x.mime_type,
    x.safe_filename,
    x.byte_length,
    x.content_hash,
    x.renderer_version,
    NULL::text AS retention_mode,
    NULL::text AS retention_until,
    '[]'::jsonb AS active_holds,
    NULL::jsonb AS deletion,
    x.failure_code,
    x.state_changed_at AS updated_at,
    row_number() OVER (
      PARTITION BY x.format
      ORDER BY x.state_changed_at DESC, x.created_at DESC, x.id DESC
    ) AS ordinal
  FROM version_scope v
  JOIN public.studio_rendition_attempts x
    ON x.artifact_version_id = v.id
   AND x.org_id = v.org_id
   AND x.workspace_id = v.workspace_id
  WHERE x.state IN ('requested','rendering','uploaded','reconciliation_required','reconciling','failed')
    AND NOT EXISTS (
      SELECT 1 FROM canonical c WHERE c.format = x.format
    )
),
effective AS (
  SELECT format, source_rank, id, version, public_state, mime_type, safe_filename,
         byte_length, content_hash, renderer_version, retention_mode, retention_until,
         active_holds, deletion, failure_code, updated_at
  FROM canonical
  UNION ALL
  SELECT format, source_rank, id, version, public_state, mime_type, safe_filename,
         byte_length, content_hash, renderer_version, retention_mode, retention_until,
         active_holds, deletion, failure_code, updated_at
  FROM attempt_candidates
  WHERE ordinal = 1
)
SELECT jsonb_build_object(
  'artifactId', v.artifact_id,
  'artifactVersionId', v.id,
  'artifactVersion', v.version,
  'artifactType', v.artifact_type,
  'approved', v.lifecycle = 'approved',
  'readOnly', NOT control.enabled OR control.read_only,
  'renditions', COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', e.id,
        'version', e.version,
        'format', e.format,
        'state', e.public_state,
        'mimeType', e.mime_type,
        'filename', e.safe_filename,
        'byteLength', e.byte_length,
        'sha256', e.content_hash,
        'rendererVersion', e.renderer_version,
        'retentionMode', e.retention_mode,
        'retentionUntil', e.retention_until,
        'legalHoldActive', jsonb_array_length(e.active_holds) > 0,
        'activeHolds', e.active_holds,
        'deletion', e.deletion,
        'failureCode', e.failure_code,
        'updatedAt', e.updated_at
      )
      ORDER BY e.format, e.source_rank, e.id
    )
    FROM effective e
  ), '[]'::jsonb)
)
FROM version_scope v
CROSS JOIN public.studio_private_artifact_runtime_control control
WHERE control.singleton
$$;

CREATE OR REPLACE FUNCTION public.studio_private_artifact_projection(
  p_org uuid,
  p_workspace uuid,
  p_artifact_version uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
SELECT CASE
  WHEN public.has_workspace_capability(p_workspace, p_org, 'studio.artifacts.read')
  THEN public.studio_private_projection_unchecked(p_org, p_workspace, p_artifact_version)
  ELSE NULL
END
$$;

DO $legacy$
BEGIN
  IF to_regprocedure('public.studio_private_artifact_command_claim_pr217_accepted(jsonb)') IS NULL THEN
    ALTER FUNCTION public.studio_private_artifact_command_claim(jsonb)
      RENAME TO studio_private_artifact_command_claim_pr217_accepted;
  END IF;
END
$legacy$;

-- One transaction-scoped authority for the complete canonical generation
-- tuple. Generation claims and both completion paths must take this exact
-- lock before inspecting canonical or active work.
CREATE OR REPLACE FUNCTION public.studio_rendition_generation_lock(
  p_org uuid,
  p_workspace uuid,
  p_artifact_version uuid,
  p_format text,
  p_renderer_version text
)
RETURNS void
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
SELECT pg_advisory_xact_lock(
  hashtextextended(
    jsonb_build_array(
      'studio-rendition-generation-v1',
      p_org,
      p_workspace,
      p_artifact_version,
      p_format,
      p_renderer_version
    )::text,
    0
  )
)
$$;

CREATE OR REPLACE FUNCTION public.studio_private_artifact_command_claim(p_command jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
#variable_conflict use_variable
DECLARE
  command_type text := p_command ->> 'commandType';
  actor uuid;
  org uuid;
  workspace uuid;
  authorization_version bigint;
  command_idempotency_key text;
  request_hash text;
  required_capability text;
  expected_artifact bigint;
  expected_rendition bigint;
  artifact_version_id uuid;
  rendition_id uuid;
  command_hold_id uuid;
  command_deletion_request_id uuid;
  command_deletion_outcome text;
  format_name text;
  renderer text;
  v public.studio_artifact_versions;
  r public.studio_renditions;
  bound_deletion_request public.studio_rendition_deletion_requests;
  result jsonb;
  prior_receipt public.studio_private_artifact_command_receipts;
  expected_payload_keys text[];
BEGIN
  IF p_command IS NULL
     OR jsonb_typeof(p_command) <> 'object'
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(p_command) key)
        IS DISTINCT FROM ARRAY[
          'actorId','authorizationVersion','commandType','expectedArtifactVersion',
          'expectedRenditionVersion','idempotencyKey','organizationId','payload',
          'requestId','workspaceId'
        ]::text[]
  THEN
    RAISE EXCEPTION USING MESSAGE = 'INVALID_COMMAND';
  END IF;

  BEGIN
    actor := (p_command ->> 'actorId')::uuid;
    org := (p_command ->> 'organizationId')::uuid;
    workspace := (p_command ->> 'workspaceId')::uuid;
    authorization_version := (p_command ->> 'authorizationVersion')::bigint;
    command_idempotency_key := p_command ->> 'idempotencyKey';
    expected_artifact := NULLIF(p_command ->> 'expectedArtifactVersion', '')::bigint;
    expected_rendition := NULLIF(p_command ->> 'expectedRenditionVersion', '')::bigint;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION USING MESSAGE = 'INVALID_COMMAND';
  END;

  required_capability := CASE command_type
    WHEN 'studio.rendition.generate' THEN 'studio.artifacts.rendition.generate'
    WHEN 'studio.retention.policy.publish' THEN 'studio.artifacts.retention.manage'
    WHEN 'studio.rendition.retention.extend' THEN 'studio.artifacts.retention.manage'
    WHEN 'studio.legal_hold.place' THEN 'studio.artifacts.legal_hold.manage'
    WHEN 'studio.legal_hold.release' THEN 'studio.artifacts.legal_hold.manage'
    WHEN 'studio.rendition.deletion.request' THEN 'studio.artifacts.delete.request'
    WHEN 'studio.rendition.deletion.resolve' THEN 'studio.artifacts.delete.approve'
    ELSE NULL
  END;
  IF required_capability IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'INVALID_COMMAND';
  END IF;
  PERFORM public.studio_assert_actor(
    actor, org, workspace, required_capability, authorization_version
  );
  request_hash := encode(public.digest(convert_to(p_command::text,'UTF8'),'sha256'),'hex');
  SELECT * INTO prior_receipt
  FROM public.studio_private_artifact_command_receipts receipt
  WHERE receipt.org_id = org
    AND receipt.actor_id = actor
    AND receipt.command_type = command_type
    AND receipt.idempotency_key = command_idempotency_key
  FOR UPDATE;
  IF prior_receipt.id IS NOT NULL THEN
    IF prior_receipt.workspace_id IS DISTINCT FROM workspace
       OR prior_receipt.request_hash IS DISTINCT FROM request_hash
    THEN
      RAISE EXCEPTION USING MESSAGE = 'IDEMPOTENCY_CONFLICT';
    END IF;
    RETURN public.studio_private_artifact_command_claim_pr217_accepted(p_command);
  END IF;

  expected_payload_keys := CASE command_type
    WHEN 'studio.rendition.generate' THEN ARRAY['artifactId','artifactVersionId','format']
    WHEN 'studio.retention.policy.publish' THEN ARRAY['artifactType','indefinite','rationale','retentionDays']
    WHEN 'studio.rendition.retention.extend' THEN ARRAY['extendUntil','indefinite','rationale','renditionId']
    WHEN 'studio.legal_hold.place' THEN ARRAY['rationale','renditionId']
    WHEN 'studio.legal_hold.release' THEN ARRAY['holdId','rationale','renditionId']
    WHEN 'studio.rendition.deletion.request' THEN ARRAY['rationale','renditionId']
    WHEN 'studio.rendition.deletion.resolve' THEN ARRAY['deletionRequestId','outcome','rationale','renditionId']
    ELSE NULL
  END;
  IF expected_payload_keys IS NULL
     OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(p_command -> 'payload') key)
        IS DISTINCT FROM expected_payload_keys
  THEN
    RAISE EXCEPTION USING MESSAGE = 'INVALID_COMMAND';
  END IF;

  IF command_type = 'studio.retention.policy.publish' THEN
    IF expected_artifact IS NOT NULL OR expected_rendition IS NOT NULL THEN
      RAISE EXCEPTION USING MESSAGE = 'VERSION_CONFLICT';
    END IF;
  ELSIF command_type = 'studio.rendition.generate' THEN
    BEGIN
      artifact_version_id := (p_command #>> '{payload,artifactVersionId}')::uuid;
      format_name := p_command #>> '{payload,format}';
      renderer := CASE format_name
        WHEN 'markdown' THEN 'studio-markdown-1'
        WHEN 'pdf' THEN 'studio-pdf-1'
        WHEN 'docx' THEN 'studio-docx-1'
        ELSE NULL
      END;
      IF renderer IS NULL THEN
        RAISE EXCEPTION USING MESSAGE = 'INVALID_COMMAND';
      END IF;
      SELECT version.* INTO v
      FROM public.studio_artifact_versions version
      JOIN public.studio_artifact_aggregates aggregate
        ON aggregate.id = version.artifact_id
       AND aggregate.org_id = version.org_id
       AND aggregate.workspace_id = version.workspace_id
      WHERE version.id = artifact_version_id
        AND version.org_id = org
        AND version.workspace_id = workspace
        AND aggregate.current_approved_version_id = version.id
        AND aggregate.lifecycle = 'approved'
        AND version.lifecycle = 'approved'
      FOR SHARE OF version, aggregate;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION USING MESSAGE = 'INVALID_COMMAND';
    END;
    IF v.id IS NULL
       OR (p_command #>> '{payload,artifactId}')::uuid IS DISTINCT FROM v.artifact_id
       OR expected_artifact IS DISTINCT FROM v.version
       OR expected_rendition IS NOT NULL
    THEN
      RAISE EXCEPTION USING MESSAGE = 'VERSION_CONFLICT';
    END IF;
    PERFORM public.studio_rendition_generation_lock(
      org, workspace, v.id, format_name, renderer
    );
    -- Exact receipt replay has already returned above. A new command for a
    -- canonical version/format/renderer tombstone must stop before receipt,
    -- attempt, rendering, upload, or any provider effect.
    IF EXISTS (
      SELECT 1
      FROM public.studio_renditions canonical
      WHERE canonical.artifact_version_id = v.id
        AND canonical.org_id = org
        AND canonical.workspace_id = workspace
        AND canonical.format = format_name
        AND canonical.renderer_version = renderer
    ) THEN
      RAISE EXCEPTION USING MESSAGE = 'VERSION_CONFLICT';
    END IF;
    -- The partial unique index remains a backstop. Explicit detection while
    -- holding the shared tuple lock prevents waiting on that index after a
    -- concurrent completion removes the old attempt from its predicate.
    IF EXISTS (
      SELECT 1
      FROM public.studio_rendition_attempts active_attempt
      WHERE active_attempt.artifact_version_id = v.id
        AND active_attempt.org_id = org
        AND active_attempt.workspace_id = workspace
        AND active_attempt.format = format_name
        AND active_attempt.renderer_version = renderer
        AND active_attempt.state IN (
          'requested','rendering','uploaded','reconciliation_required','reconciling'
        )
    ) THEN
      RAISE EXCEPTION USING MESSAGE = 'VERSION_CONFLICT';
    END IF;
  ELSE
    BEGIN
      rendition_id := (p_command #>> '{payload,renditionId}')::uuid;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION USING MESSAGE = 'INVALID_COMMAND';
    END;
    SELECT * INTO r
    FROM public.studio_renditions
    WHERE id = rendition_id AND org_id = org AND workspace_id = workspace
    FOR UPDATE;
    IF r.id IS NULL THEN
      RAISE EXCEPTION USING MESSAGE = 'RESOURCE_NOT_AVAILABLE';
    END IF;
    IF expected_artifact IS DISTINCT FROM r.artifact_version
       OR expected_rendition IS DISTINCT FROM r.lifecycle_version
    THEN
      RAISE EXCEPTION USING MESSAGE = 'VERSION_CONFLICT';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(r.id::text, 0));

    IF command_type = 'studio.rendition.deletion.resolve' THEN
      BEGIN
        command_deletion_request_id := (p_command #>> '{payload,deletionRequestId}')::uuid;
        command_deletion_outcome := p_command #>> '{payload,outcome}';
      EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION USING MESSAGE = 'INVALID_COMMAND';
      END;
      IF command_deletion_outcome NOT IN ('approve','reject') THEN
        RAISE EXCEPTION USING MESSAGE = 'INVALID_COMMAND';
      END IF;
      SELECT request.* INTO bound_deletion_request
      FROM public.studio_rendition_deletion_requests request
      WHERE request.id = command_deletion_request_id
        AND request.rendition_id = r.id
        AND request.org_id = org
        AND request.workspace_id = workspace
        AND NOT EXISTS (
          SELECT 1
          FROM public.studio_rendition_deletion_resolutions existing_resolution
          WHERE existing_resolution.request_id = request.id
        )
      FOR UPDATE OF request;
      IF bound_deletion_request.id IS NULL THEN
        RAISE EXCEPTION USING MESSAGE = 'RESOURCE_NOT_AVAILABLE';
      END IF;
    END IF;

    IF command_type = 'studio.rendition.retention.extend'
       AND (
         r.lifecycle NOT IN ('available','deletion_requested','deletion_failed')
         OR EXISTS (
           SELECT 1
           FROM public.studio_rendition_deletion_attempts active_attempt
           WHERE active_attempt.rendition_id = r.id
             AND active_attempt.state IN (
               'requested','executing','reconciliation_required','reconciling'
             )
         )
       )
    THEN
      RAISE EXCEPTION USING MESSAGE = 'STUDIO_DELETION_BLOCKED';
    END IF;
    IF command_type = 'studio.rendition.deletion.request'
       AND EXISTS (
         SELECT 1
         FROM public.studio_rendition_deletion_requests unresolved
         WHERE unresolved.rendition_id = r.id
           AND NOT EXISTS (
             SELECT 1
             FROM public.studio_rendition_deletion_resolutions resolution
             WHERE resolution.request_id = unresolved.id
           )
       )
    THEN
      RAISE EXCEPTION USING MESSAGE = 'VERSION_CONFLICT';
    END IF;
    IF command_type = 'studio.legal_hold.place' AND r.lifecycle IN ('deleting','deleted') THEN
      RAISE EXCEPTION USING MESSAGE = 'STUDIO_DELETION_BLOCKED';
    END IF;
    IF command_type = 'studio.legal_hold.release' THEN
      BEGIN
        command_hold_id := (p_command #>> '{payload,holdId}')::uuid;
      EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION USING MESSAGE = 'INVALID_COMMAND';
      END;
      IF NOT EXISTS (
        SELECT 1
        FROM public.studio_rendition_legal_hold_events placed
        WHERE placed.hold_id = command_hold_id
          AND placed.event_type = 'placed'
          AND placed.rendition_id = r.id
          AND placed.org_id = org
          AND placed.workspace_id = workspace
          AND NOT EXISTS (
            SELECT 1 FROM public.studio_rendition_legal_hold_events released
            WHERE released.hold_id = placed.hold_id AND released.event_type = 'released'
          )
      ) THEN
        RAISE EXCEPTION USING MESSAGE = 'RESOURCE_NOT_AVAILABLE';
      END IF;
    END IF;
  END IF;

  result := public.studio_private_artifact_command_claim_pr217_accepted(p_command);
  IF command_type = 'studio.rendition.deletion.resolve' AND result ? 'deletionClaim' THEN
    result := (result - 'deletionClaim') || jsonb_build_object(
      'deletionClaim',
      (result -> 'deletionClaim') - 'objectKey'
    );
  END IF;
  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION public.studio_private_actor_has_current_authority(
  p_actor uuid,
  p_org uuid,
  p_workspace uuid,
  p_capability text,
  p_authorization bigint
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT COALESCE(
    p_actor IS NOT NULL
    AND p_org IS NOT NULL
    AND p_workspace IS NOT NULL
    AND p_capability IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.profiles profile
      JOIN public.organization_members organization_member
        ON organization_member.user_id = profile.id
       AND organization_member.org_id = p_org
      JOIN public.workspace_memberships workspace_member
        ON workspace_member.user_id = profile.id
       AND workspace_member.org_id = organization_member.org_id
       AND workspace_member.workspace_id = p_workspace
      JOIN public.organizations organization
        ON organization.id = organization_member.org_id
      JOIN public.workspaces workspace
        ON workspace.id = workspace_member.workspace_id
       AND workspace.org_id = workspace_member.org_id
      WHERE profile.id = p_actor
        AND profile.status = 'active'
        AND profile.deleted_at IS NULL
        AND organization_member.status = 'active'
        AND organization_member.deleted_at IS NULL
        AND workspace_member.status = 'active'
        AND workspace_member.deleted_at IS NULL
        AND organization.status = 'active'
        AND organization.deleted_at IS NULL
        AND workspace.status = 'active'
        AND workspace.deleted_at IS NULL
        AND (
          EXISTS (
            SELECT 1
            FROM public.roles organization_role
            JOIN public.role_capabilities organization_capability
              ON organization_capability.role_id = organization_role.id
             AND organization_capability.capability_key = p_capability
            WHERE organization_role.id = organization_member.role_id
              AND organization_role.scope = 'organization'
              AND organization_role.org_id = p_org
              AND organization_role.workspace_id IS NULL
              AND organization_role.status = 'active'
              AND organization_role.deleted_at IS NULL
          )
          OR EXISTS (
            SELECT 1
            FROM public.roles workspace_role
            JOIN public.role_capabilities workspace_capability
              ON workspace_capability.role_id = workspace_role.id
             AND workspace_capability.capability_key = p_capability
            WHERE workspace_role.id = workspace_member.role_id
              AND workspace_role.scope = 'workspace'
              AND workspace_role.org_id = p_org
              AND workspace_role.workspace_id = p_workspace
              AND workspace_role.status = 'active'
              AND workspace_role.deleted_at IS NULL
          )
        )
    )
    AND COALESCE((
      SELECT authority_version.version
      FROM public.authorization_versions authority_version
      WHERE authority_version.org_id = p_org
        AND authority_version.user_id = p_actor
    ), 1) = p_authorization,
    false
  )
$$;

CREATE OR REPLACE FUNCTION public.studio_private_rendition_reconciliation_actionable(
  p_attempt uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.studio_rendition_attempts attempt
    JOIN public.studio_artifact_versions version
      ON version.id = attempt.artifact_version_id
     AND version.artifact_id = attempt.artifact_id
     AND version.org_id = attempt.org_id
     AND version.workspace_id = attempt.workspace_id
    JOIN public.studio_artifact_aggregates aggregate
      ON aggregate.id = version.artifact_id
     AND aggregate.org_id = version.org_id
     AND aggregate.workspace_id = version.workspace_id
     AND aggregate.current_approved_version_id = version.id
     AND aggregate.lifecycle = 'approved'
    JOIN public.studio_private_artifact_runtime_control control
      ON control.singleton
     AND control.enabled
     AND NOT control.read_only
     AND control.provider_enabled
    WHERE attempt.id = p_attempt
      AND version.lifecycle = 'approved'
      AND public.studio_private_actor_has_current_authority(
        attempt.requested_by,
        attempt.org_id,
        attempt.workspace_id,
        'studio.artifacts.rendition.generate',
        attempt.requester_authorization_version
      )
      AND (
        attempt.state = 'reconciliation_required'
        OR (
          attempt.state IN ('requested','rendering','uploaded')
          AND attempt.state_changed_at <= now() - interval '5 minutes'
        )
        OR (
          attempt.state = 'reconciling'
          AND attempt.reconciliation_claimed_at <= now() - interval '5 minutes'
        )
      )
      AND CASE
        WHEN attempt.state IN ('requested','rendering') THEN
          attempt.reconciliation_phase IS DISTINCT FROM 'verify_or_upload'
          AND attempt.storage_provider IS NULL
          AND attempt.bucket_id IS NULL
          AND attempt.object_key IS NULL
          AND attempt.content_hash IS NULL
          AND attempt.byte_length IS NULL
          AND attempt.mime_type IS NULL
          AND attempt.safe_filename IS NULL
        WHEN attempt.state = 'uploaded' THEN
          attempt.reconciliation_phase IS DISTINCT FROM 'pre_render'
          AND COALESCE(
            attempt.storage_provider = 'supabase'
            AND attempt.bucket_id = 'studio-private-artifacts'
            AND attempt.object_key = format(
              '%s/%s/studio-artifacts/%s.%s',
              attempt.org_id,
              attempt.workspace_id,
              attempt.opaque_object_id,
              CASE attempt.format WHEN 'markdown' THEN 'md' ELSE attempt.format END
            )
            AND attempt.content_hash ~ '^[0-9a-f]{64}$'
            AND attempt.byte_length > 0
            AND attempt.mime_type = CASE attempt.format
              WHEN 'markdown' THEN 'text/markdown; charset=utf-8'
              WHEN 'pdf' THEN 'application/pdf'
              ELSE 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
            END
            AND attempt.safe_filename ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$',
            false
          )
        WHEN attempt.state IN ('reconciliation_required','reconciling') THEN
          (
            COALESCE(
              attempt.reconciliation_phase,
              CASE WHEN
                attempt.storage_provider IS NULL
                AND attempt.bucket_id IS NULL
                AND attempt.object_key IS NULL
                AND attempt.content_hash IS NULL
                AND attempt.byte_length IS NULL
                AND attempt.mime_type IS NULL
                AND attempt.safe_filename IS NULL
              THEN 'pre_render' ELSE 'verify_or_upload' END
            ) = 'pre_render'
            AND attempt.storage_provider IS NULL
            AND attempt.bucket_id IS NULL
            AND attempt.object_key IS NULL
            AND attempt.content_hash IS NULL
            AND attempt.byte_length IS NULL
            AND attempt.mime_type IS NULL
            AND attempt.safe_filename IS NULL
          )
          OR (
            COALESCE(
              attempt.reconciliation_phase,
              CASE WHEN
                attempt.storage_provider IS NULL
                AND attempt.bucket_id IS NULL
                AND attempt.object_key IS NULL
                AND attempt.content_hash IS NULL
                AND attempt.byte_length IS NULL
                AND attempt.mime_type IS NULL
                AND attempt.safe_filename IS NULL
              THEN 'pre_render' ELSE 'verify_or_upload' END
            ) = 'verify_or_upload'
            AND COALESCE(
              attempt.storage_provider = 'supabase'
              AND attempt.bucket_id = 'studio-private-artifacts'
              AND attempt.object_key = format(
                '%s/%s/studio-artifacts/%s.%s',
                attempt.org_id,
                attempt.workspace_id,
                attempt.opaque_object_id,
                CASE attempt.format WHEN 'markdown' THEN 'md' ELSE attempt.format END
              )
              AND attempt.content_hash ~ '^[0-9a-f]{64}$'
              AND attempt.byte_length > 0
              AND attempt.mime_type = CASE attempt.format
                WHEN 'markdown' THEN 'text/markdown; charset=utf-8'
                WHEN 'pdf' THEN 'application/pdf'
                ELSE 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
              END
              AND attempt.safe_filename ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$',
              false
            )
          )
        ELSE false
      END
  )
$$;

CREATE OR REPLACE FUNCTION public.studio_private_deletion_reconciliation_actionable(
  p_attempt uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.studio_rendition_deletion_attempts attempt
    JOIN public.studio_rendition_deletion_resolutions resolution
      ON resolution.id = attempt.resolution_id
     AND resolution.request_id = attempt.request_id
     AND resolution.rendition_id = attempt.rendition_id
     AND resolution.org_id = attempt.org_id
     AND resolution.workspace_id = attempt.workspace_id
     AND resolution.outcome = 'approved'
    JOIN public.studio_rendition_deletion_requests request
      ON request.id = attempt.request_id
     AND request.rendition_id = attempt.rendition_id
     AND request.org_id = attempt.org_id
     AND request.workspace_id = attempt.workspace_id
    JOIN public.studio_private_artifact_command_receipts receipt
      ON receipt.id = resolution.receipt_id
     AND receipt.org_id = resolution.org_id
     AND receipt.workspace_id = resolution.workspace_id
     AND receipt.actor_id = resolution.resolved_by
     AND receipt.command_type = 'studio.rendition.deletion.resolve'
     AND receipt.status = 'committed'
     AND receipt.resource_id = resolution.id
     AND receipt.response ->> 'deletionRequestId' = resolution.request_id::text
     AND receipt.response ->> 'resolutionId' = resolution.id::text
     AND receipt.response ->> 'renditionId' = resolution.rendition_id::text
     AND receipt.response ->> 'status' = 'deleting'
    JOIN public.studio_renditions rendition
      ON rendition.id = attempt.rendition_id
     AND rendition.org_id = attempt.org_id
     AND rendition.workspace_id = attempt.workspace_id
     AND rendition.lifecycle = 'deleting'
     AND rendition.storage_provider = 'supabase'
     AND rendition.bucket_id = 'studio-private-artifacts'
     AND rendition.content_hash ~ '^[0-9a-f]{64}$'
     AND rendition.byte_length > 0
     AND rendition.mime_type = CASE rendition.format
       WHEN 'markdown' THEN 'text/markdown; charset=utf-8'
       WHEN 'pdf' THEN 'application/pdf'
       ELSE 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
     END
     AND rendition.safe_filename ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$'
    JOIN public.studio_rendition_attempts source_attempt
      ON source_attempt.id = rendition.attempt_id
     AND source_attempt.rendition_id = rendition.id
     AND source_attempt.org_id = rendition.org_id
     AND source_attempt.workspace_id = rendition.workspace_id
     AND source_attempt.state = 'available'
     AND source_attempt.storage_provider = rendition.storage_provider
     AND source_attempt.bucket_id = rendition.bucket_id
     AND source_attempt.object_key = rendition.object_key
     AND source_attempt.content_hash = rendition.content_hash
     AND source_attempt.byte_length = rendition.byte_length
     AND source_attempt.mime_type = rendition.mime_type
     AND source_attempt.safe_filename = rendition.safe_filename
     AND rendition.object_key = format(
       '%s/%s/studio-artifacts/%s.%s',
       source_attempt.org_id,
       source_attempt.workspace_id,
       source_attempt.opaque_object_id,
       CASE source_attempt.format WHEN 'markdown' THEN 'md' ELSE source_attempt.format END
     )
    JOIN public.studio_private_artifact_runtime_control control
      ON control.singleton
     AND control.enabled
     AND NOT control.read_only
     AND control.provider_enabled
     AND control.deletion_enabled
    CROSS JOIN LATERAL (
      SELECT
        public.studio_effective_retention(rendition.id) AS retention,
        public.studio_active_hold_count(rendition.id) AS active_holds
    ) deletion_guard
    WHERE attempt.id = p_attempt
      AND public.studio_private_actor_has_current_authority(
        resolution.resolved_by,
        resolution.org_id,
        resolution.workspace_id,
        'studio.artifacts.delete.approve',
        resolution.resolver_authorization_version
      )
      AND (
        attempt.state = 'reconciliation_required'
        OR (
          attempt.state IN ('requested','executing')
          AND attempt.state_changed_at <= now() - interval '5 minutes'
        )
        OR (
          attempt.state = 'reconciling'
          AND attempt.reconciliation_claimed_at <= now() - interval '5 minutes'
        )
      )
      AND deletion_guard.active_holds = 0
      AND deletion_guard.retention ->> 'indefinite' = 'false'
      AND COALESCE(
        (deletion_guard.retention ->> 'retentionUntil')::timestamptz,
        'infinity'::timestamptz
      ) <= now()
  )
$$;

CREATE OR REPLACE FUNCTION public.studio_private_artifact_reconciliation_due(p_limit integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 50 THEN
    RAISE EXCEPTION USING MESSAGE = 'INVALID_COMMAND';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object('kind', due.kind, 'attemptId', due.attempt_id)
                     ORDER BY due.due_at, due.kind, due.attempt_id)
    FROM (
      SELECT 'rendition'::text AS kind, r.id AS attempt_id,
             COALESCE(r.reconciliation_claimed_at, r.state_changed_at, r.created_at) AS due_at
      FROM public.studio_rendition_attempts r
      WHERE (
        r.state = 'reconciliation_required'
        OR (
          r.state IN ('requested','rendering','uploaded')
          AND r.state_changed_at <= now() - interval '5 minutes'
        )
        OR (
          r.state = 'reconciling'
          AND r.reconciliation_claimed_at <= now() - interval '5 minutes'
        )
      )
        AND public.studio_private_rendition_reconciliation_actionable(r.id)
      UNION ALL
      SELECT 'deletion'::text, d.id,
             COALESCE(d.execution_claimed_at, d.reconciliation_claimed_at, d.state_changed_at, d.created_at)
      FROM public.studio_rendition_deletion_attempts d
      WHERE (
        d.state = 'reconciliation_required'
        OR (
          d.state IN ('requested','executing')
          AND d.state_changed_at <= now() - interval '5 minutes'
        )
        OR (
          d.state = 'reconciling'
          AND d.reconciliation_claimed_at <= now() - interval '5 minutes'
        )
      )
        AND public.studio_private_deletion_reconciliation_actionable(d.id)
      ORDER BY due_at, kind, attempt_id
      LIMIT p_limit
    ) due
  ), '[]'::jsonb);
END
$$;

CREATE OR REPLACE FUNCTION public.studio_rendition_reconciliation_claim(p_attempt uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  x public.studio_rendition_attempts;
  v public.studio_artifact_versions;
  control public.studio_private_artifact_runtime_control;
  phase text;
  next_count integer;
  next_fence bigint;
  audit_id uuid := gen_random_uuid();
  extension text;
  expected_key text;
  expected_mime text;
  metadata_empty boolean;
  metadata_complete boolean;
BEGIN
  SELECT * INTO x FROM public.studio_rendition_attempts WHERE id = p_attempt FOR UPDATE;
  IF x.id IS NULL THEN RAISE EXCEPTION USING MESSAGE = 'RESOURCE_NOT_AVAILABLE'; END IF;
  PERFORM public.studio_assert_actor(
    x.requested_by, x.org_id, x.workspace_id,
    'studio.artifacts.rendition.generate', x.requester_authorization_version
  );
  SELECT * INTO control FROM public.studio_private_artifact_runtime_control WHERE singleton FOR SHARE;
  IF NOT control.enabled OR control.read_only OR NOT control.provider_enabled THEN
    RAISE EXCEPTION USING MESSAGE = 'STUDIO_READ_ONLY';
  END IF;
  SELECT version.* INTO v
  FROM public.studio_artifact_versions version
  JOIN public.studio_artifact_aggregates aggregate
    ON aggregate.id = version.artifact_id
   AND aggregate.org_id = version.org_id
   AND aggregate.workspace_id = version.workspace_id
  WHERE version.id = x.artifact_version_id
    AND version.artifact_id = x.artifact_id
    AND version.org_id = x.org_id
    AND version.workspace_id = x.workspace_id
    AND aggregate.current_approved_version_id = version.id
    AND aggregate.lifecycle = 'approved'
    AND version.lifecycle = 'approved'
  FOR SHARE OF version, aggregate;
  IF v.id IS NULL THEN RAISE EXCEPTION USING MESSAGE = 'RESOURCE_NOT_AVAILABLE'; END IF;
  IF x.state IN ('available','failed') THEN RETURN NULL; END IF;
  IF x.state IN ('requested','rendering','uploaded')
     AND x.state_changed_at > now() - interval '5 minutes' THEN RETURN NULL; END IF;
  IF x.state = 'reconciling'
     AND x.reconciliation_claimed_at > now() - interval '5 minutes' THEN RETURN NULL; END IF;
  IF x.state NOT IN ('requested','rendering','uploaded','reconciliation_required','reconciling') THEN
    RETURN NULL;
  END IF;
  extension := CASE x.format WHEN 'markdown' THEN 'md' ELSE x.format END;
  expected_key := format('%s/%s/studio-artifacts/%s.%s', x.org_id, x.workspace_id, x.opaque_object_id, extension);
  expected_mime := CASE x.format
    WHEN 'markdown' THEN 'text/markdown; charset=utf-8'
    WHEN 'pdf' THEN 'application/pdf'
    ELSE 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  END;
  metadata_empty := x.storage_provider IS NULL
    AND x.bucket_id IS NULL
    AND x.object_key IS NULL
    AND x.content_hash IS NULL
    AND x.byte_length IS NULL
    AND x.mime_type IS NULL
    AND x.safe_filename IS NULL;
  metadata_complete := COALESCE(x.storage_provider = 'supabase'
    AND x.bucket_id = 'studio-private-artifacts'
    AND x.object_key = expected_key
    AND x.content_hash ~ '^[0-9a-f]{64}$'
    AND x.byte_length > 0
    AND x.mime_type = expected_mime
    AND x.safe_filename ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$', false);

  IF NOT metadata_empty AND NOT metadata_complete THEN
    RAISE EXCEPTION USING MESSAGE = 'COMMAND_UNAVAILABLE';
  END IF;
  phase := CASE
    WHEN x.state IN ('requested','rendering') THEN 'pre_render'
    WHEN x.state = 'uploaded' THEN 'verify_or_upload'
    WHEN x.state = 'reconciliation_required' THEN
      COALESCE(x.reconciliation_phase, CASE WHEN metadata_empty THEN 'pre_render' ELSE 'verify_or_upload' END)
    WHEN x.state = 'reconciling' THEN x.reconciliation_phase
  END;
  IF phase IS NULL
     OR (x.state IN ('requested','rendering') AND (NOT metadata_empty OR x.reconciliation_phase = 'verify_or_upload'))
     OR (x.state = 'uploaded' AND (NOT metadata_complete OR x.reconciliation_phase = 'pre_render'))
     OR (phase = 'pre_render' AND NOT metadata_empty)
     OR (phase = 'verify_or_upload' AND NOT metadata_complete)
  THEN
    RAISE EXCEPTION USING MESSAGE = 'COMMAND_UNAVAILABLE';
  END IF;
  next_count := CASE
    WHEN x.state = 'reconciliation_required' THEN GREATEST(x.reconciliation_count, 1)
    WHEN x.state = 'reconciling' THEN x.reconciliation_count + 1
    ELSE GREATEST(x.reconciliation_count + 1, 1)
  END;
  IF next_count >= 3 THEN
    UPDATE public.studio_rendition_attempts
    SET state = 'failed', failure_code = 'RECONCILIATION_EXHAUSTED',
        reconciliation_count = 3, reconciliation_claimed_at = NULL,
        reconciliation_phase = phase, completed_at = now()
    WHERE id = x.id;
    INSERT INTO public.privileged_audit_events(
      id,org_id,workspace_id,actor_id,request_id,action,resource_type,resource_id,
      outcome,resource_version,metadata
    ) VALUES (
      audit_id,x.org_id,x.workspace_id,x.requested_by,x.request_id,
      'studio.rendition.reconciliation.exhausted','studio_rendition_attempt',x.id,
      'failed',x.execution_fence,
      jsonb_build_object(
        'attemptId',x.id,
        'artifactVersionId',x.artifact_version_id,
        'format',x.format,
        'previousState',x.state,
        'recoveryPhase',phase,
        'failureCode','RECONCILIATION_EXHAUSTED',
        'reconciliationCount',3,
        'executionFence',x.execution_fence,
        'terminalState','failed'
      )
    );
    RETURN NULL;
  END IF;
  next_fence := x.execution_fence + 1;
  UPDATE public.studio_rendition_attempts
  SET state = 'reconciling', failure_code = NULL,
      reconciliation_count = next_count, reconciliation_claimed_at = now(),
      reconciliation_phase = phase, execution_fence = next_fence, completed_at = NULL
  WHERE id = x.id;

  INSERT INTO public.privileged_audit_events(
    id,org_id,workspace_id,actor_id,request_id,action,resource_type,resource_id,
    outcome,resource_version,metadata
  ) VALUES (
    audit_id,x.org_id,x.workspace_id,x.requested_by,x.request_id,
    'studio.rendition.reconciliation.claim','studio_rendition_attempt',x.id,
    'succeeded',next_fence,
    jsonb_build_object(
      'attemptId',x.id,
      'artifactVersionId',x.artifact_version_id,
      'format',x.format,
      'previousState',x.state,
      'recoveryPhase',phase,
      'previousReconciliationCount',x.reconciliation_count,
      'reconciliationCount',next_count,
      'previousExecutionFence',x.execution_fence,
      'executionFence',next_fence
    )
  );

  RETURN jsonb_strip_nulls(jsonb_build_object(
    'phase', phase,
    'attemptId', x.id,
    'renditionId', x.rendition_id,
    'organizationId', x.org_id,
    'workspaceId', x.workspace_id,
    'artifactId', x.artifact_id,
    'artifactVersionId', x.artifact_version_id,
    'artifactVersion', x.artifact_version,
    'artifactType', x.artifact_type,
    'format', x.format,
    'opaqueObjectId', x.opaque_object_id,
    'approvedContent', v.content,
    'contentSchemaVersion', x.content_schema_version,
    'rendererVersion', x.renderer_version,
    'templateVersion', x.template_version,
    'reconciliationCount', next_count,
    'fence', next_fence,
    'objectKey', CASE WHEN phase = 'verify_or_upload' THEN x.object_key END,
    'byteLength', CASE WHEN phase = 'verify_or_upload' THEN x.byte_length END,
    'sha256', CASE WHEN phase = 'verify_or_upload' THEN x.content_hash END,
    'mimeType', CASE WHEN phase = 'verify_or_upload' THEN x.mime_type END,
    'filename', CASE WHEN phase = 'verify_or_upload' THEN x.safe_filename END
  ));
END
$$;

CREATE OR REPLACE FUNCTION public.studio_rendition_reconciliation_rendered(
  p_attempt uuid,
  p_fence bigint,
  p_object_key text,
  p_hash text,
  p_byte_length bigint,
  p_mime text,
  p_safe_filename text,
  p_renderer_version text,
  p_template_version text,
  p_content_schema_version text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  x public.studio_rendition_attempts;
  extension text;
  expected_key text;
  expected_mime text;
BEGIN
  SELECT * INTO x FROM public.studio_rendition_attempts WHERE id = p_attempt FOR UPDATE;
  IF x.id IS NULL OR x.state <> 'reconciling' OR x.execution_fence <> p_fence THEN
    RAISE EXCEPTION USING MESSAGE = 'AUTHORITY_STALE';
  END IF;
  PERFORM public.studio_assert_actor(
    x.requested_by, x.org_id, x.workspace_id,
    'studio.artifacts.rendition.generate', x.requester_authorization_version
  );
  extension := CASE x.format WHEN 'markdown' THEN 'md' ELSE x.format END;
  expected_key := format('%s/%s/studio-artifacts/%s.%s', x.org_id, x.workspace_id, x.opaque_object_id, extension);
  expected_mime := CASE x.format
    WHEN 'markdown' THEN 'text/markdown; charset=utf-8'
    WHEN 'pdf' THEN 'application/pdf'
    ELSE 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  END;
  IF p_object_key IS DISTINCT FROM expected_key
     OR p_hash !~ '^[0-9a-f]{64}$'
     OR p_byte_length <= 0
     OR p_mime IS DISTINCT FROM expected_mime
     OR p_safe_filename !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$'
     OR p_renderer_version IS DISTINCT FROM x.renderer_version
     OR p_template_version IS DISTINCT FROM x.template_version
     OR p_content_schema_version IS DISTINCT FROM x.content_schema_version
  THEN
    RAISE EXCEPTION USING MESSAGE = 'INVALID_RENDITION_METADATA';
  END IF;
  UPDATE public.studio_rendition_attempts
  SET storage_provider = 'supabase', bucket_id = 'studio-private-artifacts',
      object_key = p_object_key, content_hash = p_hash, byte_length = p_byte_length,
      mime_type = p_mime, safe_filename = p_safe_filename,
      reconciliation_phase = 'verify_or_upload', rendered_at = now()
  WHERE id = x.id;
  RETURN jsonb_build_object('outcome','committed','attemptId',x.id,'state','reconciling');
END
$$;

CREATE OR REPLACE FUNCTION public.studio_rendition_reconciliation_complete(
  p_attempt uuid,
  p_fence bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE x public.studio_rendition_attempts;
BEGIN
  SELECT * INTO x FROM public.studio_rendition_attempts WHERE id = p_attempt FOR UPDATE;
  IF x.id IS NULL OR x.state <> 'reconciling' OR x.execution_fence <> p_fence THEN
    RAISE EXCEPTION USING MESSAGE = 'AUTHORITY_STALE';
  END IF;
  RETURN public.studio_rendition_attempt_complete(p_attempt);
END
$$;

CREATE OR REPLACE FUNCTION public.studio_rendition_reconciliation_fail(
  p_attempt uuid,
  p_fence bigint,
  p_failure text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  x public.studio_rendition_attempts;
  audit_id uuid := gen_random_uuid();
  target_state text;
  next_count integer;
BEGIN
  SELECT * INTO x FROM public.studio_rendition_attempts WHERE id = p_attempt FOR UPDATE;
  IF x.id IS NULL OR x.state <> 'reconciling' OR x.execution_fence <> p_fence THEN
    RAISE EXCEPTION USING MESSAGE = 'AUTHORITY_STALE';
  END IF;
  IF p_failure !~ '^[A-Z0-9_]{1,64}$' THEN
    RAISE EXCEPTION USING MESSAGE = 'INVALID_FAILURE';
  END IF;
  target_state := CASE
    WHEN p_failure IN ('UPLOAD_OUTCOME_UNKNOWN','AVAILABLE_COMPLETION_FAILED')
      THEN 'reconciliation_required'
    ELSE 'failed'
  END;
  next_count := CASE
    WHEN target_state = 'reconciliation_required'
      THEN LEAST(x.reconciliation_count + 1, 3)
    ELSE x.reconciliation_count
  END;
  UPDATE public.studio_rendition_attempts
  SET state = target_state,
      failure_code = p_failure,
      reconciliation_count = next_count,
      reconciliation_claimed_at = NULL,
      completed_at = CASE WHEN target_state = 'failed' THEN now() ELSE NULL END,
      state_changed_at = now()
  WHERE id = x.id;
  INSERT INTO public.privileged_audit_events(
    id,org_id,workspace_id,actor_id,request_id,action,resource_type,resource_id,
    outcome,resource_version,metadata
  ) VALUES (
    audit_id,x.org_id,x.workspace_id,x.requested_by,x.request_id,
    'studio.rendition.reconciliation.fail','studio_rendition_attempt',x.id,
    CASE WHEN target_state = 'failed' THEN 'failed' ELSE 'succeeded' END,6,
    jsonb_build_object(
      'attemptId',x.id,'failureCode',p_failure,'state',target_state,
      'reconciliationCount',next_count,'fence',p_fence
    )
  );
  RETURN jsonb_build_object(
    'outcome','committed','attemptId',x.id,'state',target_state
  );
END
$$;

CREATE OR REPLACE FUNCTION public.studio_deletion_reconciliation_claim(p_attempt uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  a public.studio_rendition_deletion_attempts;
  d public.studio_rendition_deletion_resolutions;
  r public.studio_renditions;
  control public.studio_private_artifact_runtime_control;
  retention jsonb;
  holds integer;
  audit_id uuid := gen_random_uuid();
  command_request_id uuid;
  next_count integer;
  resulting_version bigint;
BEGIN
  SELECT * INTO a FROM public.studio_rendition_deletion_attempts WHERE id = p_attempt FOR UPDATE;
  IF a.id IS NULL THEN RAISE EXCEPTION USING MESSAGE = 'RESOURCE_NOT_AVAILABLE'; END IF;
  SELECT * INTO d
  FROM public.studio_rendition_deletion_resolutions
  WHERE id = a.resolution_id
    AND request_id = a.request_id
    AND rendition_id = a.rendition_id
    AND org_id = a.org_id
    AND workspace_id = a.workspace_id
    AND outcome = 'approved';
  IF d.id IS NULL THEN RAISE EXCEPTION USING MESSAGE = 'RESOURCE_NOT_AVAILABLE'; END IF;
  PERFORM public.studio_assert_actor(
    d.resolved_by, d.org_id, d.workspace_id,
    'studio.artifacts.delete.approve', d.resolver_authorization_version
  );
  SELECT * INTO r FROM public.studio_renditions
  WHERE id = a.rendition_id AND org_id = a.org_id AND workspace_id = a.workspace_id FOR UPDATE;
  IF r.id IS NULL
     OR r.storage_provider IS DISTINCT FROM 'supabase'
     OR r.bucket_id IS DISTINCT FROM 'studio-private-artifacts'
     OR r.content_hash !~ '^[0-9a-f]{64}$'
     OR r.byte_length <= 0
     OR r.mime_type IS DISTINCT FROM (CASE r.format
       WHEN 'markdown' THEN 'text/markdown; charset=utf-8'
       WHEN 'pdf' THEN 'application/pdf'
       ELSE 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
     END)
     OR r.safe_filename !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$'
     OR NOT EXISTS (
       SELECT 1
       FROM public.studio_rendition_attempts source_attempt
       WHERE source_attempt.id = r.attempt_id
         AND source_attempt.rendition_id = r.id
         AND source_attempt.org_id = r.org_id
         AND source_attempt.workspace_id = r.workspace_id
         AND source_attempt.state = 'available'
         AND source_attempt.storage_provider = r.storage_provider
         AND source_attempt.bucket_id = r.bucket_id
         AND source_attempt.object_key = r.object_key
         AND source_attempt.content_hash = r.content_hash
         AND source_attempt.byte_length = r.byte_length
         AND source_attempt.mime_type = r.mime_type
         AND source_attempt.safe_filename = r.safe_filename
         AND r.object_key = format(
           '%s/%s/studio-artifacts/%s.%s',
           source_attempt.org_id,
           source_attempt.workspace_id,
           source_attempt.opaque_object_id,
           CASE source_attempt.format WHEN 'markdown' THEN 'md' ELSE source_attempt.format END
         )
     )
  THEN
    RAISE EXCEPTION USING MESSAGE = 'RESOURCE_NOT_AVAILABLE';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(r.id::text, 0));
  IF a.state = 'completed' AND r.lifecycle = 'deleted' THEN RETURN NULL; END IF;
  IF a.state = 'failed' THEN RETURN NULL; END IF;
  IF r.lifecycle <> 'deleting' THEN
    RAISE EXCEPTION USING MESSAGE = 'RESOURCE_NOT_AVAILABLE';
  END IF;
  IF a.state IN ('requested','executing')
     AND a.state_changed_at > now() - interval '5 minutes' THEN RETURN NULL; END IF;
  IF a.state = 'reconciling'
     AND a.reconciliation_claimed_at > now() - interval '5 minutes' THEN RETURN NULL; END IF;
  IF a.state NOT IN ('requested','executing','reconciliation_required','reconciling') THEN RETURN NULL; END IF;
  SELECT * INTO control
  FROM public.studio_private_artifact_runtime_control
  WHERE singleton
  FOR SHARE;
  IF control.singleton IS NULL
     OR NOT control.enabled
     OR control.read_only
     OR NOT control.provider_enabled
     OR NOT control.deletion_enabled
  THEN
    RAISE EXCEPTION USING MESSAGE = 'STUDIO_READ_ONLY';
  END IF;
  retention := public.studio_effective_retention(r.id);
  holds := public.studio_active_hold_count(r.id);
  IF r.lifecycle <> 'deleting'
     OR holds > 0
     OR retention ->> 'indefinite' = 'true'
     OR COALESCE((retention ->> 'retentionUntil')::timestamptz, 'infinity') > now()
  THEN
    RAISE EXCEPTION USING MESSAGE = 'STUDIO_DELETION_BLOCKED';
  END IF;
  SELECT cr.request_id INTO command_request_id
  FROM public.studio_private_artifact_command_receipts cr
  WHERE cr.id = d.receipt_id
    AND cr.org_id = d.org_id
    AND cr.workspace_id = d.workspace_id
    AND cr.actor_id = d.resolved_by
    AND cr.command_type = 'studio.rendition.deletion.resolve'
    AND cr.status = 'committed'
    AND cr.resource_id = d.id
    AND cr.response ->> 'deletionRequestId' = d.request_id::text
    AND cr.response ->> 'resolutionId' = d.id::text
    AND cr.response ->> 'renditionId' = d.rendition_id::text
    AND cr.response ->> 'status' = 'deleting';
  IF command_request_id IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'RESOURCE_NOT_AVAILABLE';
  END IF;
  next_count := a.reconciliation_count + 1;
  IF next_count > 3 THEN
    UPDATE public.studio_rendition_deletion_attempts
    SET state = 'failed', failure_code = 'DELETION_RECONCILIATION_EXHAUSTED',
        reconciliation_count = 3, reconciliation_claimed_at = NULL,
        execution_claimed_at = NULL, completed_at = now()
    WHERE id = a.id;
    UPDATE public.studio_renditions
    SET lifecycle = 'deletion_failed', lifecycle_version = lifecycle_version + 1, updated_at = now()
    WHERE id = r.id
    RETURNING lifecycle_version INTO resulting_version;
    INSERT INTO public.privileged_audit_events(
      id,org_id,workspace_id,actor_id,request_id,action,resource_type,resource_id,
      outcome,resource_version,metadata
    ) VALUES (
      audit_id,r.org_id,r.workspace_id,d.resolved_by,command_request_id,
      'studio.rendition.deletion.reconciliation.exhausted','studio_rendition',r.id,
      'failed',resulting_version,
      jsonb_build_object(
        'deletionAttemptId',a.id,'deletionRequestId',a.request_id,
        'resolutionId',d.id,'executionFence',a.execution_fence,
        'failureCode','DELETION_RECONCILIATION_EXHAUSTED',
        'reconciliationCount',3,'resultingLifecycleVersion',resulting_version
      )
    );
    RETURN NULL;
  END IF;
  UPDATE public.studio_rendition_deletion_attempts
  SET state = 'reconciling', failure_code = NULL,
      reconciliation_count = next_count, reconciliation_claimed_at = now(),
      execution_claimed_at = NULL, completed_at = NULL
  WHERE id = a.id;
  INSERT INTO public.privileged_audit_events(
    id,org_id,workspace_id,actor_id,request_id,action,resource_type,resource_id,
    outcome,resource_version,metadata
  ) VALUES (
    audit_id,r.org_id,r.workspace_id,d.resolved_by,command_request_id,
    'studio.rendition.deletion.reconciliation.claim','studio_rendition',r.id,
    'succeeded',r.lifecycle_version,
    jsonb_build_object(
      'deletionAttemptId',a.id,
      'deletionRequestId',a.request_id,
      'resolutionId',d.id,
      'previousState',a.state,
      'previousReconciliationCount',a.reconciliation_count,
      'reconciliationCount',next_count,
      'currentExecutionFence',a.execution_fence,
      'resultingLifecycleVersion',r.lifecycle_version,
      'recoveryKind','deletion',
      'providerAuthorityIssued',false
    )
  );
  RETURN jsonb_build_object(
    'deletionAttemptId', a.id,
    'renditionId', r.id,
    'organizationId', r.org_id,
    'workspaceId', r.workspace_id,
    'reconciliationCount', next_count
  );
END
$$;

CREATE OR REPLACE FUNCTION public.studio_rendition_deletion_execution_claim(p_attempt uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  a public.studio_rendition_deletion_attempts;
  d public.studio_rendition_deletion_resolutions;
  r public.studio_renditions;
  control public.studio_private_artifact_runtime_control;
  retention jsonb;
  holds integer;
  audit_id uuid := gen_random_uuid();
  command_request_id uuid;
  next_fence bigint;
  next_count integer;
  execution_kind text;
BEGIN
  SELECT * INTO a FROM public.studio_rendition_deletion_attempts WHERE id = p_attempt FOR UPDATE;
  IF a.id IS NULL THEN RAISE EXCEPTION USING MESSAGE = 'RESOURCE_NOT_AVAILABLE'; END IF;
  SELECT * INTO d
  FROM public.studio_rendition_deletion_resolutions
  WHERE id = a.resolution_id
    AND request_id = a.request_id
    AND rendition_id = a.rendition_id
    AND org_id = a.org_id
    AND workspace_id = a.workspace_id
    AND outcome = 'approved';
  IF d.id IS NULL THEN RAISE EXCEPTION USING MESSAGE = 'RESOURCE_NOT_AVAILABLE'; END IF;
  PERFORM public.studio_assert_actor(
    d.resolved_by, d.org_id, d.workspace_id,
    'studio.artifacts.delete.approve', d.resolver_authorization_version
  );
  SELECT * INTO r FROM public.studio_renditions
  WHERE id = a.rendition_id AND org_id = a.org_id AND workspace_id = a.workspace_id FOR UPDATE;
  IF r.id IS NULL
     OR r.storage_provider IS DISTINCT FROM 'supabase'
     OR r.bucket_id IS DISTINCT FROM 'studio-private-artifacts'
     OR r.content_hash !~ '^[0-9a-f]{64}$'
     OR r.byte_length <= 0
     OR r.mime_type IS DISTINCT FROM (CASE r.format
       WHEN 'markdown' THEN 'text/markdown; charset=utf-8'
       WHEN 'pdf' THEN 'application/pdf'
       ELSE 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
     END)
     OR r.safe_filename !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$'
     OR NOT EXISTS (
       SELECT 1
       FROM public.studio_rendition_attempts source_attempt
       WHERE source_attempt.id = r.attempt_id
         AND source_attempt.rendition_id = r.id
         AND source_attempt.org_id = r.org_id
         AND source_attempt.workspace_id = r.workspace_id
         AND source_attempt.state = 'available'
         AND source_attempt.storage_provider = r.storage_provider
         AND source_attempt.bucket_id = r.bucket_id
         AND source_attempt.object_key = r.object_key
         AND source_attempt.content_hash = r.content_hash
         AND source_attempt.byte_length = r.byte_length
         AND source_attempt.mime_type = r.mime_type
         AND source_attempt.safe_filename = r.safe_filename
         AND r.object_key = format(
           '%s/%s/studio-artifacts/%s.%s',
           source_attempt.org_id,
           source_attempt.workspace_id,
           source_attempt.opaque_object_id,
           CASE source_attempt.format WHEN 'markdown' THEN 'md' ELSE source_attempt.format END
         )
     )
  THEN
    RAISE EXCEPTION USING MESSAGE = 'RESOURCE_NOT_AVAILABLE';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(r.id::text, 0));
  SELECT * INTO control FROM public.studio_private_artifact_runtime_control WHERE singleton FOR SHARE;
  IF NOT control.enabled OR control.read_only OR NOT control.provider_enabled OR NOT control.deletion_enabled THEN
    RAISE EXCEPTION USING MESSAGE = 'STUDIO_READ_ONLY';
  END IF;
  retention := public.studio_effective_retention(r.id);
  holds := public.studio_active_hold_count(r.id);
  IF r.lifecycle <> 'deleting'
     OR holds > 0
     OR retention ->> 'indefinite' = 'true'
     OR COALESCE((retention ->> 'retentionUntil')::timestamptz, 'infinity') > now()
  THEN
    RAISE EXCEPTION USING MESSAGE = 'STUDIO_DELETION_BLOCKED';
  END IF;
  IF a.state = 'executing'
     AND a.execution_claimed_at > now() - interval '5 minutes' THEN RETURN NULL; END IF;
  IF a.state NOT IN ('requested','reconciling','reconciliation_required','executing') THEN RETURN NULL; END IF;
  SELECT cr.request_id INTO command_request_id
  FROM public.studio_private_artifact_command_receipts cr
  WHERE cr.id = d.receipt_id
    AND cr.org_id = d.org_id
    AND cr.workspace_id = d.workspace_id
    AND cr.actor_id = d.resolved_by
    AND cr.command_type = 'studio.rendition.deletion.resolve'
    AND cr.status = 'committed'
    AND cr.resource_id = d.id
    AND cr.response ->> 'deletionRequestId' = d.request_id::text
    AND cr.response ->> 'resolutionId' = d.id::text
    AND cr.response ->> 'renditionId' = d.rendition_id::text
    AND cr.response ->> 'status' = 'deleting';
  IF command_request_id IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'RESOURCE_NOT_AVAILABLE';
  END IF;
  next_fence := a.execution_fence + 1;
  next_count := CASE
    WHEN a.state = 'requested' AND a.reconciliation_count = 0 THEN 1
    ELSE a.reconciliation_count
  END;
  execution_kind := CASE
    WHEN a.state = 'requested' AND a.reconciliation_count = 0 THEN 'initial'
    ELSE 'recovery'
  END;
  UPDATE public.studio_rendition_deletion_attempts
  SET state = 'executing', execution_fence = next_fence,
      execution_claimed_at = now(), reconciliation_claimed_at = NULL,
      failure_code = NULL,
      reconciliation_count = next_count
  WHERE id = a.id;
  INSERT INTO public.privileged_audit_events(
    id,org_id,workspace_id,actor_id,request_id,action,resource_type,resource_id,
    outcome,resource_version,metadata
  ) VALUES (
    audit_id,r.org_id,r.workspace_id,d.resolved_by,command_request_id,
    'studio.rendition.deletion.execution.claim','studio_rendition',r.id,
    'succeeded',r.lifecycle_version,
    jsonb_build_object(
      'deletionAttemptId',a.id,
      'deletionRequestId',a.request_id,
      'resolutionId',d.id,
      'previousState',a.state,
      'previousExecutionFence',a.execution_fence,
      'executionFence',next_fence,
      'previousReconciliationCount',a.reconciliation_count,
      'reconciliationCount',next_count,
      'resultingLifecycleVersion',r.lifecycle_version,
      'executionKind',execution_kind
    )
  );
  RETURN jsonb_build_object(
    'deletionAttemptId', a.id,
    'renditionId', r.id,
    'organizationId', r.org_id,
    'workspaceId', r.workspace_id,
    'objectKey', r.object_key,
    'reconciliationCount', next_count,
    'fence', next_fence
  );
END
$$;

DROP FUNCTION IF EXISTS public.studio_rendition_deletion_complete(uuid,bigint);

CREATE OR REPLACE FUNCTION public.studio_rendition_deletion_complete(
  p_attempt uuid,
  p_fence bigint,
  p_provider_outcome text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  a public.studio_rendition_deletion_attempts;
  d public.studio_rendition_deletion_resolutions;
  r public.studio_renditions;
  retention jsonb;
  holds integer;
  audit_id uuid := gen_random_uuid();
  command_request_id uuid;
  resulting_version bigint;
BEGIN
  SELECT * INTO a FROM public.studio_rendition_deletion_attempts WHERE id = p_attempt FOR UPDATE;
  IF a.id IS NULL OR a.state <> 'executing' OR a.execution_fence <> p_fence THEN
    RAISE EXCEPTION USING MESSAGE = 'AUTHORITY_STALE';
  END IF;
  SELECT * INTO d FROM public.studio_rendition_deletion_resolutions WHERE id = a.resolution_id;
  IF d.id IS NULL THEN RAISE EXCEPTION USING MESSAGE = 'RESOURCE_NOT_AVAILABLE'; END IF;
  PERFORM public.studio_assert_actor(
    d.resolved_by, d.org_id, d.workspace_id,
    'studio.artifacts.delete.approve', d.resolver_authorization_version
  );
  IF p_provider_outcome NOT IN ('deleted','missing') THEN
    RAISE EXCEPTION USING MESSAGE = 'INVALID_PROVIDER_OUTCOME';
  END IF;
  SELECT cr.request_id INTO command_request_id
  FROM public.studio_private_artifact_command_receipts cr
  WHERE cr.id = d.receipt_id;
  IF command_request_id IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'RESOURCE_NOT_AVAILABLE';
  END IF;
  SELECT * INTO r FROM public.studio_renditions WHERE id = a.rendition_id FOR UPDATE;
  PERFORM pg_advisory_xact_lock(hashtextextended(r.id::text, 0));
  retention := public.studio_effective_retention(r.id);
  holds := public.studio_active_hold_count(r.id);
  IF r.lifecycle <> 'deleting'
     OR holds > 0
     OR retention ->> 'indefinite' = 'true'
     OR COALESCE((retention ->> 'retentionUntil')::timestamptz, 'infinity') > now()
  THEN
    RAISE EXCEPTION USING MESSAGE = 'STUDIO_DELETION_BLOCKED';
  END IF;
  UPDATE public.studio_rendition_deletion_attempts
  SET state = 'completed', failure_code = NULL, execution_claimed_at = NULL,
      reconciliation_claimed_at = NULL, completed_at = now()
  WHERE id = a.id;
  UPDATE public.studio_renditions
  SET lifecycle = 'deleted', lifecycle_version = lifecycle_version + 1,
      updated_at = now(), deleted_at = now()
  WHERE id = r.id
  RETURNING lifecycle_version INTO resulting_version;
  INSERT INTO public.privileged_audit_events(
    id,org_id,workspace_id,actor_id,request_id,action,resource_type,resource_id,
    outcome,resource_version,metadata
  ) VALUES (
    audit_id,r.org_id,r.workspace_id,d.resolved_by,command_request_id,
    'studio.rendition.deletion.complete','studio_rendition',r.id,
    'succeeded',resulting_version,
    jsonb_build_object(
      'deletionAttemptId',a.id,'deletionRequestId',a.request_id,
      'resolutionId',d.id,'executionFence',p_fence,
      'reconciliationCount',a.reconciliation_count,
      'providerOutcome',p_provider_outcome,'format',r.format,
      'contentHash',r.content_hash,'byteLength',r.byte_length,
      'resultingLifecycleVersion',resulting_version
    )
  );
  RETURN jsonb_build_object('outcome','committed','attemptId',a.id,'state','deleted');
END
$$;

CREATE OR REPLACE FUNCTION public.studio_rendition_deletion_fail(
  p_attempt uuid,
  p_fence bigint,
  p_failure text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  a public.studio_rendition_deletion_attempts;
  d public.studio_rendition_deletion_resolutions;
  r public.studio_renditions;
  audit_id uuid := gen_random_uuid();
  command_request_id uuid;
  target_state text;
  resulting_version bigint;
BEGIN
  SELECT * INTO a FROM public.studio_rendition_deletion_attempts WHERE id = p_attempt FOR UPDATE;
  IF a.id IS NULL OR a.state <> 'executing' OR a.execution_fence <> p_fence THEN
    RAISE EXCEPTION USING MESSAGE = 'AUTHORITY_STALE';
  END IF;
  IF p_failure = 'DELETION_RECONCILIATION_EXHAUSTED'
     OR p_failure !~ '^[A-Z0-9_]{1,64}$'
  THEN
    RAISE EXCEPTION USING MESSAGE = 'INVALID_FAILURE';
  END IF;
  SELECT * INTO d FROM public.studio_rendition_deletion_resolutions WHERE id = a.resolution_id;
  IF d.id IS NULL THEN RAISE EXCEPTION USING MESSAGE = 'RESOURCE_NOT_AVAILABLE'; END IF;
  PERFORM public.studio_assert_actor(
    d.resolved_by, d.org_id, d.workspace_id,
    'studio.artifacts.delete.approve', d.resolver_authorization_version
  );
  SELECT cr.request_id INTO command_request_id
  FROM public.studio_private_artifact_command_receipts cr
  WHERE cr.id = d.receipt_id;
  IF command_request_id IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'RESOURCE_NOT_AVAILABLE';
  END IF;
  SELECT * INTO r FROM public.studio_renditions WHERE id = a.rendition_id FOR UPDATE;
  target_state := CASE
    WHEN p_failure IN ('DELETE_OUTCOME_UNKNOWN','TOMBSTONE_COMPLETION_FAILED')
      THEN 'reconciliation_required'
    ELSE 'failed'
  END;
  UPDATE public.studio_rendition_deletion_attempts
  SET state = target_state, failure_code = p_failure,
      execution_claimed_at = NULL, reconciliation_claimed_at = NULL,
      completed_at = CASE WHEN target_state = 'failed' THEN now() ELSE NULL END
  WHERE id = a.id;
  IF target_state = 'failed' THEN
    UPDATE public.studio_renditions
    SET lifecycle = 'deletion_failed', lifecycle_version = lifecycle_version + 1, updated_at = now()
    WHERE id = r.id
    RETURNING lifecycle_version INTO resulting_version;
  ELSE
    resulting_version := r.lifecycle_version;
  END IF;
  INSERT INTO public.privileged_audit_events(
    id,org_id,workspace_id,actor_id,request_id,action,resource_type,resource_id,
    outcome,resource_version,metadata
  ) VALUES (
    audit_id,r.org_id,r.workspace_id,d.resolved_by,command_request_id,
    'studio.rendition.deletion.fail','studio_rendition',r.id,
    CASE WHEN target_state = 'failed' THEN 'failed' ELSE 'succeeded' END,
    resulting_version,
    jsonb_build_object(
      'deletionAttemptId',a.id,'deletionRequestId',a.request_id,
      'resolutionId',d.id,'executionFence',p_fence,
      'failureCode',p_failure,'targetState',target_state,
      'reconciliationCount',a.reconciliation_count,
      'resultingLifecycleVersion',resulting_version
    )
  );
  RETURN jsonb_build_object(
    'outcome','committed','attemptId',a.id,
    'state', CASE WHEN target_state = 'failed' THEN 'deletion_failed' ELSE target_state END
  );
END
$$;

-- Effective rendition mutation contract. Normal workers may mutate only
-- pre-recovery states. Recovery workers use a separate exact-fence authority.
CREATE OR REPLACE FUNCTION public.studio_rendition_recovery_authority(
  p_attempt uuid,
  p_fence bigint
)
RETURNS public.studio_rendition_attempts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  x public.studio_rendition_attempts;
  v public.studio_artifact_versions;
  control public.studio_private_artifact_runtime_control;
BEGIN
  SELECT * INTO x
  FROM public.studio_rendition_attempts
  WHERE id = p_attempt
  FOR UPDATE;
  IF x.id IS NULL
     OR x.state <> 'reconciling'
     OR x.execution_fence <> p_fence
     OR x.reconciliation_claimed_at IS NULL
     OR x.reconciliation_claimed_at <= clock_timestamp() - interval '5 minutes'
  THEN
    RAISE EXCEPTION USING MESSAGE = 'AUTHORITY_STALE';
  END IF;
  PERFORM public.studio_assert_actor(
    x.requested_by, x.org_id, x.workspace_id,
    'studio.artifacts.rendition.generate', x.requester_authorization_version
  );
  SELECT version.* INTO v
  FROM public.studio_artifact_versions version
  JOIN public.studio_artifact_aggregates aggregate
    ON aggregate.id = version.artifact_id
   AND aggregate.org_id = version.org_id
   AND aggregate.workspace_id = version.workspace_id
  WHERE version.id = x.artifact_version_id
    AND version.artifact_id = x.artifact_id
    AND version.org_id = x.org_id
    AND version.workspace_id = x.workspace_id
    AND aggregate.current_approved_version_id = version.id
    AND aggregate.lifecycle = 'approved'
    AND version.lifecycle = 'approved'
  FOR SHARE OF version, aggregate;
  IF v.id IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'AUTHORITY_STALE';
  END IF;

  -- Keep the safe-stop row locked through the caller's recovery mutation and
  -- any provider-effect authority that follows it in this transaction. A
  -- concurrent operator update therefore wins before this reread or waits for
  -- the already-authorized recovery transaction to finish; it cannot interleave.
  SELECT * INTO control
  FROM public.studio_private_artifact_runtime_control
  WHERE singleton
  FOR SHARE;
  IF control.singleton IS NULL
     OR NOT control.enabled
     OR control.read_only
     OR NOT control.provider_enabled
  THEN
    RAISE EXCEPTION USING MESSAGE = 'STUDIO_READ_ONLY';
  END IF;
  RETURN x;
END
$$;

CREATE OR REPLACE FUNCTION public.studio_rendition_attempt_start(p_attempt uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  x public.studio_rendition_attempts;
  audit_id uuid := gen_random_uuid();
BEGIN
  SELECT * INTO x FROM public.studio_rendition_attempts WHERE id = p_attempt FOR UPDATE;
  IF x.id IS NULL THEN RAISE EXCEPTION USING MESSAGE = 'RESOURCE_NOT_AVAILABLE'; END IF;
  IF x.state = 'reconciling' THEN RAISE EXCEPTION USING MESSAGE = 'AUTHORITY_STALE'; END IF;
  IF x.state <> 'requested' THEN RAISE EXCEPTION USING MESSAGE = 'VERSION_CONFLICT'; END IF;
  PERFORM public.studio_assert_actor(
    x.requested_by, x.org_id, x.workspace_id,
    'studio.artifacts.rendition.generate', x.requester_authorization_version
  );
  UPDATE public.studio_rendition_attempts
  SET state = 'rendering', started_at = now()
  WHERE id = x.id;
  INSERT INTO public.privileged_audit_events(
    id,org_id,workspace_id,actor_id,request_id,action,resource_type,resource_id,
    outcome,resource_version,metadata
  ) VALUES (
    audit_id,x.org_id,x.workspace_id,x.requested_by,x.request_id,
    'studio.rendition.attempt.start','studio_rendition_attempt',x.id,
    'succeeded',2,jsonb_build_object('attemptId',x.id,'format',x.format)
  );
  RETURN jsonb_build_object('outcome','committed','attemptId',x.id,'state','rendering');
END
$$;

CREATE OR REPLACE FUNCTION public.studio_rendition_attempt_rendered(
  p_attempt uuid,
  p_object_key text,
  p_hash text,
  p_byte_length bigint,
  p_mime text,
  p_safe_filename text,
  p_renderer_version text,
  p_template_version text,
  p_content_schema_version text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  x public.studio_rendition_attempts;
  expected_key text;
  expected_mime text;
  extension text;
  audit_id uuid := gen_random_uuid();
BEGIN
  SELECT * INTO x FROM public.studio_rendition_attempts WHERE id = p_attempt FOR UPDATE;
  IF x.id IS NULL THEN RAISE EXCEPTION USING MESSAGE = 'RESOURCE_NOT_AVAILABLE'; END IF;
  IF x.state = 'reconciling' THEN RAISE EXCEPTION USING MESSAGE = 'AUTHORITY_STALE'; END IF;
  IF x.state <> 'rendering' THEN RAISE EXCEPTION USING MESSAGE = 'VERSION_CONFLICT'; END IF;
  PERFORM public.studio_assert_actor(
    x.requested_by, x.org_id, x.workspace_id,
    'studio.artifacts.rendition.generate', x.requester_authorization_version
  );
  extension := CASE x.format WHEN 'markdown' THEN 'md' ELSE x.format END;
  expected_mime := CASE x.format
    WHEN 'markdown' THEN 'text/markdown; charset=utf-8'
    WHEN 'pdf' THEN 'application/pdf'
    ELSE 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  END;
  expected_key := format(
    '%s/%s/studio-artifacts/%s.%s',
    x.org_id,x.workspace_id,x.opaque_object_id,extension
  );
  IF p_object_key IS DISTINCT FROM expected_key
     OR p_hash !~ '^[0-9a-f]{64}$'
     OR p_byte_length <= 0
     OR p_mime IS DISTINCT FROM expected_mime
     OR p_renderer_version IS DISTINCT FROM x.renderer_version
     OR p_template_version IS DISTINCT FROM x.template_version
     OR p_content_schema_version IS DISTINCT FROM x.content_schema_version
     OR p_safe_filename !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$'
     OR lower(right(p_safe_filename,length(extension)+1)) <> '.' || extension
  THEN
    RAISE EXCEPTION USING MESSAGE = 'INVALID_RENDITION_METADATA';
  END IF;
  UPDATE public.studio_rendition_attempts
  SET state = 'uploaded', storage_provider = 'supabase',
      bucket_id = 'studio-private-artifacts', object_key = p_object_key,
      content_hash = p_hash, byte_length = p_byte_length, mime_type = p_mime,
      safe_filename = p_safe_filename, rendered_at = now()
  WHERE id = x.id;
  INSERT INTO public.privileged_audit_events(
    id,org_id,workspace_id,actor_id,request_id,action,resource_type,resource_id,
    outcome,resource_version,metadata
  ) VALUES (
    audit_id,x.org_id,x.workspace_id,x.requested_by,x.request_id,
    'studio.rendition.attempt.rendered','studio_rendition_attempt',x.id,
    'succeeded',3,jsonb_build_object(
      'attemptId',x.id,'format',x.format,'contentHash',p_hash,
      'byteLength',p_byte_length,'mimeType',p_mime,
      'rendererVersion',p_renderer_version,'templateVersion',p_template_version,
      'contentSchemaVersion',p_content_schema_version
    )
  );
  RETURN jsonb_build_object('outcome','committed','attemptId',x.id,'state','uploaded');
END
$$;

CREATE OR REPLACE FUNCTION public.studio_rendition_attempt_complete_internal(
  p_attempt uuid,
  p_recovery_fence bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  x public.studio_rendition_attempts;
  r public.studio_renditions;
  p public.studio_retention_policies;
  audit_id uuid := gen_random_uuid();
BEGIN
  IF p_recovery_fence IS NULL THEN
    SELECT * INTO x FROM public.studio_rendition_attempts WHERE id = p_attempt FOR UPDATE;
    IF x.id IS NULL THEN RAISE EXCEPTION USING MESSAGE = 'RESOURCE_NOT_AVAILABLE'; END IF;
    IF x.state = 'reconciling' THEN RAISE EXCEPTION USING MESSAGE = 'AUTHORITY_STALE'; END IF;
    PERFORM public.studio_assert_actor(
      x.requested_by, x.org_id, x.workspace_id,
      'studio.artifacts.rendition.generate', x.requester_authorization_version
    );
  ELSE
    SELECT authority.* INTO x
    FROM public.studio_rendition_recovery_authority(p_attempt,p_recovery_fence) authority;
  END IF;

  PERFORM public.studio_rendition_generation_lock(
    x.org_id, x.workspace_id, x.artifact_version_id, x.format, x.renderer_version
  );

  SELECT * INTO r FROM public.studio_renditions WHERE attempt_id = x.id;
  IF x.state = 'available' AND r.id IS NOT NULL AND p_recovery_fence IS NULL THEN
    RETURN jsonb_build_object('outcome','replayed','renditionId',r.id,'state','available');
  END IF;
  IF (p_recovery_fence IS NULL AND x.state <> 'uploaded')
     OR (p_recovery_fence IS NOT NULL AND x.state <> 'reconciling')
  THEN
    RAISE EXCEPTION USING MESSAGE = 'VERSION_CONFLICT';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.studio_renditions canonical
    WHERE canonical.artifact_version_id = x.artifact_version_id
      AND canonical.org_id = x.org_id
      AND canonical.workspace_id = x.workspace_id
      AND canonical.format = x.format
      AND canonical.renderer_version = x.renderer_version
  ) THEN
    RAISE EXCEPTION USING MESSAGE = 'VERSION_CONFLICT';
  END IF;
  SELECT * INTO p
  FROM public.studio_retention_policies
  WHERE (
    system_default
    OR (org_id = x.org_id AND workspace_id = x.workspace_id AND artifact_type = x.artifact_type)
  )
    AND effective_at <= now()
  ORDER BY system_default ASC, effective_at DESC, policy_version DESC
  LIMIT 1
  FOR SHARE;
  IF p.id IS NULL THEN RAISE EXCEPTION USING MESSAGE = 'RETENTION_POLICY_UNAVAILABLE'; END IF;
  INSERT INTO public.studio_renditions(
    id,attempt_id,org_id,workspace_id,artifact_id,artifact_version_id,
    artifact_version,artifact_type,format,mime_type,safe_filename,
    storage_provider,bucket_id,object_key,byte_length,content_hash,
    renderer_version,template_version,content_schema_version,
    retention_policy_id,retention_policy_version,retention_indefinite,
    retention_until,lifecycle
  ) VALUES (
    x.rendition_id,x.id,x.org_id,x.workspace_id,x.artifact_id,x.artifact_version_id,
    x.artifact_version,x.artifact_type,x.format,x.mime_type,x.safe_filename,
    x.storage_provider,x.bucket_id,x.object_key,x.byte_length,x.content_hash,
    x.renderer_version,x.template_version,x.content_schema_version,
    p.id,p.policy_version,p.indefinite,
    CASE WHEN p.indefinite THEN NULL ELSE now()+make_interval(days=>p.retention_days) END,
    'available'
  ) RETURNING * INTO r;
  UPDATE public.studio_rendition_attempts
  SET state = 'available', failure_code = NULL,
      reconciliation_claimed_at = NULL, completed_at = now()
  WHERE id = x.id;
  INSERT INTO public.privileged_audit_events(
    id,org_id,workspace_id,actor_id,request_id,action,resource_type,resource_id,
    outcome,resource_version,metadata
  ) VALUES (
    audit_id,x.org_id,x.workspace_id,x.requested_by,x.request_id,
    'studio.rendition.attempt.complete','studio_rendition',r.id,
    'succeeded',1,jsonb_build_object(
      'attemptId',x.id,'artifactVersionId',x.artifact_version_id,
      'format',x.format,'contentHash',x.content_hash,'byteLength',x.byte_length,
      'retentionPolicyId',p.id,'retentionPolicyVersion',p.policy_version
    )
  );
  RETURN jsonb_build_object('outcome','committed','renditionId',r.id,'state','available');
END
$$;

CREATE OR REPLACE FUNCTION public.studio_rendition_attempt_complete(p_attempt uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
SELECT public.studio_rendition_attempt_complete_internal(p_attempt,NULL::bigint)
$$;

CREATE OR REPLACE FUNCTION public.studio_rendition_attempt_fail(
  p_attempt uuid,
  p_failure text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  x public.studio_rendition_attempts;
  audit_id uuid := gen_random_uuid();
  target_state text;
  next_count integer;
BEGIN
  SELECT * INTO x FROM public.studio_rendition_attempts WHERE id = p_attempt FOR UPDATE;
  IF x.id IS NULL THEN RAISE EXCEPTION USING MESSAGE = 'RESOURCE_NOT_AVAILABLE'; END IF;
  IF x.state = 'reconciling' THEN RAISE EXCEPTION USING MESSAGE = 'AUTHORITY_STALE'; END IF;
  PERFORM public.studio_assert_actor(
    x.requested_by, x.org_id, x.workspace_id,
    'studio.artifacts.rendition.generate', x.requester_authorization_version
  );
  IF p_failure !~ '^[A-Z0-9_]{1,64}$' THEN
    RAISE EXCEPTION USING MESSAGE = 'INVALID_FAILURE';
  END IF;
  target_state := CASE
    WHEN p_failure IN ('UPLOAD_OUTCOME_UNKNOWN','AVAILABLE_COMPLETION_FAILED')
      THEN 'reconciliation_required'
    ELSE 'failed'
  END;
  next_count := CASE
    WHEN target_state = 'reconciliation_required' THEN x.reconciliation_count + 1
    ELSE x.reconciliation_count
  END;
  IF x.state = target_state THEN
    IF x.failure_code IS DISTINCT FROM p_failure THEN
      RAISE EXCEPTION USING MESSAGE = 'IDEMPOTENCY_CONFLICT';
    END IF;
    RETURN jsonb_build_object('outcome','replayed','attemptId',x.id,'state',x.state);
  END IF;
  IF x.state NOT IN ('requested','rendering','uploaded') OR next_count > 3 THEN
    RAISE EXCEPTION USING MESSAGE = 'INVALID_FAILURE';
  END IF;
  UPDATE public.studio_rendition_attempts
  SET state = target_state, failure_code = p_failure,
      reconciliation_count = next_count, reconciliation_claimed_at = NULL,
      reconciliation_phase = CASE
        WHEN target_state = 'reconciliation_required' AND x.state IN ('requested','rendering')
          THEN 'pre_render'
        WHEN target_state = 'reconciliation_required' AND x.state = 'uploaded'
          THEN 'verify_or_upload'
        ELSE x.reconciliation_phase
      END,
      completed_at = CASE WHEN target_state = 'failed' THEN now() ELSE NULL END
  WHERE id = x.id;
  INSERT INTO public.privileged_audit_events(
    id,org_id,workspace_id,actor_id,request_id,action,resource_type,resource_id,
    outcome,resource_version,metadata
  ) VALUES (
    audit_id,x.org_id,x.workspace_id,x.requested_by,x.request_id,
    'studio.rendition.attempt.fail','studio_rendition_attempt',x.id,
    CASE WHEN target_state = 'failed' THEN 'failed' ELSE 'succeeded' END,
    4,jsonb_build_object(
      'attemptId',x.id,'failureCode',p_failure,'state',target_state,
      'reconciliationCount',next_count
    )
  );
  RETURN jsonb_build_object('outcome','committed','attemptId',x.id,'state',target_state);
END
$$;

CREATE OR REPLACE FUNCTION public.studio_rendition_reconciliation_rendered(
  p_attempt uuid,
  p_fence bigint,
  p_object_key text,
  p_hash text,
  p_byte_length bigint,
  p_mime text,
  p_safe_filename text,
  p_renderer_version text,
  p_template_version text,
  p_content_schema_version text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  x public.studio_rendition_attempts;
  extension text;
  expected_key text;
  expected_mime text;
BEGIN
  SELECT authority.* INTO x
  FROM public.studio_rendition_recovery_authority(p_attempt,p_fence) authority;
  extension := CASE x.format WHEN 'markdown' THEN 'md' ELSE x.format END;
  expected_key := format(
    '%s/%s/studio-artifacts/%s.%s',
    x.org_id,x.workspace_id,x.opaque_object_id,extension
  );
  expected_mime := CASE x.format
    WHEN 'markdown' THEN 'text/markdown; charset=utf-8'
    WHEN 'pdf' THEN 'application/pdf'
    ELSE 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  END;
  IF p_object_key IS DISTINCT FROM expected_key
     OR p_hash !~ '^[0-9a-f]{64}$'
     OR p_byte_length <= 0
     OR p_mime IS DISTINCT FROM expected_mime
     OR p_safe_filename !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$'
     OR p_renderer_version IS DISTINCT FROM x.renderer_version
     OR p_template_version IS DISTINCT FROM x.template_version
     OR p_content_schema_version IS DISTINCT FROM x.content_schema_version
  THEN
    RAISE EXCEPTION USING MESSAGE = 'INVALID_RENDITION_METADATA';
  END IF;
  UPDATE public.studio_rendition_attempts
  SET storage_provider = 'supabase', bucket_id = 'studio-private-artifacts',
      object_key = p_object_key, content_hash = p_hash, byte_length = p_byte_length,
      mime_type = p_mime, safe_filename = p_safe_filename,
      reconciliation_phase = 'verify_or_upload',
      reconciliation_claimed_at = clock_timestamp(), rendered_at = now()
  WHERE id = x.id;
  RETURN jsonb_build_object('outcome','committed','attemptId',x.id,'state','reconciling');
END
$$;

CREATE OR REPLACE FUNCTION public.studio_rendition_reconciliation_complete(
  p_attempt uuid,
  p_fence bigint
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
SELECT public.studio_rendition_attempt_complete_internal(p_attempt,p_fence)
$$;

CREATE OR REPLACE FUNCTION public.studio_rendition_reconciliation_fail(
  p_attempt uuid,
  p_fence bigint,
  p_failure text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  x public.studio_rendition_attempts;
  audit_id uuid := gen_random_uuid();
  target_state text;
  next_count integer;
BEGIN
  SELECT authority.* INTO x
  FROM public.studio_rendition_recovery_authority(p_attempt,p_fence) authority;
  IF p_failure !~ '^[A-Z0-9_]{1,64}$' THEN
    RAISE EXCEPTION USING MESSAGE = 'INVALID_FAILURE';
  END IF;
  target_state := CASE
    WHEN p_failure IN ('UPLOAD_OUTCOME_UNKNOWN','AVAILABLE_COMPLETION_FAILED')
      THEN 'reconciliation_required'
    ELSE 'failed'
  END;
  next_count := CASE
    WHEN target_state = 'reconciliation_required'
      THEN LEAST(x.reconciliation_count + 1, 3)
    ELSE x.reconciliation_count
  END;
  UPDATE public.studio_rendition_attempts
  SET state = target_state, failure_code = p_failure,
      reconciliation_count = next_count, reconciliation_claimed_at = NULL,
      completed_at = CASE WHEN target_state = 'failed' THEN now() ELSE NULL END,
      state_changed_at = now()
  WHERE id = x.id;
  INSERT INTO public.privileged_audit_events(
    id,org_id,workspace_id,actor_id,request_id,action,resource_type,resource_id,
    outcome,resource_version,metadata
  ) VALUES (
    audit_id,x.org_id,x.workspace_id,x.requested_by,x.request_id,
    'studio.rendition.reconciliation.fail','studio_rendition_attempt',x.id,
    CASE WHEN target_state = 'failed' THEN 'failed' ELSE 'succeeded' END,
    6,jsonb_build_object(
      'attemptId',x.id,'failureCode',p_failure,'state',target_state,
      'reconciliationCount',next_count,'fence',p_fence
    )
  );
  RETURN jsonb_build_object('outcome','committed','attemptId',x.id,'state',target_state);
END
$$;

REVOKE ALL ON FUNCTION public.studio_private_artifact_command_claim_pr217_accepted(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.studio_rendition_deletion_complete(uuid),
  public.studio_rendition_deletion_fail(uuid,text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.studio_private_state_timestamp(),
  public.studio_deletion_attempt_guard(),
  public.studio_private_actor_has_current_authority(uuid,uuid,uuid,text,bigint),
  public.studio_private_rendition_reconciliation_actionable(uuid),
  public.studio_private_deletion_reconciliation_actionable(uuid),
  public.studio_rendition_generation_lock(uuid,uuid,uuid,text,text),
  public.studio_rendition_recovery_authority(uuid,bigint),
  public.studio_rendition_attempt_complete_internal(uuid,bigint),
  public.studio_private_artifact_reconciliation_due(integer),
  public.studio_rendition_reconciliation_rendered(uuid,bigint,text,text,bigint,text,text,text,text,text),
  public.studio_rendition_reconciliation_complete(uuid,bigint),
  public.studio_rendition_reconciliation_fail(uuid,bigint,text),
  public.studio_rendition_deletion_execution_claim(uuid),
  public.studio_rendition_deletion_complete(uuid,bigint,text),
  public.studio_rendition_deletion_fail(uuid,bigint,text)
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.studio_private_artifact_projection(uuid,uuid,uuid),
  public.studio_private_artifact_command_claim(jsonb),
  public.studio_rendition_reconciliation_claim(uuid),
  public.studio_deletion_reconciliation_claim(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.studio_private_artifact_projection(uuid,uuid,uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.studio_private_artifact_command_claim(jsonb),
  public.studio_private_artifact_reconciliation_due(integer),
  public.studio_rendition_reconciliation_claim(uuid),
  public.studio_rendition_reconciliation_rendered(uuid,bigint,text,text,bigint,text,text,text,text,text),
  public.studio_rendition_reconciliation_complete(uuid,bigint),
  public.studio_rendition_reconciliation_fail(uuid,bigint,text),
  public.studio_deletion_reconciliation_claim(uuid),
  public.studio_rendition_deletion_execution_claim(uuid),
  public.studio_rendition_deletion_complete(uuid,bigint,text),
  public.studio_rendition_deletion_fail(uuid,bigint,text)
  TO service_role;

COMMENT ON FUNCTION public.studio_private_artifact_reconciliation_due(integer)
IS 'Service-only bounded discovery of currently actionable Studio private-artifact attempt identifiers. Discovery is non-authoritative and returns no Storage or actor authority.';
COMMENT ON FUNCTION public.studio_private_actor_has_current_authority(uuid,uuid,uuid,text,bigint)
IS 'Private exception-free discovery prefilter mirroring current membership, role capability, and authorization-version semantics. Claim RPCs reauthorize under lock.';
COMMENT ON FUNCTION public.studio_private_rendition_reconciliation_actionable(uuid)
IS 'Private non-mutating rendition actionability prefilter used before the shared due-work limit.';
COMMENT ON FUNCTION public.studio_private_deletion_reconciliation_actionable(uuid)
IS 'Private non-mutating deletion actionability prefilter used before the shared due-work limit.';
COMMENT ON FUNCTION public.studio_rendition_deletion_execution_claim(uuid)
IS 'Service-only fenced execution-time guard. Rechecks retention and active holds before any provider deletion.';
