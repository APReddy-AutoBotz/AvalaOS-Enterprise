-- PR A unified provider budget and cleanup authority.
-- Additive only. No live/provider effect is performed by this migration.

CREATE TABLE public.enterprise_ai_budget_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id uuid NOT NULL REFERENCES public.enterprise_ai_command_receipts(id) ON DELETE RESTRICT,
  job_id uuid NOT NULL,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  authorization_version bigint NOT NULL CHECK (authorization_version > 0),
  route_id uuid NOT NULL,
  provider_config_id uuid NOT NULL,
  provider text NOT NULL CHECK (provider IN ('openai','azure_openai','anthropic','gemini','groq','openai_compatible')),
  capability text NOT NULL CHECK (capability IN (
    'assess.evidence.extract','assess.evidence.summarize','delivery.work_items.draft',
    'modernization.rationale.draft','assemble.blueprint.draft','studio.document.generate'
  )),
  model text NOT NULL CHECK (length(btrim(model)) BETWEEN 1 AND 200),
  state text NOT NULL CHECK (state IN ('reserved','settled','uncertain','released')),
  reserved_requests integer NOT NULL DEFAULT 1 CHECK (reserved_requests = 1),
  estimated_input_tokens integer NOT NULL CHECK (estimated_input_tokens > 0),
  maximum_output_tokens integer NOT NULL CHECK (maximum_output_tokens > 0),
  reserved_tokens integer GENERATED ALWAYS AS (estimated_input_tokens + maximum_output_tokens) STORED,
  actual_input_tokens integer CHECK (actual_input_tokens IS NULL OR actual_input_tokens >= 0),
  actual_output_tokens integer CHECK (actual_output_tokens IS NULL OR actual_output_tokens >= 0),
  actual_total_tokens integer CHECK (actual_total_tokens IS NULL OR actual_total_tokens > 0),
  failure_class text CHECK (failure_class IS NULL OR failure_class ~ '^[a-z0-9_]{1,80}$'),
  release_reason text CHECK (release_reason IS NULL OR release_reason IN ('before_provider_effect','reconciled_no_effect')),
  execution_token uuid NOT NULL,
  execution_fence bigint NOT NULL CHECK (execution_fence > 0),
  day_bucket date NOT NULL,
  month_bucket date NOT NULL,
  reserved_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  settled_at timestamptz,
  CONSTRAINT enterprise_ai_budget_workspace_org_fkey FOREIGN KEY (workspace_id,org_id)
    REFERENCES public.workspaces(id,org_id) ON DELETE CASCADE,
  CONSTRAINT enterprise_ai_budget_route_scope_fkey FOREIGN KEY (route_id,org_id,workspace_id)
    REFERENCES public.enterprise_ai_capability_routes(id,org_id,workspace_id) ON DELETE RESTRICT,
  CONSTRAINT enterprise_ai_budget_provider_scope_fkey FOREIGN KEY (provider_config_id,org_id)
    REFERENCES public.ai_provider_configs(id,org_id) ON DELETE RESTRICT,
  CONSTRAINT enterprise_ai_budget_job_scope_fkey FOREIGN KEY (job_id,org_id)
    REFERENCES public.enterprise_ai_job_ledger(id,org_id) ON DELETE RESTRICT,
  CONSTRAINT enterprise_ai_budget_actual_usage_check CHECK (
    (state <> 'settled' AND actual_input_tokens IS NULL AND actual_output_tokens IS NULL AND actual_total_tokens IS NULL)
    OR (state = 'settled' AND actual_total_tokens = actual_input_tokens + actual_output_tokens)
  ),
  UNIQUE (receipt_id), UNIQUE (job_id)
);

CREATE INDEX enterprise_ai_budget_scope_day_idx ON public.enterprise_ai_budget_reservations
  (org_id,workspace_id,provider,capability,day_bucket,state);
CREATE INDEX enterprise_ai_budget_scope_month_idx ON public.enterprise_ai_budget_reservations
  (org_id,workspace_id,provider,capability,month_bucket,state);

ALTER TABLE public.enterprise_ai_budget_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enterprise_ai_budget_reservations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.enterprise_ai_budget_reservations FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.enterprise_ai_budget_result(
  p_row public.enterprise_ai_budget_reservations,
  p_owns boolean,
  p_replayed boolean
) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'reservationId',p_row.id,'state',p_row.state,'ownsProviderEffect',p_owns,
    'replayed',p_replayed,'reservedTokens',p_row.reserved_tokens,
    'inputTokens',p_row.actual_input_tokens,'outputTokens',p_row.actual_output_tokens,
    'totalTokens',p_row.actual_total_tokens
  ));
$$;

CREATE OR REPLACE FUNCTION public.enterprise_ai_assert_budget_identity(
  p_row public.enterprise_ai_budget_reservations,
  p_actor uuid,p_org uuid,p_workspace uuid,p_receipt uuid,p_job uuid,
  p_route uuid,p_provider_config uuid,p_provider text,p_capability text,p_model text
) RETURNS void LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
BEGIN
  IF p_row.id IS NULL OR p_row.actor_id IS DISTINCT FROM p_actor OR p_row.org_id IS DISTINCT FROM p_org
     OR p_row.workspace_id IS DISTINCT FROM p_workspace OR p_row.receipt_id IS DISTINCT FROM p_receipt
     OR p_row.job_id IS DISTINCT FROM p_job OR p_row.route_id IS DISTINCT FROM p_route
     OR p_row.provider_config_id IS DISTINCT FROM p_provider_config OR p_row.provider IS DISTINCT FROM p_provider
     OR p_row.capability IS DISTINCT FROM p_capability OR p_row.model IS DISTINCT FROM p_model THEN
    RAISE EXCEPTION 'ENTERPRISE_AI_PROVIDER_ROUTE_STALE';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.enterprise_ai_reserve_provider_budget(
  p_actor uuid,p_org uuid,p_workspace uuid,p_authorization_version bigint,
  p_receipt uuid,p_job uuid,p_execution_token uuid,p_execution_fence bigint,
  p_route uuid,p_provider_config uuid,p_provider text,p_capability text,p_model text,
  p_estimated_input_tokens integer,p_maximum_output_tokens integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  receipt public.enterprise_ai_command_receipts;
  job public.enterprise_ai_job_ledger;
  route public.enterprise_ai_capability_routes;
  config public.ai_provider_configs;
  reservation public.enterprise_ai_budget_reservations;
  required_capability text;
  daily_limit bigint; monthly_limit bigint; daily_used bigint; monthly_used bigint;
  day_value date := (statement_timestamp() AT TIME ZONE 'UTC')::date;
  month_value date := date_trunc('month',statement_timestamp() AT TIME ZONE 'UTC')::date;
BEGIN
  IF p_actor IS NULL OR p_org IS NULL OR p_workspace IS NULL OR p_receipt IS NULL OR p_job IS NULL
     OR p_execution_token IS NULL OR p_execution_fence < 1 OR p_route IS NULL OR p_provider_config IS NULL
     OR p_provider NOT IN ('openai','azure_openai','anthropic','gemini','groq','openai_compatible')
     OR p_capability NOT IN ('assess.evidence.extract','assess.evidence.summarize','delivery.work_items.draft',
       'modernization.rationale.draft','assemble.blueprint.draft','studio.document.generate')
     OR length(btrim(COALESCE(p_model,''))) NOT BETWEEN 1 AND 200
     OR p_estimated_input_tokens < 1 OR p_maximum_output_tokens < 1 THEN
    RAISE EXCEPTION 'ENTERPRISE_AI_PROVIDER_ROUTE_STALE';
  END IF;
  required_capability := CASE
    WHEN p_capability LIKE 'assess.%' THEN 'evidence.write'
    WHEN p_capability='delivery.work_items.draft' THEN 'project.manage'
    WHEN p_capability='modernization.rationale.draft' THEN 'portfolio.manage'
    WHEN p_capability='assemble.blueprint.draft' THEN 'assemble.manage'
    WHEN p_capability='studio.document.generate' THEN 'docs.approve'
  END;
  -- Fresh authority and effect ownership are checked inside this transaction.
  PERFORM public.pr1b_assert_command_authority(p_actor,p_org,p_workspace,required_capability,p_authorization_version);
  PERFORM pg_advisory_xact_lock(hashtextextended(concat_ws(':','enterprise-ai-budget',p_org,p_workspace,p_provider,p_capability),0));

  SELECT * INTO receipt FROM public.enterprise_ai_command_receipts
   WHERE id=p_receipt AND org_id=p_org AND workspace_id=p_workspace AND actor_id=p_actor FOR UPDATE;
  SELECT * INTO job FROM public.enterprise_ai_job_ledger
   WHERE id=p_job AND org_id=p_org AND workspace_id=p_workspace AND actor_id=p_actor FOR UPDATE;
  SELECT * INTO route FROM public.enterprise_ai_capability_routes
   WHERE id=p_route AND org_id=p_org AND workspace_id=p_workspace FOR UPDATE;
  SELECT * INTO config FROM public.ai_provider_configs
   WHERE id=p_provider_config AND org_id=p_org FOR UPDATE;
  IF receipt.id IS NULL OR receipt.status<>'claimed' OR receipt.execution_token IS DISTINCT FROM p_execution_token
     OR receipt.execution_fence IS DISTINCT FROM p_execution_fence OR job.id IS NULL OR job.receipt_id IS DISTINCT FROM p_receipt
     OR job.execution_token IS DISTINCT FROM p_execution_token OR job.execution_fence IS DISTINCT FROM p_execution_fence
     OR job.status<>'running' OR job.route_id IS DISTINCT FROM p_route OR job.provider_config_id IS DISTINCT FROM p_provider_config
     OR job.provider IS DISTINCT FROM p_provider OR job.capability IS DISTINCT FROM p_capability OR job.model IS DISTINCT FROM p_model
     OR route.id IS NULL OR NOT route.enabled OR route.deleted_at IS NOT NULL OR route.provider_config_id IS DISTINCT FROM p_provider_config
     OR route.capability IS DISTINCT FROM p_capability OR route.model IS DISTINCT FROM p_model
     OR config.id IS NULL OR config.status<>'active' OR config.deleted_at IS NOT NULL OR config.provider IS DISTINCT FROM p_provider
     OR NOT (p_model=ANY(config.model_allowlist)) OR config.last_validated_at IS NULL
     OR config.last_validated_at > statement_timestamp() OR config.last_validated_at < statement_timestamp()-interval '24 hours'
     OR config.key_ref_id IS NULL OR NOT EXISTS (
       SELECT 1 FROM public.ai_provider_key_refs key_ref
        WHERE key_ref.id=config.key_ref_id AND key_ref.org_id=p_org AND key_ref.provider=p_provider
          AND key_ref.resolver_type='server_reference' AND key_ref.status='active'
          AND key_ref.deleted_at IS NULL AND (key_ref.expires_at IS NULL OR key_ref.expires_at>statement_timestamp())
     )
     OR cardinality(route.allowed_roles)=0 OR NOT EXISTS (
       SELECT 1 FROM public.organization_members member
       JOIN public.roles role ON role.id=member.role_id AND role.org_id=p_org
       WHERE member.user_id=p_actor AND member.org_id=p_org AND member.status='active' AND member.deleted_at IS NULL
         AND role.status='active' AND role.deleted_at IS NULL
         AND EXISTS (SELECT 1 FROM unnest(route.allowed_roles) allowed(value)
           WHERE lower(allowed.value)=lower(role.name) OR lower(allowed.value)=lower(role.id::text))
       UNION ALL
       SELECT 1 FROM public.workspace_memberships member
       JOIN public.roles role ON role.id=member.role_id AND role.org_id=p_org AND role.workspace_id=p_workspace
       WHERE member.user_id=p_actor AND member.org_id=p_org AND member.workspace_id=p_workspace
         AND member.status='active' AND member.deleted_at IS NULL AND role.status='active' AND role.deleted_at IS NULL
         AND EXISTS (SELECT 1 FROM unnest(route.allowed_roles) allowed(value)
           WHERE lower(allowed.value)=lower(role.name) OR lower(allowed.value)=lower(role.id::text))
     )
     OR EXISTS (SELECT 1 FROM public.enterprise_ai_effect_journal e WHERE e.receipt_id=p_receipt AND e.effect_key='command') THEN
    RAISE EXCEPTION 'ENTERPRISE_AI_PROVIDER_ROUTE_STALE';
  END IF;

  SELECT * INTO reservation FROM public.enterprise_ai_budget_reservations WHERE receipt_id=p_receipt OR job_id=p_job FOR UPDATE;
  IF reservation.id IS NOT NULL THEN
    PERFORM public.enterprise_ai_assert_budget_identity(reservation,p_actor,p_org,p_workspace,p_receipt,p_job,p_route,p_provider_config,p_provider,p_capability,p_model);
    RETURN public.enterprise_ai_budget_result(reservation,false,true);
  END IF;

  daily_limit := CASE WHEN (config.budget_policy->>'dailyRequests') ~ '^[1-9][0-9]*$' THEN (config.budget_policy->>'dailyRequests')::bigint END;
  monthly_limit := CASE WHEN (config.budget_policy->>'monthlyTokens') ~ '^[1-9][0-9]*$' THEN (config.budget_policy->>'monthlyTokens')::bigint END;
  SELECT count(*) FILTER (WHERE day_bucket=day_value),
         COALESCE(sum(CASE WHEN state='settled' THEN actual_total_tokens ELSE reserved_tokens END) FILTER (WHERE month_bucket=month_value),0)
    INTO daily_used,monthly_used FROM public.enterprise_ai_budget_reservations
   WHERE org_id=p_org AND workspace_id=p_workspace AND provider=p_provider
     AND capability=p_capability AND state IN ('reserved','settled','uncertain');
  IF (daily_limit IS NOT NULL AND daily_used + 1 > daily_limit)
     OR (monthly_limit IS NOT NULL AND monthly_used + p_estimated_input_tokens + p_maximum_output_tokens > monthly_limit) THEN
    RAISE EXCEPTION 'ENTERPRISE_AI_BUDGET_EXHAUSTED';
  END IF;
  INSERT INTO public.enterprise_ai_budget_reservations(
    receipt_id,job_id,org_id,workspace_id,actor_id,authorization_version,route_id,provider_config_id,
    provider,capability,model,state,estimated_input_tokens,maximum_output_tokens,execution_token,execution_fence,
    day_bucket,month_bucket
  ) VALUES (p_receipt,p_job,p_org,p_workspace,p_actor,p_authorization_version,p_route,p_provider_config,
    p_provider,p_capability,p_model,'reserved',p_estimated_input_tokens,p_maximum_output_tokens,p_execution_token,p_execution_fence,
    day_value,month_value) RETURNING * INTO reservation;
  RETURN public.enterprise_ai_budget_result(reservation,true,false);
EXCEPTION
  WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM LIKE '%ENTERPRISE_AI_BUDGET_EXHAUSTED%' THEN RETURN jsonb_build_object('errorCode','BUDGET_EXHAUSTED'); END IF;
    IF SQLERRM LIKE '%PR1B_AUTHORIZATION_STALE%' THEN RETURN jsonb_build_object('errorCode','AUTHORIZATION_STALE'); END IF;
    IF SQLERRM LIKE '%PR1B_NOT_FOUND%' THEN RETURN jsonb_build_object('errorCode','PERMISSION_DENIED'); END IF;
    IF SQLERRM LIKE '%ENTERPRISE_AI_PROVIDER_ROUTE_STALE%' THEN RETURN jsonb_build_object('errorCode','PROVIDER_ROUTE_STALE'); END IF;
    RAISE;
END;
$$;

CREATE OR REPLACE FUNCTION public.enterprise_ai_settle_provider_budget(
  p_actor uuid,p_org uuid,p_workspace uuid,p_authorization_version bigint,
  p_receipt uuid,p_job uuid,p_execution_token uuid,p_execution_fence bigint,
  p_route uuid,p_provider_config uuid,p_provider text,p_capability text,p_model text,
  p_reservation uuid,p_input_tokens integer,p_output_tokens integer,p_total_tokens integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE reservation public.enterprise_ai_budget_reservations; required_capability text;
BEGIN
  required_capability:=CASE WHEN p_capability LIKE 'assess.%' THEN 'evidence.write' WHEN p_capability='delivery.work_items.draft' THEN 'project.manage' WHEN p_capability='modernization.rationale.draft' THEN 'portfolio.manage' WHEN p_capability='assemble.blueprint.draft' THEN 'assemble.manage' ELSE 'docs.approve' END;
  PERFORM public.pr1b_assert_command_authority(p_actor,p_org,p_workspace,required_capability,p_authorization_version);
  SELECT * INTO reservation FROM public.enterprise_ai_budget_reservations WHERE id=p_reservation FOR UPDATE;
  PERFORM public.enterprise_ai_assert_budget_identity(reservation,p_actor,p_org,p_workspace,p_receipt,p_job,p_route,p_provider_config,p_provider,p_capability,p_model);
  IF reservation.state='settled' THEN RETURN public.enterprise_ai_budget_result(reservation,false,true); END IF;
  IF reservation.state NOT IN ('reserved','uncertain') OR p_input_tokens<0 OR p_output_tokens<0 OR p_total_tokens<1 OR p_total_tokens<>p_input_tokens+p_output_tokens THEN RAISE EXCEPTION 'ENTERPRISE_AI_PROVIDER_ROUTE_STALE'; END IF;
  UPDATE public.enterprise_ai_budget_reservations SET state='settled',actual_input_tokens=p_input_tokens,
    actual_output_tokens=p_output_tokens,actual_total_tokens=p_total_tokens,updated_at=statement_timestamp(),settled_at=statement_timestamp()
   WHERE id=reservation.id RETURNING * INTO reservation;
  RETURN public.enterprise_ai_budget_result(reservation,false,false);
EXCEPTION WHEN SQLSTATE 'P0001' THEN
  IF SQLERRM LIKE '%PR1B_AUTHORIZATION_STALE%' THEN RETURN jsonb_build_object('errorCode','AUTHORIZATION_STALE'); END IF;
  IF SQLERRM LIKE '%PR1B_NOT_FOUND%' THEN RETURN jsonb_build_object('errorCode','PERMISSION_DENIED'); END IF;
  RETURN jsonb_build_object('errorCode','PROVIDER_ROUTE_STALE');
END;
$$;

CREATE OR REPLACE FUNCTION public.enterprise_ai_mark_provider_budget_uncertain(
  p_actor uuid,p_org uuid,p_workspace uuid,p_authorization_version bigint,
  p_receipt uuid,p_job uuid,p_execution_token uuid,p_execution_fence bigint,
  p_route uuid,p_provider_config uuid,p_provider text,p_capability text,p_model text,
  p_reservation uuid,p_failure_class text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE reservation public.enterprise_ai_budget_reservations; required_capability text;
BEGIN
  required_capability:=CASE WHEN p_capability LIKE 'assess.%' THEN 'evidence.write' WHEN p_capability='delivery.work_items.draft' THEN 'project.manage' WHEN p_capability='modernization.rationale.draft' THEN 'portfolio.manage' WHEN p_capability='assemble.blueprint.draft' THEN 'assemble.manage' ELSE 'docs.approve' END;
  PERFORM public.pr1b_assert_command_authority(p_actor,p_org,p_workspace,required_capability,p_authorization_version);
  SELECT * INTO reservation FROM public.enterprise_ai_budget_reservations WHERE id=p_reservation FOR UPDATE;
  PERFORM public.enterprise_ai_assert_budget_identity(reservation,p_actor,p_org,p_workspace,p_receipt,p_job,p_route,p_provider_config,p_provider,p_capability,p_model);
  IF reservation.state IN ('settled','uncertain') THEN RETURN public.enterprise_ai_budget_result(reservation,false,true); END IF;
  IF reservation.state<>'reserved' OR p_failure_class !~ '^[a-z0-9_]{1,80}$' THEN RAISE EXCEPTION 'ENTERPRISE_AI_PROVIDER_ROUTE_STALE'; END IF;
  UPDATE public.enterprise_ai_budget_reservations SET state='uncertain',failure_class=p_failure_class,updated_at=statement_timestamp()
   WHERE id=reservation.id RETURNING * INTO reservation;
  RETURN public.enterprise_ai_budget_result(reservation,false,false);
EXCEPTION WHEN SQLSTATE 'P0001' THEN
  IF SQLERRM LIKE '%PR1B_AUTHORIZATION_STALE%' THEN RETURN jsonb_build_object('errorCode','AUTHORIZATION_STALE'); END IF;
  IF SQLERRM LIKE '%PR1B_NOT_FOUND%' THEN RETURN jsonb_build_object('errorCode','PERMISSION_DENIED'); END IF;
  RETURN jsonb_build_object('errorCode','PROVIDER_ROUTE_STALE');
END;
$$;

CREATE OR REPLACE FUNCTION public.enterprise_ai_release_provider_budget(
  p_actor uuid,p_org uuid,p_workspace uuid,p_authorization_version bigint,
  p_receipt uuid,p_job uuid,p_execution_token uuid,p_execution_fence bigint,
  p_route uuid,p_provider_config uuid,p_provider text,p_capability text,p_model text,
  p_reservation uuid,p_release_reason text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE reservation public.enterprise_ai_budget_reservations; required_capability text;
BEGIN
  required_capability:=CASE WHEN p_capability LIKE 'assess.%' THEN 'evidence.write' WHEN p_capability='delivery.work_items.draft' THEN 'project.manage' WHEN p_capability='modernization.rationale.draft' THEN 'portfolio.manage' WHEN p_capability='assemble.blueprint.draft' THEN 'assemble.manage' ELSE 'docs.approve' END;
  PERFORM public.pr1b_assert_command_authority(p_actor,p_org,p_workspace,required_capability,p_authorization_version);
  SELECT * INTO reservation FROM public.enterprise_ai_budget_reservations WHERE id=p_reservation FOR UPDATE;
  PERFORM public.enterprise_ai_assert_budget_identity(reservation,p_actor,p_org,p_workspace,p_receipt,p_job,p_route,p_provider_config,p_provider,p_capability,p_model);
  IF reservation.state='released' THEN RETURN public.enterprise_ai_budget_result(reservation,false,true); END IF;
  IF p_release_reason NOT IN ('before_provider_effect','reconciled_no_effect') OR reservation.state='settled'
     OR (reservation.state='uncertain' AND p_release_reason<>'reconciled_no_effect') THEN RAISE EXCEPTION 'ENTERPRISE_AI_PROVIDER_ROUTE_STALE'; END IF;
  UPDATE public.enterprise_ai_budget_reservations SET state='released',release_reason=p_release_reason,
    updated_at=statement_timestamp(),settled_at=statement_timestamp() WHERE id=reservation.id RETURNING * INTO reservation;
  RETURN public.enterprise_ai_budget_result(reservation,false,false);
EXCEPTION WHEN SQLSTATE 'P0001' THEN
  IF SQLERRM LIKE '%PR1B_AUTHORIZATION_STALE%' THEN RETURN jsonb_build_object('errorCode','AUTHORIZATION_STALE'); END IF;
  IF SQLERRM LIKE '%PR1B_NOT_FOUND%' THEN RETURN jsonb_build_object('errorCode','PERMISSION_DENIED'); END IF;
  RETURN jsonb_build_object('errorCode','PROVIDER_ROUTE_STALE');
END;
$$;

REVOKE ALL ON FUNCTION public.enterprise_ai_budget_result(public.enterprise_ai_budget_reservations,boolean,boolean),
  public.enterprise_ai_assert_budget_identity(public.enterprise_ai_budget_reservations,uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,text),
  public.enterprise_ai_reserve_provider_budget(uuid,uuid,uuid,bigint,uuid,uuid,uuid,bigint,uuid,uuid,text,text,text,integer,integer),
  public.enterprise_ai_settle_provider_budget(uuid,uuid,uuid,bigint,uuid,uuid,uuid,bigint,uuid,uuid,text,text,text,uuid,integer,integer,integer),
  public.enterprise_ai_mark_provider_budget_uncertain(uuid,uuid,uuid,bigint,uuid,uuid,uuid,bigint,uuid,uuid,text,text,text,uuid,text),
  public.enterprise_ai_release_provider_budget(uuid,uuid,uuid,bigint,uuid,uuid,uuid,bigint,uuid,uuid,text,text,text,uuid,text)
FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION
  public.enterprise_ai_reserve_provider_budget(uuid,uuid,uuid,bigint,uuid,uuid,uuid,bigint,uuid,uuid,text,text,text,integer,integer),
  public.enterprise_ai_settle_provider_budget(uuid,uuid,uuid,bigint,uuid,uuid,uuid,bigint,uuid,uuid,text,text,text,uuid,integer,integer,integer),
  public.enterprise_ai_mark_provider_budget_uncertain(uuid,uuid,uuid,bigint,uuid,uuid,uuid,bigint,uuid,uuid,text,text,text,uuid,text),
  public.enterprise_ai_release_provider_budget(uuid,uuid,uuid,bigint,uuid,uuid,uuid,bigint,uuid,uuid,text,text,text,uuid,text)
TO service_role;

COMMENT ON TABLE public.enterprise_ai_budget_reservations IS
  'Service-only atomic provider-effect reservations. Uncertain effects retain reserved budget until explicit no-effect reconciliation; no secrets or provider payloads are stored.';

-- Retirement cleanup is durable. The queue stores only tenant/provider/key
-- selectors; the opaque secret reference remains in the existing service-only
-- key-ref table and never enters a job result or projection.
CREATE TABLE public.enterprise_provider_secret_cleanup_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key_ref_id uuid NOT NULL,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('openai','azure_openai','anthropic','gemini','groq','openai_compatible')),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','claimed','completed')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 20),
  execution_token uuid,
  lease_expires_at timestamptz,
  next_attempt_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  last_failure_class text CHECK (last_failure_class IS NULL OR last_failure_class ~ '^[a-z0-9_]{1,80}$'),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  completed_at timestamptz,
  CONSTRAINT enterprise_provider_cleanup_key_scope_fkey FOREIGN KEY (key_ref_id,org_id)
    REFERENCES public.ai_provider_key_refs(id,org_id) ON DELETE RESTRICT,
  UNIQUE (key_ref_id,org_id)
);
ALTER TABLE public.enterprise_provider_secret_cleanup_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enterprise_provider_secret_cleanup_jobs FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.enterprise_provider_secret_cleanup_jobs FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.enterprise_ai_enqueue_retired_provider_secret_cleanup()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF NEW.resolver_type='server_reference' AND NEW.provider IN ('openai','azure_openai','anthropic','gemini','groq','openai_compatible')
     AND ((OLD.status IS DISTINCT FROM NEW.status AND NEW.status IN ('retired','revoked'))
       OR (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL)) THEN
    INSERT INTO public.enterprise_provider_secret_cleanup_jobs(key_ref_id,org_id,provider)
    VALUES(NEW.id,NEW.org_id,NEW.provider)
    ON CONFLICT(key_ref_id,org_id) DO UPDATE SET
      state=CASE WHEN public.enterprise_provider_secret_cleanup_jobs.state='completed' THEN 'completed' ELSE 'pending' END,
      execution_token=NULL,lease_expires_at=NULL,next_attempt_at=statement_timestamp(),updated_at=statement_timestamp();
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS enterprise_ai_retired_provider_secret_cleanup ON public.ai_provider_key_refs;
CREATE TRIGGER enterprise_ai_retired_provider_secret_cleanup
AFTER UPDATE OF status,deleted_at ON public.ai_provider_key_refs
FOR EACH ROW EXECUTE FUNCTION public.enterprise_ai_enqueue_retired_provider_secret_cleanup();

CREATE OR REPLACE FUNCTION public.enterprise_ai_claim_provider_secret_cleanup_job(p_execution_token uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE job public.enterprise_provider_secret_cleanup_jobs;
BEGIN
  IF p_execution_token IS NULL THEN RAISE EXCEPTION 'ENTERPRISE_PROVIDER_CLEANUP_NOT_ALLOWED'; END IF;
  SELECT * INTO job FROM public.enterprise_provider_secret_cleanup_jobs
   WHERE attempt_count<20 AND (
     (state='pending' AND next_attempt_at<=statement_timestamp())
     OR (state='claimed' AND lease_expires_at<=statement_timestamp())
   )
   ORDER BY next_attempt_at,id FOR UPDATE SKIP LOCKED LIMIT 1;
  IF job.id IS NULL THEN RETURN jsonb_build_object('state','empty'); END IF;
  UPDATE public.enterprise_provider_secret_cleanup_jobs SET state='claimed',execution_token=p_execution_token,
    lease_expires_at=statement_timestamp()+interval '45 seconds',attempt_count=attempt_count+1,updated_at=statement_timestamp()
   WHERE id=job.id RETURNING * INTO job;
  RETURN jsonb_build_object('state','claimed','jobId',job.id,'keyRefId',job.key_ref_id,
    'organizationId',job.org_id,'provider',job.provider,'attemptCount',job.attempt_count);
END;
$$;

CREATE OR REPLACE FUNCTION public.enterprise_ai_complete_provider_secret_cleanup_job(
  p_job uuid,p_execution_token uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE job public.enterprise_provider_secret_cleanup_jobs;
BEGIN
  UPDATE public.enterprise_provider_secret_cleanup_jobs SET state='completed',execution_token=NULL,
    lease_expires_at=NULL,last_failure_class=NULL,completed_at=statement_timestamp(),updated_at=statement_timestamp()
   WHERE id=p_job AND state='claimed' AND execution_token=p_execution_token
     AND lease_expires_at>statement_timestamp() RETURNING * INTO job;
  IF job.id IS NULL THEN RAISE EXCEPTION 'ENTERPRISE_PROVIDER_CLEANUP_NOT_ALLOWED'; END IF;
  RETURN jsonb_build_object('state','completed','jobId',job.id,'attemptCount',job.attempt_count);
END;
$$;

CREATE OR REPLACE FUNCTION public.enterprise_ai_fail_provider_secret_cleanup_job(
  p_job uuid,p_execution_token uuid,p_failure_class text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE job public.enterprise_provider_secret_cleanup_jobs;
BEGIN
  IF p_failure_class !~ '^[a-z0-9_]{1,80}$' THEN RAISE EXCEPTION 'ENTERPRISE_PROVIDER_CLEANUP_NOT_ALLOWED'; END IF;
  UPDATE public.enterprise_provider_secret_cleanup_jobs SET state='pending',execution_token=NULL,lease_expires_at=NULL,
    last_failure_class=p_failure_class,
    next_attempt_at=statement_timestamp()+make_interval(secs=>LEAST(3600,5*(2^LEAST(attempt_count,9))::integer)),
    updated_at=statement_timestamp()
   WHERE id=p_job AND state='claimed' AND execution_token=p_execution_token RETURNING * INTO job;
  IF job.id IS NULL THEN RAISE EXCEPTION 'ENTERPRISE_PROVIDER_CLEANUP_NOT_ALLOWED'; END IF;
  RETURN jsonb_build_object('state','pending','jobId',job.id,'attemptCount',job.attempt_count);
END;
$$;

REVOKE ALL ON FUNCTION public.enterprise_ai_enqueue_retired_provider_secret_cleanup(),
  public.enterprise_ai_claim_provider_secret_cleanup_job(uuid),
  public.enterprise_ai_complete_provider_secret_cleanup_job(uuid,uuid),
  public.enterprise_ai_fail_provider_secret_cleanup_job(uuid,uuid,text)
FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enterprise_ai_claim_provider_secret_cleanup_job(uuid),
  public.enterprise_ai_complete_provider_secret_cleanup_job(uuid,uuid),
  public.enterprise_ai_fail_provider_secret_cleanup_job(uuid,uuid,text)
TO service_role;

COMMENT ON TABLE public.enterprise_provider_secret_cleanup_jobs IS
  'Service-only idempotent retirement cleanup queue. Contains no raw key, secret reference, provider response, source text, or infrastructure identifier.';

-- The accepted v2 managed-write recovery predates first-class Enterprise
-- Groq. Generalize its internal implementation while retaining the v2 RPC
-- name used by existing recovery callers.
CREATE OR REPLACE FUNCTION public.enterprise_ai_claim_provider_secret_cleanup_v3(
  p_actor uuid,p_org uuid,p_workspace uuid,p_operation text,p_key text,
  p_request uuid,p_provider_config_id uuid,p_execution_token uuid
) RETURNS public.enterprise_ai_command_receipts
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE receipt public.enterprise_ai_command_receipts; plan jsonb; existing_effect public.enterprise_ai_effect_journal;
BEGIN
  SELECT * INTO receipt FROM public.enterprise_ai_command_receipts
   WHERE org_id=p_org AND workspace_id=p_workspace AND actor_id=p_actor
     AND command_type=p_operation AND idempotency_key=p_key FOR UPDATE;
  -- Preserve the accepted v2 non-disclosing absence contract before
  -- validating any fields that are available only on an existing receipt.
  IF receipt.id IS NULL THEN RAISE EXCEPTION 'ENTERPRISE_AI_RECEIPT_NOT_FOUND'; END IF;
  IF p_actor IS NULL OR p_org IS NULL OR p_workspace IS NULL OR p_request IS NULL OR p_provider_config_id IS NULL
     OR p_execution_token IS NULL OR p_operation NOT IN ('provider.secret.bind','provider.secret.rotate')
     OR p_key IS NULL OR length(btrim(p_key)) NOT BETWEEN 8 AND 200
     OR receipt.initial_request_id IS DISTINCT FROM p_request OR receipt.runtime_area IS DISTINCT FROM 'provider' THEN
    RAISE EXCEPTION 'ENTERPRISE_PROVIDER_CLEANUP_NOT_ALLOWED';
  END IF;
  plan:=receipt.execution_plan;
  IF plan->>'secretOwnership' IS DISTINCT FROM 'managed_write'
     OR plan->>'secretPlanReceiptId' IS DISTINCT FROM receipt.id::text
     OR plan->>'providerConfigId' IS DISTINCT FROM p_provider_config_id::text
     OR plan->>'writeState' NOT IN ('planned','written')
     OR plan->>'provider' NOT IN ('openai','azure_openai','anthropic','gemini','groq','openai_compatible')
     OR NOT (
       COALESCE(plan->>'secretReference','') ~ ('^AVALA_PROVIDER_SECRET_'||upper(plan->>'provider')||'_'||upper(replace(p_org::text,'-',''))||'_[A-Z0-9_]+$')
       OR COALESCE(plan->>'secretReference','') ~ ('^AVALA_PROVIDER_SECRET_'||upper(plan->>'provider')||'_SERVER_PLAN_[A-Z0-9_]+$')
     )
     OR COALESCE(plan->>'safeFingerprint','') !~ '^sha256:[0-9a-f]{24}$'
     OR COALESCE((plan->>'validationSucceeded')::boolean,false)
     OR (plan->>'cleanupTerminalCode' IS NOT NULL AND plan->>'cleanupTerminalCode'<>'PERMISSION_DENIED')
     OR (p_operation='provider.secret.rotate' AND COALESCE(plan->>'protectedSecretReferenceHash','') !~ '^sha256:[0-9a-f]{24}$')
     OR (p_operation='provider.secret.bind' AND plan ? 'protectedSecretReferenceHash') THEN
    RAISE EXCEPTION 'ENTERPRISE_PROVIDER_CLEANUP_NOT_ALLOWED';
  END IF;
  IF EXISTS (SELECT 1 FROM public.ai_provider_key_refs WHERE org_id=p_org AND secret_ref=plan->>'secretReference' AND status='active') THEN
    RAISE EXCEPTION 'ENTERPRISE_PROVIDER_CLEANUP_NOT_ALLOWED';
  END IF;
  IF receipt.status='blocked' THEN
    IF receipt.response#>>'{error,code}' IS DISTINCT FROM 'PERMISSION_DENIED'
       OR COALESCE((plan->>'cleanupCompleted')::boolean,false) IS NOT TRUE THEN
      RAISE EXCEPTION 'ENTERPRISE_PROVIDER_CLEANUP_NOT_ALLOWED';
    END IF;
    RETURN receipt;
  END IF;
  IF receipt.status<>'claimed' THEN RAISE EXCEPTION 'ENTERPRISE_PROVIDER_CLEANUP_NOT_ALLOWED'; END IF;
  SELECT * INTO existing_effect FROM public.enterprise_ai_effect_journal WHERE receipt_id=receipt.id AND effect_key='command' FOR SHARE;
  IF existing_effect.id IS NOT NULL THEN RAISE EXCEPTION 'ENTERPRISE_PROVIDER_CLEANUP_NOT_ALLOWED'; END IF;
  IF COALESCE((plan->>'cleanupRequired')::boolean,false) AND receipt.lease_expires_at>statement_timestamp() THEN RETURN receipt; END IF;
  UPDATE public.enterprise_ai_command_receipts SET last_request_id=p_request,execution_token=p_execution_token,
    execution_fence=execution_fence+1,claim_started_at=statement_timestamp(),lease_expires_at=statement_timestamp()+interval '45 seconds',
    reconciliation_count=reconciliation_count+1,
    execution_plan=execution_plan||jsonb_build_object('cleanupRequired',true,'cleanupTerminalCode','PERMISSION_DENIED')
   WHERE id=receipt.id AND status='claimed' AND execution_fence=receipt.execution_fence RETURNING * INTO receipt;
  IF receipt.id IS NULL THEN RAISE EXCEPTION 'ENTERPRISE_AI_STALE_EXECUTION_FENCE'; END IF;
  RETURN receipt;
END;
$$;
REVOKE ALL ON FUNCTION public.enterprise_ai_claim_provider_secret_cleanup_v3(uuid,uuid,uuid,text,text,uuid,uuid,uuid)
  FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.enterprise_ai_claim_provider_secret_cleanup_v2(
  p_actor uuid,p_org uuid,p_workspace uuid,p_operation text,p_key text,
  p_request uuid,p_provider_config_id uuid,p_execution_token uuid
) RETURNS public.enterprise_ai_command_receipts
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT public.enterprise_ai_claim_provider_secret_cleanup_v3(
    p_actor,p_org,p_workspace,p_operation,p_key,p_request,p_provider_config_id,p_execution_token
  );
$$;
REVOKE ALL ON FUNCTION public.enterprise_ai_claim_provider_secret_cleanup_v2(uuid,uuid,uuid,text,text,uuid,uuid,uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enterprise_ai_claim_provider_secret_cleanup_v2(uuid,uuid,uuid,text,text,uuid,uuid,uuid)
  TO service_role;

-- Rollback/read-only boundary: set the existing Enterprise provider runtime
-- control off before disabling new call sites. Preserve reservation and
-- cleanup rows for reconciliation. Never delete or rewrite uncertain effects;
-- correct schema or state transitions only through an additive forward fix.
