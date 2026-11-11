-- Focused Ready-review correction: extraction recovery keeps one immutable
-- route/provider/model plan and commits only a fenced sanitized staged result.
-- External provider attempts remain at-least-once across an unknowable crash.

ALTER TABLE public.enterprise_ai_job_ledger
  ADD COLUMN route_id UUID,
  ADD COLUMN endpoint_identity TEXT CHECK (endpoint_identity IS NULL OR length(endpoint_identity) BETWEEN 1 AND 2000),
  ADD COLUMN deployment_identity TEXT CHECK (deployment_identity IS NULL OR length(deployment_identity) BETWEEN 1 AND 240),
  ADD CONSTRAINT enterprise_ai_job_route_scope_fkey
    FOREIGN KEY (route_id, org_id, workspace_id)
    REFERENCES public.enterprise_ai_capability_routes(id, org_id, workspace_id) ON DELETE RESTRICT;

CREATE TABLE public.enterprise_ai_extraction_staged_results (
  job_id UUID PRIMARY KEY,
  receipt_id UUID NOT NULL UNIQUE REFERENCES public.enterprise_ai_command_receipts(id) ON DELETE RESTRICT,
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL,
  actor_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  source_id UUID NOT NULL,
  source_version_id UUID NOT NULL,
  route_id UUID NOT NULL,
  provider_config_id UUID NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('gemini','groq','openai','azure_openai','anthropic','openai_compatible')),
  model TEXT NOT NULL CHECK (length(btrim(model)) BETWEEN 1 AND 200),
  request_hash TEXT NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  output_hash TEXT NOT NULL CHECK (output_hash ~ '^[0-9a-f]{64}$'),
  latency_ms INTEGER NOT NULL CHECK (latency_ms >= 0),
  token_input INTEGER NOT NULL CHECK (token_input >= 0),
  token_output INTEGER NOT NULL CHECK (token_output >= 0),
  candidates JSONB NOT NULL CHECK (jsonb_typeof(candidates)='array' AND jsonb_array_length(candidates)<=200),
  safe_result JSONB NOT NULL CHECK (jsonb_typeof(safe_result)='object'),
  staged_payload_hash TEXT NOT NULL CHECK (staged_payload_hash ~ '^[0-9a-f]{64}$'),
  execution_token UUID NOT NULL,
  execution_fence BIGINT NOT NULL CHECK (execution_fence > 0),
  staged_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT enterprise_ai_stage_job_scope_fkey
    FOREIGN KEY (job_id, org_id) REFERENCES public.enterprise_ai_job_ledger(id, org_id) ON DELETE RESTRICT,
  CONSTRAINT enterprise_ai_stage_workspace_org_fkey
    FOREIGN KEY (workspace_id, org_id) REFERENCES public.workspaces(id, org_id) ON DELETE CASCADE,
  CONSTRAINT enterprise_ai_stage_source_scope_fkey
    FOREIGN KEY (source_id, org_id, workspace_id)
    REFERENCES public.enterprise_evidence_sources(id, org_id, workspace_id) ON DELETE RESTRICT,
  CONSTRAINT enterprise_ai_stage_source_version_scope_fkey
    FOREIGN KEY (source_version_id, source_id, org_id, workspace_id)
    REFERENCES public.enterprise_evidence_source_versions(id, source_id, org_id, workspace_id) ON DELETE RESTRICT,
  CONSTRAINT enterprise_ai_stage_route_scope_fkey
    FOREIGN KEY (route_id, org_id, workspace_id)
    REFERENCES public.enterprise_ai_capability_routes(id, org_id, workspace_id) ON DELETE RESTRICT,
  CONSTRAINT enterprise_ai_stage_provider_scope_fkey
    FOREIGN KEY (provider_config_id, org_id)
    REFERENCES public.ai_provider_configs(id, org_id) ON DELETE RESTRICT
);

ALTER TABLE public.enterprise_ai_extraction_staged_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enterprise_ai_extraction_staged_results FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.enterprise_ai_extraction_staged_results FROM PUBLIC,anon,authenticated;
GRANT SELECT ON TABLE public.enterprise_ai_extraction_staged_results TO service_role;

CREATE OR REPLACE FUNCTION public.enterprise_extraction_stage_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'ENTERPRISE_AI_EXTRACTION_STAGE_IMMUTABLE';
END;
$$;
CREATE TRIGGER enterprise_extraction_stage_immutable
BEFORE UPDATE OR DELETE ON public.enterprise_ai_extraction_staged_results
FOR EACH ROW EXECUTE FUNCTION public.enterprise_extraction_stage_immutable();

CREATE OR REPLACE FUNCTION public.enterprise_claim_or_resume_evidence_extraction_job_v2(
  p_job_id UUID,p_receipt UUID,p_org UUID,p_workspace UUID,p_actor UUID,
  p_source_id UUID,p_source_version_id UUID,p_route_id UUID,p_provider_config_id UUID,
  p_provider TEXT,p_capability TEXT,p_model TEXT,p_endpoint_identity TEXT,p_deployment_identity TEXT,
  p_prompt_key TEXT,p_prompt_version TEXT,p_request_hash TEXT,
  p_execution_token UUID,p_execution_fence BIGINT
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  receipt public.enterprise_ai_command_receipts;
  job public.enterprise_ai_job_ledger;
  effect public.enterprise_ai_effect_journal;
  stage public.enterprise_ai_extraction_staged_results;
  inserted BOOLEAN:=false;
  lease_until TIMESTAMPTZ:=statement_timestamp()+interval '2 minutes';
BEGIN
  IF p_job_id IS NULL OR p_receipt IS NULL OR p_org IS NULL OR p_workspace IS NULL OR p_actor IS NULL
     OR p_source_id IS NULL OR p_source_version_id IS NULL OR p_route_id IS NULL OR p_provider_config_id IS NULL
     OR p_execution_token IS NULL OR p_execution_fence IS NULL OR p_execution_fence<1
     OR p_capability<>'assess.evidence.extract'
     OR p_provider NOT IN ('gemini','groq','openai','azure_openai','anthropic','openai_compatible')
     OR length(btrim(COALESCE(p_model,''))) NOT BETWEEN 1 AND 200
     OR length(btrim(COALESCE(p_prompt_key,''))) NOT BETWEEN 1 AND 200
     OR length(btrim(COALESCE(p_prompt_version,''))) NOT BETWEEN 1 AND 120
     OR (p_endpoint_identity IS NOT NULL AND length(p_endpoint_identity) NOT BETWEEN 1 AND 2000)
     OR (p_deployment_identity IS NOT NULL AND length(p_deployment_identity) NOT BETWEEN 1 AND 240)
     OR p_request_hash IS NULL OR p_request_hash!~'^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'ENTERPRISE_AI_JOB_INVALID';
  END IF;

  SELECT * INTO receipt FROM public.enterprise_ai_command_receipts
  WHERE id=p_receipt AND org_id=p_org AND workspace_id=p_workspace FOR UPDATE;
  IF receipt.id IS NULL OR receipt.command_type<>'evidence.extract'
     OR receipt.actor_id IS DISTINCT FROM p_actor OR receipt.request_hash IS DISTINCT FROM p_request_hash THEN
    RAISE EXCEPTION 'ENTERPRISE_AI_JOB_RESOURCE_STALE';
  END IF;
  IF receipt.status='claimed' AND (
       receipt.execution_token IS DISTINCT FROM p_execution_token
       OR receipt.execution_fence IS DISTINCT FROM p_execution_fence
     ) THEN RAISE EXCEPTION 'ENTERPRISE_AI_STALE_EXECUTION_FENCE';
  ELSIF receipt.status NOT IN ('claimed','committed','failed','blocked') THEN
    RAISE EXCEPTION 'ENTERPRISE_AI_COMMAND_NOT_EXECUTABLE';
  END IF;
  IF receipt.execution_plan->>'jobId' IS DISTINCT FROM p_job_id::text
     OR receipt.execution_plan->>'organizationId' IS DISTINCT FROM p_org::text
     OR receipt.execution_plan->>'workspaceId' IS DISTINCT FROM p_workspace::text
     OR receipt.execution_plan->>'sourceId' IS DISTINCT FROM p_source_id::text
     OR receipt.execution_plan->>'sourceVersionId' IS DISTINCT FROM p_source_version_id::text
     OR receipt.execution_plan->>'routeId' IS DISTINCT FROM p_route_id::text
     OR receipt.execution_plan->>'providerConfigId' IS DISTINCT FROM p_provider_config_id::text
     OR receipt.execution_plan->>'provider' IS DISTINCT FROM p_provider
     OR receipt.execution_plan->>'capability' IS DISTINCT FROM p_capability
     OR receipt.execution_plan->>'model' IS DISTINCT FROM p_model
     OR COALESCE(receipt.execution_plan->>'endpointIdentity','') IS DISTINCT FROM COALESCE(p_endpoint_identity,'')
     OR COALESCE(receipt.execution_plan->>'deploymentIdentity','') IS DISTINCT FROM COALESCE(p_deployment_identity,'')
     OR receipt.execution_plan->>'promptKey' IS DISTINCT FROM p_prompt_key
     OR receipt.execution_plan->>'promptVersion' IS DISTINCT FROM p_prompt_version
     OR receipt.execution_plan->>'requestHash' IS DISTINCT FROM p_request_hash THEN
    RAISE EXCEPTION 'ENTERPRISE_AI_JOB_IDEMPOTENCY_CONFLICT';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.enterprise_evidence_source_versions
    WHERE id=p_source_version_id AND source_id=p_source_id AND org_id=p_org AND workspace_id=p_workspace
  ) OR NOT EXISTS (
    SELECT 1 FROM public.enterprise_ai_capability_routes
    WHERE id=p_route_id AND provider_config_id=p_provider_config_id
      AND org_id=p_org AND workspace_id=p_workspace AND capability=p_capability
  ) THEN RAISE EXCEPTION 'ENTERPRISE_AI_JOB_RESOURCE_STALE'; END IF;

  SELECT * INTO job FROM public.enterprise_ai_job_ledger
  WHERE id=p_job_id OR receipt_id=p_receipt FOR UPDATE;
  IF job.id IS NULL THEN
    INSERT INTO public.enterprise_ai_job_ledger(
      id,org_id,workspace_id,capability,route_id,provider_config_id,provider,model,
      endpoint_identity,deployment_identity,prompt_key,prompt_version,source_refs,actor_id,
      request_id,idempotency_key,status,approval_state,receipt_id,source_id,source_version_id,
      request_hash,execution_token,execution_fence,attempt_lease_expires_at,
      attempt_count,recovery_count,last_attempt_at
    ) VALUES (
      p_job_id,p_org,p_workspace,p_capability,p_route_id,p_provider_config_id,p_provider,p_model,
      p_endpoint_identity,p_deployment_identity,p_prompt_key,p_prompt_version,
      jsonb_build_array(p_source_id,p_source_version_id),p_actor,receipt.initial_request_id,receipt.id::text,
      'running','review_required',p_receipt,p_source_id,p_source_version_id,p_request_hash,
      p_execution_token,p_execution_fence,lease_until,1,0,statement_timestamp()
    ) ON CONFLICT DO NOTHING RETURNING * INTO job;
    inserted:=job.id IS NOT NULL;
    IF job.id IS NULL THEN
      SELECT * INTO job FROM public.enterprise_ai_job_ledger
      WHERE id=p_job_id OR receipt_id=p_receipt FOR UPDATE;
    END IF;
  END IF;
  IF job.id IS NULL OR job.id IS DISTINCT FROM p_job_id OR job.receipt_id IS DISTINCT FROM p_receipt
     OR job.org_id IS DISTINCT FROM p_org OR job.workspace_id IS DISTINCT FROM p_workspace
     OR job.actor_id IS DISTINCT FROM p_actor OR job.source_id IS DISTINCT FROM p_source_id
     OR job.source_version_id IS DISTINCT FROM p_source_version_id OR job.route_id IS DISTINCT FROM p_route_id
     OR job.provider_config_id IS DISTINCT FROM p_provider_config_id OR job.provider IS DISTINCT FROM p_provider
     OR job.capability IS DISTINCT FROM p_capability OR job.model IS DISTINCT FROM p_model
     OR COALESCE(job.endpoint_identity,'') IS DISTINCT FROM COALESCE(p_endpoint_identity,'')
     OR COALESCE(job.deployment_identity,'') IS DISTINCT FROM COALESCE(p_deployment_identity,'')
     OR job.prompt_key IS DISTINCT FROM p_prompt_key OR job.prompt_version IS DISTINCT FROM p_prompt_version
     OR job.request_hash IS DISTINCT FROM p_request_hash THEN
    RAISE EXCEPTION 'ENTERPRISE_AI_JOB_IDEMPOTENCY_CONFLICT';
  END IF;

  SELECT * INTO effect FROM public.enterprise_ai_effect_journal
  WHERE receipt_id=p_receipt AND effect_key='command' FOR SHARE;
  IF effect.id IS NOT NULL AND effect.terminal_status='committed' THEN
    IF effect.operation_type<>'evidence.extract' OR effect.resource_id IS DISTINCT FROM p_job_id THEN
      RAISE EXCEPTION 'ENTERPRISE_AI_JOB_RESOURCE_STALE';
    END IF;
    RETURN jsonb_build_object('state','committed','ownsExecution',false,'jobId',job.id,
      'attemptCount',job.attempt_count,'recoveryCount',job.recovery_count,'safeResult',effect.safe_result);
  END IF;
  IF job.status IN ('succeeded','failed','blocked') THEN
    IF job.status='succeeded' THEN RAISE EXCEPTION 'ENTERPRISE_AI_JOB_RESOURCE_STALE'; END IF;
    IF effect.id IS NULL OR effect.operation_type<>'evidence.extract'
       OR effect.resource_id IS NOT NULL OR effect.terminal_status IS DISTINCT FROM job.status THEN
      RAISE EXCEPTION 'ENTERPRISE_AI_JOB_RESOURCE_STALE';
    END IF;
    RETURN jsonb_build_object('state',job.status,'ownsExecution',false,'jobId',job.id,
      'attemptCount',job.attempt_count,'recoveryCount',job.recovery_count,'safeResult',effect.safe_result);
  END IF;
  IF receipt.status<>'claimed' OR job.status<>'running' THEN
    RAISE EXCEPTION 'ENTERPRISE_AI_COMMAND_NOT_EXECUTABLE';
  END IF;
  SELECT * INTO stage FROM public.enterprise_ai_extraction_staged_results
  WHERE job_id=p_job_id AND receipt_id=p_receipt FOR SHARE;

  IF inserted THEN
    INSERT INTO public.enterprise_ai_job_attempts(
      job_id,receipt_id,org_id,workspace_id,actor_id,execution_token,execution_fence,
      attempt_number,attempt_kind,lease_expires_at
    ) VALUES (job.id,p_receipt,p_org,p_workspace,p_actor,p_execution_token,p_execution_fence,1,'claimed',lease_until);
  ELSIF job.execution_token IS NOT DISTINCT FROM p_execution_token
        AND job.execution_fence IS NOT DISTINCT FROM p_execution_fence
        AND job.attempt_lease_expires_at>statement_timestamp() THEN
    NULL;
  ELSIF job.attempt_lease_expires_at>statement_timestamp() THEN
    RAISE EXCEPTION 'ENTERPRISE_AI_JOB_IN_PROGRESS';
  ELSIF p_execution_fence<=job.execution_fence THEN
    RAISE EXCEPTION 'ENTERPRISE_AI_STALE_EXECUTION_FENCE';
  ELSE
    UPDATE public.enterprise_ai_job_ledger SET
      execution_token=p_execution_token,execution_fence=p_execution_fence,
      attempt_lease_expires_at=lease_until,attempt_count=attempt_count+1,
      recovery_count=recovery_count+1,last_attempt_at=statement_timestamp()
    WHERE id=job.id AND status='running' AND execution_fence=job.execution_fence
      AND attempt_lease_expires_at<=statement_timestamp()
    RETURNING * INTO job;
    IF job.id IS NULL THEN RAISE EXCEPTION 'ENTERPRISE_AI_JOB_IN_PROGRESS'; END IF;
    INSERT INTO public.enterprise_ai_job_attempts(
      job_id,receipt_id,org_id,workspace_id,actor_id,execution_token,execution_fence,
      attempt_number,attempt_kind,lease_expires_at
    ) VALUES (job.id,p_receipt,p_org,p_workspace,p_actor,p_execution_token,p_execution_fence,
      job.attempt_count,'resumed',lease_until);
  END IF;
  IF stage.job_id IS NOT NULL THEN
    RETURN jsonb_build_object('state','staged','ownsExecution',true,'jobId',job.id,
      'attemptCount',job.attempt_count,'recoveryCount',job.recovery_count,'safeResult',stage.safe_result);
  END IF;
  RETURN jsonb_build_object('state','owned','ownsExecution',true,'jobId',job.id,
    'attemptCount',job.attempt_count,'recoveryCount',job.recovery_count);
END;
$$;

CREATE OR REPLACE FUNCTION public.enterprise_stage_evidence_extraction_result(
  p_job_id UUID,p_receipt UUID,p_source_id UUID,p_source_version_id UUID,
  p_org UUID,p_workspace UUID,p_route_id UUID,p_provider_config_id UUID,
  p_provider TEXT,p_model TEXT,p_request_hash TEXT,p_output_hash TEXT,
  p_latency_ms INTEGER,p_token_input INTEGER,p_token_output INTEGER,
  p_candidates JSONB,p_result JSONB,p_staged_payload_hash TEXT,
  p_execution_token UUID,p_execution_fence BIGINT
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  receipt public.enterprise_ai_command_receipts;
  job public.enterprise_ai_job_ledger;
  stage public.enterprise_ai_extraction_staged_results;
  serialized TEXT;
BEGIN
  IF p_job_id IS NULL OR p_receipt IS NULL OR p_source_id IS NULL OR p_source_version_id IS NULL
     OR p_org IS NULL OR p_workspace IS NULL OR p_route_id IS NULL OR p_provider_config_id IS NULL
     OR p_execution_token IS NULL OR p_execution_fence IS NULL OR p_execution_fence<1
     OR p_provider NOT IN ('gemini','groq','openai','azure_openai','anthropic','openai_compatible')
     OR length(btrim(COALESCE(p_model,''))) NOT BETWEEN 1 AND 200
     OR p_request_hash!~'^[0-9a-f]{64}$' OR p_output_hash!~'^[0-9a-f]{64}$'
     OR p_staged_payload_hash!~'^[0-9a-f]{64}$' OR p_latency_ms<0
     OR p_token_input<0 OR p_token_output<0 OR jsonb_typeof(p_candidates)<>'array'
     OR jsonb_array_length(p_candidates)>200 OR jsonb_typeof(p_result)<>'object'
     OR p_result->>'resourceId' IS DISTINCT FROM p_job_id::text
     OR p_result->>'jobId' IS DISTINCT FROM p_job_id::text
     OR p_result->>'sourceId' IS DISTINCT FROM p_source_id::text
     OR p_result->>'sourceVersionId' IS DISTINCT FROM p_source_version_id::text THEN
    RAISE EXCEPTION 'ENTERPRISE_AI_JOB_INVALID';
  END IF;
  serialized:=p_candidates::text||p_result::text;
  IF serialized ~* '"(rawPrompt|promptBody|rawCompletion|completionBody|providerKey|apiKey|authorizationHeader|secretReference|sourceText)"[[:space:]]*:' THEN
    RAISE EXCEPTION 'ENTERPRISE_AI_JOB_INVALID';
  END IF;
  SELECT * INTO receipt FROM public.enterprise_ai_command_receipts
  WHERE id=p_receipt AND org_id=p_org AND workspace_id=p_workspace FOR UPDATE;
  SELECT * INTO job FROM public.enterprise_ai_job_ledger
  WHERE id=p_job_id AND receipt_id=p_receipt AND org_id=p_org AND workspace_id=p_workspace FOR UPDATE;
  IF receipt.id IS NULL OR job.id IS NULL OR receipt.status<>'claimed' OR job.status<>'running'
     OR receipt.execution_token IS DISTINCT FROM p_execution_token
     OR receipt.execution_fence IS DISTINCT FROM p_execution_fence
     OR job.execution_token IS DISTINCT FROM p_execution_token
     OR job.execution_fence IS DISTINCT FROM p_execution_fence THEN
    RAISE EXCEPTION 'ENTERPRISE_AI_STALE_EXECUTION_FENCE';
  END IF;
  IF receipt.request_hash IS DISTINCT FROM p_request_hash OR job.request_hash IS DISTINCT FROM p_request_hash
     OR job.source_id IS DISTINCT FROM p_source_id OR job.source_version_id IS DISTINCT FROM p_source_version_id
     OR job.route_id IS DISTINCT FROM p_route_id OR job.provider_config_id IS DISTINCT FROM p_provider_config_id
     OR job.provider IS DISTINCT FROM p_provider OR job.model IS DISTINCT FROM p_model THEN
    RAISE EXCEPTION 'ENTERPRISE_AI_JOB_IDEMPOTENCY_CONFLICT';
  END IF;
  SELECT * INTO stage FROM public.enterprise_ai_extraction_staged_results
  WHERE job_id=p_job_id OR receipt_id=p_receipt FOR SHARE;
  IF stage.job_id IS NOT NULL THEN
    IF stage.job_id IS DISTINCT FROM p_job_id OR stage.receipt_id IS DISTINCT FROM p_receipt
       OR stage.staged_payload_hash IS DISTINCT FROM p_staged_payload_hash THEN
      RAISE EXCEPTION 'ENTERPRISE_AI_JOB_IDEMPOTENCY_CONFLICT';
    END IF;
    RETURN stage.safe_result;
  END IF;
  INSERT INTO public.enterprise_ai_extraction_staged_results(
    job_id,receipt_id,org_id,workspace_id,actor_id,source_id,source_version_id,
    route_id,provider_config_id,provider,model,request_hash,output_hash,latency_ms,
    token_input,token_output,candidates,safe_result,staged_payload_hash,execution_token,execution_fence
  ) VALUES (
    p_job_id,p_receipt,p_org,p_workspace,receipt.actor_id,p_source_id,p_source_version_id,
    p_route_id,p_provider_config_id,p_provider,p_model,p_request_hash,p_output_hash,p_latency_ms,
    p_token_input,p_token_output,p_candidates,p_result,p_staged_payload_hash,p_execution_token,p_execution_fence
  );
  RETURN p_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.enterprise_commit_staged_evidence_extraction(
  p_job_id UUID,p_receipt UUID,p_org UUID,p_workspace UUID,
  p_execution_token UUID,p_execution_fence BIGINT
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  receipt public.enterprise_ai_command_receipts;
  job public.enterprise_ai_job_ledger;
  stage public.enterprise_ai_extraction_staged_results;
  effect public.enterprise_ai_effect_journal;
  committed JSONB;
BEGIN
  SELECT * INTO receipt FROM public.enterprise_ai_command_receipts
  WHERE id=p_receipt AND org_id=p_org AND workspace_id=p_workspace FOR UPDATE;
  SELECT * INTO job FROM public.enterprise_ai_job_ledger
  WHERE id=p_job_id AND receipt_id=p_receipt AND org_id=p_org AND workspace_id=p_workspace FOR UPDATE;
  SELECT * INTO effect FROM public.enterprise_ai_effect_journal
  WHERE receipt_id=p_receipt AND effect_key='command' FOR SHARE;
  IF effect.id IS NOT NULL THEN
    IF effect.operation_type<>'evidence.extract' OR effect.resource_id IS DISTINCT FROM p_job_id
       OR effect.terminal_status<>'committed' THEN RAISE EXCEPTION 'ENTERPRISE_AI_JOB_RESOURCE_STALE'; END IF;
    RETURN effect.safe_result;
  END IF;
  SELECT * INTO stage FROM public.enterprise_ai_extraction_staged_results
  WHERE job_id=p_job_id AND receipt_id=p_receipt FOR SHARE;
  IF receipt.id IS NULL OR job.id IS NULL OR stage.job_id IS NULL
     OR receipt.status<>'claimed' OR job.status<>'running'
     OR receipt.execution_token IS DISTINCT FROM p_execution_token
     OR receipt.execution_fence IS DISTINCT FROM p_execution_fence
     OR job.execution_token IS DISTINCT FROM p_execution_token
     OR job.execution_fence IS DISTINCT FROM p_execution_fence THEN
    RAISE EXCEPTION 'ENTERPRISE_AI_STALE_EXECUTION_FENCE';
  END IF;
  IF receipt.request_hash IS DISTINCT FROM stage.request_hash
     OR job.request_hash IS DISTINCT FROM stage.request_hash
     OR job.source_id IS DISTINCT FROM stage.source_id
     OR job.source_version_id IS DISTINCT FROM stage.source_version_id
     OR job.route_id IS DISTINCT FROM stage.route_id
     OR job.provider_config_id IS DISTINCT FROM stage.provider_config_id
     OR job.provider IS DISTINCT FROM stage.provider OR job.model IS DISTINCT FROM stage.model THEN
    RAISE EXCEPTION 'ENTERPRISE_AI_JOB_IDEMPOTENCY_CONFLICT';
  END IF;
  committed:=public.enterprise_commit_evidence_extraction(
    stage.job_id,stage.source_id,stage.org_id,stage.workspace_id,stage.output_hash,stage.latency_ms,
    stage.provider_config_id,stage.provider,stage.model,stage.token_input,stage.token_output,stage.candidates
  );
  PERFORM public.enterprise_ai_record_effect(
    p_receipt,p_org,p_workspace,p_execution_token,p_execution_fence,
    'evidence.extract','command',p_job_id,stage.safe_result,'committed'
  );
  RETURN stage.safe_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION
  public.enterprise_claim_or_resume_evidence_extraction_job(UUID,UUID,UUID,UUID,UUID,UUID,UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,UUID,BIGINT),
  public.enterprise_commit_evidence_extraction(UUID,UUID,UUID,UUID,TEXT,INTEGER,UUID,TEXT,TEXT,INTEGER,INTEGER,JSONB),
  public.enterprise_commit_evidence_extraction(UUID,UUID,UUID,UUID,TEXT,INTEGER,UUID,TEXT,TEXT,INTEGER,INTEGER,JSONB,UUID,UUID,BIGINT,JSONB)
FROM service_role;
REVOKE ALL ON FUNCTION
  public.enterprise_claim_or_resume_evidence_extraction_job_v2(UUID,UUID,UUID,UUID,UUID,UUID,UUID,UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,UUID,BIGINT),
  public.enterprise_stage_evidence_extraction_result(UUID,UUID,UUID,UUID,UUID,UUID,UUID,UUID,TEXT,TEXT,TEXT,TEXT,INTEGER,INTEGER,INTEGER,JSONB,JSONB,TEXT,UUID,BIGINT),
  public.enterprise_commit_staged_evidence_extraction(UUID,UUID,UUID,UUID,UUID,BIGINT)
FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION
  public.enterprise_claim_or_resume_evidence_extraction_job_v2(UUID,UUID,UUID,UUID,UUID,UUID,UUID,UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,UUID,BIGINT),
  public.enterprise_stage_evidence_extraction_result(UUID,UUID,UUID,UUID,UUID,UUID,UUID,UUID,TEXT,TEXT,TEXT,TEXT,INTEGER,INTEGER,INTEGER,JSONB,JSONB,TEXT,UUID,BIGINT),
  public.enterprise_commit_staged_evidence_extraction(UUID,UUID,UUID,UUID,UUID,BIGINT)
TO service_role;

COMMENT ON FUNCTION public.enterprise_claim_or_resume_evidence_extraction_job_v2(UUID,UUID,UUID,UUID,UUID,UUID,UUID,UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,UUID,BIGINT)
IS 'Service-only fenced extraction recovery using the receipt-owned immutable route/provider/model plan and staged-result-first reconciliation.';
COMMENT ON TABLE public.enterprise_ai_extraction_staged_results
IS 'Service-only immutable sanitized extraction results. Raw prompts, source text, provider completions, credentials, headers, and secret references are prohibited.';
