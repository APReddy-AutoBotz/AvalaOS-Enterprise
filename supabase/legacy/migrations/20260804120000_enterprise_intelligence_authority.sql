-- Enterprise Intelligence vertical authority.
--
-- This is additive. It does not alter PR1G scoring, existing Assess decision
-- law, accepted Studio artifact versions, private-artifact retention, Health,
-- deployment state, or any live infrastructure. Browser clients do not write
-- these tables; the Enterprise Intelligence Edge command boundary uses the
-- service role only after resolving the caller's tenant authority.

-- Fail before any capability/provider mutation when an earlier or manually
-- created Enterprise Intelligence schema is present. This migration is the
-- sole authority for these unaccepted objects; CREATE TABLE IF NOT EXISTS
-- would otherwise bless unknown columns, constraints, ACLs, and policies.
DO $enterprise_intelligence_preflight$
DECLARE
  dirty_relation TEXT;
BEGIN
  SELECT relation_name INTO dirty_relation
  FROM unnest(ARRAY[
    'enterprise_intelligence_runtime_control',
    'enterprise_ai_capability_routes', 'enterprise_ai_command_receipts',
    'enterprise_ai_receipt_replay_requests', 'enterprise_ai_effect_journal',
    'enterprise_ai_job_ledger', 'enterprise_ai_usage_ledger',
    'enterprise_evidence_sources', 'enterprise_evidence_source_versions',
    'enterprise_evidence_candidates', 'enterprise_evidence_candidate_edits',
    'enterprise_evidence_questions', 'enterprise_evidence_assess_promotions',
    'enterprise_studio_delivery_handoffs', 'enterprise_delivery_work_packages',
    'enterprise_delivery_work_package_versions', 'enterprise_delivery_work_items',
    'enterprise_monitor_baselines', 'enterprise_modernization_assessments',
    'enterprise_modernization_decisions', 'enterprise_assemble_blueprints',
    'enterprise_high_impact_review_events', 'enterprise_high_impact_approvals'
  ]) AS expected(relation_name)
  WHERE to_regclass(format('public.%I', relation_name)) IS NOT NULL
  ORDER BY relation_name
  LIMIT 1;

  IF dirty_relation IS NOT NULL THEN
    RAISE EXCEPTION 'ENTERPRISE_INTELLIGENCE_DIRTY_SCHEMA relation=%', dirty_relation;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'ai_provider_configs'
      AND column_name IN ('endpoint_url', 'deployment_name', 'model_allowlist', 'budget_policy', 'last_validated_at')
  ) THEN
    RAISE EXCEPTION 'ENTERPRISE_INTELLIGENCE_DIRTY_SCHEMA relation=ai_provider_configs';
  END IF;
END
$enterprise_intelligence_preflight$;

INSERT INTO public.capabilities (capability_key, module, description) VALUES
  ('org.admin', 'organization', 'Manage organization-scoped governed controls'),
  ('byok.manage', 'admin', 'Register and enable server-managed provider routes'),
  ('security.manage', 'admin', 'Manage security-sensitive provider controls'),
  ('evidence.write', 'assess', 'Capture and extract workspace-scoped evidence'),
  ('evidence.review', 'assess', 'Review workspace-scoped evidence candidates'),
  ('assessment.edit', 'assess', 'Edit workspace-scoped Assess drafts'),
  ('assessment.review', 'assess', 'Review workspace-scoped Assess decisions'),
  ('portfolio.manage', 'assess', 'Create workspace-scoped modernization assessments'),
  ('approvals.review', 'govern', 'Record independent high-impact reviews and approvals'),
  ('docs.approve', 'docs', 'Create governed handoffs from approved Studio documents'),
  ('project.manage', 'delivery', 'Manage governed Delivery work packages'),
  ('project.read', 'delivery', 'Read governed Delivery work packages'),
  ('monitor.manage', 'monitor', 'Create governed Monitor baselines'),
  ('monitor.read', 'monitor', 'Read governed Monitor baselines'),
  ('assemble.manage', 'assemble', 'Create Assemble Phase 1 blueprint drafts')
ON CONFLICT (capability_key) DO UPDATE
SET module = EXCLUDED.module, description = EXCLUDED.description;

INSERT INTO public.role_capabilities (role_id, capability_key)
SELECT r.id, p.value
FROM public.roles r
CROSS JOIN LATERAL jsonb_array_elements_text(
  CASE WHEN jsonb_typeof(r.permissions) = 'array' THEN r.permissions ELSE '[]'::jsonb END
) p(value)
JOIN public.capabilities c ON c.capability_key = p.value
WHERE p.value IN (
  'org.admin', 'byok.manage', 'security.manage', 'evidence.write', 'evidence.review',
  'assessment.edit', 'assessment.review', 'portfolio.manage', 'approvals.review',
  'docs.approve', 'project.manage', 'project.read', 'monitor.manage', 'monitor.read',
  'assemble.manage'
)
ON CONFLICT DO NOTHING;

INSERT INTO public.role_capabilities (role_id, capability_key)
SELECT r.id, 'org.admin'
FROM public.roles r
WHERE r.scope = 'organization' AND lower(r.name) = 'admin'
ON CONFLICT DO NOTHING;

ALTER TABLE public.ai_provider_key_refs DROP CONSTRAINT IF EXISTS ai_provider_key_refs_provider_check;
ALTER TABLE public.ai_provider_key_refs
  ADD CONSTRAINT ai_provider_key_refs_provider_check
  CHECK (provider IN ('gemini', 'groq', 'openai', 'azure_openai', 'anthropic', 'openai_compatible')) NOT VALID;

ALTER TABLE public.ai_provider_configs DROP CONSTRAINT IF EXISTS ai_provider_configs_provider_check;
ALTER TABLE public.ai_provider_configs
  ADD CONSTRAINT ai_provider_configs_provider_check
  CHECK (provider IN ('gemini', 'groq', 'openai', 'azure_openai', 'anthropic', 'openai_compatible')) NOT VALID;

ALTER TABLE public.ai_provider_configs ADD COLUMN endpoint_url TEXT;
ALTER TABLE public.ai_provider_configs ADD COLUMN deployment_name TEXT;
ALTER TABLE public.ai_provider_configs ADD COLUMN model_allowlist TEXT[] NOT NULL DEFAULT '{}'::text[];
ALTER TABLE public.ai_provider_configs ADD COLUMN budget_policy JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.ai_provider_configs ADD COLUMN last_validated_at TIMESTAMPTZ;
ALTER TABLE public.ai_provider_configs DROP CONSTRAINT IF EXISTS ai_provider_configs_model_allowlist_check;
ALTER TABLE public.ai_provider_configs
  ADD CONSTRAINT ai_provider_configs_model_allowlist_check
  CHECK (cardinality(model_allowlist) <= 64);
ALTER TABLE public.ai_provider_configs DROP CONSTRAINT IF EXISTS ai_provider_configs_budget_policy_check;
ALTER TABLE public.ai_provider_configs
  ADD CONSTRAINT ai_provider_configs_budget_policy_check
  CHECK (jsonb_typeof(budget_policy) = 'object');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ai_provider_configs_id_org_key'
      AND conrelid = 'public.ai_provider_configs'::regclass
  ) THEN
    ALTER TABLE public.ai_provider_configs ADD CONSTRAINT ai_provider_configs_id_org_key UNIQUE (id, org_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ai_provider_key_refs_id_org_key'
      AND conrelid = 'public.ai_provider_key_refs'::regclass
  ) THEN
    ALTER TABLE public.ai_provider_key_refs ADD CONSTRAINT ai_provider_key_refs_id_org_key UNIQUE (id, org_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ai_provider_configs_key_ref_org_fkey'
      AND conrelid = 'public.ai_provider_configs'::regclass
  ) THEN
    ALTER TABLE public.ai_provider_configs
      ADD CONSTRAINT ai_provider_configs_key_ref_org_fkey
      FOREIGN KEY (key_ref_id, org_id)
      REFERENCES public.ai_provider_key_refs(id, org_id) ON DELETE SET NULL (key_ref_id);
  END IF;
END $$;

CREATE TABLE public.enterprise_intelligence_runtime_control (
  singleton BOOLEAN PRIMARY KEY DEFAULT true CHECK (singleton),
  enabled BOOLEAN NOT NULL DEFAULT true,
  read_only BOOLEAN NOT NULL DEFAULT false,
  provider_enabled BOOLEAN NOT NULL DEFAULT true,
  ingestion_enabled BOOLEAN NOT NULL DEFAULT true,
  delivery_enabled BOOLEAN NOT NULL DEFAULT true,
  assemble_enabled BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO public.enterprise_intelligence_runtime_control(singleton) VALUES (true);

CREATE TABLE public.enterprise_ai_capability_routes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL,
  provider_config_id UUID NOT NULL,
  capability TEXT NOT NULL CHECK (capability IN (
    'assess.evidence.extract',
    'assess.evidence.summarize',
    'delivery.work_items.draft',
    'modernization.rationale.draft',
    'assemble.blueprint.draft',
    'studio.document.generate'
  )),
  model TEXT NOT NULL CHECK (length(btrim(model)) BETWEEN 1 AND 200),
  enabled BOOLEAN NOT NULL DEFAULT false,
  allowed_roles TEXT[] NOT NULL DEFAULT '{}'::text[],
  version BIGINT NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by UUID NOT NULL REFERENCES public.profiles(id),
  updated_by UUID NOT NULL REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT enterprise_ai_capability_routes_workspace_org_fkey
    FOREIGN KEY (workspace_id, org_id)
    REFERENCES public.workspaces(id, org_id) ON DELETE CASCADE,
  CONSTRAINT enterprise_ai_routes_provider_org_fkey
    FOREIGN KEY (provider_config_id, org_id)
    REFERENCES public.ai_provider_configs(id, org_id) ON DELETE RESTRICT,
  UNIQUE (id, org_id, workspace_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS enterprise_ai_one_active_route
  ON public.enterprise_ai_capability_routes(org_id, workspace_id, capability)
  WHERE enabled = true AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS enterprise_ai_routes_workspace
  ON public.enterprise_ai_capability_routes(org_id, workspace_id, enabled)
  WHERE deleted_at IS NULL;

CREATE TABLE public.enterprise_ai_command_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL,
  actor_id UUID NOT NULL REFERENCES public.profiles(id),
  command_type TEXT NOT NULL CHECK (length(btrim(command_type)) BETWEEN 1 AND 120),
  runtime_area TEXT NOT NULL CHECK (runtime_area IN ('provider', 'ingestion', 'delivery', 'assemble')),
  resource_type TEXT CHECK (resource_type IS NULL OR length(btrim(resource_type)) BETWEEN 1 AND 80),
  idempotency_key TEXT NOT NULL CHECK (length(btrim(idempotency_key)) BETWEEN 8 AND 200),
  request_id UUID NOT NULL,
  request_hash TEXT NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  status TEXT NOT NULL CHECK (status IN ('claimed', 'committed', 'failed', 'blocked')),
  resource_id UUID,
  response JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(response) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  CONSTRAINT enterprise_ai_receipts_workspace_org_fkey
    FOREIGN KEY (workspace_id, org_id)
    REFERENCES public.workspaces(id, org_id) ON DELETE CASCADE,
  UNIQUE (org_id, workspace_id, actor_id, command_type, idempotency_key)
);

CREATE TABLE public.enterprise_ai_job_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL,
  capability TEXT NOT NULL CHECK (capability IN (
    'assess.evidence.extract',
    'assess.evidence.summarize',
    'delivery.work_items.draft',
    'modernization.rationale.draft',
    'assemble.blueprint.draft',
    'studio.document.generate'
  )),
  provider_config_id UUID,
  provider TEXT NOT NULL CHECK (provider IN ('gemini', 'groq', 'openai', 'azure_openai', 'anthropic', 'openai_compatible')),
  model TEXT NOT NULL CHECK (length(btrim(model)) BETWEEN 1 AND 200),
  prompt_key TEXT NOT NULL CHECK (length(btrim(prompt_key)) BETWEEN 1 AND 200),
  prompt_version TEXT NOT NULL CHECK (length(btrim(prompt_version)) BETWEEN 1 AND 120),
  source_refs JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(source_refs) = 'array'),
  actor_id UUID NOT NULL REFERENCES public.profiles(id),
  request_id UUID NOT NULL,
  idempotency_key TEXT NOT NULL CHECK (length(btrim(idempotency_key)) BETWEEN 8 AND 200),
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'blocked')),
  token_input INTEGER CHECK (token_input IS NULL OR token_input >= 0),
  token_output INTEGER CHECK (token_output IS NULL OR token_output >= 0),
  latency_ms INTEGER CHECK (latency_ms IS NULL OR latency_ms >= 0),
  failure_class TEXT,
  output_hash TEXT CHECK (output_hash IS NULL OR output_hash ~ '^[0-9a-f]{64}$'),
  approval_state TEXT NOT NULL CHECK (approval_state IN ('not_required', 'review_required', 'approved', 'rejected')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (
    jsonb_typeof(metadata) = 'object'
    AND NOT (metadata ?| ARRAY[
      'api_key', 'auth_header', 'authorization', 'bearer_token', 'completion',
      'completion_body', 'encrypted_key', 'prompt', 'prompt_body', 'provider_key',
      'raw_completion', 'raw_key', 'raw_prompt', 'response_body', 'secret',
      'secret_value', 'storage_path', 'object_key'
    ])
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  CONSTRAINT enterprise_ai_job_workspace_org_fkey
    FOREIGN KEY (workspace_id, org_id)
    REFERENCES public.workspaces(id, org_id) ON DELETE CASCADE,
  CONSTRAINT enterprise_ai_job_provider_org_fkey
    FOREIGN KEY (provider_config_id, org_id)
    REFERENCES public.ai_provider_configs(id, org_id) ON DELETE SET NULL (provider_config_id),
  UNIQUE (id, org_id),
  UNIQUE (org_id, actor_id, capability, idempotency_key)
);

CREATE OR REPLACE FUNCTION public.enterprise_command_runtime_area(
  p_command_type TEXT,
  p_resource_type TEXT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog
AS $$
BEGIN
  CASE p_command_type
    WHEN 'provider.register', 'provider.secret.bind', 'provider.validate', 'provider.activate',
         'provider.route.toggle', 'provider.secret.rotate', 'provider.revoke' THEN
      IF p_resource_type IS NOT NULL THEN RAISE EXCEPTION 'ENTERPRISE_AI_INVALID_COMMAND_AREA'; END IF;
      RETURN 'provider';
    WHEN 'evidence.source.create', 'evidence.extract', 'evidence.candidate.review',
         'evidence.assess.promote' THEN
      IF p_resource_type IS NOT NULL THEN RAISE EXCEPTION 'ENTERPRISE_AI_INVALID_COMMAND_AREA'; END IF;
      RETURN 'ingestion';
    WHEN 'modernization.evaluate', 'studio.delivery.handoff', 'monitor.baseline.create' THEN
      IF p_resource_type IS NOT NULL THEN RAISE EXCEPTION 'ENTERPRISE_AI_INVALID_COMMAND_AREA'; END IF;
      RETURN 'delivery';
    WHEN 'assemble.blueprint.create' THEN
      IF p_resource_type IS NOT NULL THEN RAISE EXCEPTION 'ENTERPRISE_AI_INVALID_COMMAND_AREA'; END IF;
      RETURN 'assemble';
    WHEN 'approval.review.record', 'approval.record' THEN
      IF p_resource_type = 'assemble_blueprint' THEN RETURN 'assemble'; END IF;
      IF p_resource_type IN ('modernization_decision', 'delivery_work_package', 'monitor_baseline', 'evidence_candidate') THEN
        RETURN 'delivery';
      END IF;
      RAISE EXCEPTION 'ENTERPRISE_AI_INVALID_COMMAND_AREA';
    ELSE
      RAISE EXCEPTION 'ENTERPRISE_AI_INVALID_COMMAND_AREA';
  END CASE;
END;
$$;

CREATE OR REPLACE FUNCTION public.enterprise_assert_writable(p_area TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE control public.enterprise_intelligence_runtime_control;
BEGIN
  SELECT * INTO control FROM public.enterprise_intelligence_runtime_control WHERE singleton = true FOR SHARE;
  IF control.singleton IS NULL OR NOT control.enabled OR control.read_only THEN RAISE EXCEPTION 'ENTERPRISE_INTELLIGENCE_READ_ONLY'; END IF;
  IF p_area = 'provider' AND NOT control.provider_enabled THEN RAISE EXCEPTION 'ENTERPRISE_INTELLIGENCE_PROVIDER_DISABLED';
  ELSIF p_area = 'ingestion' AND NOT control.ingestion_enabled THEN RAISE EXCEPTION 'ENTERPRISE_INTELLIGENCE_INGESTION_DISABLED';
  ELSIF p_area = 'delivery' AND NOT control.delivery_enabled THEN RAISE EXCEPTION 'ENTERPRISE_INTELLIGENCE_DELIVERY_DISABLED';
  ELSIF p_area = 'assemble' AND NOT control.assemble_enabled THEN RAISE EXCEPTION 'ENTERPRISE_INTELLIGENCE_ASSEMBLE_DISABLED';
  ELSIF p_area NOT IN ('provider', 'ingestion', 'delivery', 'assemble') THEN RAISE EXCEPTION 'ENTERPRISE_AI_INVALID_COMMAND_AREA';
  END IF;
END;
$$;

-- Claim idempotency before any Storage, provider, or state effect. A unique
-- row lock makes a concurrent duplicate observe the in-progress claim instead
-- of executing the command a second time. Completion/failure are forward-only
-- and retain the sanitized response for exact replay.
CREATE OR REPLACE FUNCTION public.enterprise_ai_claim_command(
  p_actor UUID,
  p_org UUID,
  p_workspace UUID,
  p_command_type TEXT,
  p_key TEXT,
  p_request UUID,
  p_hash TEXT,
  p_resource_type TEXT DEFAULT NULL
)
RETURNS public.enterprise_ai_command_receipts
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE v_row public.enterprise_ai_command_receipts; v_area TEXT;
BEGIN
  IF p_actor IS NULL OR p_org IS NULL OR p_workspace IS NULL OR p_request IS NULL
     OR p_key IS NULL OR length(btrim(p_key)) NOT BETWEEN 8 AND 200
     OR p_hash IS NULL OR p_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'ENTERPRISE_AI_INVALID_COMMAND';
  END IF;
  v_area := public.enterprise_command_runtime_area(p_command_type, p_resource_type);
  SELECT * INTO v_row FROM public.enterprise_ai_command_receipts
  WHERE org_id = p_org AND workspace_id = p_workspace AND actor_id = p_actor
    AND command_type = p_command_type AND idempotency_key = p_key
  FOR UPDATE;
  IF v_row.id IS NOT NULL THEN
    IF v_row.request_id IS DISTINCT FROM p_request OR v_row.request_hash IS DISTINCT FROM p_hash
       OR v_row.runtime_area IS DISTINCT FROM v_area OR v_row.resource_type IS DISTINCT FROM p_resource_type THEN
      RAISE EXCEPTION 'ENTERPRISE_AI_IDEMPOTENCY_CONFLICT';
    END IF;
    RETURN v_row;
  END IF;
  PERFORM public.enterprise_assert_writable(v_area);
  INSERT INTO public.enterprise_ai_command_receipts(
    org_id, workspace_id, actor_id, command_type, runtime_area, resource_type, idempotency_key,
    request_id, request_hash, status, response
  ) VALUES (
    p_org, p_workspace, p_actor, p_command_type, v_area, p_resource_type, p_key,
    p_request, p_hash, 'claimed', '{}'::jsonb
  )
  ON CONFLICT (org_id, workspace_id, actor_id, command_type, idempotency_key) DO NOTHING
  RETURNING * INTO v_row;
  IF v_row.id IS NULL THEN
    SELECT * INTO v_row
    FROM public.enterprise_ai_command_receipts
    WHERE org_id = p_org AND workspace_id = p_workspace
      AND actor_id = p_actor AND command_type = p_command_type
      AND idempotency_key = p_key
    FOR UPDATE;
    IF v_row.id IS NULL THEN RAISE EXCEPTION 'ENTERPRISE_AI_NOT_FOUND'; END IF;
    IF v_row.request_id IS DISTINCT FROM p_request OR v_row.request_hash IS DISTINCT FROM p_hash
       OR v_row.runtime_area IS DISTINCT FROM v_area OR v_row.resource_type IS DISTINCT FROM p_resource_type THEN
      RAISE EXCEPTION 'ENTERPRISE_AI_IDEMPOTENCY_CONFLICT';
    END IF;
  END IF;
  RETURN v_row;
END;
$$;


CREATE OR REPLACE FUNCTION public.enterprise_ai_complete_command(
  p_id UUID, p_org UUID, p_workspace UUID, p_response JSONB, p_resource_id UUID DEFAULT NULL
)
RETURNS public.enterprise_ai_command_receipts
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE v_row public.enterprise_ai_command_receipts;
BEGIN
  SELECT * INTO v_row
  FROM public.enterprise_ai_command_receipts
  WHERE id = p_id AND org_id = p_org AND workspace_id = p_workspace
  FOR UPDATE;
  IF v_row.id IS NULL OR v_row.status <> 'claimed' THEN
    RAISE EXCEPTION 'ENTERPRISE_AI_RECEIPT_NOT_CLAIMED';
  END IF;
  UPDATE public.enterprise_ai_command_receipts
  SET status = 'committed', response = COALESCE(p_response, '{}'::jsonb),
      resource_id = p_resource_id, completed_at = statement_timestamp()
  WHERE id = v_row.id AND status = 'claimed'
  RETURNING * INTO v_row;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'ENTERPRISE_AI_RECEIPT_NOT_CLAIMED'; END IF;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.enterprise_ai_fail_command(
  p_id UUID, p_org UUID, p_workspace UUID, p_response JSONB, p_blocked BOOLEAN DEFAULT false
)
RETURNS public.enterprise_ai_command_receipts
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE v_row public.enterprise_ai_command_receipts;
BEGIN
  SELECT * INTO v_row
  FROM public.enterprise_ai_command_receipts
  WHERE id = p_id AND org_id = p_org AND workspace_id = p_workspace
  FOR UPDATE;
  IF v_row.id IS NULL OR v_row.status <> 'claimed' THEN
    RAISE EXCEPTION 'ENTERPRISE_AI_RECEIPT_NOT_CLAIMED';
  END IF;
  UPDATE public.enterprise_ai_command_receipts
  SET status = CASE WHEN p_blocked THEN 'blocked' ELSE 'failed' END,
      response = COALESCE(p_response, '{}'::jsonb), completed_at = statement_timestamp()
  WHERE id = v_row.id AND status = 'claimed'
  RETURNING * INTO v_row;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'ENTERPRISE_AI_RECEIPT_NOT_CLAIMED'; END IF;
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.enterprise_ai_claim_command(UUID, UUID, UUID, TEXT, TEXT, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enterprise_ai_complete_command(UUID, UUID, UUID, JSONB, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enterprise_ai_fail_command(UUID, UUID, UUID, JSONB, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enterprise_ai_claim_command(UUID, UUID, UUID, TEXT, TEXT, UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.enterprise_ai_complete_command(UUID, UUID, UUID, JSONB, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.enterprise_ai_fail_command(UUID, UUID, UUID, JSONB, BOOLEAN) TO service_role;

CREATE TABLE public.enterprise_ai_usage_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL,
  provider_config_id UUID NOT NULL,
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('gemini', 'groq', 'openai', 'azure_openai', 'anthropic', 'openai_compatible')),
  model TEXT NOT NULL CHECK (length(btrim(model)) BETWEEN 1 AND 200),
  input_tokens INTEGER NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens INTEGER NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  request_count INTEGER NOT NULL DEFAULT 1 CHECK (request_count = 1),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT enterprise_ai_usage_workspace_org_fkey
    FOREIGN KEY (workspace_id, org_id)
    REFERENCES public.workspaces(id, org_id) ON DELETE CASCADE,
  CONSTRAINT enterprise_ai_usage_job_org_fkey
    FOREIGN KEY (job_id, org_id)
    REFERENCES public.enterprise_ai_job_ledger(id, org_id) ON DELETE RESTRICT,
  CONSTRAINT enterprise_ai_usage_provider_org_fkey
    FOREIGN KEY (provider_config_id, org_id)
    REFERENCES public.ai_provider_configs(id, org_id) ON DELETE RESTRICT,
  UNIQUE (job_id)
);

CREATE TABLE public.enterprise_evidence_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL,
  display_name TEXT NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 240),
  source_kind TEXT NOT NULL CHECK (source_kind IN ('upload', 'pasted_text')),
  mime_type TEXT NOT NULL CHECK (mime_type IN (
    'text/plain', 'text/markdown', 'text/csv', 'text/vtt', 'application/x-subrip',
    'text/x-srt', 'text/meeting-notes', 'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  )),
  current_version INTEGER NOT NULL DEFAULT 1 CHECK (current_version > 0),
  lifecycle_version BIGINT NOT NULL DEFAULT 1 CHECK (lifecycle_version > 0),
  status TEXT NOT NULL CHECK (status IN ('uploaded', 'extracting', 'review', 'deleted', 'failed')),
  created_by UUID NOT NULL REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT enterprise_evidence_sources_workspace_org_fkey
    FOREIGN KEY (workspace_id, org_id)
    REFERENCES public.workspaces(id, org_id) ON DELETE CASCADE,
  UNIQUE (id, org_id, workspace_id)
);

CREATE TABLE public.enterprise_evidence_source_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID NOT NULL,
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  original_filename TEXT NOT NULL CHECK (length(btrim(original_filename)) BETWEEN 1 AND 240),
  content_hash TEXT NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  content_bytes BIGINT NOT NULL CHECK (content_bytes > 0 AND content_bytes <= 12582912),
  storage_bucket TEXT NOT NULL DEFAULT 'source-uploads' CHECK (storage_bucket = 'source-uploads'),
  storage_path TEXT NOT NULL CHECK (length(btrim(storage_path)) BETWEEN 1 AND 1024),
  extracted_text_hash TEXT CHECK (extracted_text_hash IS NULL OR extracted_text_hash ~ '^[0-9a-f]{64}$'),
  extracted_character_count INTEGER CHECK (extracted_character_count IS NULL OR extracted_character_count >= 0),
  extraction_status TEXT NOT NULL DEFAULT 'pending' CHECK (extraction_status IN (
    'pending', 'parsed', 'failed_ocr_required', 'failed_unsupported', 'failed_malformed'
  )),
  parser_kind TEXT NOT NULL CHECK (parser_kind IN ('text_native', 'csv', 'vtt', 'srt', 'pdf_text', 'docx')),
  parser_version TEXT NOT NULL CHECK (length(btrim(parser_version)) BETWEEN 1 AND 120),
  extraction_failure_code TEXT CHECK (extraction_failure_code IS NULL OR extraction_failure_code IN (
    'OCR_REQUIRED', 'UNSUPPORTED_FORMAT', 'MALFORMED_SOURCE'
  )),
  provenance_hash TEXT NOT NULL CHECK (provenance_hash ~ '^[0-9a-f]{64}$'),
  source_locator_schema TEXT NOT NULL DEFAULT 'source-locator-1',
  created_by UUID NOT NULL REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT enterprise_evidence_versions_source_fkey
    FOREIGN KEY (source_id, org_id, workspace_id)
    REFERENCES public.enterprise_evidence_sources(id, org_id, workspace_id) ON DELETE RESTRICT,
  UNIQUE (id, source_id, org_id, workspace_id),
  UNIQUE (source_id, version),
  UNIQUE (org_id, workspace_id, content_hash)
);

CREATE OR REPLACE FUNCTION public.enterprise_create_evidence_source(p_source JSONB, p_version JSONB)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE v_source public.enterprise_evidence_sources; v_version public.enterprise_evidence_source_versions;
BEGIN
  INSERT INTO public.enterprise_evidence_sources(
    id, org_id, workspace_id, display_name, source_kind, mime_type,
    current_version, status, created_by
  ) VALUES (
    (p_source->>'id')::uuid, (p_source->>'org_id')::uuid, (p_source->>'workspace_id')::uuid,
    p_source->>'display_name', p_source->>'source_kind', p_source->>'mime_type',
    (p_source->>'current_version')::integer, p_source->>'status', (p_source->>'created_by')::uuid
  ) RETURNING * INTO v_source;
  INSERT INTO public.enterprise_evidence_source_versions(
    id, source_id, org_id, workspace_id, version, original_filename,
    content_hash, content_bytes, storage_bucket, storage_path,
    extracted_text_hash, extracted_character_count, created_by
  ) VALUES (
    (p_version->>'id')::uuid, (p_version->>'source_id')::uuid,
    (p_version->>'org_id')::uuid, (p_version->>'workspace_id')::uuid,
    (p_version->>'version')::integer, p_version->>'original_filename',
    p_version->>'content_hash', (p_version->>'content_bytes')::bigint,
    p_version->>'storage_bucket', p_version->>'storage_path',
    p_version->>'extracted_text_hash', (p_version->>'extracted_character_count')::integer,
    (p_version->>'created_by')::uuid
  ) RETURNING * INTO v_version;
  RETURN jsonb_build_object('sourceId', v_source.id, 'sourceVersionId', v_version.id);
END;
$$;

REVOKE ALL ON FUNCTION public.enterprise_create_evidence_source(JSONB, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enterprise_create_evidence_source(JSONB, JSONB) TO service_role;

CREATE TABLE public.enterprise_evidence_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID NOT NULL,
  source_version_id UUID NOT NULL,
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL,
  field_key TEXT NOT NULL CHECK (field_key IN (
    'process_objective', 'outcome', 'trigger', 'completion', 'actors', 'systems',
    'steps', 'rules', 'exceptions', 'manual_activities', 'controls_approvals',
    'inputs_outputs', 'volumes_frequencies', 'slas', 'pain_points', 'risks',
    'data_sensitivity', 'automation_opportunities', 'integrations',
    'unresolved_questions', 'assumptions'
  )),
  value TEXT NOT NULL CHECK (length(btrim(value)) BETWEEN 1 AND 12000),
  safe_excerpt TEXT CHECK (safe_excerpt IS NULL OR length(safe_excerpt) <= 1000),
  excerpt_hash TEXT NOT NULL CHECK (excerpt_hash ~ '^[0-9a-f]{64}$'),
  provenance_hash TEXT NOT NULL CHECK (provenance_hash ~ '^[0-9a-f]{64}$'),
  version BIGINT NOT NULL DEFAULT 1 CHECK (version > 0),
  source_locator TEXT NOT NULL CHECK (length(btrim(source_locator)) BETWEEN 1 AND 400),
  confidence NUMERIC(5,4) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  ai_job_id UUID REFERENCES public.enterprise_ai_job_ledger(id) ON DELETE SET NULL,
  prompt_version TEXT,
  suggestion_status TEXT NOT NULL CHECK (suggestion_status IN ('suggested', 'accepted', 'rejected', 'edited')),
  created_by UUID NOT NULL REFERENCES public.profiles(id),
  reviewed_by UUID REFERENCES public.profiles(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT enterprise_evidence_candidates_source_fkey
    FOREIGN KEY (source_id, org_id, workspace_id)
    REFERENCES public.enterprise_evidence_sources(id, org_id, workspace_id) ON DELETE RESTRICT,
  CONSTRAINT enterprise_evidence_candidates_version_fkey
    FOREIGN KEY (source_version_id, source_id, org_id, workspace_id)
    REFERENCES public.enterprise_evidence_source_versions(id, source_id, org_id, workspace_id) ON DELETE RESTRICT,
  CONSTRAINT enterprise_evidence_candidates_job_org_fkey
    FOREIGN KEY (ai_job_id, org_id)
    REFERENCES public.enterprise_ai_job_ledger(id, org_id) ON DELETE SET NULL (ai_job_id),
  UNIQUE (id, org_id, workspace_id)
);

CREATE OR REPLACE FUNCTION public.enterprise_commit_evidence_extraction(
  p_job_id UUID,
  p_source_id UUID,
  p_org UUID,
  p_workspace UUID,
  p_output_hash TEXT,
  p_latency_ms INTEGER,
  p_provider_config_id UUID,
  p_provider TEXT,
  p_model TEXT,
  p_token_input INTEGER,
  p_token_output INTEGER,
  p_candidates JSONB
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE item JSONB;
BEGIN
  FOR item IN SELECT value FROM jsonb_array_elements(COALESCE(p_candidates, '[]'::jsonb)) LOOP
    INSERT INTO public.enterprise_evidence_candidates(
      id, source_id, source_version_id, org_id, workspace_id, field_key,
      value, safe_excerpt, excerpt_hash, source_locator, confidence,
      ai_job_id, prompt_version, suggestion_status, created_by
    ) VALUES (
      (item->>'id')::uuid, p_source_id, (item->>'sourceVersionId')::uuid,
      p_org, p_workspace, item->>'field', item->>'value', item->>'safeExcerpt',
      item->>'excerptHash', item->>'sourceLocator', (item->>'confidence')::numeric,
      p_job_id, item->>'promptVersion', item->>'status', (item->>'createdBy')::uuid
    );
  END LOOP;
  UPDATE public.enterprise_ai_job_ledger
  SET status = 'succeeded', output_hash = p_output_hash, latency_ms = p_latency_ms,
      token_input = p_token_input, token_output = p_token_output,
      completed_at = statement_timestamp()
  WHERE id = p_job_id AND org_id = p_org AND workspace_id = p_workspace AND status = 'running';
  IF NOT FOUND THEN RAISE EXCEPTION 'ENTERPRISE_AI_JOB_NOT_RUNNING'; END IF;
  INSERT INTO public.enterprise_ai_usage_ledger(
    job_id, provider_config_id, org_id, workspace_id, provider, model,
    input_tokens, output_tokens
  ) VALUES (p_job_id, p_provider_config_id, p_org, p_workspace, p_provider, p_model, p_token_input, p_token_output);
  UPDATE public.enterprise_evidence_sources
  SET status = 'review', updated_at = statement_timestamp()
  WHERE id = p_source_id AND org_id = p_org AND workspace_id = p_workspace AND deleted_at IS NULL;
  RETURN jsonb_build_object('jobId', p_job_id, 'candidateCount', jsonb_array_length(COALESCE(p_candidates, '[]'::jsonb)));
END;
$$;

REVOKE ALL ON FUNCTION public.enterprise_commit_evidence_extraction(UUID, UUID, UUID, UUID, TEXT, INTEGER, UUID, TEXT, TEXT, INTEGER, INTEGER, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enterprise_commit_evidence_extraction(UUID, UUID, UUID, UUID, TEXT, INTEGER, UUID, TEXT, TEXT, INTEGER, INTEGER, JSONB) TO service_role;

CREATE TABLE public.enterprise_evidence_candidate_edits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id UUID NOT NULL,
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL,
  actor_id UUID NOT NULL REFERENCES public.profiles(id),
  previous_value TEXT NOT NULL,
  next_value TEXT NOT NULL,
  previous_version BIGINT NOT NULL CHECK (previous_version > 0),
  resulting_version BIGINT NOT NULL CHECK (resulting_version = previous_version + 1),
  previous_provenance_hash TEXT NOT NULL CHECK (previous_provenance_hash ~ '^[0-9a-f]{64}$'),
  resulting_provenance_hash TEXT NOT NULL CHECK (resulting_provenance_hash ~ '^[0-9a-f]{64}$'),
  reason TEXT NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT enterprise_evidence_edits_workspace_org_fkey
    FOREIGN KEY (workspace_id, org_id)
    REFERENCES public.workspaces(id, org_id) ON DELETE CASCADE,
  CONSTRAINT enterprise_evidence_edits_candidate_fkey
    FOREIGN KEY (candidate_id, org_id, workspace_id)
    REFERENCES public.enterprise_evidence_candidates(id, org_id, workspace_id) ON DELETE RESTRICT
);

CREATE OR REPLACE FUNCTION public.enterprise_review_evidence_candidate(
  p_candidate_id UUID, p_org UUID, p_workspace UUID, p_value TEXT,
  p_excerpt_hash TEXT, p_status TEXT, p_actor UUID,
  p_previous_value TEXT, p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
BEGIN
  UPDATE public.enterprise_evidence_candidates
  SET value = p_value, excerpt_hash = p_excerpt_hash, suggestion_status = p_status,
      reviewed_by = p_actor, reviewed_at = statement_timestamp(), updated_at = statement_timestamp()
  WHERE id = p_candidate_id AND org_id = p_org AND workspace_id = p_workspace;
  IF NOT FOUND THEN RAISE EXCEPTION 'ENTERPRISE_AI_CANDIDATE_NOT_FOUND'; END IF;
  IF p_status = 'edited' THEN
    INSERT INTO public.enterprise_evidence_candidate_edits(
      candidate_id, org_id, workspace_id, actor_id, previous_value, next_value, reason
    ) VALUES (p_candidate_id, p_org, p_workspace, p_actor, p_previous_value, p_value, p_reason);
  END IF;
  RETURN jsonb_build_object('candidateId', p_candidate_id, 'status', p_status, 'reviewedBy', p_actor);
END;
$$;

CREATE OR REPLACE FUNCTION public.enterprise_ai_claim_command(
  p_actor UUID, p_org UUID, p_workspace UUID, p_command_type TEXT,
  p_key TEXT, p_request UUID, p_hash TEXT, p_resource_type TEXT DEFAULT NULL
)
RETURNS public.enterprise_ai_command_receipts
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE receipt public.enterprise_ai_command_receipts; runtime_area TEXT;
BEGIN
  IF p_actor IS NULL OR p_org IS NULL OR p_workspace IS NULL OR p_request IS NULL
     OR length(btrim(COALESCE(p_command_type, ''))) NOT BETWEEN 1 AND 120
     OR length(btrim(COALESCE(p_key, ''))) NOT BETWEEN 8 AND 200
     OR p_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'ENTERPRISE_AI_INVALID_COMMAND';
  END IF;
  runtime_area := public.enterprise_command_runtime_area(p_command_type, p_resource_type);
  SELECT * INTO receipt FROM public.enterprise_ai_command_receipts
  WHERE org_id = p_org AND workspace_id = p_workspace AND actor_id = p_actor
    AND command_type = p_command_type AND idempotency_key = p_key
  FOR UPDATE;
  IF receipt.id IS NOT NULL THEN
    IF receipt.request_id IS DISTINCT FROM p_request
       OR receipt.request_hash IS DISTINCT FROM p_hash
       OR receipt.runtime_area IS DISTINCT FROM runtime_area
       OR receipt.resource_type IS DISTINCT FROM p_resource_type THEN
      RAISE EXCEPTION 'ENTERPRISE_AI_IDEMPOTENCY_CONFLICT';
    END IF;
    RETURN receipt;
  END IF;
  PERFORM public.enterprise_assert_writable(runtime_area);
  INSERT INTO public.enterprise_ai_command_receipts(
    org_id, workspace_id, actor_id, command_type, runtime_area, resource_type, idempotency_key,
    request_id, request_hash, status, response
  ) VALUES (p_org, p_workspace, p_actor, p_command_type, runtime_area, p_resource_type, p_key, p_request, p_hash, 'claimed', '{}'::jsonb)
  ON CONFLICT (org_id, workspace_id, actor_id, command_type, idempotency_key) DO NOTHING
  RETURNING * INTO receipt;
  IF receipt.id IS NULL THEN
    SELECT * INTO receipt FROM public.enterprise_ai_command_receipts
    WHERE org_id = p_org AND actor_id = p_actor
      AND command_type = p_command_type AND idempotency_key = p_key
    FOR UPDATE;
    IF receipt.workspace_id IS DISTINCT FROM p_workspace
       OR receipt.request_id IS DISTINCT FROM p_request
       OR receipt.request_hash IS DISTINCT FROM p_hash
       OR receipt.runtime_area IS DISTINCT FROM runtime_area
       OR receipt.resource_type IS DISTINCT FROM p_resource_type THEN
      RAISE EXCEPTION 'ENTERPRISE_AI_IDEMPOTENCY_CONFLICT';
    END IF;
  END IF;
  RETURN receipt;
END;
$$;

CREATE TABLE public.enterprise_evidence_assess_promotions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL,
  candidate_id UUID NOT NULL,
  source_id UUID NOT NULL,
  source_version_id UUID NOT NULL,
  assess_case_id UUID NOT NULL,
  assess_case_version_id UUID NOT NULL,
  assess_case_version BIGINT NOT NULL CHECK (assess_case_version > 0),
  candidate_version BIGINT NOT NULL CHECK (candidate_version > 0),
  candidate_provenance_hash TEXT NOT NULL CHECK (candidate_provenance_hash ~ '^[0-9a-f]{64}$'),
  field_key TEXT NOT NULL,
  promoted_by UUID NOT NULL REFERENCES public.profiles(id),
  promoted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT enterprise_evidence_promotions_workspace_org_fkey
    FOREIGN KEY (workspace_id, org_id) REFERENCES public.workspaces(id, org_id) ON DELETE CASCADE,
  CONSTRAINT enterprise_evidence_promotions_candidate_fkey
    FOREIGN KEY (candidate_id, org_id, workspace_id)
    REFERENCES public.enterprise_evidence_candidates(id, org_id, workspace_id) ON DELETE RESTRICT,
  CONSTRAINT enterprise_evidence_promotions_source_fkey
    FOREIGN KEY (source_version_id, source_id, org_id, workspace_id)
    REFERENCES public.enterprise_evidence_source_versions(id, source_id, org_id, workspace_id) ON DELETE RESTRICT,
  CONSTRAINT enterprise_evidence_promotions_case_version_fkey
    FOREIGN KEY (assess_case_version_id, assess_case_id, workspace_id, org_id)
    REFERENCES public.assess_v2_case_versions(id, case_id, workspace_id, org_id) ON DELETE RESTRICT,
  UNIQUE (id, org_id, workspace_id),
  UNIQUE (candidate_id, assess_case_id, assess_case_version_id)
);

CREATE OR REPLACE FUNCTION public.enterprise_promote_evidence_to_assess_v2(
  p_candidate UUID, p_case UUID, p_expected_version BIGINT,
  p_actor UUID, p_org UUID, p_workspace UUID,
  p_request UUID, p_idempotency_key TEXT, p_authorization_version BIGINT
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE candidate public.enterprise_evidence_candidates; assess_case public.assess_v2_cases;
  old_version public.assess_v2_case_versions; new_version public.assess_v2_case_versions;
  receipt public.enterprise_ai_command_receipts; promotion public.enterprise_evidence_assess_promotions;
  request_hash TEXT; result JSONB;
BEGIN
  PERFORM public.enterprise_assert_writable('ingestion');
  PERFORM public.pr1b_assert_command_authority(p_actor, p_org, p_workspace, 'assessment.edit', p_authorization_version);
  request_hash := public.enterprise_sha256_jsonb(jsonb_build_object(
    'candidateId', p_candidate, 'caseId', p_case, 'expectedVersion', p_expected_version,
    'organizationId', p_org, 'workspaceId', p_workspace
  ));
  receipt := public.enterprise_ai_claim_command(
    p_actor, p_org, p_workspace, 'evidence.assess.promote',
    p_idempotency_key, p_request, request_hash, NULL
  );
  IF receipt.status = 'committed' THEN
    RETURN jsonb_build_object('outcome', 'replayed', 'resource', receipt.response);
  ELSIF receipt.status <> 'claimed' OR receipt.created_at < statement_timestamp() - interval '5 minutes' THEN
    RAISE EXCEPTION 'ENTERPRISE_AI_COMMAND_NOT_EXECUTABLE';
  END IF;
  SELECT * INTO candidate FROM public.enterprise_evidence_candidates
  WHERE id = p_candidate AND org_id = p_org AND workspace_id = p_workspace FOR SHARE;
  IF candidate.id IS NULL OR candidate.suggestion_status <> 'accepted' THEN
    RAISE EXCEPTION 'ENTERPRISE_EVIDENCE_CANDIDATE_NOT_ACCEPTED';
  END IF;
  SELECT * INTO assess_case FROM public.assess_v2_cases
  WHERE id = p_case AND org_id = p_org AND workspace_id = p_workspace AND deleted_at IS NULL FOR UPDATE;
  IF assess_case.id IS NULL OR assess_case.status <> 'draft' OR assess_case.version <> p_expected_version THEN
    RAISE EXCEPTION 'ENTERPRISE_EVIDENCE_ASSESS_VERSION_CONFLICT';
  END IF;
  SELECT * INTO old_version FROM public.assess_v2_case_versions
  WHERE id = assess_case.head_version_id AND case_id = assess_case.id FOR SHARE;
  INSERT INTO public.assess_v2_case_versions(
    case_id, org_id, workspace_id, version, name, description, agent_necessity,
    source_kind, source_snapshot, created_by
  ) VALUES (
    assess_case.id, p_org, p_workspace, assess_case.version + 1,
    old_version.name, old_version.description, old_version.agent_necessity,
    'draft_upsert', jsonb_build_object(
      'promotion', jsonb_build_object(
        'candidateId', candidate.id, 'candidateVersion', candidate.version,
        'candidateProvenanceHash', candidate.provenance_hash,
        'sourceId', candidate.source_id, 'sourceVersionId', candidate.source_version_id
      )
    ), p_actor
  ) RETURNING * INTO new_version;
  INSERT INTO public.assess_v2_primitives SELECT id, new_version.id, case_id, org_id, workspace_id, payload FROM public.assess_v2_primitives WHERE version_id = old_version.id;
  INSERT INTO public.assess_v2_edges SELECT id, new_version.id, case_id, org_id, workspace_id, payload FROM public.assess_v2_edges WHERE version_id = old_version.id;
  INSERT INTO public.assess_v2_decision_points SELECT id, new_version.id, case_id, org_id, workspace_id, payload FROM public.assess_v2_decision_points WHERE version_id = old_version.id;
  INSERT INTO public.assess_v2_exception_paths SELECT id, new_version.id, case_id, org_id, workspace_id, payload FROM public.assess_v2_exception_paths WHERE version_id = old_version.id;
  INSERT INTO public.assess_v2_application_assets SELECT id, new_version.id, case_id, org_id, workspace_id, payload FROM public.assess_v2_application_assets WHERE version_id = old_version.id;
  INSERT INTO public.assess_v2_application_interactions SELECT id, new_version.id, case_id, org_id, workspace_id, payload FROM public.assess_v2_application_interactions WHERE version_id = old_version.id;
  INSERT INTO public.assess_v2_evidence_links(id, version_id, case_id, org_id, workspace_id, payload)
  SELECT id, new_version.id, case_id, org_id, workspace_id, payload
  FROM public.assess_v2_evidence_links WHERE version_id = old_version.id;
  INSERT INTO public.assess_v2_evidence_links(id, version_id, case_id, org_id, workspace_id, payload)
  VALUES (gen_random_uuid(), new_version.id, assess_case.id, p_org, p_workspace, jsonb_build_object(
    'status', 'submitted', 'validated', false, 'reviewerIds', '[]'::jsonb,
    'kind', 'enterprise_evidence_candidate', 'candidateId', candidate.id,
    'sourceId', candidate.source_id, 'sourceVersionId', candidate.source_version_id,
    'fieldKey', candidate.field_key, 'value', candidate.value,
    'sourceLocator', candidate.source_locator, 'safeExcerpt', candidate.safe_excerpt,
    'candidateVersion', candidate.version, 'provenanceHash', candidate.provenance_hash
  ));
  UPDATE public.assess_v2_cases
  SET version = new_version.version, head_version_id = new_version.id, updated_at = statement_timestamp()
  WHERE id = assess_case.id;
  INSERT INTO public.enterprise_evidence_assess_promotions(
    org_id, workspace_id, candidate_id, source_id, source_version_id,
    assess_case_id, assess_case_version_id, assess_case_version,
    candidate_version, candidate_provenance_hash, field_key, promoted_by
  ) VALUES (
    p_org, p_workspace, candidate.id, candidate.source_id, candidate.source_version_id,
    assess_case.id, new_version.id, new_version.version,
    candidate.version, candidate.provenance_hash, candidate.field_key, p_actor
  ) RETURNING * INTO promotion;
  INSERT INTO public.privileged_audit_events(
    org_id, workspace_id, actor_id, request_id, action, resource_type,
    resource_id, outcome, resource_version, metadata
  ) VALUES (
    p_org, p_workspace, p_actor, p_request, 'evidence.candidate.promote',
    'assess_v2_case', assess_case.id, 'succeeded', new_version.version,
    jsonb_build_object('promotionId', promotion.id, 'candidateId', candidate.id,
      'candidateVersion', candidate.version, 'candidateProvenanceHash', candidate.provenance_hash)
  );
  result := jsonb_build_object(
    'promotionId', promotion.id, 'candidateId', candidate.id,
    'caseId', assess_case.id, 'caseVersionId', new_version.id,
    'caseVersion', new_version.version, 'candidateProvenanceHash', candidate.provenance_hash
  );
  UPDATE public.enterprise_ai_command_receipts
  SET status = 'committed', response = result, resource_id = promotion.id, completed_at = statement_timestamp()
  WHERE id = receipt.id AND status = 'claimed';
  RETURN jsonb_build_object('outcome', 'committed', 'resource', result);
END;
$$;

CREATE OR REPLACE FUNCTION public.enterprise_commit_delivery_handoff(
  p_handoff JSONB, p_package JSONB, p_version JSONB, p_items JSONB
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE aggregate public.studio_artifact_aggregates; studio_version public.studio_artifact_versions;
  item JSONB; item_id UUID; parent_id UUID; item_ids JSONB := '[]'::jsonb;
  canonical_content_hash TEXT; handoff_id UUID := (p_handoff->>'id')::uuid;
  package_id UUID := (p_package->>'id')::uuid; package_version_id UUID := (p_version->>'id')::uuid;
  org UUID := (p_handoff->>'org_id')::uuid; workspace UUID := (p_handoff->>'workspace_id')::uuid;
BEGIN
  PERFORM public.enterprise_assert_writable('delivery');
  IF jsonb_typeof(COALESCE(p_items, '[]'::jsonb)) <> 'array' OR jsonb_array_length(COALESCE(p_items, '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'ENTERPRISE_DELIVERY_ITEMS_REQUIRED';
  END IF;
  SELECT * INTO aggregate FROM public.studio_artifact_aggregates
  WHERE id = (p_handoff->>'studio_document_id')::uuid AND org_id = org AND workspace_id = workspace FOR SHARE;
  IF aggregate.id IS NULL OR aggregate.lifecycle <> 'approved'
     OR aggregate.current_approved_version_id IS DISTINCT FROM (p_handoff->>'studio_version_id')::uuid THEN
    RAISE EXCEPTION 'ENTERPRISE_DELIVERY_SOURCE_STALE';
  END IF;
  SELECT * INTO studio_version FROM public.studio_artifact_versions
  WHERE id = aggregate.current_approved_version_id AND artifact_id = aggregate.id
    AND org_id = org AND workspace_id = workspace FOR SHARE;
  IF studio_version.id IS NULL OR studio_version.lifecycle <> 'approved'
     OR studio_version.version IS DISTINCT FROM (p_handoff->>'studio_version')::bigint
     OR studio_version.content_hash IS DISTINCT FROM p_handoff->>'studio_content_hash' THEN
    RAISE EXCEPTION 'ENTERPRISE_DELIVERY_SOURCE_STALE';
  END IF;
  canonical_content_hash := public.enterprise_sha256_jsonb(p_version->'content');
  INSERT INTO public.enterprise_studio_delivery_handoffs(
    id, org_id, workspace_id, studio_document_id, artifact_type, studio_version_id,
    studio_version, studio_content_hash, source_status, source_snapshot, status, created_by
  ) VALUES (
    handoff_id, org, workspace, aggregate.id, aggregate.artifact_type, studio_version.id,
    studio_version.version, studio_version.content_hash, 'approved',
    jsonb_build_object('artifactType', aggregate.artifact_type, 'version', studio_version.version,
      'contentHash', studio_version.content_hash), 'draft', (p_handoff->>'created_by')::uuid
  );
  INSERT INTO public.enterprise_delivery_work_packages(
    id, org_id, workspace_id, handoff_id, current_version, status, created_by
  ) VALUES (package_id, org, workspace, handoff_id, 1, 'draft', (p_package->>'created_by')::uuid);
  INSERT INTO public.enterprise_delivery_work_package_versions(
    id, work_package_id, org_id, workspace_id, version, studio_document_id,
    artifact_type, studio_version_id, studio_version, studio_content_hash,
    content, content_hash, status, created_by
  ) VALUES (
    package_version_id, package_id, org, workspace, 1, aggregate.id,
    aggregate.artifact_type, studio_version.id, studio_version.version, studio_version.content_hash,
    p_version->'content', canonical_content_hash, 'draft', (p_version->>'created_by')::uuid
  );
  FOR item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    item_id := (substr(md5(package_version_id::text || ':' || (item->>'id')), 1, 8) || '-' ||
      substr(md5(package_version_id::text || ':' || (item->>'id')), 9, 4) || '-4' ||
      substr(md5(package_version_id::text || ':' || (item->>'id')), 14, 3) || '-8' ||
      substr(md5(package_version_id::text || ':' || (item->>'id')), 18, 3) || '-' ||
      substr(md5(package_version_id::text || ':' || (item->>'id')), 21, 12))::uuid;
    parent_id := NULL;
    IF NULLIF(item->>'parentId', '') IS NOT NULL THEN
      parent_id := (substr(md5(package_version_id::text || ':' || (item->>'parentId')), 1, 8) || '-' ||
        substr(md5(package_version_id::text || ':' || (item->>'parentId')), 9, 4) || '-4' ||
        substr(md5(package_version_id::text || ':' || (item->>'parentId')), 14, 3) || '-8' ||
        substr(md5(package_version_id::text || ':' || (item->>'parentId')), 18, 3) || '-' ||
        substr(md5(package_version_id::text || ':' || (item->>'parentId')), 21, 12))::uuid;
    END IF;
    INSERT INTO public.enterprise_delivery_work_items(
      id, package_version_id, org_id, workspace_id, parent_item_id, item_type,
      title, description, acceptance_criteria, non_functional_requirements,
      source_section_locator, source_document_id, source_document_version,
      source_document_hash, idempotency_key, created_by
    ) VALUES (
      item_id, package_version_id, org, workspace, parent_id, item->>'itemType',
      item->>'title', COALESCE(item->>'description', ''),
      COALESCE(item->'acceptanceCriteria', '[]'::jsonb),
      COALESCE(item->'nonFunctionalRequirements', '[]'::jsonb),
      item->>'sourceSectionLocator', aggregate.id, studio_version.version,
      studio_version.content_hash, item->>'idempotencyKey', (item->>'createdBy')::uuid
    );
    item_ids := item_ids || jsonb_build_array(item_id);
  END LOOP;
  RETURN jsonb_build_object(
    'handoffId', handoff_id, 'workPackageId', package_id,
    'packageVersionId', package_version_id, 'contentHash', canonical_content_hash,
    'itemIds', item_ids
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.enterprise_commit_monitor_baseline(
  p_baseline JSONB, p_actor UUID, p_org UUID, p_workspace UUID
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE package RECORD; version RECORD;
  expected_ids JSONB; supplied_ids JSONB; canonical_hash TEXT; baseline_id UUID := (p_baseline->>'id')::uuid;
BEGIN
  PERFORM public.enterprise_assert_writable('delivery');
  SELECT * INTO version FROM public.enterprise_delivery_work_package_versions
  WHERE id = (p_baseline->>'workPackageVersionId')::uuid AND org_id = p_org AND workspace_id = p_workspace FOR SHARE;
  SELECT * INTO package FROM public.enterprise_delivery_work_packages
  WHERE id = version.work_package_id AND org_id = p_org AND workspace_id = p_workspace FOR SHARE;
  IF version.id IS NULL OR package.id IS NULL OR package.status <> 'approved'
     OR version.status <> 'approved' OR package.current_version <> version.version THEN
    RAISE EXCEPTION 'ENTERPRISE_MONITOR_PACKAGE_NOT_APPROVED';
  END IF;
  SELECT COALESCE(jsonb_agg(id ORDER BY id), '[]'::jsonb) INTO expected_ids
  FROM public.enterprise_delivery_work_items WHERE package_version_id = version.id;
  SELECT COALESCE(jsonb_agg(value ORDER BY value), '[]'::jsonb) INTO supplied_ids
  FROM (SELECT DISTINCT value FROM jsonb_array_elements_text(COALESCE(p_baseline->'approvedItemIds', '[]'::jsonb))) ids;
  IF expected_ids <> supplied_ids OR jsonb_array_length(expected_ids) = 0
     OR COALESCE(jsonb_array_length(p_baseline->'blockers'), 0) <> 0 THEN
    RAISE EXCEPTION 'ENTERPRISE_MONITOR_BASELINE_INCOMPLETE';
  END IF;
  canonical_hash := public.enterprise_sha256_jsonb(jsonb_build_object(
    'workPackageVersionId', version.id, 'studioContentHash', version.studio_content_hash,
    'approvedItemIds', expected_ids, 'milestones', COALESCE(p_baseline->'milestones', '[]'::jsonb),
    'dependencies', COALESCE(p_baseline->'dependencies', '[]'::jsonb),
    'risks', COALESCE(p_baseline->'risks', '[]'::jsonb)
  ));
  INSERT INTO public.enterprise_monitor_baselines(
    id, org_id, workspace_id, work_package_id, work_package_version_id,
    studio_document_id, studio_version, studio_content_hash, approved_item_ids,
    milestones, dependencies, blockers, risks, readiness, status,
    live_telemetry_connected, version, resource_hash, created_by
  ) VALUES (
    baseline_id, p_org, p_workspace, package.id, version.id,
    version.studio_document_id, version.studio_version, version.studio_content_hash,
    expected_ids, COALESCE(p_baseline->'milestones', '[]'::jsonb),
    COALESCE(p_baseline->'dependencies', '[]'::jsonb), '[]'::jsonb,
    COALESCE(p_baseline->'risks', '[]'::jsonb), 'review_required', 'approval_required',
    false, 1, canonical_hash, p_actor
  );
  RETURN jsonb_build_object('baselineId', baseline_id, 'status', 'approval_required',
    'readiness', 'review_required', 'version', 1, 'resourceHash', canonical_hash);
END;
$$;

CREATE OR REPLACE FUNCTION public.enterprise_commit_assemble_blueprint(
  p_blueprint JSONB, p_actor UUID, p_org UUID, p_workspace UUID
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE decision RECORD; blueprint_id UUID := (p_blueprint->>'id')::uuid; canonical_hash TEXT;
BEGIN
  PERFORM public.enterprise_assert_writable('assemble');
  SELECT * INTO decision FROM public.enterprise_modernization_decisions
  WHERE id = (p_blueprint->>'modernizationDecisionId')::uuid
    AND org_id = p_org AND workspace_id = p_workspace FOR SHARE;
  IF decision.id IS NULL OR decision.status <> 'approved'
     OR decision.primary_disposition NOT IN ('api_enable_wrap', 'refactor', 'rebuild', 'assemble') THEN
    RAISE EXCEPTION 'ENTERPRISE_ASSEMBLE_DECISION_NOT_ELIGIBLE';
  END IF;
  canonical_hash := public.enterprise_sha256_jsonb(jsonb_build_object(
    'modernizationDecisionId', decision.id, 'decisionHash', decision.resource_hash,
    'disposition', decision.primary_disposition, 'schemaVersion', 'assemble-blueprint-1',
    'structuredContent', p_blueprint->'structuredContent',
    'readableDocument', p_blueprint->>'readableDocument', 'version', 1
  ));
  INSERT INTO public.enterprise_assemble_blueprints(
    id, org_id, workspace_id, modernization_decision_id, disposition,
    schema_version, version, structured_content, readable_document, status,
    code_generation_enabled, deployment_enabled, infrastructure_changes_enabled,
    credential_access_enabled, source_system_calls_enabled, runtime_agents_enabled,
    live_telemetry_enabled, resource_hash, created_by
  ) VALUES (
    blueprint_id, p_org, p_workspace, decision.id, decision.primary_disposition,
    'assemble-blueprint-1', 1, p_blueprint->'structuredContent',
    p_blueprint->>'readableDocument', 'draft', false, false, false, false, false, false, false,
    canonical_hash, p_actor
  );
  RETURN jsonb_build_object('blueprintId', blueprint_id, 'status', 'draft',
    'version', 1, 'resourceHash', canonical_hash,
    'executionEnabled', false, 'runtimeAgentsEnabled', false, 'liveTelemetryEnabled', false);
END;
$$;

CREATE OR REPLACE FUNCTION public.enterprise_commit_modernization_assessment(p_assessment JSONB, p_decision JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE source public.assess_application_assessment_versions;
  application public.assess_application_assets; metadata public.assess_application_metadata_versions;
  recommendation public.assess_application_modernization_recommendations;
  factors JSONB; blockers JSONB; primary_disposition TEXT;
  assessment RECORD;
  decision RECORD; decision_hash TEXT;
BEGIN
  PERFORM public.enterprise_assert_writable('delivery');
  SELECT * INTO source FROM public.assess_application_assessment_versions
  WHERE id = (p_assessment->>'source_assessment_id')::uuid
    AND application_id = (p_assessment->>'application_ref')::uuid
    AND metadata_version_id = (p_assessment->>'source_metadata_version_id')::uuid
    AND org_id = (p_assessment->>'org_id')::uuid
    AND workspace_id = (p_assessment->>'workspace_id')::uuid FOR SHARE;
  SELECT * INTO application FROM public.assess_application_assets
  WHERE id = source.application_id AND org_id = source.org_id AND workspace_id = source.workspace_id
    AND deleted_at IS NULL FOR SHARE;
  SELECT * INTO metadata FROM public.assess_application_metadata_versions
  WHERE id = source.metadata_version_id AND application_id = source.application_id
    AND org_id = source.org_id AND workspace_id = source.workspace_id FOR SHARE;
  SELECT * INTO recommendation FROM public.assess_application_modernization_recommendations
  WHERE assessment_version_id = source.id AND application_id = source.application_id
    AND metadata_version_id = source.metadata_version_id AND org_id = source.org_id
    AND workspace_id = source.workspace_id FOR SHARE;
  IF source.id IS NULL OR application.id IS NULL OR metadata.id IS NULL OR recommendation.id IS NULL
     OR source.lifecycle <> 'approved' OR metadata.lifecycle <> 'approved'
     OR source.decision_model_version <> 'assess-v2-application-portfolio-2026-07' THEN
    RAISE EXCEPTION 'ENTERPRISE_MODERNIZATION_SOURCE_NOT_APPROVED';
  END IF;
  SELECT COALESCE(jsonb_object_agg(dimension, jsonb_build_object(
      'readinessBand', readiness_band, 'evidenceConfidence', evidence_confidence,
      'hardGates', hard_gates, 'missingEvidence', missing_evidence,
      'assessmentVersionId', assessment_version_id
    ) ORDER BY dimension), '{}'::jsonb),
    COALESCE(jsonb_agg(jsonb_build_object('dimension', dimension, 'missingEvidence', missing_evidence, 'hardGates', hard_gates)
      ORDER BY dimension) FILTER (WHERE evidence_confidence = 'Insufficient Evidence'
        OR cardinality(missing_evidence) > 0 OR cardinality(hard_gates) > 0), '[]'::jsonb)
  INTO factors, blockers
  FROM public.assess_application_dimension_results
  WHERE assessment_version_id = source.id AND org_id = source.org_id AND workspace_id = source.workspace_id;
  IF (SELECT count(*) FROM public.assess_application_dimension_results WHERE assessment_version_id = source.id) <> 7 THEN
    RAISE EXCEPTION 'ENTERPRISE_MODERNIZATION_INCOMPLETE_FACTORS';
  END IF;
  primary_disposition := CASE
    WHEN jsonb_array_length(blockers) > 0 THEN 'insufficient_evidence'
    WHEN recommendation.disposition IN (
      'retain', 'optimize', 'automate_around', 'integrate', 'api_enable_wrap',
      'refactor', 'replatform', 'rebuild', 'replace', 'assemble', 'retire'
    ) THEN recommendation.disposition
    ELSE 'blocked'
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
    'assessmentId', assessment.id, 'applicationId', source.application_id,
    'sourceAssessmentId', source.id, 'sourceAssessmentVersion', source.version,
    'sourceMetadataVersionId', source.metadata_version_id,
    'modelVersion', assessment.model_version, 'factorBands', factors,
    'primaryDisposition', primary_disposition, 'blockers', blockers,
    'eligibleDispositions', jsonb_build_array(primary_disposition), 'version', 1
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
    'modernizationAssessmentId', assessment.id, 'decisionId', decision.id,
    'primaryDisposition', decision.primary_disposition,
    'resourceHash', decision.resource_hash, 'version', decision.version
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.enterprise_resource_snapshot(
  p_resource_type TEXT, p_resource UUID, p_org UUID, p_workspace UUID
)
RETURNS TABLE(created_by UUID, resource_version BIGINT, resource_hash TEXT, resource_status TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF p_resource_type = 'evidence_candidate' THEN
    RETURN QUERY SELECT c.created_by, c.version, c.provenance_hash, c.suggestion_status
    FROM public.enterprise_evidence_candidates c
    WHERE c.id = p_resource AND c.org_id = p_org AND c.workspace_id = p_workspace;
  ELSIF p_resource_type = 'modernization_decision' THEN
    RETURN QUERY SELECT d.created_by, d.version, d.resource_hash, d.status
    FROM public.enterprise_modernization_decisions d
    WHERE d.id = p_resource AND d.org_id = p_org AND d.workspace_id = p_workspace;
  ELSIF p_resource_type = 'delivery_work_package' THEN
    RETURN QUERY SELECT p.created_by, p.current_version, v.content_hash, p.status
    FROM public.enterprise_delivery_work_packages p
    JOIN public.enterprise_delivery_work_package_versions v
      ON v.work_package_id = p.id AND v.org_id = p.org_id AND v.workspace_id = p.workspace_id
      AND v.version = p.current_version
    WHERE p.id = p_resource AND p.org_id = p_org AND p.workspace_id = p_workspace;
  ELSIF p_resource_type = 'monitor_baseline' THEN
    RETURN QUERY SELECT m.created_by, m.version, m.resource_hash, m.status
    FROM public.enterprise_monitor_baselines m
    WHERE m.id = p_resource AND m.org_id = p_org AND m.workspace_id = p_workspace;
  ELSIF p_resource_type = 'assemble_blueprint' THEN
    RETURN QUERY SELECT b.created_by, b.version, b.resource_hash, b.status
    FROM public.enterprise_assemble_blueprints b
    WHERE b.id = p_resource AND b.org_id = p_org AND b.workspace_id = p_workspace;
  ELSE RAISE EXCEPTION 'ENTERPRISE_APPROVAL_RESOURCE_INVALID'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.enterprise_review_event_derive()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE snapshot RECORD; current_authorization BIGINT;
BEGIN
  SELECT * INTO snapshot FROM public.enterprise_resource_snapshot(
    NEW.resource_type, NEW.resource_id, NEW.org_id, NEW.workspace_id
  );
  IF snapshot.created_by IS NULL OR snapshot.created_by = NEW.reviewer_id
     OR snapshot.resource_status IN ('approved', 'rejected', 'stale', 'blocked') THEN
    RAISE EXCEPTION 'ENTERPRISE_APPROVAL_SEPARATION_OR_STATE_INVALID';
  END IF;
  SELECT version INTO current_authorization FROM public.authorization_versions
  WHERE org_id = NEW.org_id AND user_id = NEW.reviewer_id;
  PERFORM public.pr1b_assert_command_authority(
    NEW.reviewer_id, NEW.org_id, NEW.workspace_id, 'approvals.review', current_authorization
  );
  IF NEW.reviewer_authorization_version IS DISTINCT FROM current_authorization THEN
    RAISE EXCEPTION 'ENTERPRISE_APPROVAL_AUTHORIZATION_STALE';
  END IF;
  NEW.resource_version := snapshot.resource_version;
  NEW.resource_hash := snapshot.resource_hash;
  NEW.outcome := COALESCE(NEW.outcome, 'approved');
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.enterprise_approval_derive()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE snapshot RECORD; review RECORD;
  reviewer_authorization BIGINT; approver_authorization BIGINT;
BEGIN
  SELECT * INTO snapshot FROM public.enterprise_resource_snapshot(
    NEW.resource_type, NEW.resource_id, NEW.org_id, NEW.workspace_id
  );
  SELECT * INTO review FROM public.enterprise_high_impact_review_events
  WHERE id = NEW.review_event_id AND org_id = NEW.org_id AND workspace_id = NEW.workspace_id
    AND resource_type = NEW.resource_type AND resource_id = NEW.resource_id FOR SHARE;
  IF snapshot.created_by IS NULL OR review.id IS NULL OR review.outcome <> 'approved'
     OR NEW.created_by IS DISTINCT FROM snapshot.created_by
     OR review.reviewer_id IS DISTINCT FROM NEW.reviewed_by
     OR NEW.created_by = NEW.reviewed_by OR NEW.created_by = NEW.approved_by
     OR NEW.reviewed_by = NEW.approved_by
     OR review.resource_version IS DISTINCT FROM snapshot.resource_version
     OR review.resource_hash IS DISTINCT FROM snapshot.resource_hash THEN
    RAISE EXCEPTION 'ENTERPRISE_APPROVAL_SEPARATION_OR_STALE_RESOURCE';
  END IF;
  SELECT version INTO reviewer_authorization FROM public.authorization_versions
  WHERE org_id = NEW.org_id AND user_id = NEW.reviewed_by;
  SELECT version INTO approver_authorization FROM public.authorization_versions
  WHERE org_id = NEW.org_id AND user_id = NEW.approved_by;
  PERFORM public.pr1b_assert_command_authority(
    NEW.reviewed_by, NEW.org_id, NEW.workspace_id, 'approvals.review', reviewer_authorization
  );
  PERFORM public.pr1b_assert_command_authority(
    NEW.approved_by, NEW.org_id, NEW.workspace_id, 'approvals.review', approver_authorization
  );
  IF review.reviewer_authorization_version IS DISTINCT FROM reviewer_authorization THEN
    RAISE EXCEPTION 'ENTERPRISE_APPROVAL_REVIEWER_AUTHORIZATION_STALE';
  END IF;
  NEW.reviewer_authorization_version := reviewer_authorization;
  NEW.approver_authorization_version := approver_authorization;
  NEW.resource_version := snapshot.resource_version;
  NEW.resource_hash := snapshot.resource_hash;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.enterprise_commit_high_impact_approval(
  p_approval JSONB, p_resource_type TEXT, p_resource_id UUID,
  p_org UUID, p_workspace UUID, p_next_status TEXT
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE approval RECORD; snapshot RECORD; expected_status TEXT;
BEGIN
  PERFORM public.enterprise_assert_writable(CASE WHEN p_resource_type = 'assemble_blueprint' THEN 'assemble' ELSE 'delivery' END);
  expected_status := CASE p_approval->>'outcome' WHEN 'approved' THEN 'approved' WHEN 'rejected' THEN 'rejected' ELSE NULL END;
  IF expected_status IS NULL OR p_next_status IS DISTINCT FROM expected_status THEN
    RAISE EXCEPTION 'ENTERPRISE_APPROVAL_OUTCOME_INVALID';
  END IF;
  SELECT * INTO snapshot FROM public.enterprise_resource_snapshot(p_resource_type, p_resource_id, p_org, p_workspace);
  IF snapshot.created_by IS NULL OR snapshot.resource_status IN ('approved', 'rejected', 'stale', 'blocked') THEN
    RAISE EXCEPTION 'ENTERPRISE_APPROVAL_STATE_INVALID';
  END IF;
  INSERT INTO public.enterprise_high_impact_approvals(
    org_id, workspace_id, resource_type, resource_id, created_by,
    reviewed_by, approved_by, review_event_id, reviewer_authorization_version,
    approver_authorization_version, resource_version, resource_hash, outcome, rationale
  ) VALUES (
    p_org, p_workspace, p_resource_type, p_resource_id,
    (p_approval->>'created_by')::uuid, (p_approval->>'reviewed_by')::uuid,
    (p_approval->>'approved_by')::uuid, (p_approval->>'review_event_id')::uuid,
    1, 1, snapshot.resource_version, snapshot.resource_hash,
    p_approval->>'outcome', p_approval->>'rationale'
  ) RETURNING * INTO approval;
  IF p_resource_type = 'evidence_candidate' THEN
    UPDATE public.enterprise_evidence_candidates
    SET suggestion_status = CASE expected_status WHEN 'approved' THEN 'accepted' ELSE 'rejected' END,
        reviewed_by = approval.approved_by, reviewed_at = statement_timestamp(), updated_at = statement_timestamp()
    WHERE id = p_resource_id AND org_id = p_org AND workspace_id = p_workspace;
  ELSIF p_resource_type = 'modernization_decision' THEN
    UPDATE public.enterprise_modernization_decisions SET status = expected_status
    WHERE id = p_resource_id AND org_id = p_org AND workspace_id = p_workspace;
  ELSIF p_resource_type = 'delivery_work_package' THEN
    UPDATE public.enterprise_delivery_work_packages SET status = expected_status, updated_at = statement_timestamp()
    WHERE id = p_resource_id AND org_id = p_org AND workspace_id = p_workspace;
    UPDATE public.enterprise_delivery_work_package_versions SET status = expected_status
    WHERE work_package_id = p_resource_id AND org_id = p_org AND workspace_id = p_workspace
      AND version = snapshot.resource_version;
  ELSIF p_resource_type = 'monitor_baseline' THEN
    UPDATE public.enterprise_monitor_baselines SET status = expected_status
    WHERE id = p_resource_id AND org_id = p_org AND workspace_id = p_workspace;
  ELSIF p_resource_type = 'assemble_blueprint' THEN
    UPDATE public.enterprise_assemble_blueprints SET status = expected_status
    WHERE id = p_resource_id AND org_id = p_org AND workspace_id = p_workspace;
  END IF;
  INSERT INTO public.privileged_audit_events(
    org_id, workspace_id, actor_id, request_id, action, resource_type, resource_id,
    outcome, resource_version, metadata
  ) VALUES (
    p_org, p_workspace, approval.approved_by, approval.id, 'enterprise.high_impact.approval',
    p_resource_type, p_resource_id, 'succeeded', approval.resource_version,
    jsonb_build_object('approvalId', approval.id, 'reviewEventId', approval.review_event_id,
      'resourceHash', approval.resource_hash, 'decisionOutcome', approval.outcome)
  );
  RETURN jsonb_build_object(
    'approvalId', approval.id, 'resourceType', p_resource_type,
    'resourceId', p_resource_id, 'status', expected_status,
    'resourceVersion', approval.resource_version, 'resourceHash', approval.resource_hash
  );
END;
$$;

REVOKE ALL ON FUNCTION public.enterprise_review_evidence_candidate(UUID, UUID, UUID, TEXT, TEXT, TEXT, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enterprise_review_evidence_candidate(UUID, UUID, UUID, TEXT, TEXT, TEXT, UUID, TEXT, TEXT) TO service_role;

CREATE TABLE public.enterprise_evidence_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID NOT NULL,
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL,
  question TEXT NOT NULL CHECK (length(btrim(question)) BETWEEN 1 AND 2000),
  status TEXT NOT NULL CHECK (status IN ('open', 'answered', 'deferred')),
  answer TEXT,
  created_by UUID NOT NULL REFERENCES public.profiles(id),
  resolved_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  CONSTRAINT enterprise_evidence_questions_workspace_org_fkey
    FOREIGN KEY (workspace_id, org_id)
    REFERENCES public.workspaces(id, org_id) ON DELETE CASCADE,
  CONSTRAINT enterprise_evidence_questions_source_fkey
    FOREIGN KEY (source_id, org_id, workspace_id)
    REFERENCES public.enterprise_evidence_sources(id, org_id, workspace_id) ON DELETE RESTRICT
);

CREATE TABLE public.enterprise_studio_delivery_handoffs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL,
  studio_document_id UUID NOT NULL,
  artifact_type TEXT NOT NULL CHECK (artifact_type IN ('brd', 'frd', 'pdd')),
  studio_version_id UUID NOT NULL,
  studio_version BIGINT NOT NULL CHECK (studio_version > 0),
  studio_content_hash TEXT NOT NULL CHECK (studio_content_hash ~ '^[0-9a-f]{64}$'),
  source_status TEXT NOT NULL CHECK (source_status = 'approved'),
  source_snapshot JSONB NOT NULL CHECK (jsonb_typeof(source_snapshot) = 'object'),
  status TEXT NOT NULL CHECK (status IN ('draft', 'review', 'approved', 'rejected', 'stale', 'blocked')),
  version BIGINT NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by UUID NOT NULL REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT enterprise_studio_handoffs_workspace_org_fkey
    FOREIGN KEY (workspace_id, org_id)
    REFERENCES public.workspaces(id, org_id) ON DELETE CASCADE,
  CONSTRAINT enterprise_studio_handoffs_studio_fkey
    FOREIGN KEY (studio_document_id, org_id, workspace_id)
    REFERENCES public.studio_artifact_aggregates(id, org_id, workspace_id) ON DELETE RESTRICT,
  CONSTRAINT enterprise_studio_handoffs_version_fkey
    FOREIGN KEY (studio_version_id, studio_document_id, org_id, workspace_id)
    REFERENCES public.studio_artifact_versions(id, artifact_id, org_id, workspace_id) ON DELETE RESTRICT,
  UNIQUE (id, org_id, workspace_id),
  UNIQUE (org_id, workspace_id, studio_document_id, studio_version, studio_content_hash)
);

CREATE TABLE public.enterprise_delivery_work_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL,
  handoff_id UUID NOT NULL,
  current_version BIGINT NOT NULL DEFAULT 1 CHECK (current_version > 0),
  status TEXT NOT NULL CHECK (status IN ('draft', 'review', 'approved', 'rejected', 'stale', 'blocked')),
  created_by UUID NOT NULL REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT enterprise_work_packages_workspace_org_fkey
    FOREIGN KEY (workspace_id, org_id)
    REFERENCES public.workspaces(id, org_id) ON DELETE CASCADE,
  CONSTRAINT enterprise_work_packages_handoff_fkey
    FOREIGN KEY (handoff_id, org_id, workspace_id)
    REFERENCES public.enterprise_studio_delivery_handoffs(id, org_id, workspace_id) ON DELETE RESTRICT,
  UNIQUE (id, org_id, workspace_id),
  UNIQUE (org_id, workspace_id, handoff_id)
);

CREATE TABLE public.enterprise_delivery_work_package_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_package_id UUID NOT NULL,
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL,
  version BIGINT NOT NULL CHECK (version > 0),
  studio_document_id UUID NOT NULL,
  artifact_type TEXT NOT NULL CHECK (artifact_type IN ('brd', 'frd', 'pdd')),
  studio_version_id UUID NOT NULL,
  studio_version BIGINT NOT NULL CHECK (studio_version > 0),
  studio_content_hash TEXT NOT NULL CHECK (studio_content_hash ~ '^[0-9a-f]{64}$'),
  content JSONB NOT NULL CHECK (jsonb_typeof(content) = 'object' AND pg_column_size(content) <= 2097152),
  content_hash TEXT NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  status TEXT NOT NULL CHECK (status IN ('draft', 'review', 'approved', 'rejected', 'superseded', 'stale', 'blocked')),
  created_by UUID NOT NULL REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT enterprise_work_package_versions_package_fkey
    FOREIGN KEY (work_package_id, org_id, workspace_id)
    REFERENCES public.enterprise_delivery_work_packages(id, org_id, workspace_id) ON DELETE RESTRICT,
  CONSTRAINT enterprise_work_package_versions_studio_fkey
    FOREIGN KEY (studio_version_id, studio_document_id, org_id, workspace_id)
    REFERENCES public.studio_artifact_versions(id, artifact_id, org_id, workspace_id) ON DELETE RESTRICT,
  UNIQUE (id, work_package_id, org_id, workspace_id),
  UNIQUE (id, org_id, workspace_id),
  UNIQUE (work_package_id, version)
);

CREATE TABLE public.enterprise_delivery_work_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_version_id UUID NOT NULL,
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL,
  parent_item_id UUID,
  item_type TEXT NOT NULL CHECK (item_type IN ('Epic', 'Story', 'Task', 'Milestone', 'Dependency', 'Risk')),
  title TEXT NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 400),
  description TEXT NOT NULL DEFAULT '',
  acceptance_criteria JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(acceptance_criteria) = 'array'),
  non_functional_requirements JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(non_functional_requirements) = 'array'),
  source_section_locator TEXT NOT NULL,
  source_document_id UUID NOT NULL,
  source_document_version BIGINT NOT NULL CHECK (source_document_version > 0),
  source_document_hash TEXT NOT NULL CHECK (source_document_hash ~ '^[0-9a-f]{64}$'),
  idempotency_key TEXT NOT NULL CHECK (length(btrim(idempotency_key)) BETWEEN 8 AND 200),
  created_by UUID NOT NULL REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT enterprise_work_items_version_fkey
    FOREIGN KEY (package_version_id, org_id, workspace_id)
    REFERENCES public.enterprise_delivery_work_package_versions(id, org_id, workspace_id) ON DELETE RESTRICT,
  CONSTRAINT enterprise_work_items_parent_fkey
    FOREIGN KEY (parent_item_id, org_id, workspace_id)
    REFERENCES public.enterprise_delivery_work_items(id, org_id, workspace_id) ON DELETE RESTRICT,
  UNIQUE (id, org_id, workspace_id),
  UNIQUE (package_version_id, idempotency_key)
);

CREATE OR REPLACE FUNCTION public.enterprise_commit_delivery_handoff_legacy_untrusted(
  p_handoff JSONB, p_package JSONB, p_version JSONB, p_items JSONB
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE item JSONB;
BEGIN
  INSERT INTO public.enterprise_studio_delivery_handoffs(
    id, org_id, workspace_id, studio_document_id, studio_version_id,
    studio_version, studio_content_hash, artifact_type, source_status,
    source_snapshot, status, created_by
  ) VALUES (
    (p_handoff->>'id')::uuid, (p_handoff->>'org_id')::uuid, (p_handoff->>'workspace_id')::uuid,
    (p_handoff->>'studio_document_id')::uuid, (p_handoff->>'studio_version_id')::uuid,
    (p_handoff->>'studio_version')::bigint, p_handoff->>'studio_content_hash',
    p_handoff->>'artifact_type', p_handoff->>'source_status', p_handoff->'source_snapshot',
    p_handoff->>'status', (p_handoff->>'created_by')::uuid
  );
  INSERT INTO public.enterprise_delivery_work_packages(
    id, org_id, workspace_id, handoff_id, current_version, status, created_by
  ) VALUES (
    (p_package->>'id')::uuid, (p_package->>'org_id')::uuid, (p_package->>'workspace_id')::uuid,
    (p_package->>'handoff_id')::uuid, (p_package->>'current_version')::bigint,
    p_package->>'status', (p_package->>'created_by')::uuid
  );
  INSERT INTO public.enterprise_delivery_work_package_versions(
    id, work_package_id, org_id, workspace_id, version, studio_document_id,
    artifact_type, studio_version_id, studio_version, studio_content_hash,
    content, content_hash, status, created_by
  ) VALUES (
    (p_version->>'id')::uuid, (p_version->>'work_package_id')::uuid,
    (p_version->>'org_id')::uuid, (p_version->>'workspace_id')::uuid,
    (p_version->>'version')::bigint, (p_version->>'studio_document_id')::uuid,
    p_version->>'artifact_type', (p_version->>'studio_version_id')::uuid,
    (p_version->>'studio_version')::bigint, p_version->>'studio_content_hash',
    p_version->'content', p_version->>'content_hash', p_version->>'status',
    (p_version->>'created_by')::uuid
  );
  FOR item IN SELECT value FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) LOOP
    INSERT INTO public.enterprise_delivery_work_items(
      id, package_version_id, org_id, workspace_id, parent_item_id, item_type,
      title, description, acceptance_criteria, non_functional_requirements,
      source_section_locator, source_document_id, source_document_version,
      source_document_hash, idempotency_key, created_by
    ) VALUES (
      (item->>'id')::uuid, (p_version->>'id')::uuid, (p_version->>'org_id')::uuid,
      (p_version->>'workspace_id')::uuid, NULLIF(item->>'parentId', '')::uuid,
      item->>'itemType', item->>'title', item->>'description',
      COALESCE(item->'acceptanceCriteria', '[]'::jsonb),
      COALESCE(item->'nonFunctionalRequirements', '[]'::jsonb),
      item->>'sourceSectionLocator', (item->>'sourceDocumentId')::uuid,
      (item->>'sourceDocumentVersion')::bigint, item->>'sourceDocumentHash',
      item->>'idempotencyKey', (item->>'createdBy')::uuid
    );
  END LOOP;
  RETURN jsonb_build_object(
    'handoffId', (p_handoff->>'id')::uuid,
    'workPackageId', (p_package->>'id')::uuid,
    'packageVersionId', (p_version->>'id')::uuid,
    'itemIds', COALESCE((SELECT jsonb_agg(value->>'id') FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb))), '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.enterprise_commit_delivery_handoff(JSONB, JSONB, JSONB, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enterprise_commit_delivery_handoff(JSONB, JSONB, JSONB, JSONB) TO service_role;

CREATE TABLE public.enterprise_monitor_baselines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL,
  work_package_id UUID NOT NULL,
  work_package_version_id UUID NOT NULL,
  studio_document_id UUID NOT NULL,
  studio_version BIGINT NOT NULL CHECK (studio_version > 0),
  studio_content_hash TEXT NOT NULL CHECK (studio_content_hash ~ '^[0-9a-f]{64}$'),
  approved_item_ids JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(approved_item_ids) = 'array'),
  milestones JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(milestones) = 'array'),
  dependencies JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(dependencies) = 'array'),
  blockers JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(blockers) = 'array'),
  risks JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(risks) = 'array'),
  readiness TEXT NOT NULL CHECK (readiness IN ('not_ready', 'review_required')),
  status TEXT NOT NULL CHECK (status IN ('draft', 'approval_required', 'approved', 'rejected', 'blocked', 'stale')),
  live_telemetry_connected BOOLEAN NOT NULL DEFAULT false CHECK (live_telemetry_connected = false),
  version BIGINT NOT NULL DEFAULT 1 CHECK (version > 0),
  resource_hash TEXT NOT NULL CHECK (resource_hash ~ '^[0-9a-f]{64}$'),
  created_by UUID NOT NULL REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT enterprise_monitor_baselines_workspace_org_fkey
    FOREIGN KEY (workspace_id, org_id)
    REFERENCES public.workspaces(id, org_id) ON DELETE CASCADE,
  CONSTRAINT enterprise_monitor_baselines_package_fkey
    FOREIGN KEY (work_package_id, org_id, workspace_id)
    REFERENCES public.enterprise_delivery_work_packages(id, org_id, workspace_id) ON DELETE RESTRICT,
  CONSTRAINT enterprise_monitor_baselines_package_version_fkey
    FOREIGN KEY (work_package_version_id, work_package_id, org_id, workspace_id)
    REFERENCES public.enterprise_delivery_work_package_versions(id, work_package_id, org_id, workspace_id) ON DELETE RESTRICT,
  UNIQUE (org_id, workspace_id, work_package_version_id)
);

CREATE TABLE public.enterprise_modernization_assessments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL,
  application_ref UUID NOT NULL,
  application_version BIGINT NOT NULL CHECK (application_version > 0),
  source_assessment_id UUID NOT NULL,
  source_assessment_version BIGINT NOT NULL CHECK (source_assessment_version > 0),
  source_metadata_version_id UUID NOT NULL,
  factor_bands JSONB NOT NULL CHECK (jsonb_typeof(factor_bands) = 'object'),
  model_version TEXT NOT NULL,
  source_decision_model_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'review', 'approved', 'stale', 'blocked')),
  created_by UUID NOT NULL REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT enterprise_modernization_assessments_workspace_org_fkey
    FOREIGN KEY (workspace_id, org_id)
    REFERENCES public.workspaces(id, org_id) ON DELETE CASCADE,
  CONSTRAINT enterprise_modernization_assessments_application_fkey
    FOREIGN KEY (application_ref, org_id, workspace_id)
    REFERENCES public.assess_application_assets(id, org_id, workspace_id) ON DELETE RESTRICT,
  CONSTRAINT enterprise_modernization_assessments_source_fkey
    FOREIGN KEY (source_assessment_id, application_ref, source_metadata_version_id, org_id, workspace_id)
    REFERENCES public.assess_application_assessment_versions(id, application_id, metadata_version_id, org_id, workspace_id) ON DELETE RESTRICT,
  UNIQUE (org_id, workspace_id, application_ref, application_version),
  UNIQUE (id, org_id, workspace_id)
);

CREATE TABLE public.enterprise_modernization_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  modernization_assessment_id UUID NOT NULL,
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL,
  primary_disposition TEXT NOT NULL CHECK (primary_disposition IN (
    'retain', 'optimize', 'automate_around', 'integrate', 'api_enable_wrap',
    'refactor', 'replatform', 'rebuild', 'replace', 'assemble', 'retire',
    'insufficient_evidence', 'blocked'
  )),
  alternative_disposition TEXT,
  eligible_dispositions JSONB NOT NULL CHECK (jsonb_typeof(eligible_dispositions) = 'array'),
  blockers JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(blockers) = 'array'),
  conflicts JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(conflicts) = 'array'),
  status TEXT NOT NULL CHECK (status IN ('draft', 'review', 'approved', 'rejected', 'stale', 'blocked')),
  requires_human_approval BOOLEAN NOT NULL DEFAULT true CHECK (requires_human_approval = true),
  version BIGINT NOT NULL DEFAULT 1 CHECK (version > 0),
  resource_hash TEXT NOT NULL CHECK (resource_hash ~ '^[0-9a-f]{64}$'),
  created_by UUID NOT NULL REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT enterprise_modernization_decisions_workspace_org_fkey
    FOREIGN KEY (workspace_id, org_id)
    REFERENCES public.workspaces(id, org_id) ON DELETE CASCADE,
  CONSTRAINT enterprise_modernization_decisions_assessment_fkey
    FOREIGN KEY (modernization_assessment_id, org_id, workspace_id)
    REFERENCES public.enterprise_modernization_assessments(id, org_id, workspace_id) ON DELETE RESTRICT,
  UNIQUE (id, org_id, workspace_id),
  UNIQUE (modernization_assessment_id)
);

CREATE OR REPLACE FUNCTION public.enterprise_commit_modernization_assessment_legacy_untrusted(p_assessment JSONB, p_decision JSONB)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE v_assessment public.enterprise_modernization_assessments; v_decision public.enterprise_modernization_decisions;
BEGIN
  INSERT INTO public.enterprise_modernization_assessments(
    id, org_id, workspace_id, application_ref, application_version,
    source_assessment_id, source_assessment_version, source_metadata_version_id,
    factor_bands, model_version, source_decision_model_version, status, created_by
  ) VALUES (
    (p_assessment->>'id')::uuid, (p_assessment->>'org_id')::uuid, (p_assessment->>'workspace_id')::uuid,
    (p_assessment->>'application_ref')::uuid, (p_assessment->>'application_version')::bigint,
    (p_assessment->>'source_assessment_id')::uuid, (p_assessment->>'source_assessment_version')::bigint,
    (p_assessment->>'source_metadata_version_id')::uuid, p_assessment->'factor_bands',
    p_assessment->>'model_version', p_assessment->>'source_decision_model_version',
    p_assessment->>'status', (p_assessment->>'created_by')::uuid
  ) RETURNING * INTO v_assessment;
  INSERT INTO public.enterprise_modernization_decisions(
    id, modernization_assessment_id, org_id, workspace_id, primary_disposition,
    alternative_disposition, eligible_dispositions, blockers, conflicts, status,
    requires_human_approval, created_by
  ) VALUES (
    (p_decision->>'id')::uuid, v_assessment.id, (p_decision->>'org_id')::uuid,
    (p_decision->>'workspace_id')::uuid, p_decision->>'primary_disposition',
    NULLIF(p_decision->>'alternative_disposition', ''), p_decision->'eligible_dispositions',
    p_decision->'blockers', p_decision->'conflicts', p_decision->>'status', true,
    (p_decision->>'created_by')::uuid
  ) RETURNING * INTO v_decision;
  RETURN jsonb_build_object('modernizationAssessmentId', v_assessment.id, 'decisionId', v_decision.id);
END;
$$;

REVOKE ALL ON FUNCTION public.enterprise_commit_modernization_assessment(JSONB, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enterprise_commit_modernization_assessment(JSONB, JSONB) TO service_role;

CREATE TABLE public.enterprise_assemble_blueprints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL,
  modernization_decision_id UUID NOT NULL,
  disposition TEXT NOT NULL CHECK (disposition IN ('api_enable_wrap', 'refactor', 'rebuild', 'assemble')),
  schema_version TEXT NOT NULL,
  version BIGINT NOT NULL DEFAULT 1 CHECK (version > 0),
  structured_content JSONB NOT NULL CHECK (jsonb_typeof(structured_content) = 'object'),
  readable_document TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'edit', 'review', 'approval_required', 'approved', 'rejected', 'stale', 'blocked')),
  code_generation_enabled BOOLEAN NOT NULL DEFAULT false CHECK (code_generation_enabled = false),
  deployment_enabled BOOLEAN NOT NULL DEFAULT false CHECK (deployment_enabled = false),
  infrastructure_changes_enabled BOOLEAN NOT NULL DEFAULT false CHECK (infrastructure_changes_enabled = false),
  credential_access_enabled BOOLEAN NOT NULL DEFAULT false CHECK (credential_access_enabled = false),
  source_system_calls_enabled BOOLEAN NOT NULL DEFAULT false CHECK (source_system_calls_enabled = false),
  runtime_agents_enabled BOOLEAN NOT NULL DEFAULT false CHECK (runtime_agents_enabled = false),
  live_telemetry_enabled BOOLEAN NOT NULL DEFAULT false CHECK (live_telemetry_enabled = false),
  resource_hash TEXT NOT NULL CHECK (resource_hash ~ '^[0-9a-f]{64}$'),
  created_by UUID NOT NULL REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT enterprise_assemble_blueprints_workspace_org_fkey
    FOREIGN KEY (workspace_id, org_id)
    REFERENCES public.workspaces(id, org_id) ON DELETE CASCADE,
  CONSTRAINT enterprise_assemble_blueprints_decision_fkey
    FOREIGN KEY (modernization_decision_id, org_id, workspace_id)
    REFERENCES public.enterprise_modernization_decisions(id, org_id, workspace_id) ON DELETE RESTRICT,
  UNIQUE (id, org_id, workspace_id),
  UNIQUE (modernization_decision_id, version)
);

CREATE TABLE public.enterprise_high_impact_review_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL,
  resource_type TEXT NOT NULL CHECK (resource_type IN ('evidence_candidate', 'modernization_decision', 'delivery_work_package', 'monitor_baseline', 'assemble_blueprint')),
  resource_id UUID NOT NULL,
  reviewer_id UUID NOT NULL REFERENCES public.profiles(id),
  reviewer_authorization_version BIGINT NOT NULL CHECK (reviewer_authorization_version > 0),
  resource_version BIGINT NOT NULL CHECK (resource_version > 0),
  resource_hash TEXT NOT NULL CHECK (resource_hash ~ '^[0-9a-f]{64}$'),
  outcome TEXT NOT NULL CHECK (outcome IN ('approved', 'rejected')),
  rationale TEXT NOT NULL CHECK (length(btrim(rationale)) BETWEEN 1 AND 4000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT enterprise_high_impact_reviews_workspace_org_fkey
    FOREIGN KEY (workspace_id, org_id)
    REFERENCES public.workspaces(id, org_id) ON DELETE CASCADE,
  UNIQUE (id, org_id, workspace_id),
  UNIQUE (id, org_id, workspace_id, resource_type, resource_id, reviewer_id, resource_version, resource_hash),
  UNIQUE (org_id, workspace_id, resource_type, resource_id, reviewer_id, resource_hash)
);

CREATE TABLE public.enterprise_high_impact_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL,
  resource_type TEXT NOT NULL CHECK (resource_type IN ('evidence_candidate', 'modernization_decision', 'delivery_work_package', 'monitor_baseline', 'assemble_blueprint')),
  resource_id UUID NOT NULL,
  created_by UUID NOT NULL REFERENCES public.profiles(id),
  reviewed_by UUID NOT NULL REFERENCES public.profiles(id),
  approved_by UUID NOT NULL REFERENCES public.profiles(id),
  review_event_id UUID NOT NULL,
  reviewer_authorization_version BIGINT NOT NULL CHECK (reviewer_authorization_version > 0),
  approver_authorization_version BIGINT NOT NULL CHECK (approver_authorization_version > 0),
  resource_version BIGINT NOT NULL CHECK (resource_version > 0),
  resource_hash TEXT NOT NULL CHECK (resource_hash ~ '^[0-9a-f]{64}$'),
  outcome TEXT NOT NULL CHECK (outcome IN ('approved', 'rejected')),
  rationale TEXT NOT NULL CHECK (length(btrim(rationale)) BETWEEN 1 AND 4000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT enterprise_high_impact_approvals_workspace_org_fkey
    FOREIGN KEY (workspace_id, org_id)
    REFERENCES public.workspaces(id, org_id) ON DELETE CASCADE,
  CONSTRAINT enterprise_high_impact_approval_separation_check
    CHECK (created_by <> reviewed_by AND created_by <> approved_by AND reviewed_by <> approved_by),
  CONSTRAINT enterprise_high_impact_approval_review_event_fkey
    FOREIGN KEY (review_event_id, org_id, workspace_id, resource_type, resource_id, reviewed_by, resource_version, resource_hash)
    REFERENCES public.enterprise_high_impact_review_events(id, org_id, workspace_id, resource_type, resource_id, reviewer_id, resource_version, resource_hash) ON DELETE RESTRICT,
  UNIQUE (org_id, workspace_id, resource_type, resource_id)
);

CREATE OR REPLACE FUNCTION public.enterprise_commit_high_impact_approval_legacy_untrusted(
  p_approval JSONB, p_resource_type TEXT, p_resource_id UUID,
  p_org UUID, p_workspace UUID, p_next_status TEXT
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE v_current_version BIGINT;
BEGIN
  INSERT INTO public.enterprise_high_impact_approvals(
    org_id, workspace_id, resource_type, resource_id, created_by,
    reviewed_by, approved_by, review_event_id, outcome, rationale
  ) VALUES (
    p_org, p_workspace, p_resource_type, p_resource_id,
    (p_approval->>'created_by')::uuid, (p_approval->>'reviewed_by')::uuid,
    (p_approval->>'approved_by')::uuid, (p_approval->>'review_event_id')::uuid,
    p_approval->>'outcome', p_approval->>'rationale'
  );
  IF p_resource_type = 'evidence_candidate' THEN
    UPDATE public.enterprise_evidence_candidates
    SET suggestion_status = CASE WHEN p_next_status = 'approved' THEN 'accepted' ELSE 'rejected' END,
        updated_at = statement_timestamp()
    WHERE id = p_resource_id AND org_id = p_org AND workspace_id = p_workspace;
  ELSIF p_resource_type = 'modernization_decision' THEN
    UPDATE public.enterprise_modernization_decisions
    SET status = p_next_status
    WHERE id = p_resource_id AND org_id = p_org AND workspace_id = p_workspace;
  ELSIF p_resource_type = 'delivery_work_package' THEN
    SELECT current_version INTO v_current_version
    FROM public.enterprise_delivery_work_packages
    WHERE id = p_resource_id AND org_id = p_org AND workspace_id = p_workspace
    FOR UPDATE;
    UPDATE public.enterprise_delivery_work_packages
    SET status = p_next_status, updated_at = statement_timestamp()
    WHERE id = p_resource_id AND org_id = p_org AND workspace_id = p_workspace;
    UPDATE public.enterprise_delivery_work_package_versions
    SET status = p_next_status
    WHERE work_package_id = p_resource_id AND org_id = p_org AND workspace_id = p_workspace AND version = v_current_version;
  ELSIF p_resource_type = 'monitor_baseline' THEN
    UPDATE public.enterprise_monitor_baselines
    SET status = p_next_status
    WHERE id = p_resource_id AND org_id = p_org AND workspace_id = p_workspace;
  ELSIF p_resource_type = 'assemble_blueprint' THEN
    UPDATE public.enterprise_assemble_blueprints
    SET status = p_next_status
    WHERE id = p_resource_id AND org_id = p_org AND workspace_id = p_workspace;
  END IF;
  RETURN jsonb_build_object('resourceType', p_resource_type, 'resourceId', p_resource_id, 'status', p_next_status);
END;
$$;

REVOKE ALL ON FUNCTION public.enterprise_commit_high_impact_approval(JSONB, TEXT, UUID, UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enterprise_commit_high_impact_approval(JSONB, TEXT, UUID, UUID, UUID, TEXT) TO service_role;

ALTER TABLE public.enterprise_ai_capability_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enterprise_ai_command_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enterprise_ai_job_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enterprise_ai_usage_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enterprise_evidence_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enterprise_evidence_source_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enterprise_evidence_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enterprise_evidence_candidate_edits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enterprise_evidence_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enterprise_studio_delivery_handoffs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enterprise_delivery_work_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enterprise_delivery_work_package_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enterprise_delivery_work_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enterprise_monitor_baselines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enterprise_modernization_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enterprise_modernization_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enterprise_assemble_blueprints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enterprise_high_impact_review_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enterprise_high_impact_approvals ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.enterprise_ai_capability_routes FORCE ROW LEVEL SECURITY;
ALTER TABLE public.enterprise_ai_command_receipts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.enterprise_ai_job_ledger FORCE ROW LEVEL SECURITY;
ALTER TABLE public.enterprise_ai_usage_ledger FORCE ROW LEVEL SECURITY;
ALTER TABLE public.enterprise_evidence_sources FORCE ROW LEVEL SECURITY;
ALTER TABLE public.enterprise_evidence_source_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.enterprise_evidence_candidates FORCE ROW LEVEL SECURITY;
ALTER TABLE public.enterprise_evidence_candidate_edits FORCE ROW LEVEL SECURITY;
ALTER TABLE public.enterprise_evidence_questions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.enterprise_studio_delivery_handoffs FORCE ROW LEVEL SECURITY;
ALTER TABLE public.enterprise_delivery_work_packages FORCE ROW LEVEL SECURITY;
ALTER TABLE public.enterprise_delivery_work_package_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.enterprise_delivery_work_items FORCE ROW LEVEL SECURITY;
ALTER TABLE public.enterprise_monitor_baselines FORCE ROW LEVEL SECURITY;
ALTER TABLE public.enterprise_modernization_assessments FORCE ROW LEVEL SECURITY;
ALTER TABLE public.enterprise_modernization_decisions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.enterprise_assemble_blueprints FORCE ROW LEVEL SECURITY;
ALTER TABLE public.enterprise_high_impact_review_events FORCE ROW LEVEL SECURITY;
ALTER TABLE public.enterprise_high_impact_approvals FORCE ROW LEVEL SECURITY;

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'enterprise_ai_capability_routes', 'enterprise_ai_command_receipts',
    'enterprise_ai_job_ledger', 'enterprise_ai_usage_ledger',
    'enterprise_evidence_sources', 'enterprise_evidence_source_versions',
    'enterprise_evidence_candidates', 'enterprise_evidence_candidate_edits',
    'enterprise_evidence_questions', 'enterprise_studio_delivery_handoffs',
    'enterprise_delivery_work_packages', 'enterprise_delivery_work_package_versions',
    'enterprise_delivery_work_items', 'enterprise_monitor_baselines',
    'enterprise_modernization_assessments', 'enterprise_modernization_decisions',
    'enterprise_assemble_blueprints', 'enterprise_high_impact_review_events',
    'enterprise_high_impact_approvals'
  ] LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', table_name);
  END LOOP;
END $$;

-- Safe read projections are intentionally narrow. Source storage paths,
-- opaque secret references, raw AI prompts, and raw provider outputs are not
-- exposed through browser table reads.
GRANT SELECT ON TABLE public.enterprise_ai_capability_routes TO authenticated;
GRANT SELECT ON TABLE public.enterprise_ai_job_ledger TO authenticated;
GRANT SELECT ON TABLE public.enterprise_ai_usage_ledger TO authenticated;
GRANT SELECT ON TABLE public.enterprise_delivery_work_packages TO authenticated;
GRANT SELECT ON TABLE public.enterprise_delivery_work_package_versions TO authenticated;
GRANT SELECT ON TABLE public.enterprise_delivery_work_items TO authenticated;
GRANT SELECT ON TABLE public.enterprise_monitor_baselines TO authenticated;
GRANT SELECT ON TABLE public.enterprise_modernization_assessments TO authenticated;
GRANT SELECT ON TABLE public.enterprise_modernization_decisions TO authenticated;
GRANT SELECT ON TABLE public.enterprise_assemble_blueprints TO authenticated;

DROP POLICY IF EXISTS enterprise_ai_routes_select_member ON public.enterprise_ai_capability_routes;
CREATE POLICY enterprise_ai_routes_select_member
  ON public.enterprise_ai_capability_routes FOR SELECT TO authenticated
  USING (deleted_at IS NULL AND public.has_workspace_capability(workspace_id, org_id, 'byok.manage'));

DROP POLICY IF EXISTS enterprise_ai_jobs_select_member ON public.enterprise_ai_job_ledger;
CREATE POLICY enterprise_ai_jobs_select_member
  ON public.enterprise_ai_job_ledger FOR SELECT TO authenticated
  USING (public.has_workspace_capability(workspace_id, org_id, 'assess.audit.read'));

DROP POLICY IF EXISTS enterprise_ai_usage_select_member ON public.enterprise_ai_usage_ledger;
CREATE POLICY enterprise_ai_usage_select_member
  ON public.enterprise_ai_usage_ledger FOR SELECT TO authenticated
  USING (public.has_workspace_capability(workspace_id, org_id, 'assess.audit.read'));

DROP POLICY IF EXISTS enterprise_delivery_packages_select_member ON public.enterprise_delivery_work_packages;
CREATE POLICY enterprise_delivery_packages_select_member
  ON public.enterprise_delivery_work_packages FOR SELECT TO authenticated
  USING (public.has_workspace_capability(workspace_id, org_id, 'project.read'));

DROP POLICY IF EXISTS enterprise_delivery_versions_select_member ON public.enterprise_delivery_work_package_versions;
CREATE POLICY enterprise_delivery_versions_select_member
  ON public.enterprise_delivery_work_package_versions FOR SELECT TO authenticated
  USING (public.has_workspace_capability(workspace_id, org_id, 'project.read'));

DROP POLICY IF EXISTS enterprise_delivery_items_select_member ON public.enterprise_delivery_work_items;
CREATE POLICY enterprise_delivery_items_select_member
  ON public.enterprise_delivery_work_items FOR SELECT TO authenticated
  USING (public.has_workspace_capability(workspace_id, org_id, 'project.read'));

DROP POLICY IF EXISTS enterprise_monitor_select_member ON public.enterprise_monitor_baselines;
CREATE POLICY enterprise_monitor_select_member
  ON public.enterprise_monitor_baselines FOR SELECT TO authenticated
  USING (public.has_workspace_capability(workspace_id, org_id, 'monitor.read'));

DROP POLICY IF EXISTS enterprise_modernization_select_member ON public.enterprise_modernization_assessments;
CREATE POLICY enterprise_modernization_select_member
  ON public.enterprise_modernization_assessments FOR SELECT TO authenticated
  USING (public.has_workspace_capability(workspace_id, org_id, 'assess.applications.read'));

DROP POLICY IF EXISTS enterprise_modernization_decisions_select_member ON public.enterprise_modernization_decisions;
CREATE POLICY enterprise_modernization_decisions_select_member
  ON public.enterprise_modernization_decisions FOR SELECT TO authenticated
  USING (public.has_workspace_capability(workspace_id, org_id, 'assess.applications.read'));

DROP POLICY IF EXISTS enterprise_assemble_select_member ON public.enterprise_assemble_blueprints;
CREATE POLICY enterprise_assemble_select_member
  ON public.enterprise_assemble_blueprints FOR SELECT TO authenticated
  USING (public.has_workspace_capability(workspace_id, org_id, 'assess.applications.read'));

-- Provider configuration and key-reference rows are consumed only by the
-- server command boundary. Remove the legacy organization-wide browser read
-- surface so endpoint, budget, and resolver metadata cannot be enumerated.
REVOKE ALL ON TABLE public.ai_provider_configs, public.ai_provider_key_refs FROM PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS "Members can read org AI provider configs" ON public.ai_provider_configs;
DROP POLICY IF EXISTS "Members can read org AI provider key refs" ON public.ai_provider_key_refs;

CREATE INDEX IF NOT EXISTS enterprise_evidence_sources_scope
  ON public.enterprise_evidence_sources(org_id, workspace_id, status)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS enterprise_evidence_candidates_scope
  ON public.enterprise_evidence_candidates(org_id, workspace_id, source_id, suggestion_status);
CREATE INDEX IF NOT EXISTS enterprise_handoffs_scope
  ON public.enterprise_studio_delivery_handoffs(org_id, workspace_id, status);
CREATE INDEX IF NOT EXISTS enterprise_modernization_scope
  ON public.enterprise_modernization_assessments(org_id, workspace_id, status);

-- Source and version rows are append-only. The command boundary creates a new
-- version for edits and a new work-package/blueprint version for supersession.
CREATE OR REPLACE FUNCTION public.enterprise_reject_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'ENTERPRISE_APPEND_ONLY';
END;
$$;

DROP TRIGGER IF EXISTS enterprise_source_version_immutable ON public.enterprise_evidence_source_versions;
CREATE TRIGGER enterprise_source_version_immutable
  BEFORE UPDATE OR DELETE ON public.enterprise_evidence_source_versions
  FOR EACH ROW EXECUTE FUNCTION public.enterprise_reject_mutation();
DROP TRIGGER IF EXISTS enterprise_candidate_edit_immutable ON public.enterprise_evidence_candidate_edits;
CREATE TRIGGER enterprise_candidate_edit_immutable
  BEFORE UPDATE OR DELETE ON public.enterprise_evidence_candidate_edits
  FOR EACH ROW EXECUTE FUNCTION public.enterprise_reject_mutation();
DROP TRIGGER IF EXISTS enterprise_delivery_version_immutable ON public.enterprise_delivery_work_package_versions;
CREATE TRIGGER enterprise_delivery_version_immutable
  BEFORE UPDATE OR DELETE ON public.enterprise_delivery_work_package_versions
  FOR EACH ROW EXECUTE FUNCTION public.enterprise_reject_mutation();
DROP TRIGGER IF EXISTS enterprise_high_impact_approval_immutable ON public.enterprise_high_impact_approvals;
CREATE TRIGGER enterprise_high_impact_approval_immutable
  BEFORE UPDATE OR DELETE ON public.enterprise_high_impact_approvals
  FOR EACH ROW EXECUTE FUNCTION public.enterprise_reject_mutation();
DROP TRIGGER IF EXISTS enterprise_high_impact_review_immutable ON public.enterprise_high_impact_review_events;
CREATE TRIGGER enterprise_high_impact_review_immutable
  BEFORE UPDATE OR DELETE ON public.enterprise_high_impact_review_events
  FOR EACH ROW EXECUTE FUNCTION public.enterprise_reject_mutation();

DO $storage$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL AND to_regclass('storage.objects') IS NOT NULL THEN
    INSERT INTO storage.buckets(id, name, public)
    VALUES ('source-uploads', 'source-uploads', false)
    ON CONFLICT (id) DO UPDATE SET public = false;
    EXECUTE 'DROP POLICY IF EXISTS enterprise_source_uploads_browser_deny ON storage.objects';
    EXECUTE $policy$
      CREATE POLICY enterprise_source_uploads_browser_deny
      ON storage.objects AS RESTRICTIVE FOR ALL TO anon, authenticated
      USING (bucket_id <> 'source-uploads')
      WITH CHECK (bucket_id <> 'source-uploads')
    $policy$;
  END IF;
END
$storage$;

COMMENT ON TABLE public.enterprise_ai_job_ledger IS 'Durable Enterprise Intelligence job ledger. Prompt bodies, completion bodies, provider keys, auth headers, secret payloads, storage paths, and raw customer content are prohibited.';
COMMENT ON TABLE public.enterprise_evidence_source_versions IS 'Immutable server-managed source versions. storage_path is service-only and never a browser projection.';
COMMENT ON TABLE public.enterprise_studio_delivery_handoffs IS 'Exact approved Studio document handoff snapshots. Stale versions require a new handoff and cannot overwrite completed work.';
COMMENT ON TABLE public.enterprise_assemble_blueprints IS 'Assemble Phase 1 structured blueprint drafts. No code, deployment, infrastructure, credentials, source calls, or runtime agents.';

-- -------------------------------------------------------------------------
-- Effective Enterprise Intelligence authority hardening.
-- Rollback/read-only fallback: set the singleton control to read_only=true
-- and disable provider/ingestion/delivery/assemble. Preserve every committed
-- source version, provenance record, review, approval, package, and blueprint;
-- repair only with an additive forward migration.
-- -------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enterprise_sha256_jsonb(p_value JSONB)
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT encode(public.digest(convert_to(COALESCE(p_value, 'null'::jsonb)::text, 'UTF8'), 'sha256'), 'hex')
$$;

CREATE OR REPLACE FUNCTION public.enterprise_assert_writable(p_area TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE control public.enterprise_intelligence_runtime_control;
BEGIN
  SELECT * INTO control
  FROM public.enterprise_intelligence_runtime_control
  WHERE singleton = true
  FOR SHARE;
  IF control.singleton IS NULL OR NOT control.enabled OR control.read_only THEN
    RAISE EXCEPTION 'ENTERPRISE_INTELLIGENCE_READ_ONLY';
  END IF;
  IF p_area = 'provider' AND NOT control.provider_enabled THEN
    RAISE EXCEPTION 'ENTERPRISE_INTELLIGENCE_PROVIDER_DISABLED';
  ELSIF p_area = 'ingestion' AND NOT control.ingestion_enabled THEN
    RAISE EXCEPTION 'ENTERPRISE_INTELLIGENCE_INGESTION_DISABLED';
  ELSIF p_area = 'delivery' AND NOT control.delivery_enabled THEN
    RAISE EXCEPTION 'ENTERPRISE_INTELLIGENCE_DELIVERY_DISABLED';
  ELSIF p_area = 'assemble' AND NOT control.assemble_enabled THEN
    RAISE EXCEPTION 'ENTERPRISE_INTELLIGENCE_ASSEMBLE_DISABLED';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.enterprise_source_version_derive()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE source public.enterprise_evidence_sources; expected_parser TEXT;
BEGIN
  SELECT * INTO source
  FROM public.enterprise_evidence_sources
  WHERE id = NEW.source_id AND org_id = NEW.org_id AND workspace_id = NEW.workspace_id
  FOR SHARE;
  IF source.id IS NULL THEN RAISE EXCEPTION 'ENTERPRISE_EVIDENCE_SOURCE_NOT_FOUND'; END IF;
  expected_parser := CASE source.mime_type
    WHEN 'text/plain' THEN 'text_native'
    WHEN 'text/markdown' THEN 'text_native'
    WHEN 'text/meeting-notes' THEN 'text_native'
    WHEN 'text/csv' THEN 'csv'
    WHEN 'text/vtt' THEN 'vtt'
    WHEN 'application/x-subrip' THEN 'srt'
    WHEN 'text/x-srt' THEN 'srt'
    WHEN 'application/pdf' THEN 'pdf_text'
    WHEN 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' THEN 'docx'
    ELSE NULL
  END;
  IF expected_parser IS NULL THEN RAISE EXCEPTION 'ENTERPRISE_EVIDENCE_UNSUPPORTED_FORMAT'; END IF;
  NEW.parser_kind := expected_parser;
  NEW.parser_version := COALESCE(NULLIF(btrim(NEW.parser_version), ''), 'enterprise-parser-1');
  IF NEW.storage_bucket <> 'source-uploads'
     OR NEW.storage_path <> format('%s/%s/enterprise-evidence/%s.bin', NEW.org_id, NEW.workspace_id, NEW.source_id) THEN
    RAISE EXCEPTION 'ENTERPRISE_EVIDENCE_STORAGE_BINDING_INVALID';
  END IF;
  IF NEW.extracted_text_hash IS NOT NULL AND NEW.extracted_character_count IS NOT NULL THEN
    NEW.extraction_status := 'parsed'; NEW.extraction_failure_code := NULL;
  ELSIF NEW.extraction_status = 'failed_ocr_required'
        AND source.mime_type = 'application/pdf'
        AND NEW.extraction_failure_code = 'OCR_REQUIRED'
        AND NEW.extracted_text_hash IS NULL AND NEW.extracted_character_count IS NULL THEN
    NULL;
  ELSIF NEW.extraction_status IN ('failed_unsupported', 'failed_malformed')
        AND NEW.extraction_failure_code IN ('UNSUPPORTED_FORMAT', 'MALFORMED_SOURCE')
        AND NEW.extracted_text_hash IS NULL AND NEW.extracted_character_count IS NULL THEN
    NULL;
  ELSIF NEW.extraction_status = 'pending'
        AND NEW.extracted_text_hash IS NULL AND NEW.extracted_character_count IS NULL
        AND NEW.extraction_failure_code IS NULL THEN
    NULL;
  ELSE
    RAISE EXCEPTION 'ENTERPRISE_EVIDENCE_EXTRACTION_STATE_INVALID';
  END IF;
  NEW.provenance_hash := public.enterprise_sha256_jsonb(jsonb_build_object(
    'sourceId', NEW.source_id, 'sourceVersionId', NEW.id, 'version', NEW.version,
    'organizationId', NEW.org_id, 'workspaceId', NEW.workspace_id,
    'mimeType', source.mime_type, 'contentHash', NEW.content_hash,
    'contentBytes', NEW.content_bytes, 'parserKind', NEW.parser_kind,
    'parserVersion', NEW.parser_version
  ));
  RETURN NEW;
END;
$$;
CREATE TRIGGER enterprise_source_version_derive_before_insert
  BEFORE INSERT ON public.enterprise_evidence_source_versions
  FOR EACH ROW EXECUTE FUNCTION public.enterprise_source_version_derive();

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
  NEW.excerpt_hash := encode(public.digest(convert_to(NEW.safe_excerpt, 'UTF8'), 'sha256'), 'hex');
  NEW.provenance_hash := public.enterprise_sha256_jsonb(jsonb_build_object(
    'sourceVersionId', version.id, 'sourceContentHash', version.content_hash,
    'extractedTextHash', version.extracted_text_hash, 'sourceLocator', NEW.source_locator,
    'safeExcerpt', NEW.safe_excerpt, 'fieldKey', NEW.field_key, 'value', NEW.value,
    'candidateVersion', NEW.version
  ));
  RETURN NEW;
END;
$$;
CREATE TRIGGER enterprise_candidate_derive_before_insert
  BEFORE INSERT ON public.enterprise_evidence_candidates
  FOR EACH ROW EXECUTE FUNCTION public.enterprise_candidate_derive();

CREATE OR REPLACE FUNCTION public.enterprise_create_evidence_source(p_source JSONB, p_version JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE v_source public.enterprise_evidence_sources; v_version public.enterprise_evidence_source_versions;
BEGIN
  PERFORM public.enterprise_assert_writable('ingestion');
  INSERT INTO public.enterprise_evidence_sources(
    id, org_id, workspace_id, display_name, source_kind, mime_type,
    current_version, status, created_by
  ) VALUES (
    (p_source->>'id')::uuid, (p_source->>'org_id')::uuid, (p_source->>'workspace_id')::uuid,
    p_source->>'display_name', p_source->>'source_kind', p_source->>'mime_type',
    1, CASE WHEN p_version->>'extracted_text_hash' IS NULL THEN 'uploaded' ELSE 'review' END,
    (p_source->>'created_by')::uuid
  ) RETURNING * INTO v_source;
  INSERT INTO public.enterprise_evidence_source_versions(
    id, source_id, org_id, workspace_id, version, original_filename,
    content_hash, content_bytes, storage_bucket, storage_path,
    extracted_text_hash, extracted_character_count, extraction_status,
    parser_kind, parser_version, extraction_failure_code, provenance_hash, created_by
  ) VALUES (
    (p_version->>'id')::uuid, v_source.id, v_source.org_id, v_source.workspace_id,
    1, p_version->>'original_filename', p_version->>'content_hash',
    (p_version->>'content_bytes')::bigint, p_version->>'storage_bucket', p_version->>'storage_path',
    NULLIF(p_version->>'extracted_text_hash', ''), NULLIF(p_version->>'extracted_character_count', '')::integer,
    CASE WHEN NULLIF(p_version->>'extracted_text_hash', '') IS NULL THEN 'pending' ELSE 'parsed' END,
    'text_native', 'enterprise-parser-1', NULL, repeat('0', 64), (p_version->>'created_by')::uuid
  ) RETURNING * INTO v_version;
  RETURN jsonb_build_object(
    'sourceId', v_source.id, 'sourceVersionId', v_version.id,
    'version', v_version.version, 'contentHash', v_version.content_hash,
    'extractedTextHash', v_version.extracted_text_hash,
    'provenanceHash', v_version.provenance_hash, 'extractionStatus', v_version.extraction_status
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.enterprise_record_source_extraction_failure(
  p_source_version UUID, p_org UUID, p_workspace UUID, p_failure_code TEXT
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE version public.enterprise_evidence_source_versions; source public.enterprise_evidence_sources;
BEGIN
  PERFORM public.enterprise_assert_writable('ingestion');
  SELECT * INTO version FROM public.enterprise_evidence_source_versions
  WHERE id = p_source_version AND org_id = p_org AND workspace_id = p_workspace FOR UPDATE;
  IF version.id IS NULL OR version.extraction_status <> 'pending' THEN
    RAISE EXCEPTION 'ENTERPRISE_EVIDENCE_VERSION_CONFLICT';
  END IF;
  SELECT * INTO source FROM public.enterprise_evidence_sources
  WHERE id = version.source_id AND org_id = p_org AND workspace_id = p_workspace FOR UPDATE;
  IF p_failure_code = 'OCR_REQUIRED' AND source.mime_type = 'application/pdf' THEN
    UPDATE public.enterprise_evidence_source_versions
    SET extraction_status = 'failed_ocr_required', extraction_failure_code = p_failure_code
    WHERE id = version.id;
  ELSIF p_failure_code IN ('UNSUPPORTED_FORMAT', 'MALFORMED_SOURCE') THEN
    UPDATE public.enterprise_evidence_source_versions
    SET extraction_status = CASE p_failure_code WHEN 'UNSUPPORTED_FORMAT' THEN 'failed_unsupported' ELSE 'failed_malformed' END,
        extraction_failure_code = p_failure_code
    WHERE id = version.id;
  ELSE RAISE EXCEPTION 'ENTERPRISE_EVIDENCE_FAILURE_INVALID'; END IF;
  UPDATE public.enterprise_evidence_sources
  SET status = 'failed', lifecycle_version = lifecycle_version + 1, updated_at = statement_timestamp()
  WHERE id = source.id;
  SELECT * INTO version FROM public.enterprise_evidence_source_versions WHERE id = version.id;
  RETURN jsonb_build_object('sourceVersionId', version.id, 'status', version.extraction_status, 'failureCode', version.extraction_failure_code);
END;
$$;

CREATE OR REPLACE FUNCTION public.enterprise_commit_evidence_extraction(
  p_job_id UUID, p_source_id UUID, p_org UUID, p_workspace UUID,
  p_output_hash TEXT, p_latency_ms INTEGER, p_provider_config_id UUID,
  p_provider TEXT, p_model TEXT, p_token_input INTEGER, p_token_output INTEGER,
  p_candidates JSONB
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE item JSONB; source public.enterprise_evidence_sources; inserted_count INTEGER := 0;
BEGIN
  PERFORM public.enterprise_assert_writable('ingestion');
  IF jsonb_typeof(COALESCE(p_candidates, '[]'::jsonb)) <> 'array' OR jsonb_array_length(COALESCE(p_candidates, '[]'::jsonb)) > 200 THEN
    RAISE EXCEPTION 'ENTERPRISE_EVIDENCE_CANDIDATES_INVALID';
  END IF;
  SELECT * INTO source FROM public.enterprise_evidence_sources
  WHERE id = p_source_id AND org_id = p_org AND workspace_id = p_workspace AND deleted_at IS NULL FOR UPDATE;
  IF source.id IS NULL OR source.status NOT IN ('uploaded', 'extracting', 'review') THEN
    RAISE EXCEPTION 'ENTERPRISE_EVIDENCE_SOURCE_NOT_FOUND';
  END IF;
  UPDATE public.enterprise_ai_job_ledger
  SET status = 'succeeded', output_hash = p_output_hash, latency_ms = p_latency_ms,
      token_input = p_token_input, token_output = p_token_output, completed_at = statement_timestamp()
  WHERE id = p_job_id AND org_id = p_org AND workspace_id = p_workspace AND status = 'running'
    AND provider_config_id = p_provider_config_id AND provider = p_provider AND model = p_model;
  IF NOT FOUND THEN RAISE EXCEPTION 'ENTERPRISE_AI_JOB_NOT_RUNNING'; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(COALESCE(p_candidates, '[]'::jsonb)) LOOP
    INSERT INTO public.enterprise_evidence_candidates(
      id, source_id, source_version_id, org_id, workspace_id, field_key,
      value, safe_excerpt, excerpt_hash, provenance_hash, source_locator, confidence,
      ai_job_id, prompt_version, suggestion_status, created_by
    ) VALUES (
      (item->>'id')::uuid, p_source_id, (item->>'sourceVersionId')::uuid,
      p_org, p_workspace, item->>'field', item->>'value', item->>'safeExcerpt',
      repeat('0', 64), repeat('0', 64), item->>'sourceLocator', (item->>'confidence')::numeric,
      p_job_id, item->>'promptVersion', 'suggested', (item->>'createdBy')::uuid
    );
    inserted_count := inserted_count + 1;
  END LOOP;
  INSERT INTO public.enterprise_ai_usage_ledger(
    job_id, provider_config_id, org_id, workspace_id, provider, model, input_tokens, output_tokens
  ) VALUES (p_job_id, p_provider_config_id, p_org, p_workspace, p_provider, p_model, p_token_input, p_token_output);
  UPDATE public.enterprise_evidence_sources
  SET status = 'review', lifecycle_version = lifecycle_version + 1, updated_at = statement_timestamp()
  WHERE id = source.id;
  RETURN jsonb_build_object('jobId', p_job_id, 'candidateCount', inserted_count);
END;
$$;

CREATE OR REPLACE FUNCTION public.enterprise_review_evidence_candidate(
  p_candidate_id UUID, p_org UUID, p_workspace UUID, p_value TEXT,
  p_excerpt_hash TEXT, p_status TEXT, p_actor UUID,
  p_previous_value TEXT, p_reason TEXT
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE candidate public.enterprise_evidence_candidates; next_hash TEXT; auth_version BIGINT;
BEGIN
  PERFORM public.enterprise_assert_writable('ingestion');
  SELECT version INTO auth_version FROM public.authorization_versions WHERE org_id = p_org AND user_id = p_actor;
  PERFORM public.pr1b_assert_command_authority(p_actor, p_org, p_workspace, 'evidence.review', auth_version);
  SELECT * INTO candidate FROM public.enterprise_evidence_candidates
  WHERE id = p_candidate_id AND org_id = p_org AND workspace_id = p_workspace FOR UPDATE;
  IF candidate.id IS NULL THEN RAISE EXCEPTION 'ENTERPRISE_AI_CANDIDATE_NOT_FOUND'; END IF;
  IF candidate.suggestion_status IN ('accepted', 'rejected') OR candidate.value IS DISTINCT FROM p_previous_value
     OR p_status NOT IN ('accepted', 'rejected', 'edited') THEN
    RAISE EXCEPTION 'ENTERPRISE_EVIDENCE_VERSION_CONFLICT';
  END IF;
  next_hash := public.enterprise_sha256_jsonb(jsonb_build_object(
    'sourceVersionId', candidate.source_version_id,
    'sourceContentHash', (SELECT content_hash FROM public.enterprise_evidence_source_versions WHERE id = candidate.source_version_id),
    'extractedTextHash', (SELECT extracted_text_hash FROM public.enterprise_evidence_source_versions WHERE id = candidate.source_version_id),
    'sourceLocator', candidate.source_locator, 'safeExcerpt', candidate.safe_excerpt,
    'fieldKey', candidate.field_key, 'value', p_value,
    'candidateVersion', candidate.version + CASE WHEN p_status = 'edited' THEN 1 ELSE 0 END
  ));
  IF p_status = 'edited' THEN
    INSERT INTO public.enterprise_evidence_candidate_edits(
      candidate_id, org_id, workspace_id, actor_id, previous_value, next_value,
      previous_version, resulting_version, previous_provenance_hash, resulting_provenance_hash, reason
    ) VALUES (
      candidate.id, p_org, p_workspace, p_actor, candidate.value, p_value,
      candidate.version, candidate.version + 1, candidate.provenance_hash, next_hash, p_reason
    );
  END IF;
  UPDATE public.enterprise_evidence_candidates
  SET value = p_value, suggestion_status = p_status, reviewed_by = p_actor,
      reviewed_at = statement_timestamp(), updated_at = statement_timestamp(),
      version = version + CASE WHEN p_status = 'edited' THEN 1 ELSE 0 END,
      provenance_hash = next_hash
  WHERE id = candidate.id;
  RETURN jsonb_build_object(
    'candidateId', candidate.id, 'status', p_status,
    'reviewedBy', p_actor, 'version', candidate.version + CASE WHEN p_status = 'edited' THEN 1 ELSE 0 END,
    'provenanceHash', next_hash
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.enterprise_source_version_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'ENTERPRISE_APPEND_ONLY'; END IF;
  IF (to_jsonb(NEW) - ARRAY['extraction_status','extraction_failure_code','extracted_text_hash','extracted_character_count'])
     IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['extraction_status','extraction_failure_code','extracted_text_hash','extracted_character_count'])
     OR OLD.extraction_status <> 'pending'
     OR NEW.extraction_status NOT IN ('parsed','failed_ocr_required','failed_unsupported','failed_malformed')
     OR (NEW.extraction_status = 'parsed' AND (NEW.extracted_text_hash IS NULL OR NEW.extracted_character_count IS NULL OR NEW.extraction_failure_code IS NOT NULL))
     OR (NEW.extraction_status <> 'parsed' AND (NEW.extracted_text_hash IS NOT NULL OR NEW.extracted_character_count IS NOT NULL OR NEW.extraction_failure_code IS NULL)) THEN
    RAISE EXCEPTION 'ENTERPRISE_SOURCE_VERSION_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS enterprise_source_version_immutable ON public.enterprise_evidence_source_versions;
CREATE TRIGGER enterprise_source_version_immutable
  BEFORE UPDATE OR DELETE ON public.enterprise_evidence_source_versions
  FOR EACH ROW EXECUTE FUNCTION public.enterprise_source_version_guard();

CREATE OR REPLACE FUNCTION public.enterprise_candidate_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'ENTERPRISE_APPEND_ONLY'; END IF;
  IF (to_jsonb(NEW) - ARRAY['value','suggestion_status','reviewed_by','reviewed_at','updated_at','version','provenance_hash'])
     IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['value','suggestion_status','reviewed_by','reviewed_at','updated_at','version','provenance_hash'])
     OR OLD.suggestion_status IN ('accepted','rejected')
     OR NEW.suggestion_status NOT IN ('edited','accepted','rejected')
     OR (NEW.value IS DISTINCT FROM OLD.value AND (NEW.version <> OLD.version + 1 OR NEW.provenance_hash = OLD.provenance_hash))
     OR (NEW.value IS NOT DISTINCT FROM OLD.value AND NEW.version <> OLD.version) THEN
    RAISE EXCEPTION 'ENTERPRISE_CANDIDATE_IMMUTABLE_OR_TRANSITION_INVALID';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER enterprise_candidate_guard_before_mutation
  BEFORE UPDATE OR DELETE ON public.enterprise_evidence_candidates
  FOR EACH ROW EXECUTE FUNCTION public.enterprise_candidate_guard();

CREATE OR REPLACE FUNCTION public.enterprise_receipt_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.status <> 'claimed' OR NEW.status NOT IN ('committed','failed','blocked')
     OR (to_jsonb(NEW) - ARRAY['status','resource_id','response','completed_at'])
        IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','resource_id','response','completed_at'])
     OR NEW.completed_at IS NULL OR jsonb_typeof(NEW.response) <> 'object' THEN
    RAISE EXCEPTION 'ENTERPRISE_RECEIPT_IMMUTABLE_OR_TRANSITION_INVALID';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER enterprise_receipt_guard_before_mutation
  BEFORE UPDATE OR DELETE ON public.enterprise_ai_command_receipts
  FOR EACH ROW EXECUTE FUNCTION public.enterprise_receipt_guard();

CREATE OR REPLACE FUNCTION public.enterprise_job_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP = 'DELETE'
     OR (to_jsonb(NEW) - ARRAY['provider_config_id','status','token_input','token_output','latency_ms','failure_class','output_hash','completed_at'])
        IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['provider_config_id','status','token_input','token_output','latency_ms','failure_class','output_hash','completed_at'])
     OR NOT (
       (OLD.provider_config_id IS NOT NULL AND NEW.provider_config_id IS NULL AND NEW.status = OLD.status)
       OR (OLD.status NOT IN ('succeeded','failed','blocked') AND (
         (OLD.status = 'queued' AND NEW.status = 'running')
         OR (OLD.status = 'running' AND NEW.status IN ('succeeded','failed','blocked'))
       ))
     ) THEN
    RAISE EXCEPTION 'ENTERPRISE_AI_JOB_IMMUTABLE_OR_TRANSITION_INVALID';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER enterprise_job_guard_before_mutation
  BEFORE UPDATE OR DELETE ON public.enterprise_ai_job_ledger
  FOR EACH ROW EXECUTE FUNCTION public.enterprise_job_guard();

-- The Edge lifecycle boundary resolves or writes provider secrets before it
-- reaches PostgreSQL. This RPC accepts only opaque tenant-bound references and
-- safe fingerprints, then rechecks current human authority inside the same
-- transaction as every state transition.
ALTER TABLE public.ai_provider_audit_events DROP CONSTRAINT IF EXISTS ai_provider_audit_events_provider_check;
ALTER TABLE public.ai_provider_audit_events
  ADD CONSTRAINT ai_provider_audit_events_provider_check
  CHECK (provider IN ('gemini', 'groq', 'openai', 'azure_openai', 'anthropic', 'openai_compatible')) NOT VALID;
ALTER TABLE public.ai_provider_audit_events
  ADD CONSTRAINT ai_provider_audit_events_workspace_org_fkey
  FOREIGN KEY (workspace_id, org_id) REFERENCES public.workspaces(id, org_id) ON DELETE CASCADE;
ALTER TABLE public.ai_provider_audit_events
  ADD CONSTRAINT ai_provider_audit_events_config_org_fkey
  FOREIGN KEY (provider_config_id, org_id)
  REFERENCES public.ai_provider_configs(id, org_id) ON DELETE SET NULL (provider_config_id);
ALTER TABLE public.ai_provider_audit_events
  ADD CONSTRAINT ai_provider_audit_events_key_org_fkey
  FOREIGN KEY (key_ref_id, org_id)
  REFERENCES public.ai_provider_key_refs(id, org_id) ON DELETE SET NULL (key_ref_id);

CREATE OR REPLACE FUNCTION public.enterprise_provider_lifecycle_transition(
  p_operation TEXT, p_actor UUID, p_org UUID, p_workspace UUID,
  p_authorization_version BIGINT, p_payload JSONB
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  config public.ai_provider_configs;
  key_ref public.ai_provider_key_refs;
  previous_key public.ai_provider_key_refs;
  route_payload JSONB;
  route public.enterprise_ai_capability_routes;
  provider_name TEXT;
  secret_operation BOOLEAN := p_operation IN ('provider.secret.bind', 'provider.secret.rotate', 'provider.revoke');
  is_admin BOOLEAN := false;
  validated_at TIMESTAMPTZ;
  roles TEXT[];
  tenant_segment TEXT := upper(replace(p_org::text, '-', ''));
  forbidden_keys TEXT[] := ARRAY[
    'providerKey', 'rawKey', 'apiKey', 'secretValue', 'secret', 'authorization',
    'authHeader', 'bearerToken', 'encryptedKey', 'rawPrompt', 'rawCompletion'
  ];
BEGIN
  PERFORM public.enterprise_assert_writable('provider');
  IF p_operation NOT IN (
    'provider.register', 'provider.secret.bind', 'provider.validate',
    'provider.activate', 'provider.route.toggle', 'provider.secret.rotate', 'provider.revoke'
  ) OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object'
     OR p_payload ?| forbidden_keys
     OR p_payload::text ~* '"(providerKey|provider_key|rawKey|raw_key|apiKey|api_key|secretValue|secret_value|secret|authorization|authHeader|auth_header|bearerToken|bearer_token|encryptedKey|encrypted_key|rawPrompt|raw_prompt|rawCompletion|raw_completion)"[[:space:]]*:' THEN
    RAISE EXCEPTION 'ENTERPRISE_PROVIDER_LIFECYCLE_INVALID';
  END IF;

  BEGIN
    PERFORM public.pr1b_assert_command_authority(
      p_actor, p_org, p_workspace, 'org.admin', p_authorization_version
    );
    is_admin := true;
  EXCEPTION WHEN OTHERS THEN
    BEGIN
      PERFORM public.pr1b_assert_command_authority(
        p_actor, p_org, p_workspace, 'byok.manage', p_authorization_version
      );
    EXCEPTION WHEN OTHERS THEN
      IF secret_operation THEN RAISE; END IF;
      PERFORM public.pr1b_assert_command_authority(
        p_actor, p_org, p_workspace, 'security.manage', p_authorization_version
      );
    END;
  END;
  IF secret_operation AND NOT is_admin THEN
    PERFORM public.pr1b_assert_command_authority(
      p_actor, p_org, p_workspace, 'security.manage', p_authorization_version
    );
  END IF;

  IF p_operation = 'provider.register' THEN
    provider_name := p_payload->>'provider';
    IF provider_name NOT IN ('gemini', 'groq', 'openai', 'azure_openai', 'anthropic', 'openai_compatible')
       OR length(btrim(COALESCE(p_payload->>'displayName', ''))) NOT BETWEEN 1 AND 240
       OR length(btrim(COALESCE(p_payload->>'defaultModel', ''))) NOT BETWEEN 1 AND 200
       OR jsonb_typeof(p_payload->'modelAllowlist') IS DISTINCT FROM 'array'
       OR jsonb_array_length(p_payload->'modelAllowlist') NOT BETWEEN 1 AND 64
       OR NOT (p_payload->'modelAllowlist' @> jsonb_build_array(p_payload->>'defaultModel'))
       OR jsonb_typeof(p_payload->'routes') IS DISTINCT FROM 'array'
       OR jsonb_array_length(p_payload->'routes') NOT BETWEEN 1 AND 6
       OR jsonb_typeof(COALESCE(p_payload->'budget', '{}'::jsonb)) IS DISTINCT FROM 'object'
       OR (NULLIF(p_payload->>'endpoint', '') IS NOT NULL AND (
         length(p_payload->>'endpoint') > 500 OR p_payload->>'endpoint' !~ '^https://'
         OR p_payload->>'endpoint' ~ '@'
       ))
       OR (provider_name IN ('azure_openai', 'openai_compatible') AND NULLIF(p_payload->>'endpoint', '') IS NULL)
       OR (provider_name = 'azure_openai' AND NULLIF(p_payload->>'deployment', '') IS NULL) THEN
      RAISE EXCEPTION 'ENTERPRISE_PROVIDER_LIFECYCLE_INVALID';
    END IF;
    INSERT INTO public.ai_provider_configs(
      id, org_id, provider, display_name, endpoint_url, deployment_name,
      default_model, model_allowlist, budget_policy, allowed_modes,
      allowed_operations, status, created_by, updated_by
    ) VALUES (
      (p_payload->>'providerConfigId')::uuid, p_org, provider_name,
      p_payload->>'displayName', NULLIF(p_payload->>'endpoint', ''),
      NULLIF(p_payload->>'deployment', ''), p_payload->>'defaultModel',
      ARRAY(SELECT jsonb_array_elements_text(p_payload->'modelAllowlist')),
      COALESCE(p_payload->'budget', '{}'::jsonb), ARRAY['pilot'],
      ARRAY['generate_document'], 'pending_review', p_actor, p_actor
    ) RETURNING * INTO config;
    FOR route_payload IN SELECT value FROM jsonb_array_elements(p_payload->'routes') LOOP
      INSERT INTO public.enterprise_ai_capability_routes(
        id, org_id, workspace_id, provider_config_id, capability, model,
        enabled, allowed_roles, version, created_by, updated_by
      ) VALUES (
        (route_payload->>'id')::uuid, p_org, p_workspace, config.id,
        route_payload->>'capability', route_payload->>'model', false, '{}', 1, p_actor, p_actor
      );
    END LOOP;

  ELSE
    SELECT * INTO config FROM public.ai_provider_configs
    WHERE id = (p_payload->>'providerConfigId')::uuid AND org_id = p_org
      AND deleted_at IS NULL FOR UPDATE;
    IF config.id IS NULL OR config.status = 'retired' THEN
      RAISE EXCEPTION 'ENTERPRISE_PROVIDER_NOT_AVAILABLE';
    END IF;
    provider_name := config.provider;

    IF p_operation = 'provider.secret.bind' THEN
      IF config.key_ref_id IS NOT NULL OR p_payload->>'provider' IS DISTINCT FROM config.provider
         OR p_payload->>'backend' NOT IN ('environment', 'vault')
         OR p_payload->>'secretReference' !~ ('^AVALA_PROVIDER_SECRET_' || upper(config.provider) || '_' || tenant_segment || '_[A-Z0-9]+$')
         OR p_payload->>'safeFingerprint' !~ '^sha256:[0-9a-f]{24}$' THEN
        RAISE EXCEPTION 'ENTERPRISE_PROVIDER_SECRET_REFERENCE_INVALID';
      END IF;
      INSERT INTO public.ai_provider_key_refs(
        id, org_id, provider, resolver_type, secret_ref, safe_label,
        safe_fingerprint, status, rotation_status, created_by, updated_by
      ) VALUES (
        (p_payload->>'keyRefId')::uuid, p_org, config.provider, 'server_reference',
        p_payload->>'secretReference', 'Enterprise provider reference',
        p_payload->>'safeFingerprint', 'pending_review', 'not_started', p_actor, p_actor
      ) RETURNING * INTO key_ref;
      UPDATE public.ai_provider_configs SET key_ref_id = key_ref.id, updated_by = p_actor, updated_at = now()
      WHERE id = config.id AND org_id = p_org;

    ELSIF p_operation = 'provider.validate' THEN
      SELECT * INTO key_ref FROM public.ai_provider_key_refs
      WHERE id = config.key_ref_id AND org_id = p_org AND provider = config.provider
        AND deleted_at IS NULL AND status IN ('pending_review', 'active') FOR UPDATE;
      IF key_ref.id IS NULL THEN RAISE EXCEPTION 'ENTERPRISE_PROVIDER_SECRET_UNAVAILABLE'; END IF;
      validated_at := statement_timestamp();
      UPDATE public.ai_provider_configs SET last_validated_at = validated_at, updated_by = p_actor, updated_at = validated_at
      WHERE id = config.id AND org_id = p_org;
      UPDATE public.ai_provider_key_refs SET status = 'active', updated_by = p_actor, updated_at = validated_at
      WHERE id = key_ref.id AND org_id = p_org;

    ELSIF p_operation = 'provider.activate' THEN
      SELECT * INTO key_ref FROM public.ai_provider_key_refs
      WHERE id = (p_payload->>'keyRefId')::uuid AND id = config.key_ref_id
        AND org_id = p_org AND provider = config.provider AND status = 'active'
        AND deleted_at IS NULL FOR UPDATE;
      IF key_ref.id IS NULL OR config.last_validated_at IS NULL
         OR config.last_validated_at > statement_timestamp()
         OR config.last_validated_at < statement_timestamp() - interval '24 hours' THEN
        RAISE EXCEPTION 'ENTERPRISE_PROVIDER_VALIDATION_STALE';
      END IF;
      UPDATE public.ai_provider_configs SET status = 'active', updated_by = p_actor, updated_at = now()
      WHERE id = config.id AND org_id = p_org;

    ELSIF p_operation = 'provider.route.toggle' THEN
      SELECT * INTO route FROM public.enterprise_ai_capability_routes
      WHERE id = (p_payload->>'routeId')::uuid AND provider_config_id = config.id
        AND org_id = p_org AND workspace_id = p_workspace AND deleted_at IS NULL FOR UPDATE;
      IF route.id IS NULL OR jsonb_typeof(p_payload->'enabled') IS DISTINCT FROM 'boolean'
         OR (p_payload ? 'capability' AND p_payload->>'capability' IS DISTINCT FROM route.capability)
         OR (COALESCE((p_payload->>'enabled')::boolean, false) AND (
           config.status <> 'active' OR config.last_validated_at IS NULL
           OR config.last_validated_at > statement_timestamp()
           OR config.last_validated_at < statement_timestamp() - interval '24 hours'
         )) THEN
        RAISE EXCEPTION 'ENTERPRISE_PROVIDER_ROUTE_INVALID';
      END IF;
      IF p_payload ? 'allowedRoles' THEN
        IF jsonb_typeof(p_payload->'allowedRoles') IS DISTINCT FROM 'array'
           OR jsonb_array_length(p_payload->'allowedRoles') NOT BETWEEN 1 AND 32 THEN
          RAISE EXCEPTION 'ENTERPRISE_PROVIDER_ROUTE_ROLES_INVALID';
        END IF;
        roles := ARRAY(SELECT DISTINCT lower(btrim(value)) FROM jsonb_array_elements_text(p_payload->'allowedRoles'));
        IF EXISTS (SELECT 1 FROM unnest(roles) value WHERE value !~ '^[a-z0-9][a-z0-9 _.-]{0,119}$') THEN
          RAISE EXCEPTION 'ENTERPRISE_PROVIDER_ROUTE_ROLES_INVALID';
        END IF;
      ELSE roles := route.allowed_roles;
      END IF;
      UPDATE public.enterprise_ai_capability_routes
      SET enabled = (p_payload->>'enabled')::boolean, allowed_roles = roles,
          version = version + 1, updated_by = p_actor, updated_at = now()
      WHERE id = route.id AND org_id = p_org AND workspace_id = p_workspace;

    ELSIF p_operation = 'provider.secret.rotate' THEN
      SELECT * INTO previous_key FROM public.ai_provider_key_refs
      WHERE id = (p_payload->>'previousKeyRefId')::uuid AND id = config.key_ref_id
        AND org_id = p_org AND provider = config.provider AND status = 'active'
        AND deleted_at IS NULL FOR UPDATE;
      IF previous_key.id IS NULL OR p_payload->>'provider' IS DISTINCT FROM config.provider
         OR p_payload->>'backend' NOT IN ('environment', 'vault')
         OR p_payload->>'secretReference' !~ ('^AVALA_PROVIDER_SECRET_' || upper(config.provider) || '_' || tenant_segment || '_[A-Z0-9]+$')
         OR p_payload->>'safeFingerprint' !~ '^sha256:[0-9a-f]{24}$' THEN
        RAISE EXCEPTION 'ENTERPRISE_PROVIDER_ROTATION_INVALID';
      END IF;
      validated_at := statement_timestamp();
      INSERT INTO public.ai_provider_key_refs(
        id, org_id, provider, resolver_type, secret_ref, safe_label,
        safe_fingerprint, status, rotation_status, last_rotated_at, created_by, updated_by
      ) VALUES (
        (p_payload->>'keyRefId')::uuid, p_org, config.provider, 'server_reference',
        p_payload->>'secretReference', 'Rotated enterprise provider reference',
        p_payload->>'safeFingerprint', 'active', 'rotated', validated_at, p_actor, p_actor
      ) RETURNING * INTO key_ref;
      UPDATE public.ai_provider_configs
      SET key_ref_id = key_ref.id, last_validated_at = validated_at,
          status = 'active', updated_by = p_actor, updated_at = validated_at
      WHERE id = config.id AND org_id = p_org;
      UPDATE public.ai_provider_key_refs
      SET status = 'retired', rotation_status = 'rotated', last_rotated_at = validated_at,
          updated_by = p_actor, updated_at = validated_at, deleted_at = validated_at
      WHERE id = previous_key.id AND org_id = p_org;

    ELSIF p_operation = 'provider.revoke' THEN
      IF (p_payload->>'disableAllRoutes')::boolean IS DISTINCT FROM true
         OR (p_payload->>'keyRefId')::uuid IS DISTINCT FROM config.key_ref_id THEN
        RAISE EXCEPTION 'ENTERPRISE_PROVIDER_REVOKE_INVALID';
      END IF;
      UPDATE public.enterprise_ai_capability_routes
      SET enabled = false, version = version + 1, updated_by = p_actor, updated_at = now()
      WHERE provider_config_id = config.id AND org_id = p_org AND deleted_at IS NULL;
      UPDATE public.ai_provider_key_refs
      SET status = 'retired', rotation_status = 'rotated', updated_by = p_actor,
          updated_at = now(), deleted_at = COALESCE(deleted_at, now())
      WHERE id = config.key_ref_id AND org_id = p_org;
      UPDATE public.ai_provider_configs
      SET status = 'retired', updated_by = p_actor, updated_at = now()
      WHERE id = config.id AND org_id = p_org;
    END IF;
  END IF;

  INSERT INTO public.ai_provider_audit_events(
    event_type, org_id, workspace_id, provider, provider_config_id, key_ref_id,
    operation, mode, policy_result, status, actor_id, service_context, metadata
  ) VALUES (
    p_operation, p_org, p_workspace, provider_name, config.id,
    CASE WHEN p_operation = 'provider.revoke' THEN NULL ELSE COALESCE(key_ref.id, config.key_ref_id) END,
    p_operation, 'pilot', 'allowed', 'recorded', p_actor,
    'enterprise_provider_lifecycle_transition', jsonb_build_object(
      'operation', p_operation, 'providerConfigId', config.id,
      'routeId', p_payload->>'routeId', 'enabled', p_payload->'enabled'
    )
  );
  RETURN jsonb_strip_nulls(jsonb_build_object(
    'operation', p_operation, 'providerConfigId', config.id, 'provider', provider_name,
    'status', CASE p_operation
      WHEN 'provider.register' THEN 'pending_review'
      WHEN 'provider.secret.bind' THEN 'pending_review'
      WHEN 'provider.validate' THEN 'validated'
      WHEN 'provider.activate' THEN 'active'
      WHEN 'provider.secret.rotate' THEN 'active'
      WHEN 'provider.revoke' THEN 'retired'
      ELSE NULL END,
    'keyRefId', COALESCE(key_ref.id, config.key_ref_id),
    'routeId', p_payload->>'routeId', 'enabled', p_payload->'enabled',
    'lastValidatedAt', validated_at
  ));
END;
$$;

CREATE OR REPLACE FUNCTION public.enterprise_status_only_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE old_status TEXT := to_jsonb(OLD)->>'status'; new_status TEXT := to_jsonb(NEW)->>'status';
BEGIN
  IF TG_OP = 'DELETE'
     OR (to_jsonb(NEW) - ARRAY['status','updated_at']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','updated_at'])
     OR old_status IN ('approved','rejected','stale','blocked','superseded')
     OR new_status NOT IN ('approved','rejected','stale','blocked','superseded') THEN
    RAISE EXCEPTION 'ENTERPRISE_RESOURCE_IMMUTABLE_OR_TRANSITION_INVALID';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER enterprise_handoff_status_guard BEFORE UPDATE OR DELETE ON public.enterprise_studio_delivery_handoffs FOR EACH ROW EXECUTE FUNCTION public.enterprise_status_only_guard();
CREATE TRIGGER enterprise_package_status_guard BEFORE UPDATE OR DELETE ON public.enterprise_delivery_work_packages FOR EACH ROW EXECUTE FUNCTION public.enterprise_status_only_guard();
DROP TRIGGER IF EXISTS enterprise_delivery_version_immutable ON public.enterprise_delivery_work_package_versions;
CREATE TRIGGER enterprise_delivery_version_status_guard BEFORE UPDATE OR DELETE ON public.enterprise_delivery_work_package_versions FOR EACH ROW EXECUTE FUNCTION public.enterprise_status_only_guard();
CREATE TRIGGER enterprise_monitor_status_guard BEFORE UPDATE OR DELETE ON public.enterprise_monitor_baselines FOR EACH ROW EXECUTE FUNCTION public.enterprise_status_only_guard();
CREATE TRIGGER enterprise_modernization_assessment_status_guard BEFORE UPDATE OR DELETE ON public.enterprise_modernization_assessments FOR EACH ROW EXECUTE FUNCTION public.enterprise_status_only_guard();
CREATE TRIGGER enterprise_modernization_decision_status_guard BEFORE UPDATE OR DELETE ON public.enterprise_modernization_decisions FOR EACH ROW EXECUTE FUNCTION public.enterprise_status_only_guard();
CREATE TRIGGER enterprise_assemble_status_guard BEFORE UPDATE OR DELETE ON public.enterprise_assemble_blueprints FOR EACH ROW EXECUTE FUNCTION public.enterprise_status_only_guard();

CREATE TRIGGER enterprise_review_event_derive_before_insert
  BEFORE INSERT ON public.enterprise_high_impact_review_events
  FOR EACH ROW EXECUTE FUNCTION public.enterprise_review_event_derive();
CREATE TRIGGER enterprise_approval_derive_before_insert
  BEFORE INSERT ON public.enterprise_high_impact_approvals
  FOR EACH ROW EXECUTE FUNCTION public.enterprise_approval_derive();

DO $enterprise_immutable_tables$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'enterprise_ai_usage_ledger', 'enterprise_evidence_candidate_edits',
    'enterprise_evidence_assess_promotions', 'enterprise_delivery_work_items',
    'enterprise_high_impact_review_events', 'enterprise_high_impact_approvals'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS enterprise_%I_final_immutable ON public.%I', table_name, table_name);
    EXECUTE format('CREATE TRIGGER enterprise_%I_final_immutable BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.enterprise_reject_mutation()', table_name, table_name);
  END LOOP;
END
$enterprise_immutable_tables$;

CREATE OR REPLACE FUNCTION public.enterprise_evidence_source_projection(p_org UUID, p_workspace UUID, p_source UUID)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT CASE WHEN NOT (
    public.has_workspace_capability(p_workspace, p_org, 'evidence.write')
    OR public.has_workspace_capability(p_workspace, p_org, 'evidence.review')
    OR public.has_workspace_capability(p_workspace, p_org, 'assessment.edit')
  ) THEN NULL ELSE (
    SELECT jsonb_build_object(
      'sourceId', s.id, 'version', s.current_version, 'lifecycleVersion', s.lifecycle_version,
      'displayName', s.display_name, 'sourceKind', s.source_kind, 'mimeType', s.mime_type,
      'status', s.status, 'createdAt', s.created_at,
      'versions', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'sourceVersionId', v.id, 'version', v.version, 'originalFilename', v.original_filename,
        'contentHash', v.content_hash, 'contentBytes', v.content_bytes,
        'extractedTextHash', v.extracted_text_hash, 'extractedCharacterCount', v.extracted_character_count,
        'extractionStatus', v.extraction_status, 'parserKind', v.parser_kind,
        'parserVersion', v.parser_version, 'failureCode', v.extraction_failure_code,
        'provenanceHash', v.provenance_hash, 'createdAt', v.created_at
      ) ORDER BY v.version) FROM public.enterprise_evidence_source_versions v
        WHERE v.source_id = s.id AND v.org_id = s.org_id AND v.workspace_id = s.workspace_id), '[]'::jsonb),
      'candidates', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'candidateId', c.id, 'sourceVersionId', c.source_version_id,
        'fieldKey', c.field_key, 'value', c.value, 'safeExcerpt', c.safe_excerpt,
        'sourceLocator', c.source_locator, 'confidence', c.confidence,
        'status', c.suggestion_status, 'version', c.version,
        'provenanceHash', c.provenance_hash, 'reviewedAt', c.reviewed_at
      ) ORDER BY c.created_at, c.id) FROM public.enterprise_evidence_candidates c
        WHERE c.source_id = s.id AND c.org_id = s.org_id AND c.workspace_id = s.workspace_id), '[]'::jsonb)
    ) FROM public.enterprise_evidence_sources s
    WHERE s.id = p_source AND s.org_id = p_org AND s.workspace_id = p_workspace AND s.deleted_at IS NULL
  ) END
$$;

CREATE OR REPLACE FUNCTION public.enterprise_delivery_package_projection(p_org UUID, p_workspace UUID, p_package UUID)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT CASE WHEN NOT public.has_workspace_capability(p_workspace, p_org, 'project.read') THEN NULL ELSE (
    SELECT jsonb_build_object(
      'workPackageId', p.id, 'version', p.current_version, 'status', p.status,
      'handoffId', p.handoff_id, 'readOnly', ctl.read_only OR NOT ctl.enabled OR NOT ctl.delivery_enabled,
      'current', jsonb_build_object(
        'packageVersionId', v.id, 'contentHash', v.content_hash,
        'studioDocumentId', v.studio_document_id, 'studioVersionId', v.studio_version_id,
        'studioVersion', v.studio_version, 'studioContentHash', v.studio_content_hash,
        'artifactType', v.artifact_type, 'status', v.status, 'content', v.content
      ),
      'items', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', i.id, 'parentId', i.parent_item_id, 'itemType', i.item_type,
        'title', i.title, 'description', i.description,
        'acceptanceCriteria', i.acceptance_criteria,
        'nonFunctionalRequirements', i.non_functional_requirements,
        'sourceSectionLocator', i.source_section_locator
      ) ORDER BY i.item_type, i.id) FROM public.enterprise_delivery_work_items i
        WHERE i.package_version_id = v.id AND i.org_id = p.org_id AND i.workspace_id = p.workspace_id), '[]'::jsonb)
    ) FROM public.enterprise_delivery_work_packages p
    JOIN public.enterprise_delivery_work_package_versions v
      ON v.work_package_id = p.id AND v.version = p.current_version
      AND v.org_id = p.org_id AND v.workspace_id = p.workspace_id
    CROSS JOIN public.enterprise_intelligence_runtime_control ctl
    WHERE ctl.singleton AND p.id = p_package AND p.org_id = p_org AND p.workspace_id = p_workspace
  ) END
$$;

CREATE OR REPLACE FUNCTION public.enterprise_monitor_projection(p_org UUID, p_workspace UUID, p_baseline UUID)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT CASE WHEN NOT public.has_workspace_capability(p_workspace, p_org, 'monitor.read') THEN NULL ELSE (
    SELECT jsonb_build_object(
      'baselineId', m.id, 'workPackageId', m.work_package_id,
      'workPackageVersionId', m.work_package_version_id, 'version', m.version,
      'resourceHash', m.resource_hash, 'approvedItemIds', m.approved_item_ids,
      'milestones', m.milestones, 'dependencies', m.dependencies,
      'blockers', m.blockers, 'risks', m.risks, 'readiness', m.readiness,
      'status', m.status, 'liveTelemetryConnected', false
    ) FROM public.enterprise_monitor_baselines m
    WHERE m.id = p_baseline AND m.org_id = p_org AND m.workspace_id = p_workspace
  ) END
$$;

CREATE OR REPLACE FUNCTION public.enterprise_assemble_blueprint_projection(p_org UUID, p_workspace UUID, p_blueprint UUID)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT CASE WHEN NOT public.has_workspace_capability(p_workspace, p_org, 'assemble.manage') THEN NULL ELSE (
    SELECT jsonb_build_object(
      'blueprintId', b.id, 'modernizationDecisionId', b.modernization_decision_id,
      'disposition', b.disposition, 'schemaVersion', b.schema_version,
      'version', b.version, 'resourceHash', b.resource_hash,
      'structuredContent', b.structured_content, 'readableDocument', b.readable_document,
      'status', b.status, 'codeGenerationEnabled', false, 'deploymentEnabled', false,
      'infrastructureChangesEnabled', false, 'credentialAccessEnabled', false,
      'sourceSystemCallsEnabled', false, 'runtimeAgentsEnabled', false,
      'liveTelemetryEnabled', false
    ) FROM public.enterprise_assemble_blueprints b
    WHERE b.id = p_blueprint AND b.org_id = p_org AND b.workspace_id = p_workspace
  ) END
$$;

DO $enterprise_final_acl$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'enterprise_intelligence_runtime_control',
    'enterprise_ai_capability_routes', 'enterprise_ai_command_receipts',
    'enterprise_ai_job_ledger', 'enterprise_ai_usage_ledger',
    'enterprise_evidence_sources', 'enterprise_evidence_source_versions',
    'enterprise_evidence_candidates', 'enterprise_evidence_candidate_edits',
    'enterprise_evidence_questions', 'enterprise_evidence_assess_promotions',
    'enterprise_studio_delivery_handoffs', 'enterprise_delivery_work_packages',
    'enterprise_delivery_work_package_versions', 'enterprise_delivery_work_items',
    'enterprise_monitor_baselines', 'enterprise_modernization_assessments',
    'enterprise_modernization_decisions', 'enterprise_assemble_blueprints',
    'enterprise_high_impact_review_events', 'enterprise_high_impact_approvals'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated, service_role', table_name);
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO service_role', table_name);
  END LOOP;
END
$enterprise_final_acl$;

DROP POLICY IF EXISTS enterprise_ai_routes_select_member ON public.enterprise_ai_capability_routes;
DROP POLICY IF EXISTS enterprise_ai_jobs_select_member ON public.enterprise_ai_job_ledger;
DROP POLICY IF EXISTS enterprise_ai_usage_select_member ON public.enterprise_ai_usage_ledger;
DROP POLICY IF EXISTS enterprise_delivery_packages_select_member ON public.enterprise_delivery_work_packages;
DROP POLICY IF EXISTS enterprise_delivery_versions_select_member ON public.enterprise_delivery_work_package_versions;
DROP POLICY IF EXISTS enterprise_delivery_items_select_member ON public.enterprise_delivery_work_items;
DROP POLICY IF EXISTS enterprise_monitor_select_member ON public.enterprise_monitor_baselines;
DROP POLICY IF EXISTS enterprise_modernization_select_member ON public.enterprise_modernization_assessments;
DROP POLICY IF EXISTS enterprise_modernization_decisions_select_member ON public.enterprise_modernization_decisions;
DROP POLICY IF EXISTS enterprise_assemble_select_member ON public.enterprise_assemble_blueprints;

DROP FUNCTION public.enterprise_commit_delivery_handoff_legacy_untrusted(JSONB, JSONB, JSONB, JSONB);
DROP FUNCTION public.enterprise_commit_modernization_assessment_legacy_untrusted(JSONB, JSONB);
DROP FUNCTION public.enterprise_commit_high_impact_approval_legacy_untrusted(JSONB, TEXT, UUID, UUID, UUID, TEXT);

REVOKE ALL ON FUNCTION
  public.enterprise_sha256_jsonb(JSONB),
  public.enterprise_command_runtime_area(TEXT, TEXT),
  public.enterprise_assert_writable(TEXT),
  public.enterprise_source_version_derive(),
  public.enterprise_candidate_derive(),
  public.enterprise_source_version_guard(),
  public.enterprise_candidate_guard(),
  public.enterprise_receipt_guard(),
  public.enterprise_job_guard(),
  public.enterprise_status_only_guard(),
  public.enterprise_resource_snapshot(TEXT, UUID, UUID, UUID),
  public.enterprise_review_event_derive(),
  public.enterprise_approval_derive(),
  public.enterprise_reject_mutation()
FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION
  public.enterprise_ai_claim_command(UUID, UUID, UUID, TEXT, TEXT, UUID, TEXT, TEXT),
  public.enterprise_ai_complete_command(UUID, UUID, UUID, JSONB, UUID),
  public.enterprise_ai_fail_command(UUID, UUID, UUID, JSONB, BOOLEAN),
  public.enterprise_provider_lifecycle_transition(TEXT, UUID, UUID, UUID, BIGINT, JSONB),
  public.enterprise_create_evidence_source(JSONB, JSONB),
  public.enterprise_record_source_extraction_failure(UUID, UUID, UUID, TEXT),
  public.enterprise_commit_evidence_extraction(UUID, UUID, UUID, UUID, TEXT, INTEGER, UUID, TEXT, TEXT, INTEGER, INTEGER, JSONB),
  public.enterprise_review_evidence_candidate(UUID, UUID, UUID, TEXT, TEXT, TEXT, UUID, TEXT, TEXT),
  public.enterprise_promote_evidence_to_assess_v2(UUID, UUID, BIGINT, UUID, UUID, UUID, UUID, TEXT, BIGINT),
  public.enterprise_commit_delivery_handoff(JSONB, JSONB, JSONB, JSONB),
  public.enterprise_commit_monitor_baseline(JSONB, UUID, UUID, UUID),
  public.enterprise_commit_modernization_assessment(JSONB, JSONB),
  public.enterprise_commit_assemble_blueprint(JSONB, UUID, UUID, UUID),
  public.enterprise_commit_high_impact_approval(JSONB, TEXT, UUID, UUID, UUID, TEXT)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.enterprise_command_runtime_area(TEXT, TEXT),
  public.enterprise_ai_claim_command(UUID, UUID, UUID, TEXT, TEXT, UUID, TEXT, TEXT),
  public.enterprise_ai_complete_command(UUID, UUID, UUID, JSONB, UUID),
  public.enterprise_ai_fail_command(UUID, UUID, UUID, JSONB, BOOLEAN),
  public.enterprise_provider_lifecycle_transition(TEXT, UUID, UUID, UUID, BIGINT, JSONB),
  public.enterprise_create_evidence_source(JSONB, JSONB),
  public.enterprise_record_source_extraction_failure(UUID, UUID, UUID, TEXT),
  public.enterprise_commit_evidence_extraction(UUID, UUID, UUID, UUID, TEXT, INTEGER, UUID, TEXT, TEXT, INTEGER, INTEGER, JSONB),
  public.enterprise_review_evidence_candidate(UUID, UUID, UUID, TEXT, TEXT, TEXT, UUID, TEXT, TEXT),
  public.enterprise_promote_evidence_to_assess_v2(UUID, UUID, BIGINT, UUID, UUID, UUID, UUID, TEXT, BIGINT),
  public.enterprise_commit_delivery_handoff(JSONB, JSONB, JSONB, JSONB),
  public.enterprise_commit_monitor_baseline(JSONB, UUID, UUID, UUID),
  public.enterprise_commit_modernization_assessment(JSONB, JSONB),
  public.enterprise_commit_assemble_blueprint(JSONB, UUID, UUID, UUID),
  public.enterprise_commit_high_impact_approval(JSONB, TEXT, UUID, UUID, UUID, TEXT)
TO service_role;

REVOKE ALL ON FUNCTION
  public.enterprise_evidence_source_projection(UUID, UUID, UUID),
  public.enterprise_delivery_package_projection(UUID, UUID, UUID),
  public.enterprise_monitor_projection(UUID, UUID, UUID),
  public.enterprise_assemble_blueprint_projection(UUID, UUID, UUID)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.enterprise_evidence_source_projection(UUID, UUID, UUID),
  public.enterprise_delivery_package_projection(UUID, UUID, UUID),
  public.enterprise_monitor_projection(UUID, UUID, UUID),
  public.enterprise_assemble_blueprint_projection(UUID, UUID, UUID)
TO authenticated;

CREATE INDEX enterprise_ai_receipts_scope ON public.enterprise_ai_command_receipts(org_id, workspace_id, actor_id, status);
CREATE INDEX enterprise_ai_jobs_provider_scope ON public.enterprise_ai_job_ledger(provider_config_id, org_id, workspace_id, status);
CREATE INDEX enterprise_ai_usage_provider_scope ON public.enterprise_ai_usage_ledger(provider_config_id, org_id, workspace_id, recorded_at);
CREATE INDEX enterprise_evidence_versions_scope ON public.enterprise_evidence_source_versions(org_id, workspace_id, source_id, version);
CREATE INDEX enterprise_evidence_edits_candidate_scope ON public.enterprise_evidence_candidate_edits(candidate_id, org_id, workspace_id);
CREATE INDEX enterprise_evidence_promotions_case_scope ON public.enterprise_evidence_assess_promotions(assess_case_id, org_id, workspace_id, assess_case_version);
CREATE INDEX enterprise_package_versions_scope ON public.enterprise_delivery_work_package_versions(work_package_id, org_id, workspace_id, version);
CREATE INDEX enterprise_work_items_parent_scope ON public.enterprise_delivery_work_items(parent_item_id, org_id, workspace_id) WHERE parent_item_id IS NOT NULL;
CREATE INDEX enterprise_high_reviews_resource_scope ON public.enterprise_high_impact_review_events(resource_type, resource_id, org_id, workspace_id, created_at);

COMMENT ON TABLE public.enterprise_intelligence_runtime_control IS 'Fail-closed source-level rollback control. read_only stops all Enterprise Intelligence mutation while preserving safe projections.';
COMMENT ON TABLE public.enterprise_evidence_assess_promotions IS 'Immutable accepted-candidate provenance promoted into one immutable Assess V2 draft version.';
COMMENT ON FUNCTION public.enterprise_evidence_source_projection(UUID, UUID, UUID) IS 'Capability-scoped source/candidate projection excluding bucket and object path authority.';
COMMENT ON FUNCTION public.enterprise_delivery_package_projection(UUID, UUID, UUID) IS 'Capability-scoped canonical Delivery package projection with server-derived IDs and hashes.';

-- Independent-review correction: one request identity, fenced recovery, and
-- durable effect evidence. requestId is transport correlation only;
-- idempotency identity is tenant/workspace/actor/operation/key/request hash.
ALTER TABLE public.enterprise_ai_command_receipts RENAME COLUMN request_id TO initial_request_id;
ALTER TABLE public.enterprise_ai_command_receipts
  ADD COLUMN last_request_id UUID,
  ADD COLUMN execution_token UUID NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN execution_fence BIGINT NOT NULL DEFAULT 1 CHECK (execution_fence > 0),
  ADD COLUMN claim_started_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  ADD COLUMN lease_expires_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp() + interval '2 minutes',
  ADD COLUMN reconciliation_count INTEGER NOT NULL DEFAULT 0 CHECK (reconciliation_count >= 0),
  ADD COLUMN execution_plan JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (
    jsonb_typeof(execution_plan) = 'object'
    AND NOT (execution_plan ?| ARRAY['providerKey','provider_key','rawKey','raw_key','apiKey','api_key','secretValue','secret_value','authorization','bearerToken'])
  ),
  ADD COLUMN response_hash TEXT CHECK (response_hash IS NULL OR response_hash ~ '^[0-9a-f]{64}$');
UPDATE public.enterprise_ai_command_receipts SET last_request_id = initial_request_id WHERE last_request_id IS NULL;
ALTER TABLE public.enterprise_ai_command_receipts ALTER COLUMN last_request_id SET NOT NULL;

CREATE TABLE public.enterprise_ai_receipt_replay_requests (
  receipt_id UUID NOT NULL REFERENCES public.enterprise_ai_command_receipts(id) ON DELETE CASCADE,
  request_id UUID NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY (receipt_id, request_id)
);

CREATE TABLE public.enterprise_ai_effect_journal (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id UUID NOT NULL REFERENCES public.enterprise_ai_command_receipts(id) ON DELETE RESTRICT,
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL,
  operation_type TEXT NOT NULL CHECK (length(btrim(operation_type)) BETWEEN 1 AND 120),
  effect_key TEXT NOT NULL CHECK (length(btrim(effect_key)) BETWEEN 1 AND 120),
  resource_id UUID,
  terminal_status TEXT NOT NULL CHECK (terminal_status IN ('committed','failed','blocked')),
  safe_result JSONB NOT NULL CHECK (jsonb_typeof(safe_result) = 'object'),
  result_hash TEXT NOT NULL CHECK (result_hash ~ '^[0-9a-f]{64}$'),
  execution_fence BIGINT NOT NULL CHECK (execution_fence > 0),
  committed_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT enterprise_ai_effect_workspace_org_fkey
    FOREIGN KEY (workspace_id, org_id) REFERENCES public.workspaces(id, org_id) ON DELETE CASCADE,
  UNIQUE (receipt_id, effect_key)
);

ALTER TABLE public.enterprise_ai_receipt_replay_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enterprise_ai_receipt_replay_requests FORCE ROW LEVEL SECURITY;
ALTER TABLE public.enterprise_ai_effect_journal ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enterprise_ai_effect_journal FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.enterprise_ai_receipt_replay_requests, public.enterprise_ai_effect_journal FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.enterprise_ai_receipt_replay_requests, public.enterprise_ai_effect_journal TO service_role;

CREATE OR REPLACE FUNCTION public.enterprise_receipt_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.status <> 'claimed' THEN
    RAISE EXCEPTION 'ENTERPRISE_RECEIPT_IMMUTABLE_OR_TRANSITION_INVALID';
  END IF;
  IF NEW.status = 'claimed' THEN
    IF (to_jsonb(NEW) - ARRAY['last_request_id','execution_token','execution_fence','claim_started_at','lease_expires_at','reconciliation_count','execution_plan'])
       IS DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['last_request_id','execution_token','execution_fence','claim_started_at','lease_expires_at','reconciliation_count','execution_plan'])
       OR NEW.completed_at IS NOT NULL OR NEW.response_hash IS NOT NULL
       OR NEW.execution_fence < OLD.execution_fence OR NEW.reconciliation_count < OLD.reconciliation_count THEN
      RAISE EXCEPTION 'ENTERPRISE_RECEIPT_IMMUTABLE_OR_TRANSITION_INVALID';
    END IF;
  ELSIF NEW.status IN ('committed','failed','blocked') THEN
    NEW.response_hash := COALESCE(NEW.response_hash, public.enterprise_sha256_jsonb(NEW.response));
    IF (to_jsonb(NEW) - ARRAY['status','resource_id','response','response_hash','completed_at','reconciliation_count'])
       IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','resource_id','response','response_hash','completed_at','reconciliation_count'])
       OR NEW.reconciliation_count < OLD.reconciliation_count
       OR NEW.completed_at IS NULL OR NEW.response_hash IS NULL OR jsonb_typeof(NEW.response) <> 'object' THEN
      RAISE EXCEPTION 'ENTERPRISE_RECEIPT_IMMUTABLE_OR_TRANSITION_INVALID';
    END IF;
  ELSE
    RAISE EXCEPTION 'ENTERPRISE_RECEIPT_IMMUTABLE_OR_TRANSITION_INVALID';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.enterprise_ai_record_effect(
  p_receipt UUID, p_org UUID, p_workspace UUID, p_execution_token UUID,
  p_execution_fence BIGINT, p_operation TEXT, p_effect_key TEXT,
  p_resource_id UUID, p_result JSONB, p_terminal_status TEXT DEFAULT 'committed'
)
RETURNS public.enterprise_ai_effect_journal
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE receipt public.enterprise_ai_command_receipts; effect public.enterprise_ai_effect_journal; result_hash TEXT;
BEGIN
  IF jsonb_typeof(COALESCE(p_result, '{}'::jsonb)) <> 'object' OR p_terminal_status NOT IN ('committed','failed','blocked') THEN
    RAISE EXCEPTION 'ENTERPRISE_AI_EFFECT_INVALID';
  END IF;
  SELECT * INTO receipt FROM public.enterprise_ai_command_receipts
  WHERE id=p_receipt AND org_id=p_org AND workspace_id=p_workspace FOR UPDATE;
  IF receipt.id IS NULL OR receipt.status <> 'claimed'
     OR receipt.execution_token IS DISTINCT FROM p_execution_token
     OR receipt.execution_fence IS DISTINCT FROM p_execution_fence THEN
    RAISE EXCEPTION 'ENTERPRISE_AI_STALE_EXECUTION_FENCE';
  END IF;
  result_hash := public.enterprise_sha256_jsonb(p_result);
  INSERT INTO public.enterprise_ai_effect_journal(
    receipt_id,org_id,workspace_id,operation_type,effect_key,resource_id,
    terminal_status,safe_result,result_hash,execution_fence
  ) VALUES (
    receipt.id,p_org,p_workspace,p_operation,p_effect_key,p_resource_id,
    p_terminal_status,p_result,result_hash,p_execution_fence
  ) ON CONFLICT (receipt_id,effect_key) DO NOTHING RETURNING * INTO effect;
  IF effect.id IS NULL THEN
    SELECT * INTO effect FROM public.enterprise_ai_effect_journal
    WHERE receipt_id=receipt.id AND effect_key=p_effect_key FOR SHARE;
    IF effect.operation_type IS DISTINCT FROM p_operation
       OR effect.resource_id IS DISTINCT FROM p_resource_id
       OR effect.terminal_status IS DISTINCT FROM p_terminal_status
       OR effect.result_hash IS DISTINCT FROM result_hash
       OR effect.safe_result IS DISTINCT FROM p_result THEN
      RAISE EXCEPTION 'ENTERPRISE_AI_IDEMPOTENCY_CONFLICT';
    END IF;
  END IF;
  RETURN effect;
END;
$$;

CREATE OR REPLACE FUNCTION public.enterprise_ai_claim_command(
  p_actor UUID, p_org UUID, p_workspace UUID, p_command_type TEXT,
  p_key TEXT, p_request UUID, p_hash TEXT, p_resource_type TEXT,
  p_execution_token UUID
)
RETURNS public.enterprise_ai_command_receipts
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE receipt public.enterprise_ai_command_receipts; runtime_area TEXT; effect public.enterprise_ai_effect_journal;
BEGIN
  IF p_actor IS NULL OR p_org IS NULL OR p_workspace IS NULL OR p_request IS NULL OR p_execution_token IS NULL
     OR p_key IS NULL OR length(btrim(p_key)) NOT BETWEEN 8 AND 200
     OR p_hash IS NULL OR p_hash !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'ENTERPRISE_AI_INVALID_COMMAND'; END IF;
  runtime_area := public.enterprise_command_runtime_area(p_command_type,p_resource_type);
  SELECT * INTO receipt FROM public.enterprise_ai_command_receipts
  WHERE org_id=p_org AND workspace_id=p_workspace AND actor_id=p_actor AND command_type=p_command_type AND idempotency_key=p_key FOR UPDATE;
  IF receipt.id IS NOT NULL THEN
    IF receipt.workspace_id IS DISTINCT FROM p_workspace OR receipt.request_hash IS DISTINCT FROM p_hash
       OR receipt.runtime_area IS DISTINCT FROM runtime_area OR receipt.resource_type IS DISTINCT FROM p_resource_type THEN
      RAISE EXCEPTION 'ENTERPRISE_AI_IDEMPOTENCY_CONFLICT';
    END IF;
    INSERT INTO public.enterprise_ai_receipt_replay_requests(receipt_id,request_id)
    VALUES(receipt.id,p_request) ON CONFLICT DO NOTHING;
    IF receipt.status='claimed' THEN
      SELECT * INTO effect FROM public.enterprise_ai_effect_journal
      WHERE receipt_id=receipt.id AND effect_key='command' FOR SHARE;
      IF effect.id IS NOT NULL THEN
        UPDATE public.enterprise_ai_command_receipts SET
          status=effect.terminal_status,response=effect.safe_result,response_hash=effect.result_hash,
          resource_id=effect.resource_id,completed_at=effect.committed_at,
          reconciliation_count=reconciliation_count+1
        WHERE id=receipt.id RETURNING * INTO receipt;
      ELSIF receipt.lease_expires_at <= statement_timestamp() THEN
        UPDATE public.enterprise_ai_command_receipts SET
          last_request_id=p_request,execution_token=p_execution_token,
          execution_fence=execution_fence+1,claim_started_at=statement_timestamp(),
          lease_expires_at=statement_timestamp()+interval '2 minutes',
          reconciliation_count=reconciliation_count+1
        WHERE id=receipt.id AND status='claimed' AND execution_fence=receipt.execution_fence
        RETURNING * INTO receipt;
      END IF;
    END IF;
    RETURN receipt;
  END IF;
  PERFORM public.enterprise_assert_writable(runtime_area);
  INSERT INTO public.enterprise_ai_command_receipts(
    org_id,workspace_id,actor_id,command_type,runtime_area,resource_type,
    idempotency_key,initial_request_id,last_request_id,request_hash,status,
    execution_token,execution_fence,claim_started_at,lease_expires_at,response
  ) VALUES (
    p_org,p_workspace,p_actor,p_command_type,runtime_area,p_resource_type,
    p_key,p_request,p_request,p_hash,'claimed',p_execution_token,1,
    statement_timestamp(),statement_timestamp()+interval '2 minutes','{}'::jsonb
  ) ON CONFLICT (org_id,workspace_id,actor_id,command_type,idempotency_key) DO NOTHING RETURNING * INTO receipt;
  IF receipt.id IS NULL THEN
    SELECT * INTO receipt FROM public.enterprise_ai_command_receipts
    WHERE org_id=p_org AND workspace_id=p_workspace AND actor_id=p_actor AND command_type=p_command_type AND idempotency_key=p_key FOR UPDATE;
    IF receipt.id IS NULL OR receipt.workspace_id IS DISTINCT FROM p_workspace
       OR receipt.request_hash IS DISTINCT FROM p_hash OR receipt.runtime_area IS DISTINCT FROM runtime_area
       OR receipt.resource_type IS DISTINCT FROM p_resource_type THEN RAISE EXCEPTION 'ENTERPRISE_AI_IDEMPOTENCY_CONFLICT'; END IF;
  END IF;
  INSERT INTO public.enterprise_ai_receipt_replay_requests(receipt_id,request_id)
  VALUES(receipt.id,p_request) ON CONFLICT DO NOTHING;
  RETURN receipt;
END;
$$;

-- Compatibility overload for the internal candidate-promotion transaction.
CREATE OR REPLACE FUNCTION public.enterprise_ai_claim_command(
  p_actor UUID,p_org UUID,p_workspace UUID,p_command_type TEXT,p_key TEXT,
  p_request UUID,p_hash TEXT,p_resource_type TEXT DEFAULT NULL
)
RETURNS public.enterprise_ai_command_receipts
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  RETURN public.enterprise_ai_claim_command(
    p_actor,p_org,p_workspace,p_command_type,p_key,p_request,p_hash,p_resource_type,p_request
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.enterprise_ai_plan_command(
  p_id UUID,p_org UUID,p_workspace UUID,p_execution_token UUID,
  p_execution_fence BIGINT,p_plan JSONB
)
RETURNS public.enterprise_ai_command_receipts
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE receipt public.enterprise_ai_command_receipts;
BEGIN
  IF jsonb_typeof(COALESCE(p_plan,'{}'::jsonb)) <> 'object'
     OR p_plan ?| ARRAY['providerKey','provider_key','rawKey','raw_key','apiKey','api_key','secretValue','secret_value','authorization','bearerToken'] THEN
    RAISE EXCEPTION 'ENTERPRISE_AI_EXECUTION_PLAN_INVALID';
  END IF;
  SELECT * INTO receipt FROM public.enterprise_ai_command_receipts
  WHERE id=p_id AND org_id=p_org AND workspace_id=p_workspace FOR UPDATE;
  IF receipt.id IS NULL OR receipt.status<>'claimed'
     OR receipt.execution_token IS DISTINCT FROM p_execution_token
     OR receipt.execution_fence IS DISTINCT FROM p_execution_fence THEN RAISE EXCEPTION 'ENTERPRISE_AI_STALE_EXECUTION_FENCE'; END IF;
  IF receipt.execution_plan <> '{}'::jsonb AND NOT (p_plan @> receipt.execution_plan) THEN
    RAISE EXCEPTION 'ENTERPRISE_AI_EXECUTION_PLAN_CONFLICT';
  END IF;
  UPDATE public.enterprise_ai_command_receipts SET execution_plan=p_plan
  WHERE id=receipt.id RETURNING * INTO receipt;
  RETURN receipt;
END;
$$;

CREATE OR REPLACE FUNCTION public.enterprise_ai_complete_command(
  p_id UUID,p_org UUID,p_workspace UUID,p_execution_token UUID,p_execution_fence BIGINT,
  p_response JSONB,p_resource_id UUID DEFAULT NULL
)
RETURNS public.enterprise_ai_command_receipts
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE receipt public.enterprise_ai_command_receipts; effect public.enterprise_ai_effect_journal; result_hash TEXT;
BEGIN
  IF jsonb_typeof(COALESCE(p_response,'{}'::jsonb))<>'object' THEN RAISE EXCEPTION 'ENTERPRISE_AI_EFFECT_INVALID'; END IF;
  result_hash:=public.enterprise_sha256_jsonb(p_response);
  SELECT * INTO receipt FROM public.enterprise_ai_command_receipts
  WHERE id=p_id AND org_id=p_org AND workspace_id=p_workspace FOR UPDATE;
  IF receipt.id IS NULL THEN RAISE EXCEPTION 'ENTERPRISE_AI_RECEIPT_NOT_FOUND'; END IF;
  IF receipt.status='committed' THEN
    IF receipt.response_hash IS DISTINCT FROM result_hash OR receipt.resource_id IS DISTINCT FROM p_resource_id
       OR receipt.response IS DISTINCT FROM p_response THEN RAISE EXCEPTION 'ENTERPRISE_AI_IDEMPOTENCY_CONFLICT'; END IF;
    RETURN receipt;
  END IF;
  IF receipt.status<>'claimed' OR receipt.execution_token IS DISTINCT FROM p_execution_token
     OR receipt.execution_fence IS DISTINCT FROM p_execution_fence THEN RAISE EXCEPTION 'ENTERPRISE_AI_STALE_EXECUTION_FENCE'; END IF;
  SELECT * INTO effect FROM public.enterprise_ai_effect_journal WHERE receipt_id=receipt.id AND effect_key='command' FOR SHARE;
  IF effect.id IS NULL THEN
    effect:=public.enterprise_ai_record_effect(receipt.id,p_org,p_workspace,p_execution_token,p_execution_fence,
      receipt.command_type,'command',p_resource_id,p_response,'committed');
  ELSIF effect.terminal_status<>'committed' OR effect.result_hash IS DISTINCT FROM result_hash
        OR effect.resource_id IS DISTINCT FROM p_resource_id OR effect.safe_result IS DISTINCT FROM p_response THEN
    RAISE EXCEPTION 'ENTERPRISE_AI_IDEMPOTENCY_CONFLICT';
  END IF;
  UPDATE public.enterprise_ai_command_receipts SET status='committed',response=effect.safe_result,
    response_hash=effect.result_hash,resource_id=effect.resource_id,completed_at=effect.committed_at
  WHERE id=receipt.id AND status='claimed' RETURNING * INTO receipt;
  RETURN receipt;
END;
$$;

CREATE OR REPLACE FUNCTION public.enterprise_ai_fail_command(
  p_id UUID,p_org UUID,p_workspace UUID,p_execution_token UUID,p_execution_fence BIGINT,
  p_response JSONB,p_blocked BOOLEAN DEFAULT false
)
RETURNS public.enterprise_ai_command_receipts
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE receipt public.enterprise_ai_command_receipts; effect public.enterprise_ai_effect_journal;
  target_status TEXT:=CASE WHEN p_blocked THEN 'blocked' ELSE 'failed' END; result_hash TEXT;
BEGIN
  IF jsonb_typeof(COALESCE(p_response,'{}'::jsonb))<>'object' THEN RAISE EXCEPTION 'ENTERPRISE_AI_EFFECT_INVALID'; END IF;
  result_hash:=public.enterprise_sha256_jsonb(p_response);
  SELECT * INTO receipt FROM public.enterprise_ai_command_receipts
  WHERE id=p_id AND org_id=p_org AND workspace_id=p_workspace FOR UPDATE;
  IF receipt.id IS NULL THEN RAISE EXCEPTION 'ENTERPRISE_AI_RECEIPT_NOT_FOUND'; END IF;
  IF receipt.status=target_status THEN
    IF receipt.response_hash IS DISTINCT FROM result_hash OR receipt.response IS DISTINCT FROM p_response THEN
      RAISE EXCEPTION 'ENTERPRISE_AI_IDEMPOTENCY_CONFLICT'; END IF;
    RETURN receipt;
  END IF;
  IF receipt.status<>'claimed' OR receipt.execution_token IS DISTINCT FROM p_execution_token
     OR receipt.execution_fence IS DISTINCT FROM p_execution_fence THEN RAISE EXCEPTION 'ENTERPRISE_AI_STALE_EXECUTION_FENCE'; END IF;
  effect:=public.enterprise_ai_record_effect(receipt.id,p_org,p_workspace,p_execution_token,p_execution_fence,
    receipt.command_type,'command',NULL,p_response,target_status);
  UPDATE public.enterprise_ai_command_receipts SET status=target_status,response=effect.safe_result,
    response_hash=effect.result_hash,completed_at=effect.committed_at
  WHERE id=receipt.id AND status='claimed' RETURNING * INTO receipt;
  RETURN receipt;
END;
$$;

CREATE OR REPLACE FUNCTION public.enterprise_ai_reconcile_command(
  p_id UUID,p_org UUID,p_workspace UUID,p_expected_response JSONB,p_expected_resource_id UUID DEFAULT NULL
)
RETURNS public.enterprise_ai_command_receipts
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE receipt public.enterprise_ai_command_receipts; effect public.enterprise_ai_effect_journal; expected_hash TEXT;
BEGIN
  IF jsonb_typeof(COALESCE(p_expected_response,'{}'::jsonb))<>'object' THEN RAISE EXCEPTION 'ENTERPRISE_AI_EFFECT_INVALID'; END IF;
  expected_hash:=public.enterprise_sha256_jsonb(p_expected_response);
  SELECT * INTO receipt FROM public.enterprise_ai_command_receipts
  WHERE id=p_id AND org_id=p_org AND workspace_id=p_workspace FOR UPDATE;
  IF receipt.id IS NULL THEN RAISE EXCEPTION 'ENTERPRISE_AI_RECEIPT_NOT_FOUND'; END IF;
  IF receipt.status IN ('committed','failed','blocked') THEN
    IF receipt.response_hash IS DISTINCT FROM expected_hash OR receipt.response IS DISTINCT FROM p_expected_response
       OR receipt.resource_id IS DISTINCT FROM p_expected_resource_id THEN RAISE EXCEPTION 'ENTERPRISE_AI_IDEMPOTENCY_CONFLICT'; END IF;
    RETURN receipt;
  END IF;
  SELECT * INTO effect FROM public.enterprise_ai_effect_journal
  WHERE receipt_id=receipt.id AND effect_key='command' FOR SHARE;
  IF effect.id IS NULL THEN RAISE EXCEPTION 'ENTERPRISE_AI_EFFECT_EVIDENCE_NOT_FOUND'; END IF;
  IF effect.result_hash IS DISTINCT FROM expected_hash OR effect.safe_result IS DISTINCT FROM p_expected_response
     OR effect.resource_id IS DISTINCT FROM p_expected_resource_id THEN RAISE EXCEPTION 'ENTERPRISE_AI_IDEMPOTENCY_CONFLICT'; END IF;
  UPDATE public.enterprise_ai_command_receipts SET status=effect.terminal_status,response=effect.safe_result,
    response_hash=effect.result_hash,resource_id=effect.resource_id,completed_at=effect.committed_at,
    reconciliation_count=reconciliation_count+1
  WHERE id=receipt.id AND status='claimed' RETURNING * INTO receipt;
  RETURN receipt;
END;
$$;

CREATE OR REPLACE FUNCTION public.enterprise_ai_reload_command(
  p_id UUID,p_org UUID,p_workspace UUID
)
RETURNS public.enterprise_ai_command_receipts
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE receipt public.enterprise_ai_command_receipts; effect public.enterprise_ai_effect_journal;
BEGIN
  SELECT * INTO receipt FROM public.enterprise_ai_command_receipts
  WHERE id=p_id AND org_id=p_org AND workspace_id=p_workspace FOR UPDATE;
  IF receipt.id IS NULL THEN RAISE EXCEPTION 'ENTERPRISE_AI_RECEIPT_NOT_FOUND'; END IF;
  IF receipt.status<>'claimed' THEN RETURN receipt; END IF;
  SELECT * INTO effect FROM public.enterprise_ai_effect_journal
  WHERE receipt_id=receipt.id AND effect_key='command' FOR SHARE;
  IF effect.id IS NOT NULL THEN
    UPDATE public.enterprise_ai_command_receipts SET status=effect.terminal_status,
      response=effect.safe_result,response_hash=effect.result_hash,resource_id=effect.resource_id,
      completed_at=effect.committed_at,reconciliation_count=reconciliation_count+1
    WHERE id=receipt.id AND status='claimed' RETURNING * INTO receipt;
  END IF;
  RETURN receipt;
END;
$$;

CREATE OR REPLACE FUNCTION public.enterprise_actor_has_organization_capability(
  p_actor UUID,p_org UUID,p_capability TEXT,p_authorization_version BIGINT
)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.profiles p
    JOIN public.organization_members om ON om.user_id=p.id AND om.org_id=p_org AND om.status='active' AND om.deleted_at IS NULL
    JOIN public.organizations o ON o.id=om.org_id AND o.status='active' AND o.deleted_at IS NULL
    JOIN public.roles r ON r.id=om.role_id AND r.scope='organization' AND r.org_id=p_org
      AND r.workspace_id IS NULL AND r.status='active' AND r.deleted_at IS NULL
    JOIN public.role_capabilities rc ON rc.role_id=r.id AND rc.capability_key=p_capability
    JOIN public.authorization_versions av ON av.org_id=p_org AND av.user_id=p.id AND av.version=p_authorization_version
    WHERE p.id=p_actor AND p.status='active' AND p.deleted_at IS NULL
  )
$$;

CREATE OR REPLACE FUNCTION public.enterprise_provider_lifecycle_transition(
  p_operation TEXT,p_actor UUID,p_org UUID,p_workspace UUID,p_authorization_version BIGINT,p_payload JSONB,
  p_receipt UUID,p_execution_token UUID,p_execution_fence BIGINT,p_result JSONB
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result JSONB; secret_operation BOOLEAN:=p_operation IN ('provider.secret.bind','provider.secret.rotate','provider.revoke');
  organization_operation BOOLEAN:=p_operation<>'provider.route.toggle'; resource_id UUID;
BEGIN
  IF p_receipt IS NULL OR p_execution_token IS NULL OR p_execution_fence IS NULL OR jsonb_typeof(p_result)<>'object' THEN
    RAISE EXCEPTION 'ENTERPRISE_PROVIDER_RECEIPT_REQUIRED';
  END IF;
  IF organization_operation THEN
    IF NOT public.enterprise_actor_has_organization_capability(p_actor,p_org,'org.admin',p_authorization_version) THEN
      IF secret_operation THEN
        IF NOT public.enterprise_actor_has_organization_capability(p_actor,p_org,'byok.manage',p_authorization_version)
           OR NOT public.enterprise_actor_has_organization_capability(p_actor,p_org,'security.manage',p_authorization_version) THEN
          RAISE EXCEPTION 'ENTERPRISE_PROVIDER_ORGANIZATION_AUTHORITY_REQUIRED';
        END IF;
      ELSIF NOT public.enterprise_actor_has_organization_capability(p_actor,p_org,'byok.manage',p_authorization_version)
        AND NOT public.enterprise_actor_has_organization_capability(p_actor,p_org,'security.manage',p_authorization_version) THEN
        RAISE EXCEPTION 'ENTERPRISE_PROVIDER_ORGANIZATION_AUTHORITY_REQUIRED';
      END IF;
    END IF;
  ELSE
    BEGIN
      PERFORM public.pr1b_assert_command_authority(p_actor,p_org,p_workspace,'org.admin',p_authorization_version);
    EXCEPTION WHEN OTHERS THEN
      BEGIN
        PERFORM public.pr1b_assert_command_authority(p_actor,p_org,p_workspace,'byok.manage',p_authorization_version);
      EXCEPTION WHEN OTHERS THEN
        PERFORM public.pr1b_assert_command_authority(p_actor,p_org,p_workspace,'security.manage',p_authorization_version);
      END;
    END;
  END IF;
  result:=public.enterprise_provider_lifecycle_transition(
    p_operation,p_actor,p_org,p_workspace,p_authorization_version,p_payload
  );
  resource_id:=NULLIF(p_result->>'providerConfigId','')::uuid;
  PERFORM public.enterprise_ai_record_effect(
    p_receipt,p_org,p_workspace,p_execution_token,p_execution_fence,p_operation,'command',resource_id,p_result,'committed'
  );
  RETURN p_result;
END;
$$;

REVOKE ALL ON FUNCTION
  public.enterprise_ai_claim_command(UUID,UUID,UUID,TEXT,TEXT,UUID,TEXT,TEXT,UUID),
  public.enterprise_ai_plan_command(UUID,UUID,UUID,UUID,BIGINT,JSONB),
  public.enterprise_ai_complete_command(UUID,UUID,UUID,UUID,BIGINT,JSONB,UUID),
  public.enterprise_ai_fail_command(UUID,UUID,UUID,UUID,BIGINT,JSONB,BOOLEAN),
  public.enterprise_ai_reconcile_command(UUID,UUID,UUID,JSONB,UUID),
  public.enterprise_ai_reload_command(UUID,UUID,UUID),
  public.enterprise_ai_record_effect(UUID,UUID,UUID,UUID,BIGINT,TEXT,TEXT,UUID,JSONB,TEXT),
  public.enterprise_actor_has_organization_capability(UUID,UUID,TEXT,BIGINT),
  public.enterprise_provider_lifecycle_transition(TEXT,UUID,UUID,UUID,BIGINT,JSONB,UUID,UUID,BIGINT,JSONB)
FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION
  public.enterprise_ai_claim_command(UUID,UUID,UUID,TEXT,TEXT,UUID,TEXT,TEXT,UUID),
  public.enterprise_ai_plan_command(UUID,UUID,UUID,UUID,BIGINT,JSONB),
  public.enterprise_ai_complete_command(UUID,UUID,UUID,UUID,BIGINT,JSONB,UUID),
  public.enterprise_ai_fail_command(UUID,UUID,UUID,UUID,BIGINT,JSONB,BOOLEAN),
  public.enterprise_ai_reconcile_command(UUID,UUID,UUID,JSONB,UUID),
  public.enterprise_ai_reload_command(UUID,UUID,UUID),
  public.enterprise_ai_record_effect(UUID,UUID,UUID,UUID,BIGINT,TEXT,TEXT,UUID,JSONB,TEXT),
  public.enterprise_provider_lifecycle_transition(TEXT,UUID,UUID,UUID,BIGINT,JSONB,UUID,UUID,BIGINT,JSONB)
TO service_role;
REVOKE ALL ON FUNCTION public.enterprise_actor_has_organization_capability(UUID,UUID,TEXT,BIGINT) FROM service_role;

COMMENT ON TABLE public.enterprise_ai_effect_journal IS 'Service-only durable receipt-to-effect linkage for idempotent response-loss reconciliation.';
COMMENT ON COLUMN public.enterprise_ai_command_receipts.initial_request_id IS 'Immutable first transport correlation ID; excluded from logical command identity.';

CREATE OR REPLACE FUNCTION public.enterprise_ai_complete_command(
  p_id UUID,p_org UUID,p_workspace UUID,p_response JSONB,p_resource_id UUID DEFAULT NULL
)
RETURNS public.enterprise_ai_command_receipts
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE receipt public.enterprise_ai_command_receipts;
BEGIN
  SELECT * INTO receipt FROM public.enterprise_ai_command_receipts
  WHERE id=p_id AND org_id=p_org AND workspace_id=p_workspace FOR UPDATE;
  IF receipt.id IS NULL THEN RAISE EXCEPTION 'ENTERPRISE_AI_RECEIPT_NOT_FOUND'; END IF;
  RETURN public.enterprise_ai_complete_command(
    p_id,p_org,p_workspace,receipt.execution_token,receipt.execution_fence,p_response,p_resource_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.enterprise_ai_fail_command(
  p_id UUID,p_org UUID,p_workspace UUID,p_response JSONB,p_blocked BOOLEAN DEFAULT false
)
RETURNS public.enterprise_ai_command_receipts
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE receipt public.enterprise_ai_command_receipts;
BEGIN
  SELECT * INTO receipt FROM public.enterprise_ai_command_receipts
  WHERE id=p_id AND org_id=p_org AND workspace_id=p_workspace FOR UPDATE;
  IF receipt.id IS NULL THEN RAISE EXCEPTION 'ENTERPRISE_AI_RECEIPT_NOT_FOUND'; END IF;
  RETURN public.enterprise_ai_fail_command(
    p_id,p_org,p_workspace,receipt.execution_token,receipt.execution_fence,p_response,p_blocked
  );
END;
$$;
REVOKE ALL ON FUNCTION
  public.enterprise_ai_complete_command(UUID,UUID,UUID,JSONB,UUID),
  public.enterprise_ai_fail_command(UUID,UUID,UUID,JSONB,BOOLEAN)
FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION
  public.enterprise_ai_complete_command(UUID,UUID,UUID,JSONB,UUID),
  public.enterprise_ai_fail_command(UUID,UUID,UUID,JSONB,BOOLEAN)
TO service_role;

-- Receipt-aware mutation overloads. Each overload executes the canonical
-- mutation and writes its safe effect evidence in the same database
-- transaction. The Edge runtime uses only these overloads.
CREATE OR REPLACE FUNCTION public.enterprise_create_evidence_source(
  p_source JSONB,p_version JSONB,p_receipt UUID,p_execution_token UUID,
  p_execution_fence BIGINT,p_result JSONB
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE committed JSONB;
BEGIN
  committed:=public.enterprise_create_evidence_source(p_source,p_version);
  PERFORM public.enterprise_ai_record_effect(
    p_receipt,(p_source->>'org_id')::uuid,(p_source->>'workspace_id')::uuid,
    p_execution_token,p_execution_fence,'evidence.source.create','command',
    (p_source->>'id')::uuid,p_result,'committed'
  );
  RETURN committed;
END;
$$;

CREATE OR REPLACE FUNCTION public.enterprise_commit_evidence_extraction(
  p_job_id UUID,p_source_id UUID,p_org UUID,p_workspace UUID,p_output_hash TEXT,
  p_latency_ms INTEGER,p_provider_config_id UUID,p_provider TEXT,p_model TEXT,
  p_token_input INTEGER,p_token_output INTEGER,p_candidates JSONB,
  p_receipt UUID,p_execution_token UUID,p_execution_fence BIGINT,p_result JSONB
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE committed JSONB;
BEGIN
  committed:=public.enterprise_commit_evidence_extraction(
    p_job_id,p_source_id,p_org,p_workspace,p_output_hash,p_latency_ms,
    p_provider_config_id,p_provider,p_model,p_token_input,p_token_output,p_candidates
  );
  PERFORM public.enterprise_ai_record_effect(
    p_receipt,p_org,p_workspace,p_execution_token,p_execution_fence,
    'evidence.extract','command',p_job_id,p_result,'committed'
  );
  RETURN committed;
END;
$$;

CREATE OR REPLACE FUNCTION public.enterprise_review_evidence_candidate(
  p_candidate_id UUID,p_org UUID,p_workspace UUID,p_value TEXT,p_excerpt_hash TEXT,
  p_status TEXT,p_actor UUID,p_previous_value TEXT,p_reason TEXT,
  p_receipt UUID,p_execution_token UUID,p_execution_fence BIGINT,p_result JSONB
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE committed JSONB;
BEGIN
  committed:=public.enterprise_review_evidence_candidate(
    p_candidate_id,p_org,p_workspace,p_value,p_excerpt_hash,p_status,p_actor,p_previous_value,p_reason
  );
  PERFORM public.enterprise_ai_record_effect(
    p_receipt,p_org,p_workspace,p_execution_token,p_execution_fence,
    'evidence.candidate.review','command',p_candidate_id,p_result,'committed'
  );
  RETURN committed;
END;
$$;

CREATE OR REPLACE FUNCTION public.enterprise_promote_evidence_to_assess_v2(
  p_candidate UUID,p_case UUID,p_expected_version BIGINT,p_actor UUID,p_org UUID,p_workspace UUID,
  p_request UUID,p_idempotency_key TEXT,p_authorization_version BIGINT,
  p_outer_receipt UUID,p_execution_token UUID,p_execution_fence BIGINT,p_result JSONB
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE committed JSONB; promotion_id UUID;
BEGIN
  committed:=public.enterprise_promote_evidence_to_assess_v2(
    p_candidate,p_case,p_expected_version,p_actor,p_org,p_workspace,
    p_request,p_idempotency_key,p_authorization_version
  );
  promotion_id:=NULLIF(committed#>>'{resource,promotionId}','')::uuid;
  PERFORM public.enterprise_ai_record_effect(
    p_outer_receipt,p_org,p_workspace,p_execution_token,p_execution_fence,
    'evidence.assess.promote','promotion:'||p_candidate::text,promotion_id,p_result,'committed'
  );
  RETURN committed;
END;
$$;

CREATE OR REPLACE FUNCTION public.enterprise_commit_modernization_assessment(
  p_assessment JSONB,p_decision JSONB,p_receipt UUID,p_execution_token UUID,
  p_execution_fence BIGINT,p_result JSONB
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE committed JSONB;
BEGIN
  committed:=public.enterprise_commit_modernization_assessment(p_assessment,p_decision);
  PERFORM public.enterprise_ai_record_effect(
    p_receipt,(p_assessment->>'org_id')::uuid,(p_assessment->>'workspace_id')::uuid,
    p_execution_token,p_execution_fence,'modernization.evaluate','command',
    (p_decision->>'id')::uuid,p_result,'committed'
  );
  RETURN committed;
END;
$$;

CREATE OR REPLACE FUNCTION public.enterprise_record_high_impact_review(
  p_event JSONB,p_receipt UUID,p_execution_token UUID,p_execution_fence BIGINT,p_result JSONB
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE event_id UUID:=(p_event->>'id')::uuid; org UUID:=(p_event->>'org_id')::uuid;
  workspace UUID:=(p_event->>'workspace_id')::uuid;
BEGIN
  PERFORM public.enterprise_assert_writable(
    CASE WHEN p_event->>'resource_type'='assemble_blueprint' THEN 'assemble' ELSE 'delivery' END
  );
  INSERT INTO public.enterprise_high_impact_review_events(
    id,org_id,workspace_id,resource_type,resource_id,reviewer_id,
    reviewer_authorization_version,resource_hash,rationale
  ) VALUES (
    event_id,org,workspace,p_event->>'resource_type',(p_event->>'resource_id')::uuid,
    (p_event->>'reviewer_id')::uuid,(p_event->>'reviewer_authorization_version')::bigint,
    p_event->>'resource_hash',p_event->>'rationale'
  );
  PERFORM public.enterprise_ai_record_effect(
    p_receipt,org,workspace,p_execution_token,p_execution_fence,
    'approval.review.record','command',event_id,p_result,'committed'
  );
  RETURN p_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.enterprise_commit_high_impact_approval(
  p_approval JSONB,p_resource_type TEXT,p_resource_id UUID,p_org UUID,p_workspace UUID,
  p_next_status TEXT,p_receipt UUID,p_execution_token UUID,p_execution_fence BIGINT,p_result JSONB
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE committed JSONB;
BEGIN
  committed:=public.enterprise_commit_high_impact_approval(
    p_approval,p_resource_type,p_resource_id,p_org,p_workspace,p_next_status
  );
  PERFORM public.enterprise_ai_record_effect(
    p_receipt,p_org,p_workspace,p_execution_token,p_execution_fence,
    'approval.record','command',p_resource_id,p_result,'committed'
  );
  RETURN committed;
END;
$$;

CREATE OR REPLACE FUNCTION public.enterprise_commit_delivery_handoff(
  p_handoff JSONB,p_package JSONB,p_version JSONB,p_items JSONB,
  p_receipt UUID,p_execution_token UUID,p_execution_fence BIGINT,p_result JSONB
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE committed JSONB;
BEGIN
  committed:=public.enterprise_commit_delivery_handoff(p_handoff,p_package,p_version,p_items);
  PERFORM public.enterprise_ai_record_effect(
    p_receipt,(p_handoff->>'org_id')::uuid,(p_handoff->>'workspace_id')::uuid,
    p_execution_token,p_execution_fence,'studio.delivery.handoff','command',
    (p_package->>'id')::uuid,p_result,'committed'
  );
  RETURN committed;
END;
$$;

CREATE OR REPLACE FUNCTION public.enterprise_commit_monitor_baseline(
  p_baseline JSONB,p_actor UUID,p_org UUID,p_workspace UUID,
  p_receipt UUID,p_execution_token UUID,p_execution_fence BIGINT,p_result JSONB
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE committed JSONB;
BEGIN
  committed:=public.enterprise_commit_monitor_baseline(p_baseline,p_actor,p_org,p_workspace);
  PERFORM public.enterprise_ai_record_effect(
    p_receipt,p_org,p_workspace,p_execution_token,p_execution_fence,
    'monitor.baseline.create','command',(p_baseline->>'id')::uuid,p_result,'committed'
  );
  RETURN committed;
END;
$$;

CREATE OR REPLACE FUNCTION public.enterprise_commit_assemble_blueprint(
  p_blueprint JSONB,p_actor UUID,p_org UUID,p_workspace UUID,
  p_receipt UUID,p_execution_token UUID,p_execution_fence BIGINT,p_result JSONB
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE committed JSONB;
BEGIN
  committed:=public.enterprise_commit_assemble_blueprint(p_blueprint,p_actor,p_org,p_workspace);
  PERFORM public.enterprise_ai_record_effect(
    p_receipt,p_org,p_workspace,p_execution_token,p_execution_fence,
    'assemble.blueprint.create','command',(p_blueprint->>'id')::uuid,p_result,'committed'
  );
  RETURN committed;
END;
$$;

CREATE OR REPLACE FUNCTION public.enterprise_effect_journal_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'ENTERPRISE_AI_EFFECT_JOURNAL_IMMUTABLE';
END;
$$;
CREATE TRIGGER enterprise_effect_journal_immutable
BEFORE UPDATE OR DELETE ON public.enterprise_ai_effect_journal
FOR EACH ROW EXECUTE FUNCTION public.enterprise_effect_journal_guard();

REVOKE ALL ON FUNCTION
  public.enterprise_create_evidence_source(JSONB,JSONB,UUID,UUID,BIGINT,JSONB),
  public.enterprise_commit_evidence_extraction(UUID,UUID,UUID,UUID,TEXT,INTEGER,UUID,TEXT,TEXT,INTEGER,INTEGER,JSONB,UUID,UUID,BIGINT,JSONB),
  public.enterprise_review_evidence_candidate(UUID,UUID,UUID,TEXT,TEXT,TEXT,UUID,TEXT,TEXT,UUID,UUID,BIGINT,JSONB),
  public.enterprise_promote_evidence_to_assess_v2(UUID,UUID,BIGINT,UUID,UUID,UUID,UUID,TEXT,BIGINT,UUID,UUID,BIGINT,JSONB),
  public.enterprise_commit_modernization_assessment(JSONB,JSONB,UUID,UUID,BIGINT,JSONB),
  public.enterprise_record_high_impact_review(JSONB,UUID,UUID,BIGINT,JSONB),
  public.enterprise_commit_high_impact_approval(JSONB,TEXT,UUID,UUID,UUID,TEXT,UUID,UUID,BIGINT,JSONB),
  public.enterprise_commit_delivery_handoff(JSONB,JSONB,JSONB,JSONB,UUID,UUID,BIGINT,JSONB),
  public.enterprise_commit_monitor_baseline(JSONB,UUID,UUID,UUID,UUID,UUID,BIGINT,JSONB),
  public.enterprise_commit_assemble_blueprint(JSONB,UUID,UUID,UUID,UUID,UUID,BIGINT,JSONB)
FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION
  public.enterprise_create_evidence_source(JSONB,JSONB,UUID,UUID,BIGINT,JSONB),
  public.enterprise_commit_evidence_extraction(UUID,UUID,UUID,UUID,TEXT,INTEGER,UUID,TEXT,TEXT,INTEGER,INTEGER,JSONB,UUID,UUID,BIGINT,JSONB),
  public.enterprise_review_evidence_candidate(UUID,UUID,UUID,TEXT,TEXT,TEXT,UUID,TEXT,TEXT,UUID,UUID,BIGINT,JSONB),
  public.enterprise_promote_evidence_to_assess_v2(UUID,UUID,BIGINT,UUID,UUID,UUID,UUID,TEXT,BIGINT,UUID,UUID,BIGINT,JSONB),
  public.enterprise_commit_modernization_assessment(JSONB,JSONB,UUID,UUID,BIGINT,JSONB),
  public.enterprise_record_high_impact_review(JSONB,UUID,UUID,BIGINT,JSONB),
  public.enterprise_commit_high_impact_approval(JSONB,TEXT,UUID,UUID,UUID,TEXT,UUID,UUID,BIGINT,JSONB),
  public.enterprise_commit_delivery_handoff(JSONB,JSONB,JSONB,JSONB,UUID,UUID,BIGINT,JSONB),
  public.enterprise_commit_monitor_baseline(JSONB,UUID,UUID,UUID,UUID,UUID,BIGINT,JSONB),
  public.enterprise_commit_assemble_blueprint(JSONB,UUID,UUID,UUID,UUID,UUID,BIGINT,JSONB)
TO service_role;

-- The receipt-unaware implementations are private implementation details of
-- the receipt-aware SECURITY DEFINER overloads and are not callable by Edge.
REVOKE ALL ON FUNCTION
  public.enterprise_provider_lifecycle_transition(TEXT,UUID,UUID,UUID,BIGINT,JSONB),
  public.enterprise_create_evidence_source(JSONB,JSONB),
  public.enterprise_commit_evidence_extraction(UUID,UUID,UUID,UUID,TEXT,INTEGER,UUID,TEXT,TEXT,INTEGER,INTEGER,JSONB),
  public.enterprise_review_evidence_candidate(UUID,UUID,UUID,TEXT,TEXT,TEXT,UUID,TEXT,TEXT),
  public.enterprise_promote_evidence_to_assess_v2(UUID,UUID,BIGINT,UUID,UUID,UUID,UUID,TEXT,BIGINT),
  public.enterprise_commit_modernization_assessment(JSONB,JSONB),
  public.enterprise_commit_high_impact_approval(JSONB,TEXT,UUID,UUID,UUID,TEXT),
  public.enterprise_commit_delivery_handoff(JSONB,JSONB,JSONB,JSONB),
  public.enterprise_commit_monitor_baseline(JSONB,UUID,UUID,UUID),
  public.enterprise_commit_assemble_blueprint(JSONB,UUID,UUID,UUID)
FROM service_role;
