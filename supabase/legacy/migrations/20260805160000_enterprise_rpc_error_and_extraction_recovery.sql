-- Ready-review correction: bind evidence extraction attempts to the durable
-- command receipt and make lease-expiry recovery resume one stable job row.
-- Provider invocation remains at-least-once across a process crash; this
-- contract provides fenced ownership, not an unsupported exactly-once claim.

ALTER TABLE public.enterprise_ai_job_ledger
  ADD COLUMN receipt_id UUID REFERENCES public.enterprise_ai_command_receipts(id) ON DELETE RESTRICT,
  ADD COLUMN source_id UUID,
  ADD COLUMN source_version_id UUID,
  ADD COLUMN request_hash TEXT CHECK (request_hash IS NULL OR request_hash ~ '^[0-9a-f]{64}$'),
  ADD COLUMN execution_token UUID,
  ADD COLUMN execution_fence BIGINT CHECK (execution_fence IS NULL OR execution_fence > 0),
  ADD COLUMN attempt_lease_expires_at TIMESTAMPTZ,
  ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  ADD COLUMN recovery_count INTEGER NOT NULL DEFAULT 0 CHECK (recovery_count >= 0),
  ADD COLUMN last_attempt_at TIMESTAMPTZ,
  ADD CONSTRAINT enterprise_ai_job_source_scope_fkey
    FOREIGN KEY (source_id, org_id, workspace_id)
    REFERENCES public.enterprise_evidence_sources(id, org_id, workspace_id) ON DELETE RESTRICT,
  ADD CONSTRAINT enterprise_ai_job_source_version_scope_fkey
    FOREIGN KEY (source_version_id, source_id, org_id, workspace_id)
    REFERENCES public.enterprise_evidence_source_versions(id, source_id, org_id, workspace_id) ON DELETE RESTRICT,
  ADD CONSTRAINT enterprise_ai_job_receipt_unique UNIQUE (receipt_id);

CREATE TABLE public.enterprise_ai_job_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL,
  receipt_id UUID NOT NULL REFERENCES public.enterprise_ai_command_receipts(id) ON DELETE RESTRICT,
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL,
  actor_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  execution_token UUID NOT NULL,
  execution_fence BIGINT NOT NULL CHECK (execution_fence > 0),
  attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
  attempt_kind TEXT NOT NULL CHECK (attempt_kind IN ('claimed','resumed')),
  lease_expires_at TIMESTAMPTZ NOT NULL,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT enterprise_ai_job_attempt_job_org_fkey
    FOREIGN KEY (job_id, org_id) REFERENCES public.enterprise_ai_job_ledger(id, org_id) ON DELETE RESTRICT,
  CONSTRAINT enterprise_ai_job_attempt_workspace_org_fkey
    FOREIGN KEY (workspace_id, org_id) REFERENCES public.workspaces(id, org_id) ON DELETE CASCADE,
  UNIQUE (job_id, execution_fence),
  UNIQUE (job_id, attempt_number)
);

ALTER TABLE public.enterprise_ai_job_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enterprise_ai_job_attempts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.enterprise_ai_job_attempts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.enterprise_ai_job_attempts TO service_role;

CREATE OR REPLACE FUNCTION public.enterprise_job_attempt_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'ENTERPRISE_AI_JOB_ATTEMPT_IMMUTABLE';
END;
$$;
CREATE TRIGGER enterprise_ai_job_attempt_immutable
BEFORE UPDATE OR DELETE ON public.enterprise_ai_job_attempts
FOR EACH ROW EXECUTE FUNCTION public.enterprise_job_attempt_guard();

CREATE OR REPLACE FUNCTION public.enterprise_job_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'ENTERPRISE_AI_JOB_IMMUTABLE_OR_TRANSITION_INVALID'; END IF;

  -- Provider retirement may null only its retained lineage reference.
  IF OLD.provider_config_id IS NOT NULL AND NEW.provider_config_id IS NULL
     AND NEW.status=OLD.status
     AND (to_jsonb(NEW)-'provider_config_id') IS NOT DISTINCT FROM (to_jsonb(OLD)-'provider_config_id') THEN
    RETURN NEW;
  END IF;

  -- One expired running attempt may be resumed only by a newer receipt fence.
  IF OLD.status='running' AND NEW.status='running'
     AND (to_jsonb(NEW)-ARRAY['execution_token','execution_fence','attempt_lease_expires_at','attempt_count','recovery_count','last_attempt_at'])
       IS NOT DISTINCT FROM
       (to_jsonb(OLD)-ARRAY['execution_token','execution_fence','attempt_lease_expires_at','attempt_count','recovery_count','last_attempt_at'])
     AND OLD.attempt_lease_expires_at<=statement_timestamp()
     AND NEW.execution_fence>OLD.execution_fence
     AND NEW.attempt_count=OLD.attempt_count+1
     AND NEW.recovery_count=OLD.recovery_count+1
     AND NEW.last_attempt_at IS NOT NULL
     AND NEW.attempt_lease_expires_at>NEW.last_attempt_at THEN
    RETURN NEW;
  END IF;

  -- The existing atomic commit and the service-only failure function retain
  -- sole terminal transition authority.
  IF OLD.status='running' AND NEW.status IN ('succeeded','failed','blocked')
     AND (to_jsonb(NEW)-ARRAY['status','token_input','token_output','latency_ms','failure_class','output_hash','completed_at'])
       IS NOT DISTINCT FROM
       (to_jsonb(OLD)-ARRAY['status','token_input','token_output','latency_ms','failure_class','output_hash','completed_at'])
     AND NEW.completed_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'ENTERPRISE_AI_JOB_IMMUTABLE_OR_TRANSITION_INVALID';
END;
$$;

CREATE OR REPLACE FUNCTION public.enterprise_claim_or_resume_evidence_extraction_job(
  p_job_id UUID,p_receipt UUID,p_org UUID,p_workspace UUID,p_actor UUID,
  p_source_id UUID,p_source_version_id UUID,p_provider_config_id UUID,
  p_provider TEXT,p_capability TEXT,p_model TEXT,p_prompt_key TEXT,p_prompt_version TEXT,
  p_request_hash TEXT,p_execution_token UUID,p_execution_fence BIGINT
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  receipt public.enterprise_ai_command_receipts;
  job public.enterprise_ai_job_ledger;
  effect public.enterprise_ai_effect_journal;
  inserted BOOLEAN:=false;
  lease_until TIMESTAMPTZ:=statement_timestamp()+interval '2 minutes';
BEGIN
  IF p_job_id IS NULL OR p_receipt IS NULL OR p_org IS NULL OR p_workspace IS NULL OR p_actor IS NULL
     OR p_source_id IS NULL OR p_source_version_id IS NULL OR p_provider_config_id IS NULL
     OR p_execution_token IS NULL OR p_execution_fence IS NULL OR p_execution_fence<1
     OR p_capability<>'assess.evidence.extract'
     OR p_provider NOT IN ('gemini','groq','openai','azure_openai','anthropic','openai_compatible')
     OR length(btrim(COALESCE(p_model,''))) NOT BETWEEN 1 AND 200
     OR length(btrim(COALESCE(p_prompt_key,''))) NOT BETWEEN 1 AND 200
     OR length(btrim(COALESCE(p_prompt_version,''))) NOT BETWEEN 1 AND 120
     OR p_request_hash IS NULL OR p_request_hash!~'^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'ENTERPRISE_AI_JOB_INVALID';
  END IF;

  SELECT * INTO receipt FROM public.enterprise_ai_command_receipts
  WHERE id=p_receipt AND org_id=p_org AND workspace_id=p_workspace FOR UPDATE;
  IF receipt.id IS NULL OR receipt.command_type<>'evidence.extract'
     OR receipt.actor_id IS DISTINCT FROM p_actor
     OR receipt.request_hash IS DISTINCT FROM p_request_hash THEN
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
     OR receipt.execution_plan->>'sourceId' IS DISTINCT FROM p_source_id::text
     OR receipt.execution_plan->>'sourceVersionId' IS DISTINCT FROM p_source_version_id::text
     OR receipt.execution_plan->>'providerConfigId' IS DISTINCT FROM p_provider_config_id::text
     OR receipt.execution_plan->>'provider' IS DISTINCT FROM p_provider
     OR receipt.execution_plan->>'capability' IS DISTINCT FROM p_capability
     OR receipt.execution_plan->>'model' IS DISTINCT FROM p_model
     OR receipt.execution_plan->>'promptKey' IS DISTINCT FROM p_prompt_key
     OR receipt.execution_plan->>'promptVersion' IS DISTINCT FROM p_prompt_version
     OR receipt.execution_plan->>'requestHash' IS DISTINCT FROM p_request_hash THEN
    RAISE EXCEPTION 'ENTERPRISE_AI_JOB_IDEMPOTENCY_CONFLICT';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.enterprise_evidence_source_versions
    WHERE id=p_source_version_id AND source_id=p_source_id AND org_id=p_org AND workspace_id=p_workspace
  ) THEN RAISE EXCEPTION 'ENTERPRISE_AI_JOB_RESOURCE_STALE'; END IF;

  SELECT * INTO job FROM public.enterprise_ai_job_ledger
  WHERE id=p_job_id OR receipt_id=p_receipt FOR UPDATE;
  IF job.id IS NULL THEN
    INSERT INTO public.enterprise_ai_job_ledger(
      id,org_id,workspace_id,capability,provider_config_id,provider,model,prompt_key,prompt_version,
      source_refs,actor_id,request_id,idempotency_key,status,approval_state,receipt_id,source_id,
      source_version_id,request_hash,execution_token,execution_fence,attempt_lease_expires_at,
      attempt_count,recovery_count,last_attempt_at
    ) VALUES (
      p_job_id,p_org,p_workspace,p_capability,p_provider_config_id,p_provider,p_model,p_prompt_key,p_prompt_version,
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
     OR job.source_version_id IS DISTINCT FROM p_source_version_id
     OR job.provider_config_id IS DISTINCT FROM p_provider_config_id OR job.provider IS DISTINCT FROM p_provider
     OR job.capability IS DISTINCT FROM p_capability OR job.model IS DISTINCT FROM p_model
     OR job.prompt_key IS DISTINCT FROM p_prompt_key OR job.prompt_version IS DISTINCT FROM p_prompt_version
     OR job.request_hash IS DISTINCT FROM p_request_hash THEN
    RAISE EXCEPTION 'ENTERPRISE_AI_JOB_IDEMPOTENCY_CONFLICT';
  END IF;

  IF job.status IN ('succeeded','failed','blocked') THEN
    SELECT * INTO effect FROM public.enterprise_ai_effect_journal
    WHERE receipt_id=p_receipt AND effect_key='command' FOR SHARE;
    IF effect.id IS NULL
       OR (job.status='succeeded' AND (
         effect.resource_id IS DISTINCT FROM p_job_id OR effect.terminal_status<>'committed'
       ))
       OR (job.status IN ('failed','blocked') AND (
         effect.resource_id IS NOT NULL OR effect.terminal_status IS DISTINCT FROM job.status
       )) THEN
      RAISE EXCEPTION 'ENTERPRISE_AI_JOB_RESOURCE_STALE';
    END IF;
    RETURN jsonb_build_object('state',effect.terminal_status,'ownsExecution',false,'jobId',job.id,
      'attemptCount',job.attempt_count,'recoveryCount',job.recovery_count,'safeResult',effect.safe_result);
  END IF;
  IF receipt.status<>'claimed' THEN RAISE EXCEPTION 'ENTERPRISE_AI_COMMAND_NOT_EXECUTABLE'; END IF;
  IF job.status<>'running' THEN RAISE EXCEPTION 'ENTERPRISE_AI_JOB_RESOURCE_STALE'; END IF;

  IF inserted THEN
    INSERT INTO public.enterprise_ai_job_attempts(
      job_id,receipt_id,org_id,workspace_id,actor_id,execution_token,execution_fence,
      attempt_number,attempt_kind,lease_expires_at
    ) VALUES (job.id,p_receipt,p_org,p_workspace,p_actor,p_execution_token,p_execution_fence,1,'claimed',lease_until);
  ELSIF job.execution_token IS NOT DISTINCT FROM p_execution_token
        AND job.execution_fence IS NOT DISTINCT FROM p_execution_fence
        AND job.attempt_lease_expires_at>statement_timestamp() THEN
    RETURN jsonb_build_object('state','owned','ownsExecution',true,'jobId',job.id,
      'attemptCount',job.attempt_count,'recoveryCount',job.recovery_count);
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
  RETURN jsonb_build_object('state','owned','ownsExecution',true,'jobId',job.id,
    'attemptCount',job.attempt_count,'recoveryCount',job.recovery_count);
END;
$$;

CREATE OR REPLACE FUNCTION public.enterprise_fail_evidence_extraction_job(
  p_job_id UUID,p_receipt UUID,p_org UUID,p_workspace UUID,
  p_execution_token UUID,p_execution_fence BIGINT,p_failure_class TEXT,
  p_latency_ms INTEGER,p_response JSONB,p_blocked BOOLEAN DEFAULT true
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE receipt public.enterprise_ai_command_receipts; job public.enterprise_ai_job_ledger;
  finalized public.enterprise_ai_command_receipts; terminal_status TEXT:=CASE WHEN p_blocked THEN 'blocked' ELSE 'failed' END;
BEGIN
  IF p_failure_class IS NULL OR p_failure_class!~'^[A-Z0-9_]{1,120}$'
     OR p_latency_ms IS NULL OR p_latency_ms<0 OR jsonb_typeof(COALESCE(p_response,'{}'::jsonb))<>'object' THEN
    RAISE EXCEPTION 'ENTERPRISE_AI_JOB_INVALID';
  END IF;
  SELECT * INTO receipt FROM public.enterprise_ai_command_receipts
  WHERE id=p_receipt AND org_id=p_org AND workspace_id=p_workspace FOR UPDATE;
  SELECT * INTO job FROM public.enterprise_ai_job_ledger
  WHERE id=p_job_id AND receipt_id=p_receipt AND org_id=p_org AND workspace_id=p_workspace FOR UPDATE;
  IF receipt.id IS NULL OR job.id IS NULL OR receipt.command_type<>'evidence.extract' THEN
    RAISE EXCEPTION 'ENTERPRISE_AI_JOB_RESOURCE_STALE';
  END IF;
  IF receipt.status=terminal_status AND job.status=terminal_status THEN RETURN receipt.response; END IF;
  IF receipt.status<>'claimed' OR receipt.execution_token IS DISTINCT FROM p_execution_token
     OR receipt.execution_fence IS DISTINCT FROM p_execution_fence
     OR job.status<>'running' OR job.execution_token IS DISTINCT FROM p_execution_token
     OR job.execution_fence IS DISTINCT FROM p_execution_fence THEN
    RAISE EXCEPTION 'ENTERPRISE_AI_STALE_EXECUTION_FENCE';
  END IF;
  UPDATE public.enterprise_ai_job_ledger SET status=terminal_status,failure_class=p_failure_class,
    latency_ms=p_latency_ms,completed_at=statement_timestamp() WHERE id=job.id;
  finalized:=public.enterprise_ai_fail_command(
    p_receipt,p_org,p_workspace,p_execution_token,p_execution_fence,p_response,p_blocked
  );
  RETURN finalized.response;
END;
$$;

-- Preserve the existing all-or-nothing candidate/usage/effect transaction,
-- while requiring the committing worker to own this job attempt fence.
CREATE OR REPLACE FUNCTION public.enterprise_commit_evidence_extraction(
  p_job_id UUID,p_source_id UUID,p_org UUID,p_workspace UUID,p_output_hash TEXT,
  p_latency_ms INTEGER,p_provider_config_id UUID,p_provider TEXT,p_model TEXT,
  p_token_input INTEGER,p_token_output INTEGER,p_candidates JSONB,
  p_receipt UUID,p_execution_token UUID,p_execution_fence BIGINT,p_result JSONB
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE committed JSONB; job public.enterprise_ai_job_ledger;
BEGIN
  SELECT * INTO job FROM public.enterprise_ai_job_ledger
  WHERE id=p_job_id AND receipt_id=p_receipt AND org_id=p_org AND workspace_id=p_workspace FOR UPDATE;
  IF job.id IS NULL OR job.status<>'running' OR job.source_id IS DISTINCT FROM p_source_id
     OR job.provider_config_id IS DISTINCT FROM p_provider_config_id OR job.provider IS DISTINCT FROM p_provider
     OR job.model IS DISTINCT FROM p_model OR job.execution_token IS DISTINCT FROM p_execution_token
     OR job.execution_fence IS DISTINCT FROM p_execution_fence THEN
    RAISE EXCEPTION 'ENTERPRISE_AI_STALE_EXECUTION_FENCE';
  END IF;
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

REVOKE ALL ON FUNCTION
  public.enterprise_claim_or_resume_evidence_extraction_job(UUID,UUID,UUID,UUID,UUID,UUID,UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,UUID,BIGINT),
  public.enterprise_fail_evidence_extraction_job(UUID,UUID,UUID,UUID,UUID,BIGINT,TEXT,INTEGER,JSONB,BOOLEAN),
  public.enterprise_commit_evidence_extraction(UUID,UUID,UUID,UUID,TEXT,INTEGER,UUID,TEXT,TEXT,INTEGER,INTEGER,JSONB,UUID,UUID,BIGINT,JSONB)
FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION
  public.enterprise_claim_or_resume_evidence_extraction_job(UUID,UUID,UUID,UUID,UUID,UUID,UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,UUID,BIGINT),
  public.enterprise_fail_evidence_extraction_job(UUID,UUID,UUID,UUID,UUID,BIGINT,TEXT,INTEGER,JSONB,BOOLEAN),
  public.enterprise_commit_evidence_extraction(UUID,UUID,UUID,UUID,TEXT,INTEGER,UUID,TEXT,TEXT,INTEGER,INTEGER,JSONB,UUID,UUID,BIGINT,JSONB)
TO service_role;

COMMENT ON FUNCTION public.enterprise_claim_or_resume_evidence_extraction_job(UUID,UUID,UUID,UUID,UUID,UUID,UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,UUID,BIGINT)
IS 'Service-only fenced evidence extraction ownership. Resumes one stable job row after lease expiry; does not claim exactly-once provider invocation.';
