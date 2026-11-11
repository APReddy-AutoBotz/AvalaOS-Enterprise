-- Studio-owned independent source ingestion, extraction and review authority.
-- Additive, default-off, and provider-free until a distinct route is enabled.

ALTER TABLE public.enterprise_transcript_workspace_flags
  ADD COLUMN studio_source_integration_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE public.enterprise_ai_capability_routes
  DROP CONSTRAINT enterprise_ai_capability_routes_capability_check,
  ADD CONSTRAINT enterprise_ai_capability_routes_capability_check CHECK (capability IN (
    'assess.evidence.extract','studio.evidence.extract','assess.evidence.summarize','delivery.work_items.draft',
    'modernization.rationale.draft','assemble.blueprint.draft','studio.document.generate'
  ));
ALTER TABLE public.enterprise_ai_job_ledger
  DROP CONSTRAINT enterprise_ai_job_ledger_capability_check,
  ADD CONSTRAINT enterprise_ai_job_ledger_capability_check CHECK (capability IN (
    'assess.evidence.extract','studio.evidence.extract','assess.evidence.summarize','delivery.work_items.draft',
    'modernization.rationale.draft','assemble.blueprint.draft','studio.document.generate'
  ));
ALTER TABLE public.enterprise_ai_budget_reservations
  DROP CONSTRAINT enterprise_ai_budget_reservations_capability_check,
  ADD CONSTRAINT enterprise_ai_budget_reservations_capability_check CHECK (capability IN (
    'assess.evidence.extract','studio.evidence.extract','assess.evidence.summarize','delivery.work_items.draft',
    'modernization.rationale.draft','assemble.blueprint.draft','studio.document.generate'
  ));

-- Preserve the accepted synthetic-campaign boundary while admitting the new
-- capability for ordinary workspaces only. An active bounded campaign still
-- rejects any route other than its two exact, pre-authorized routes.
CREATE OR REPLACE FUNCTION public.synthetic_ai_campaign_required_budget_capability(
 p_org uuid,p_workspace uuid,p_route uuid,p_provider_config uuid,p_provider text,p_capability text,p_model text
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE campaign public.synthetic_ai_campaign_authorities;campaign_count integer;active_until timestamptz;
BEGIN
 SELECT count(*)::integer INTO campaign_count FROM public.synthetic_ai_campaign_authorities authority
  WHERE authority.org_id=p_org AND authority.workspace_id=p_workspace;
 IF campaign_count>0 THEN
  IF campaign_count<>1 THEN RAISE EXCEPTION 'SYNTHETIC_AI_CAMPAIGN_BUDGET_BINDING_INVALID';END IF;
  SELECT * INTO STRICT campaign FROM public.synthetic_ai_campaign_authorities authority
   WHERE authority.org_id=p_org AND authority.workspace_id=p_workspace FOR SHARE;
  active_until:=public.synthetic_ai_campaign_active_until(campaign.id);
  IF NOT campaign.enabled OR campaign.disabled_at IS NOT NULL
    OR (active_until>statement_timestamp()) IS NOT TRUE
    OR campaign.provider_config_id IS DISTINCT FROM p_provider_config
    OR p_provider<>'openai' OR p_model<>'gpt-4.1-mini-2025-04-14'
    OR campaign.server_host IS DISTINCT FROM public.synthetic_ai_campaign_request_host()
    OR campaign.project_ref||'.supabase.co' IS DISTINCT FROM campaign.server_host
    OR NOT ((p_capability='assess.evidence.extract' AND p_route=campaign.assess_route_id)
      OR (p_capability='studio.document.generate' AND p_route=campaign.studio_route_id)) THEN
   RAISE EXCEPTION 'SYNTHETIC_AI_CAMPAIGN_BUDGET_BINDING_INVALID';
  END IF;
  RETURN CASE WHEN p_capability='assess.evidence.extract'
    THEN 'assess.v2.draft.write' ELSE 'studio.artifacts.generate' END;
 END IF;
 RETURN CASE
  WHEN p_capability LIKE 'assess.%' THEN 'evidence.write'
  WHEN p_capability='studio.evidence.extract' THEN 'studio.sources.manage'
  WHEN p_capability='delivery.work_items.draft' THEN 'project.manage'
  WHEN p_capability='modernization.rationale.draft' THEN 'portfolio.manage'
  WHEN p_capability='assemble.blueprint.draft' THEN 'assemble.manage'
  WHEN p_capability='studio.document.generate' THEN 'docs.approve'
 END;
END $$;

-- Preserve the accepted budget algorithm, including synthetic-campaign
-- dispatch and exact replay token ceilings, while admitting the new Studio
-- extraction capability. Every other route, role, receipt and freshness check
-- remains unchanged.
CREATE OR REPLACE FUNCTION public.enterprise_ai_reserve_provider_budget(
  p_actor uuid,p_org uuid,p_workspace uuid,p_authorization_version bigint,
  p_receipt uuid,p_job uuid,p_execution_token uuid,p_execution_fence bigint,
  p_route uuid,p_provider_config uuid,p_provider text,p_capability text,p_model text,
  p_estimated_input_tokens integer,p_maximum_output_tokens integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE receipt public.enterprise_ai_command_receipts;job public.enterprise_ai_job_ledger;route public.enterprise_ai_capability_routes;
 config public.ai_provider_configs;reservation public.enterprise_ai_budget_reservations;required_capability text;
 daily_limit bigint;monthly_limit bigint;daily_used bigint;monthly_used bigint;
 day_value date:=(statement_timestamp() AT TIME ZONE 'UTC')::date;
 month_value date:=date_trunc('month',statement_timestamp() AT TIME ZONE 'UTC')::date;
BEGIN
 IF p_actor IS NULL OR p_org IS NULL OR p_workspace IS NULL OR p_receipt IS NULL OR p_job IS NULL OR p_execution_token IS NULL
  OR p_execution_fence<1 OR p_route IS NULL OR p_provider_config IS NULL
  OR p_provider NOT IN('openai','azure_openai','anthropic','gemini','groq','openai_compatible')
  OR p_capability NOT IN('assess.evidence.extract','studio.evidence.extract','assess.evidence.summarize','delivery.work_items.draft',
   'modernization.rationale.draft','assemble.blueprint.draft','studio.document.generate')
  OR length(btrim(COALESCE(p_model,''))) NOT BETWEEN 1 AND 200 OR p_estimated_input_tokens<1 OR p_maximum_output_tokens<1 THEN
  RAISE EXCEPTION 'ENTERPRISE_AI_PROVIDER_ROUTE_STALE';END IF;
 required_capability:=public.synthetic_ai_campaign_required_budget_capability(
  p_org,p_workspace,p_route,p_provider_config,p_provider,p_capability,p_model
 );
 PERFORM public.pr1b_assert_command_authority(p_actor,p_org,p_workspace,required_capability,p_authorization_version);
 PERFORM pg_advisory_xact_lock(hashtextextended(concat_ws(':','enterprise-ai-budget',p_org,p_workspace,p_provider,p_capability),0));
 SELECT * INTO receipt FROM public.enterprise_ai_command_receipts WHERE id=p_receipt AND org_id=p_org AND workspace_id=p_workspace AND actor_id=p_actor FOR UPDATE;
 SELECT * INTO job FROM public.enterprise_ai_job_ledger WHERE id=p_job AND org_id=p_org AND workspace_id=p_workspace AND actor_id=p_actor FOR UPDATE;
 SELECT * INTO route FROM public.enterprise_ai_capability_routes WHERE id=p_route AND org_id=p_org AND workspace_id=p_workspace FOR UPDATE;
 SELECT * INTO config FROM public.ai_provider_configs WHERE id=p_provider_config AND org_id=p_org FOR UPDATE;
 IF receipt.id IS NULL OR receipt.status<>'claimed' OR receipt.execution_token IS DISTINCT FROM p_execution_token
  OR receipt.execution_fence IS DISTINCT FROM p_execution_fence OR job.id IS NULL OR job.receipt_id IS DISTINCT FROM p_receipt
  OR job.execution_token IS DISTINCT FROM p_execution_token OR job.execution_fence IS DISTINCT FROM p_execution_fence
  OR job.status<>'running' OR job.route_id IS DISTINCT FROM p_route OR job.provider_config_id IS DISTINCT FROM p_provider_config
  OR job.provider IS DISTINCT FROM p_provider OR job.capability IS DISTINCT FROM p_capability OR job.model IS DISTINCT FROM p_model
  OR route.id IS NULL OR NOT route.enabled OR route.deleted_at IS NOT NULL OR route.provider_config_id IS DISTINCT FROM p_provider_config
  OR route.capability IS DISTINCT FROM p_capability OR route.model IS DISTINCT FROM p_model
  OR config.id IS NULL OR config.status<>'active' OR config.deleted_at IS NOT NULL OR config.provider IS DISTINCT FROM p_provider
  OR NOT(p_model=ANY(config.model_allowlist)) OR config.last_validated_at IS NULL OR config.last_validated_at>statement_timestamp()
  OR config.last_validated_at<statement_timestamp()-interval '24 hours' OR config.key_ref_id IS NULL OR NOT EXISTS(
   SELECT 1 FROM public.ai_provider_key_refs key_ref WHERE key_ref.id=config.key_ref_id AND key_ref.org_id=p_org
    AND key_ref.provider=p_provider AND key_ref.resolver_type='server_reference' AND key_ref.status='active'
    AND key_ref.deleted_at IS NULL AND(key_ref.expires_at IS NULL OR key_ref.expires_at>statement_timestamp()))
  OR cardinality(route.allowed_roles)=0 OR NOT EXISTS(
   SELECT 1 FROM public.organization_members member JOIN public.roles role ON role.id=member.role_id AND role.org_id=p_org
    WHERE member.user_id=p_actor AND member.org_id=p_org AND member.status='active' AND member.deleted_at IS NULL
     AND role.status='active' AND role.deleted_at IS NULL AND EXISTS(SELECT 1 FROM unnest(route.allowed_roles) allowed(value)
      WHERE lower(allowed.value)=lower(role.name) OR lower(allowed.value)=lower(role.id::text))
   UNION ALL
   SELECT 1 FROM public.workspace_memberships member JOIN public.roles role ON role.id=member.role_id AND role.org_id=p_org AND role.workspace_id=p_workspace
    WHERE member.user_id=p_actor AND member.org_id=p_org AND member.workspace_id=p_workspace AND member.status='active'
     AND member.deleted_at IS NULL AND role.status='active' AND role.deleted_at IS NULL AND EXISTS(
      SELECT 1 FROM unnest(route.allowed_roles) allowed(value) WHERE lower(allowed.value)=lower(role.name) OR lower(allowed.value)=lower(role.id::text)))
  OR EXISTS(SELECT 1 FROM public.enterprise_ai_effect_journal e WHERE e.receipt_id=p_receipt AND e.effect_key='command') THEN
  RAISE EXCEPTION 'ENTERPRISE_AI_PROVIDER_ROUTE_STALE';END IF;
 SELECT * INTO reservation FROM public.enterprise_ai_budget_reservations WHERE receipt_id=p_receipt OR job_id=p_job FOR UPDATE;
 IF reservation.id IS NOT NULL THEN
  PERFORM public.enterprise_ai_assert_budget_identity(reservation,p_actor,p_org,p_workspace,p_receipt,p_job,p_route,p_provider_config,p_provider,p_capability,p_model);
  IF reservation.estimated_input_tokens IS DISTINCT FROM p_estimated_input_tokens
    OR reservation.maximum_output_tokens IS DISTINCT FROM p_maximum_output_tokens THEN
   RAISE EXCEPTION 'ENTERPRISE_AI_PROVIDER_ROUTE_STALE';
  END IF;
  RETURN public.enterprise_ai_budget_result(reservation,false,true);
 END IF;
 daily_limit:=CASE WHEN(config.budget_policy->>'dailyRequests')~'^[1-9][0-9]*$' THEN(config.budget_policy->>'dailyRequests')::bigint END;
 monthly_limit:=CASE WHEN(config.budget_policy->>'monthlyTokens')~'^[1-9][0-9]*$' THEN(config.budget_policy->>'monthlyTokens')::bigint END;
 SELECT count(*) FILTER(WHERE day_bucket=day_value),COALESCE(sum(CASE WHEN state='settled' THEN actual_total_tokens ELSE reserved_tokens END)
  FILTER(WHERE month_bucket=month_value),0) INTO daily_used,monthly_used FROM public.enterprise_ai_budget_reservations
  WHERE org_id=p_org AND workspace_id=p_workspace AND provider=p_provider AND capability=p_capability AND state IN('reserved','settled','uncertain');
 IF(daily_limit IS NOT NULL AND daily_used+1>daily_limit) OR(monthly_limit IS NOT NULL AND monthly_used+p_estimated_input_tokens+p_maximum_output_tokens>monthly_limit)
  THEN RAISE EXCEPTION 'ENTERPRISE_AI_BUDGET_EXHAUSTED';END IF;
 INSERT INTO public.enterprise_ai_budget_reservations(receipt_id,job_id,org_id,workspace_id,actor_id,authorization_version,route_id,provider_config_id,
  provider,capability,model,state,estimated_input_tokens,maximum_output_tokens,execution_token,execution_fence,day_bucket,month_bucket)
 VALUES(p_receipt,p_job,p_org,p_workspace,p_actor,p_authorization_version,p_route,p_provider_config,p_provider,p_capability,p_model,'reserved',
  p_estimated_input_tokens,p_maximum_output_tokens,p_execution_token,p_execution_fence,day_value,month_value) RETURNING * INTO reservation;
 RETURN public.enterprise_ai_budget_result(reservation,true,false);
EXCEPTION WHEN SQLSTATE 'P0001' THEN
 IF SQLERRM LIKE '%ENTERPRISE_AI_BUDGET_EXHAUSTED%' THEN RETURN jsonb_build_object('errorCode','BUDGET_EXHAUSTED');END IF;
 IF SQLERRM LIKE '%PR1B_AUTHORIZATION_STALE%' THEN RETURN jsonb_build_object('errorCode','AUTHORIZATION_STALE');END IF;
 IF SQLERRM LIKE '%PR1B_NOT_FOUND%' THEN RETURN jsonb_build_object('errorCode','PERMISSION_DENIED');END IF;
 IF SQLERRM LIKE '%ENTERPRISE_AI_PROVIDER_ROUTE_STALE%' THEN RETURN jsonb_build_object('errorCode','PROVIDER_ROUTE_STALE');END IF;
 RAISE;
END$$;

-- The retained legacy transition overloads still perform current-authority
-- checks. Bind the new capability explicitly instead of allowing their
-- historical ELSE branch to treat it as Studio document approval. The v2
-- post-effect transitions intentionally retain their accepted exact
-- reservation/receipt/job/fence identity without re-authorizing after the
-- provider cut point.
DO $studio_source_budget_transition_authority$
DECLARE fn regprocedure;definition text;
 old_mapping text:='required_capability:=CASE WHEN p_capability LIKE ''assess.%'' THEN ''evidence.write'' WHEN p_capability=''delivery.work_items.draft'' THEN ''project.manage'' WHEN p_capability=''modernization.rationale.draft'' THEN ''portfolio.manage'' WHEN p_capability=''assemble.blueprint.draft'' THEN ''assemble.manage'' ELSE ''docs.approve'' END;';
 new_mapping text:='required_capability:=CASE WHEN p_capability LIKE ''assess.%'' THEN ''evidence.write'' WHEN p_capability=''studio.evidence.extract'' THEN ''studio.sources.manage'' WHEN p_capability=''delivery.work_items.draft'' THEN ''project.manage'' WHEN p_capability=''modernization.rationale.draft'' THEN ''portfolio.manage'' WHEN p_capability=''assemble.blueprint.draft'' THEN ''assemble.manage'' ELSE ''docs.approve'' END;';
BEGIN
 FOREACH fn IN ARRAY ARRAY[
  'public.enterprise_ai_settle_provider_budget(uuid,uuid,uuid,bigint,uuid,uuid,uuid,bigint,uuid,uuid,text,text,text,uuid,integer,integer,integer)'::regprocedure,
  'public.enterprise_ai_mark_provider_budget_uncertain(uuid,uuid,uuid,bigint,uuid,uuid,uuid,bigint,uuid,uuid,text,text,text,uuid,text)'::regprocedure,
  'public.enterprise_ai_release_provider_budget(uuid,uuid,uuid,bigint,uuid,uuid,uuid,bigint,uuid,uuid,text,text,text,uuid,text)'::regprocedure
 ] LOOP
  SELECT pg_get_functiondef(fn) INTO STRICT definition;
  IF position(new_mapping IN definition)>0 AND position(old_mapping IN definition)=0 THEN CONTINUE;END IF;
  IF length(definition)-length(replace(definition,old_mapping,''))<>length(old_mapping)
    OR position(new_mapping IN definition)>0 THEN RAISE EXCEPTION 'STUDIO_SOURCE_BUDGET_TRANSITION_AUTHORITY_DRIFT';END IF;
  EXECUTE replace(definition,old_mapping,new_mapping);
 END LOOP;
END
$studio_source_budget_transition_authority$;

CREATE OR REPLACE FUNCTION public.enterprise_command_runtime_area(p_command_type text,p_resource_type text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$BEGIN
 IF p_resource_type IS NOT NULL AND p_command_type NOT IN('approval.review.record','approval.record') THEN RAISE EXCEPTION 'ENTERPRISE_AI_INVALID_COMMAND_AREA';END IF;
 CASE p_command_type
  WHEN 'provider.register','provider.secret.bind','provider.validate','provider.activate','provider.route.toggle','provider.secret.rotate','provider.revoke' THEN RETURN 'provider';
  WHEN 'evidence.source.create','evidence.extract','evidence.candidate.review','evidence.assess.promote',
       'transcript.source-set.create-version','transcript.input-bundle.lock','transcript.assess.extract','transcript.assess.candidate.review',
       'transcript.assess.apply.preview','transcript.assess.apply.commit','transcript.assess.conflict.resolve','transcript.journey.set-state',
       'assess.document-map.analyze','assess.document-map.proposal.review','assess.document-map.preview',
       'assess.document-map.conflict.resolve','assess.document-map.commit',
       'studio.source.create','studio.bundle.extract','studio.candidate.review' THEN RETURN 'ingestion';
  WHEN 'modernization.evaluate','studio.delivery.handoff','monitor.baseline.create' THEN RETURN 'delivery';
  WHEN 'assemble.blueprint.create' THEN RETURN 'assemble';
  WHEN 'approval.review.record','approval.record' THEN
   IF p_resource_type='assemble_blueprint' THEN RETURN 'assemble';END IF;
   IF p_resource_type IN('modernization_decision','delivery_work_package','monitor_baseline','evidence_candidate') THEN RETURN 'delivery';END IF;
   RAISE EXCEPTION 'ENTERPRISE_AI_INVALID_COMMAND_AREA';
  ELSE RAISE EXCEPTION 'ENTERPRISE_AI_INVALID_COMMAND_AREA';
 END CASE;
END$$;

CREATE TABLE public.studio_source_version_ownerships(
 source_version_id uuid PRIMARY KEY,source_id uuid NOT NULL,
 org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,workspace_id uuid NOT NULL,
 owner_module text NOT NULL DEFAULT 'studio' CHECK(owner_module='studio'),created_by uuid NOT NULL REFERENCES public.profiles(id),
 created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 UNIQUE(source_version_id,source_id,org_id,workspace_id),
 FOREIGN KEY(workspace_id,org_id) REFERENCES public.workspaces(id,org_id) ON DELETE CASCADE,
 FOREIGN KEY(source_version_id,source_id,org_id,workspace_id)
  REFERENCES public.enterprise_evidence_source_versions(id,source_id,org_id,workspace_id) ON DELETE RESTRICT
);

CREATE TABLE public.studio_source_extraction_runs(
 job_id uuid PRIMARY KEY,org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,workspace_id uuid NOT NULL,
 receipt_id uuid NOT NULL UNIQUE REFERENCES public.enterprise_ai_command_receipts(id) ON DELETE RESTRICT,
 input_bundle_id uuid NOT NULL,input_bundle_version_id uuid NOT NULL,input_bundle_version bigint NOT NULL CHECK(input_bundle_version>0),
 bundle_hash text NOT NULL CHECK(bundle_hash~'^[0-9a-f]{64}$'),route_id uuid NOT NULL,provider_config_id uuid NOT NULL,
 provider text NOT NULL CHECK(provider IN('openai','azure_openai','anthropic','gemini','groq','openai_compatible')),
 model text NOT NULL CHECK(length(btrim(model)) BETWEEN 1 AND 200),prompt_key text NOT NULL CHECK(prompt_key='studio.evidence.extract'),
 prompt_version text NOT NULL CHECK(length(btrim(prompt_version)) BETWEEN 1 AND 120),request_hash text NOT NULL CHECK(request_hash~'^[0-9a-f]{64}$'),
 authorization_version bigint NOT NULL CHECK(authorization_version>0),execution_token uuid NOT NULL,execution_fence bigint NOT NULL CHECK(execution_fence>0),
 status text NOT NULL CHECK(status IN('running','staged','succeeded','failed','uncertain')),
 staged_candidates jsonb CHECK(staged_candidates IS NULL OR jsonb_typeof(staged_candidates)='array'),
 safe_result jsonb CHECK(safe_result IS NULL OR jsonb_typeof(safe_result)='object'),
 output_hash text CHECK(output_hash IS NULL OR output_hash~'^[0-9a-f]{64}$'),token_input integer CHECK(token_input IS NULL OR token_input>=0),
 token_output integer CHECK(token_output IS NULL OR token_output>=0),candidate_count integer NOT NULL DEFAULT 0 CHECK(candidate_count BETWEEN 0 AND 200),
 failure_code text CHECK(failure_code IS NULL OR failure_code~'^[A-Z0-9_]{1,80}$'),created_by uuid NOT NULL REFERENCES public.profiles(id),
 created_at timestamptz NOT NULL DEFAULT statement_timestamp(),completed_at timestamptz,
 UNIQUE(job_id,org_id,workspace_id),
 FOREIGN KEY(workspace_id,org_id) REFERENCES public.workspaces(id,org_id) ON DELETE CASCADE,
 FOREIGN KEY(job_id,org_id) REFERENCES public.enterprise_ai_job_ledger(id,org_id) ON DELETE RESTRICT,
 FOREIGN KEY(input_bundle_version_id,input_bundle_id,org_id,workspace_id)
  REFERENCES public.enterprise_module_input_bundle_versions(id,input_bundle_id,org_id,workspace_id) ON DELETE RESTRICT,
 FOREIGN KEY(route_id,org_id,workspace_id) REFERENCES public.enterprise_ai_capability_routes(id,org_id,workspace_id) ON DELETE RESTRICT,
 FOREIGN KEY(provider_config_id,org_id) REFERENCES public.ai_provider_configs(id,org_id) ON DELETE RESTRICT
);

CREATE TABLE public.studio_source_extraction_bindings(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),job_id uuid NOT NULL,org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
 workspace_id uuid NOT NULL,input_bundle_id uuid NOT NULL,input_bundle_version_id uuid NOT NULL,input_bundle_version bigint NOT NULL CHECK(input_bundle_version>0),
 source_set_id uuid NOT NULL,source_set_version_id uuid NOT NULL,source_set_version bigint NOT NULL CHECK(source_set_version>0),
 source_id uuid NOT NULL,source_version_id uuid NOT NULL,ordinal integer NOT NULL CHECK(ordinal BETWEEN 1 AND 20),
 created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 UNIQUE(id,org_id,workspace_id),UNIQUE(job_id,source_version_id),UNIQUE(job_id,ordinal),
 FOREIGN KEY(job_id,org_id,workspace_id) REFERENCES public.studio_source_extraction_runs(job_id,org_id,workspace_id) ON DELETE RESTRICT,
 FOREIGN KEY(input_bundle_version_id,input_bundle_id,org_id,workspace_id)
  REFERENCES public.enterprise_module_input_bundle_versions(id,input_bundle_id,org_id,workspace_id) ON DELETE RESTRICT,
 FOREIGN KEY(source_set_version_id,source_set_id,org_id,workspace_id)
  REFERENCES public.enterprise_source_set_versions(id,source_set_id,org_id,workspace_id) ON DELETE RESTRICT,
 FOREIGN KEY(source_version_id,source_id,org_id,workspace_id)
  REFERENCES public.enterprise_evidence_source_versions(id,source_id,org_id,workspace_id) ON DELETE RESTRICT
);

-- One-time compatibility authority for Studio bundles that were validly
-- populated through the retained pre-correction transcript binding path. The
-- immutable snapshot is the only compatibility exception; the original table
-- is closed to all future Studio-owned bundle inserts below.
CREATE TABLE public.studio_legacy_extraction_binding_compatibility(
 binding_id uuid PRIMARY KEY,job_id uuid NOT NULL,receipt_id uuid NOT NULL,
 org_id uuid NOT NULL,workspace_id uuid NOT NULL,input_bundle_id uuid NOT NULL,input_bundle_version_id uuid NOT NULL,
 bundle_hash text NOT NULL CHECK(bundle_hash~'^[0-9a-f]{64}$'),source_set_id uuid NOT NULL,source_set_version_id uuid NOT NULL,
 source_id uuid NOT NULL,source_version_id uuid NOT NULL,provider_route_id uuid NOT NULL,provider_config_id uuid NOT NULL,
 model text NOT NULL,authorization_version bigint NOT NULL,created_by uuid NOT NULL,original_created_at timestamptz NOT NULL,
 lineage_hash text NOT NULL CHECK(lineage_hash~'^[0-9a-f]{64}$'),snapshotted_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 UNIQUE(job_id,source_version_id),UNIQUE(binding_id,org_id,workspace_id)
);
INSERT INTO public.studio_legacy_extraction_binding_compatibility(
 binding_id,job_id,receipt_id,org_id,workspace_id,input_bundle_id,input_bundle_version_id,bundle_hash,
 source_set_id,source_set_version_id,source_id,source_version_id,provider_route_id,provider_config_id,model,
 authorization_version,created_by,original_created_at,lineage_hash
)
SELECT binding.id,binding.job_id,binding.receipt_id,binding.org_id,binding.workspace_id,binding.input_bundle_id,
 binding.input_bundle_version_id,binding.bundle_hash,binding.source_set_id,binding.source_set_version_id,binding.source_id,
 binding.source_version_id,binding.provider_route_id,binding.provider_config_id,binding.model,binding.authorization_version,
 binding.created_by,binding.created_at,public.enterprise_sha256_jsonb(jsonb_build_object(
  'bindingId',binding.id,'jobId',binding.job_id,'receiptId',binding.receipt_id,'organizationId',binding.org_id,
  'workspaceId',binding.workspace_id,'inputBundleId',binding.input_bundle_id,'inputBundleVersionId',binding.input_bundle_version_id,
  'bundleHash',binding.bundle_hash,'sourceSetId',binding.source_set_id,'sourceSetVersionId',binding.source_set_version_id,
  'sourceId',binding.source_id,'sourceVersionId',binding.source_version_id,'providerRouteId',binding.provider_route_id,
  'providerConfigId',binding.provider_config_id,'model',binding.model,'authorizationVersion',binding.authorization_version,
  'createdBy',binding.created_by,'createdAt',binding.created_at
 ))
FROM public.enterprise_transcript_extraction_bindings binding
JOIN public.enterprise_module_input_bundles bundle ON bundle.id=binding.input_bundle_id AND bundle.org_id=binding.org_id
 AND bundle.workspace_id=binding.workspace_id AND bundle.owner_module='studio'
JOIN public.enterprise_module_input_bundle_versions version ON version.id=binding.input_bundle_version_id
 AND version.input_bundle_id=bundle.id AND version.org_id=binding.org_id AND version.workspace_id=binding.workspace_id;

CREATE TABLE public.studio_source_candidate_decisions(
 candidate_id uuid PRIMARY KEY,job_id uuid NOT NULL,binding_id uuid NOT NULL,
 org_id uuid NOT NULL,workspace_id uuid NOT NULL,input_bundle_id uuid NOT NULL,input_bundle_version_id uuid NOT NULL,
 source_set_id uuid NOT NULL,source_set_version_id uuid NOT NULL,source_id uuid NOT NULL,source_version_id uuid NOT NULL,
 decision_status text NOT NULL CHECK(decision_status IN('accepted','edited','rejected')),candidate_version bigint NOT NULL CHECK(candidate_version>0),
 candidate_provenance_hash text NOT NULL CHECK(candidate_provenance_hash~'^[0-9a-f]{64}$'),
 excerpt_hash text NOT NULL CHECK(excerpt_hash~'^[0-9a-f]{64}$'),value_hash text NOT NULL CHECK(value_hash~'^[0-9a-f]{64}$'),
 reason_hash text NOT NULL CHECK(reason_hash~'^[0-9a-f]{64}$'),reviewed_by uuid NOT NULL,reviewer_authorization_version bigint NOT NULL CHECK(reviewer_authorization_version>0),
 receipt_id uuid NOT NULL,execution_fence bigint NOT NULL CHECK(execution_fence>0),reviewed_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 UNIQUE(binding_id,candidate_id),UNIQUE(candidate_id,org_id,workspace_id),
 FOREIGN KEY(binding_id,org_id,workspace_id) REFERENCES public.studio_source_extraction_bindings(id,org_id,workspace_id) ON DELETE RESTRICT,
 FOREIGN KEY(candidate_id,org_id,workspace_id) REFERENCES public.enterprise_evidence_candidates(id,org_id,workspace_id) ON DELETE RESTRICT
);

CREATE OR REPLACE FUNCTION public.studio_source_append_only_guard_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$BEGIN RAISE EXCEPTION 'STUDIO_SOURCE_HISTORY_IMMUTABLE';END$$;
CREATE TRIGGER studio_legacy_extraction_binding_compatibility_immutable BEFORE UPDATE OR DELETE ON public.studio_legacy_extraction_binding_compatibility
 FOR EACH ROW EXECUTE FUNCTION public.studio_source_append_only_guard_v1();
CREATE TRIGGER studio_source_candidate_decisions_immutable BEFORE UPDATE OR DELETE ON public.studio_source_candidate_decisions
 FOR EACH ROW EXECUTE FUNCTION public.studio_source_append_only_guard_v1();

ALTER TABLE public.studio_source_version_ownerships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.studio_source_extraction_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.studio_source_extraction_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.studio_legacy_extraction_binding_compatibility ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.studio_source_candidate_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.studio_source_version_ownerships FORCE ROW LEVEL SECURITY;
ALTER TABLE public.studio_source_extraction_runs FORCE ROW LEVEL SECURITY;
ALTER TABLE public.studio_source_extraction_bindings FORCE ROW LEVEL SECURITY;
ALTER TABLE public.studio_legacy_extraction_binding_compatibility FORCE ROW LEVEL SECURITY;
ALTER TABLE public.studio_source_candidate_decisions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.studio_source_version_ownerships,public.studio_source_extraction_runs,public.studio_source_extraction_bindings,
 public.studio_legacy_extraction_binding_compatibility,public.studio_source_candidate_decisions FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON TABLE public.studio_source_version_ownerships,public.studio_source_extraction_runs,public.studio_source_extraction_bindings TO service_role;
GRANT SELECT ON TABLE public.studio_legacy_extraction_binding_compatibility,public.studio_source_candidate_decisions TO service_role;

CREATE OR REPLACE FUNCTION public.studio_source_assert_receipt_v1(
 p_receipt uuid,p_actor uuid,p_org uuid,p_workspace uuid,p_command text,p_authorization_version bigint,
 p_execution_token uuid,p_execution_fence bigint,p_require_provider boolean DEFAULT false
) RETURNS public.enterprise_ai_command_receipts LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE receipt public.enterprise_ai_command_receipts;flags public.enterprise_transcript_workspace_flags;
BEGIN
 SELECT * INTO receipt FROM public.enterprise_ai_command_receipts WHERE id=p_receipt AND org_id=p_org AND workspace_id=p_workspace FOR UPDATE;
 IF receipt.id IS NULL OR receipt.status<>'claimed' OR receipt.actor_id IS DISTINCT FROM p_actor OR receipt.command_type IS DISTINCT FROM p_command
  OR receipt.execution_token IS DISTINCT FROM p_execution_token OR receipt.execution_fence IS DISTINCT FROM p_execution_fence THEN
  RAISE EXCEPTION 'ENTERPRISE_AI_STALE_EXECUTION_FENCE';END IF;
 PERFORM public.enterprise_assert_writable('ingestion');
 PERFORM public.pr1b_assert_command_authority(p_actor,p_org,p_workspace,'studio.sources.manage',p_authorization_version);
 SELECT * INTO flags FROM public.enterprise_transcript_workspace_flags WHERE org_id=p_org AND workspace_id=p_workspace FOR SHARE;
 IF flags.org_id IS NULL OR NOT flags.studio_multisource_enabled OR NOT flags.studio_source_integration_enabled
  OR(p_require_provider AND NOT flags.unified_byok_gateway_enabled) THEN RAISE EXCEPTION 'ENTERPRISE_TRANSCRIPT_FEATURE_DISABLED';END IF;
 RETURN receipt;
END$$;

CREATE OR REPLACE FUNCTION public.studio_source_create_preflight_v1(
 p_actor uuid,p_org uuid,p_workspace uuid,p_authorization_version bigint,
 p_receipt uuid,p_execution_token uuid,p_execution_fence bigint
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM public.studio_source_assert_receipt_v1(p_receipt,p_actor,p_org,p_workspace,'studio.source.create',
  p_authorization_version,p_execution_token,p_execution_fence,false);
 RETURN jsonb_build_object('allowed',true,'ownerModule','studio');
END$$;

CREATE OR REPLACE FUNCTION public.studio_create_evidence_source_record_v1(
 p_source jsonb,p_version jsonb,p_actor uuid,p_authorization_version bigint,p_receipt uuid,p_execution_token uuid,p_execution_fence bigint,p_result jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE committed jsonb;receipt public.enterprise_ai_command_receipts;
BEGIN
 receipt:=public.studio_source_assert_receipt_v1(p_receipt,p_actor,(p_source->>'org_id')::uuid,(p_source->>'workspace_id')::uuid,
  'studio.source.create',p_authorization_version,p_execution_token,p_execution_fence,false);
 IF (p_source->>'created_by')::uuid IS DISTINCT FROM p_actor OR (p_version->>'created_by')::uuid IS DISTINCT FROM p_actor THEN
  RAISE EXCEPTION 'STUDIO_SOURCE_INVALID';END IF;
 committed:=public.enterprise_create_evidence_source(p_source,p_version);
 INSERT INTO public.studio_source_version_ownerships(source_version_id,source_id,org_id,workspace_id,created_by)
 VALUES((p_version->>'id')::uuid,(p_source->>'id')::uuid,(p_source->>'org_id')::uuid,(p_source->>'workspace_id')::uuid,p_actor);
 PERFORM public.enterprise_ai_record_effect(p_receipt,(p_source->>'org_id')::uuid,(p_source->>'workspace_id')::uuid,
  p_execution_token,p_execution_fence,'studio.source.create','source-record',(p_source->>'id')::uuid,p_result,'committed');
 RETURN committed;
END$$;

CREATE OR REPLACE FUNCTION public.studio_record_source_extraction_success_v1(
 p_source_version uuid,p_org uuid,p_workspace uuid,p_extracted_text_hash text,p_extracted_character_count integer,
 p_actor uuid,p_authorization_version bigint,p_receipt uuid,p_execution_token uuid,p_execution_fence bigint,p_result jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ownership public.studio_source_version_ownerships;version public.enterprise_evidence_source_versions;
BEGIN
 PERFORM public.studio_source_assert_receipt_v1(p_receipt,p_actor,p_org,p_workspace,'studio.source.create',p_authorization_version,p_execution_token,p_execution_fence,false);
 SELECT * INTO ownership FROM public.studio_source_version_ownerships WHERE source_version_id=p_source_version AND org_id=p_org AND workspace_id=p_workspace FOR SHARE;
 SELECT * INTO version FROM public.enterprise_evidence_source_versions WHERE id=p_source_version AND org_id=p_org AND workspace_id=p_workspace FOR UPDATE;
 IF ownership.source_version_id IS NULL OR version.id IS NULL OR version.extraction_status<>'pending'
  OR p_extracted_text_hash!~'^[0-9a-f]{64}$' OR p_extracted_character_count<1 THEN RAISE EXCEPTION 'STUDIO_SOURCE_STALE';END IF;
 UPDATE public.enterprise_evidence_source_versions SET extraction_status='parsed',extracted_text_hash=p_extracted_text_hash,
  extracted_character_count=p_extracted_character_count,extraction_failure_code=NULL WHERE id=version.id;
 UPDATE public.enterprise_evidence_sources SET status='review',lifecycle_version=lifecycle_version+1,updated_at=statement_timestamp()
  WHERE id=version.source_id AND org_id=p_org AND workspace_id=p_workspace;
 PERFORM public.enterprise_ai_record_effect(p_receipt,p_org,p_workspace,p_execution_token,p_execution_fence,'studio.source.create','command',ownership.source_id,p_result,'committed');
 RETURN jsonb_build_object('sourceVersionId',p_source_version,'status','parsed');
END$$;

CREATE OR REPLACE FUNCTION public.studio_record_source_extraction_failure_v1(
 p_source_version uuid,p_org uuid,p_workspace uuid,p_failure_code text,p_actor uuid,p_authorization_version bigint,
 p_receipt uuid,p_execution_token uuid,p_execution_fence bigint,p_result jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ownership public.studio_source_version_ownerships;version public.enterprise_evidence_source_versions;committed jsonb;
BEGIN
 PERFORM public.studio_source_assert_receipt_v1(p_receipt,p_actor,p_org,p_workspace,'studio.source.create',p_authorization_version,p_execution_token,p_execution_fence,false);
 SELECT * INTO ownership FROM public.studio_source_version_ownerships WHERE source_version_id=p_source_version AND org_id=p_org AND workspace_id=p_workspace FOR SHARE;
 SELECT * INTO version FROM public.enterprise_evidence_source_versions WHERE id=p_source_version AND org_id=p_org AND workspace_id=p_workspace FOR UPDATE;
 IF ownership.source_version_id IS NULL OR version.id IS NULL OR version.extraction_status<>'pending'
  OR p_failure_code NOT IN('OCR_REQUIRED','UNSUPPORTED_FORMAT','MALFORMED_SOURCE') THEN RAISE EXCEPTION 'STUDIO_SOURCE_STALE';END IF;
 UPDATE public.enterprise_evidence_source_versions SET extraction_status=CASE p_failure_code WHEN 'OCR_REQUIRED' THEN 'failed_ocr_required'
  WHEN 'UNSUPPORTED_FORMAT' THEN 'failed_unsupported' ELSE 'failed_malformed' END,extraction_failure_code=p_failure_code WHERE id=version.id;
 UPDATE public.enterprise_evidence_sources SET status='failed',lifecycle_version=lifecycle_version+1,updated_at=statement_timestamp()
  WHERE id=version.source_id AND org_id=p_org AND workspace_id=p_workspace;
 committed:=jsonb_build_object('sourceVersionId',p_source_version,'status','failed','failureCode',p_failure_code);
 PERFORM public.enterprise_ai_record_effect(p_receipt,p_org,p_workspace,p_execution_token,p_execution_fence,'studio.source.create','command',ownership.source_id,p_result,'committed');
 RETURN committed;
END$$;

CREATE OR REPLACE FUNCTION public.studio_source_set_owner_guard_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$DECLARE owner text;BEGIN
 SELECT owner_module INTO owner FROM public.enterprise_source_sets WHERE id=NEW.source_set_id;
 IF owner='assess' AND EXISTS(SELECT 1 FROM public.studio_source_version_ownerships o
  WHERE o.source_version_id=NEW.source_version_id AND o.source_id=NEW.source_id AND o.org_id=NEW.org_id AND o.workspace_id=NEW.workspace_id) THEN
  RAISE EXCEPTION 'STUDIO_PRIVATE_SOURCE_OWNER_MISMATCH';END IF;
 RETURN NEW;
END$$;
CREATE TRIGGER studio_source_set_owner_guard_before_insert BEFORE INSERT ON public.enterprise_source_set_version_items
 FOR EACH ROW EXECUTE FUNCTION public.studio_source_set_owner_guard_v1();

CREATE OR REPLACE FUNCTION public.enterprise_assess_extraction_owner_guard_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.enterprise_module_input_bundles b WHERE b.id=NEW.input_bundle_id AND b.org_id=NEW.org_id
  AND b.workspace_id=NEW.workspace_id AND b.owner_module='assess') THEN RAISE EXCEPTION 'ENTERPRISE_TRANSCRIPT_EXTRACTION_BINDING_STALE';END IF;
 RETURN NEW;
END$$;
CREATE TRIGGER enterprise_assess_extraction_owner_guard_before_insert BEFORE INSERT ON public.enterprise_transcript_extraction_bindings
 FOR EACH ROW EXECUTE FUNCTION public.enterprise_assess_extraction_owner_guard_v1();

CREATE OR REPLACE FUNCTION public.enterprise_assert_assess_evidence_authority_v1(
 p_source_version uuid,p_candidate uuid,p_org uuid,p_workspace uuid
) RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.studio_source_version_ownerships ownership
   WHERE ownership.source_version_id=p_source_version AND ownership.org_id=p_org AND ownership.workspace_id=p_workspace)
  OR(p_candidate IS NOT NULL AND EXISTS(
   SELECT 1 FROM public.enterprise_evidence_candidates candidate
   JOIN public.studio_source_extraction_runs run ON run.job_id=candidate.ai_job_id AND run.org_id=candidate.org_id AND run.workspace_id=candidate.workspace_id
   WHERE candidate.id=p_candidate AND candidate.source_version_id=p_source_version
    AND candidate.org_id=p_org AND candidate.workspace_id=p_workspace
  )) THEN RAISE EXCEPTION 'ENTERPRISE_EVIDENCE_RESOURCE_NOT_FOUND';END IF;
END$$;

CREATE OR REPLACE FUNCTION public.enterprise_assess_evidence_job_owner_guard_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$BEGIN
 IF NEW.capability='assess.evidence.extract' AND NEW.source_version_id IS NOT NULL THEN
  PERFORM public.enterprise_assert_assess_evidence_authority_v1(NEW.source_version_id,NULL,NEW.org_id,NEW.workspace_id);
 END IF;
 RETURN NEW;
END$$;
CREATE TRIGGER enterprise_assess_evidence_job_owner_guard_before_insert BEFORE INSERT ON public.enterprise_ai_job_ledger
 FOR EACH ROW EXECUTE FUNCTION public.enterprise_assess_evidence_job_owner_guard_v1();

CREATE OR REPLACE FUNCTION public.enterprise_assess_promotion_owner_guard_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$BEGIN
 PERFORM public.enterprise_assert_assess_evidence_authority_v1(NEW.source_version_id,NEW.candidate_id,NEW.org_id,NEW.workspace_id);
 RETURN NEW;
END$$;
CREATE TRIGGER enterprise_assess_promotion_owner_guard_before_insert BEFORE INSERT ON public.enterprise_evidence_assess_promotions
 FOR EACH ROW EXECUTE FUNCTION public.enterprise_assess_promotion_owner_guard_v1();

-- Keep the generic receipt-aware review ABI, but close it over Assess-owned
-- evidence before it can mutate a Studio candidate or append an effect.
CREATE OR REPLACE FUNCTION public.enterprise_review_evidence_candidate(
 p_candidate_id uuid,p_org uuid,p_workspace uuid,p_value text,p_excerpt_hash text,
 p_status text,p_actor uuid,p_previous_value text,p_reason text,
 p_receipt uuid,p_execution_token uuid,p_execution_fence bigint,p_result jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE candidate public.enterprise_evidence_candidates;committed jsonb;
BEGIN
 SELECT * INTO candidate FROM public.enterprise_evidence_candidates
  WHERE id=p_candidate_id AND org_id=p_org AND workspace_id=p_workspace FOR SHARE;
 IF candidate.id IS NULL THEN RAISE EXCEPTION 'ENTERPRISE_EVIDENCE_RESOURCE_NOT_FOUND';END IF;
 PERFORM public.enterprise_assert_assess_evidence_authority_v1(candidate.source_version_id,candidate.id,p_org,p_workspace);
 committed:=public.enterprise_review_evidence_candidate(
  p_candidate_id,p_org,p_workspace,p_value,p_excerpt_hash,p_status,p_actor,p_previous_value,p_reason
 );
 PERFORM public.enterprise_ai_record_effect(p_receipt,p_org,p_workspace,p_execution_token,p_execution_fence,
  'evidence.candidate.review','command',p_candidate_id,p_result,'committed');
 RETURN committed;
END$$;
REVOKE ALL ON FUNCTION public.enterprise_review_evidence_candidate(uuid,uuid,uuid,text,text,text,uuid,text,text) FROM service_role;

CREATE OR REPLACE FUNCTION public.studio_claim_source_extraction_v1(
 p_job uuid,p_bundle uuid,p_bundle_version uuid,p_expected_bundle_version bigint,p_bindings jsonb,
 p_route uuid,p_provider_config uuid,p_provider text,p_model text,p_prompt_key text,p_prompt_version text,p_request_hash text,
 p_actor uuid,p_org uuid,p_workspace uuid,p_authorization_version bigint,p_receipt uuid,p_execution_token uuid,p_execution_fence bigint
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE receipt public.enterprise_ai_command_receipts;bundle public.enterprise_module_input_bundles;bundle_version_record public.enterprise_module_input_bundle_versions;
 run public.studio_source_extraction_runs;entry jsonb;binding_count integer:=0;
BEGIN
 receipt:=public.studio_source_assert_receipt_v1(p_receipt,p_actor,p_org,p_workspace,'studio.bundle.extract',p_authorization_version,p_execution_token,p_execution_fence,true);
 IF jsonb_typeof(p_bindings)<>'array' OR jsonb_array_length(p_bindings) NOT BETWEEN 1 AND 20 OR p_prompt_key<>'studio.evidence.extract'
  OR p_request_hash!~'^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'STUDIO_SOURCE_EXTRACTION_INVALID';END IF;
 SELECT * INTO bundle FROM public.enterprise_module_input_bundles WHERE id=p_bundle AND org_id=p_org AND workspace_id=p_workspace AND owner_module='studio' FOR SHARE;
 SELECT * INTO bundle_version_record FROM public.enterprise_module_input_bundle_versions WHERE id=p_bundle_version AND input_bundle_id=p_bundle
  AND version=p_expected_bundle_version AND org_id=p_org AND workspace_id=p_workspace AND status='locked' FOR SHARE;
 IF bundle.id IS NULL OR bundle_version_record.id IS NULL OR bundle.current_version IS DISTINCT FROM bundle_version_record.version THEN RAISE EXCEPTION 'STUDIO_SOURCE_EXTRACTION_STALE';END IF;
 SELECT * INTO run FROM public.studio_source_extraction_runs WHERE receipt_id=p_receipt FOR UPDATE;
 IF run.job_id IS NOT NULL THEN
  IF run.job_id IS DISTINCT FROM p_job OR run.input_bundle_version_id IS DISTINCT FROM p_bundle_version OR run.request_hash IS DISTINCT FROM p_request_hash
   OR run.execution_fence>p_execution_fence THEN RAISE EXCEPTION 'STUDIO_SOURCE_EXTRACTION_STALE';END IF;
  IF run.status='succeeded' THEN RETURN jsonb_build_object('state','committed','ownsExecution',false,'jobId',run.job_id,'safeResult',run.safe_result);END IF;
  IF run.status IN('failed','uncertain') THEN RETURN jsonb_build_object('state',run.status,'ownsExecution',false,'jobId',run.job_id,'safeResult',run.safe_result);END IF;
  IF run.execution_token IS DISTINCT FROM p_execution_token OR run.execution_fence IS DISTINCT FROM p_execution_fence THEN
   IF run.status='running' THEN
    UPDATE public.studio_source_extraction_runs SET status='uncertain',failure_code='RECOVERY_AFTER_UNCONFIRMED_ATTEMPT',
     safe_result=jsonb_build_object('resourceId',run.job_id,'jobId',run.job_id,'status','uncertain','failureCode','RECOVERY_AFTER_UNCONFIRMED_ATTEMPT')
     WHERE job_id=run.job_id RETURNING * INTO run;
    RETURN jsonb_build_object('state','uncertain','ownsExecution',false,'jobId',run.job_id,'safeResult',run.safe_result);
   END IF;
   UPDATE public.studio_source_extraction_runs SET execution_token=p_execution_token,execution_fence=p_execution_fence WHERE job_id=run.job_id RETURNING * INTO run;
  END IF;
  IF run.status='staged' THEN RETURN jsonb_build_object('state','staged','ownsExecution',true,'jobId',run.job_id,'safeResult',run.safe_result);END IF;
  RETURN jsonb_build_object('state','running','ownsExecution',true,'jobId',run.job_id);
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.enterprise_ai_capability_routes r JOIN public.ai_provider_configs c ON c.id=r.provider_config_id AND c.org_id=r.org_id
  WHERE r.id=p_route AND r.org_id=p_org AND r.workspace_id=p_workspace AND r.provider_config_id=p_provider_config
   AND r.capability='studio.evidence.extract' AND r.model=p_model AND r.enabled AND r.deleted_at IS NULL
   AND c.provider=p_provider AND c.status='active') THEN RAISE EXCEPTION 'ENTERPRISE_PROVIDER_ROUTE_BLOCKED';END IF;
 INSERT INTO public.enterprise_ai_job_ledger(id,org_id,workspace_id,capability,provider_config_id,provider,model,prompt_key,prompt_version,
  source_refs,actor_id,request_id,idempotency_key,status,approval_state,receipt_id,request_hash,execution_token,execution_fence,
  attempt_lease_expires_at,attempt_count,recovery_count,last_attempt_at,route_id)
 VALUES(p_job,p_org,p_workspace,'studio.evidence.extract',p_provider_config,p_provider,p_model,p_prompt_key,p_prompt_version,p_bindings,
  p_actor,receipt.initial_request_id,receipt.id::text,'running','review_required',p_receipt,p_request_hash,p_execution_token,p_execution_fence,
  statement_timestamp()+interval '2 minutes',1,0,statement_timestamp(),p_route);
 INSERT INTO public.studio_source_extraction_runs(job_id,org_id,workspace_id,receipt_id,input_bundle_id,input_bundle_version_id,input_bundle_version,
  bundle_hash,route_id,provider_config_id,provider,model,prompt_key,prompt_version,request_hash,authorization_version,execution_token,execution_fence,status,created_by)
 VALUES(p_job,p_org,p_workspace,p_receipt,p_bundle,p_bundle_version,p_expected_bundle_version,bundle_version_record.bundle_hash,p_route,p_provider_config,p_provider,p_model,
  p_prompt_key,p_prompt_version,p_request_hash,p_authorization_version,p_execution_token,p_execution_fence,'running',p_actor) RETURNING * INTO run;
 FOR entry IN SELECT value FROM jsonb_array_elements(p_bindings) ORDER BY(value->>'ordinal')::integer LOOP
  IF COALESCE(entry->>'ordinal','')!~'^[1-9][0-9]*$' OR NOT EXISTS(
   SELECT 1 FROM public.enterprise_module_input_bundle_items bi
   JOIN public.enterprise_source_set_versions sv ON sv.id=(entry->>'sourceSetVersionId')::uuid AND sv.source_set_id=(entry->>'sourceSetId')::uuid
    AND sv.version=(entry->>'sourceSetVersion')::bigint AND sv.org_id=p_org AND sv.workspace_id=p_workspace
   JOIN public.enterprise_source_sets ss ON ss.id=sv.source_set_id AND ss.owner_module='studio'
   JOIN public.enterprise_source_set_version_items si ON si.source_set_version_id=sv.id AND si.source_id=(entry->>'sourceId')::uuid
    AND si.source_version_id=(entry->>'sourceVersionId')::uuid
   WHERE bi.input_bundle_version_id=p_bundle_version AND bi.input_bundle_id=p_bundle AND bi.source_set_version_id=sv.id
  ) THEN RAISE EXCEPTION 'STUDIO_SOURCE_EXTRACTION_STALE';END IF;
  INSERT INTO public.studio_source_extraction_bindings(job_id,org_id,workspace_id,input_bundle_id,input_bundle_version_id,input_bundle_version,
   source_set_id,source_set_version_id,source_set_version,source_id,source_version_id,ordinal)
  VALUES(p_job,p_org,p_workspace,p_bundle,p_bundle_version,p_expected_bundle_version,(entry->>'sourceSetId')::uuid,(entry->>'sourceSetVersionId')::uuid,
   (entry->>'sourceSetVersion')::bigint,(entry->>'sourceId')::uuid,(entry->>'sourceVersionId')::uuid,(entry->>'ordinal')::integer);
  binding_count:=binding_count+1;
 END LOOP;
 IF binding_count<>jsonb_array_length(p_bindings) OR binding_count<>(SELECT count(*) FROM public.enterprise_source_set_version_items si
  JOIN public.enterprise_module_input_bundle_items bi ON bi.source_set_version_id=si.source_set_version_id WHERE bi.input_bundle_version_id=p_bundle_version) THEN
  RAISE EXCEPTION 'STUDIO_SOURCE_EXTRACTION_PARTIAL_COVERAGE';END IF;
 RETURN jsonb_build_object('state','owned','ownsExecution',true,'jobId',p_job);
END$$;

CREATE OR REPLACE FUNCTION public.studio_stage_source_extraction_v1(
 p_job uuid,p_candidates jsonb,p_output_hash text,p_token_input integer,p_token_output integer,p_result jsonb,
 p_actor uuid,p_org uuid,p_workspace uuid,p_authorization_version bigint,p_receipt uuid,p_execution_token uuid,p_execution_fence bigint
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE run public.studio_source_extraction_runs;entry jsonb;
BEGIN
 PERFORM public.studio_source_assert_receipt_v1(p_receipt,p_actor,p_org,p_workspace,'studio.bundle.extract',p_authorization_version,p_execution_token,p_execution_fence,true);
 SELECT * INTO run FROM public.studio_source_extraction_runs WHERE job_id=p_job AND receipt_id=p_receipt AND org_id=p_org AND workspace_id=p_workspace FOR UPDATE;
 IF run.job_id IS NULL OR run.status<>'running' OR run.execution_token IS DISTINCT FROM p_execution_token OR run.execution_fence IS DISTINCT FROM p_execution_fence
  OR jsonb_typeof(p_candidates)<>'array' OR jsonb_array_length(p_candidates)>200 OR p_output_hash!~'^[0-9a-f]{64}$'
  OR jsonb_typeof(p_result)<>'object' THEN RAISE EXCEPTION 'STUDIO_SOURCE_EXTRACTION_STALE';END IF;
 FOR entry IN SELECT value FROM jsonb_array_elements(p_candidates) LOOP
  IF NOT EXISTS(SELECT 1 FROM public.studio_source_extraction_bindings b WHERE b.job_id=p_job
   AND b.source_id=(entry->>'sourceId')::uuid AND b.source_version_id=(entry->>'sourceVersionId')::uuid)
   OR entry->>'field' IS NULL OR length(btrim(COALESCE(entry->>'value',''))) NOT BETWEEN 1 AND 12000
   OR length(COALESCE(entry->>'safeExcerpt',''))>1000 OR length(COALESCE(entry->>'sourceLocator',''))>400 THEN
   RAISE EXCEPTION 'STUDIO_SOURCE_EXTRACTION_INVALID';END IF;
 END LOOP;
 UPDATE public.studio_source_extraction_runs SET status='staged',staged_candidates=p_candidates,safe_result=p_result,output_hash=p_output_hash,
  token_input=p_token_input,token_output=p_token_output,candidate_count=jsonb_array_length(p_candidates) WHERE job_id=p_job;
 RETURN p_result;
END$$;

CREATE OR REPLACE FUNCTION public.studio_commit_source_extraction_v1(
 p_job uuid,p_actor uuid,p_org uuid,p_workspace uuid,p_authorization_version bigint,p_receipt uuid,p_execution_token uuid,p_execution_fence bigint
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE run public.studio_source_extraction_runs;entry jsonb;result jsonb;
BEGIN
 PERFORM public.studio_source_assert_receipt_v1(p_receipt,p_actor,p_org,p_workspace,'studio.bundle.extract',p_authorization_version,p_execution_token,p_execution_fence,true);
 SELECT * INTO run FROM public.studio_source_extraction_runs WHERE job_id=p_job AND receipt_id=p_receipt AND org_id=p_org AND workspace_id=p_workspace FOR UPDATE;
 IF run.status='succeeded' THEN RETURN run.safe_result;END IF;
 IF run.job_id IS NULL OR run.status<>'staged' OR run.execution_token IS DISTINCT FROM p_execution_token OR run.execution_fence IS DISTINCT FROM p_execution_fence THEN
  RAISE EXCEPTION 'STUDIO_SOURCE_EXTRACTION_STALE';END IF;
 FOR entry IN SELECT value FROM jsonb_array_elements(run.staged_candidates) LOOP
  INSERT INTO public.enterprise_evidence_candidates(id,source_id,source_version_id,org_id,workspace_id,field_key,value,safe_excerpt,excerpt_hash,
   provenance_hash,source_locator,confidence,ai_job_id,prompt_version,suggestion_status,created_by)
  VALUES((entry->>'id')::uuid,(entry->>'sourceId')::uuid,(entry->>'sourceVersionId')::uuid,p_org,p_workspace,entry->>'field',entry->>'value',
   NULLIF(entry->>'safeExcerpt',''),repeat('0',64),repeat('0',64),entry->>'sourceLocator',(entry->>'confidence')::numeric,p_job,
   entry->>'promptVersion','suggested',(entry->>'createdBy')::uuid);
 END LOOP;
 INSERT INTO public.enterprise_ai_usage_ledger(job_id,provider_config_id,org_id,workspace_id,provider,model,input_tokens,output_tokens)
 VALUES(p_job,run.provider_config_id,p_org,p_workspace,run.provider,run.model,run.token_input,run.token_output);
 result:=(run.safe_result-'status')||jsonb_build_object('status','succeeded');
 UPDATE public.enterprise_ai_job_ledger SET status='succeeded',token_input=run.token_input,token_output=run.token_output,
  output_hash=run.output_hash,completed_at=statement_timestamp() WHERE id=p_job;
 UPDATE public.studio_source_extraction_runs SET status='succeeded',safe_result=result,completed_at=statement_timestamp() WHERE job_id=p_job;
 PERFORM public.enterprise_ai_record_effect(p_receipt,p_org,p_workspace,p_execution_token,p_execution_fence,'studio.bundle.extract','command',p_job,result,'committed');
 RETURN result;
END$$;

CREATE OR REPLACE FUNCTION public.studio_fail_source_extraction_v1(
 p_job uuid,p_failure_code text,p_actor uuid,p_org uuid,p_workspace uuid,p_authorization_version bigint,p_receipt uuid,p_execution_token uuid,p_execution_fence bigint
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE run public.studio_source_extraction_runs;reservation public.enterprise_ai_budget_reservations;next_status text;result jsonb;
BEGIN
 PERFORM public.studio_source_assert_receipt_v1(p_receipt,p_actor,p_org,p_workspace,'studio.bundle.extract',p_authorization_version,p_execution_token,p_execution_fence,true);
 SELECT * INTO run FROM public.studio_source_extraction_runs WHERE job_id=p_job AND receipt_id=p_receipt AND org_id=p_org AND workspace_id=p_workspace FOR UPDATE;
 IF run.job_id IS NULL OR run.status NOT IN('running','staged') OR p_failure_code!~'^[A-Z0-9_]{1,80}$' THEN RAISE EXCEPTION 'STUDIO_SOURCE_EXTRACTION_STALE';END IF;
 SELECT * INTO reservation FROM public.enterprise_ai_budget_reservations WHERE job_id=p_job AND receipt_id=p_receipt FOR SHARE;
 next_status:=CASE WHEN reservation.id IS NULL OR(reservation.state='released' AND reservation.release_reason='before_provider_effect') THEN 'failed' ELSE 'uncertain' END;
 result:=jsonb_build_object('resourceId',p_job,'jobId',p_job,'status',next_status,'failureCode',p_failure_code);
 UPDATE public.studio_source_extraction_runs SET status=next_status,failure_code=p_failure_code,safe_result=result,
  completed_at=CASE WHEN next_status='failed' THEN statement_timestamp() ELSE NULL END WHERE job_id=p_job;
 IF next_status='failed' THEN
  UPDATE public.enterprise_ai_job_ledger SET status='failed',failure_class=p_failure_code,completed_at=statement_timestamp() WHERE id=p_job;
  PERFORM public.enterprise_ai_record_effect(p_receipt,p_org,p_workspace,p_execution_token,p_execution_fence,'studio.bundle.extract','command',p_job,result,'failed');
 END IF;
 RETURN result;
END$$;

CREATE OR REPLACE FUNCTION public.studio_review_source_candidate_v1(
 p_candidate uuid,p_expected_candidate_version bigint,p_job uuid,p_binding uuid,p_bundle uuid,p_bundle_version uuid,p_expected_bundle_version bigint,
 p_source_set uuid,p_source_set_version uuid,p_expected_source_set_version bigint,p_source uuid,p_source_version uuid,
 p_status text,p_value text,p_reason text,p_actor uuid,p_org uuid,p_workspace uuid,p_authorization_version bigint,
 p_receipt uuid,p_execution_token uuid,p_execution_fence bigint
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE candidate public.enterprise_evidence_candidates;binding public.studio_source_extraction_bindings;source_version public.enterprise_evidence_source_versions;
 next_value text;next_hash text;next_excerpt_hash text;result jsonb;
BEGIN
 PERFORM public.studio_source_assert_receipt_v1(p_receipt,p_actor,p_org,p_workspace,'studio.candidate.review',p_authorization_version,p_execution_token,p_execution_fence,false);
 SELECT * INTO candidate FROM public.enterprise_evidence_candidates WHERE id=p_candidate AND org_id=p_org AND workspace_id=p_workspace FOR UPDATE;
 SELECT * INTO binding FROM public.studio_source_extraction_bindings WHERE id=p_binding AND job_id=p_job AND org_id=p_org AND workspace_id=p_workspace FOR SHARE;
 SELECT * INTO source_version FROM public.enterprise_evidence_source_versions WHERE id=p_source_version AND source_id=p_source AND org_id=p_org AND workspace_id=p_workspace FOR SHARE;
 IF candidate.id IS NULL OR candidate.version IS DISTINCT FROM p_expected_candidate_version OR candidate.ai_job_id IS DISTINCT FROM p_job
  OR candidate.source_id IS DISTINCT FROM p_source OR candidate.source_version_id IS DISTINCT FROM p_source_version OR binding.id IS NULL
  OR binding.input_bundle_id IS DISTINCT FROM p_bundle OR binding.input_bundle_version_id IS DISTINCT FROM p_bundle_version
  OR binding.input_bundle_version IS DISTINCT FROM p_expected_bundle_version OR binding.source_set_id IS DISTINCT FROM p_source_set
  OR binding.source_set_version_id IS DISTINCT FROM p_source_set_version OR binding.source_set_version IS DISTINCT FROM p_expected_source_set_version
  OR binding.source_id IS DISTINCT FROM p_source OR binding.source_version_id IS DISTINCT FROM p_source_version
  OR candidate.suggestion_status<>'suggested' OR p_status NOT IN('accepted','rejected','edited')
  OR((p_status IN('rejected','edited')) AND length(btrim(COALESCE(p_reason,'')))<1)
  OR(p_status='edited' AND length(btrim(COALESCE(p_value,''))) NOT BETWEEN 1 AND 12000) THEN RAISE EXCEPTION 'STUDIO_SOURCE_CANDIDATE_STALE';END IF;
 next_value:=CASE WHEN p_status='edited' THEN p_value ELSE candidate.value END;
 IF source_version.id IS NULL THEN RAISE EXCEPTION 'STUDIO_SOURCE_CANDIDATE_STALE';END IF;
 next_excerpt_hash:=CASE WHEN p_status='edited' THEN public.enterprise_evidence_excerpt_anchor_hash(
  p_source_version,source_version.content_hash,source_version.extracted_text_hash,candidate.source_locator,candidate.safe_excerpt,next_value
 ) ELSE candidate.excerpt_hash END;
 next_hash:=public.enterprise_sha256_jsonb(jsonb_build_object('sourceVersionId',candidate.source_version_id,'sourceContentHash',source_version.content_hash,
  'extractedTextHash',source_version.extracted_text_hash,'sourceLocator',candidate.source_locator,'safeExcerpt',candidate.safe_excerpt,
  'fieldKey',candidate.field_key,'value',next_value,'candidateVersion',candidate.version+CASE WHEN p_status='edited' THEN 1 ELSE 0 END));
 IF p_status='edited' THEN INSERT INTO public.enterprise_evidence_candidate_edits(candidate_id,org_id,workspace_id,actor_id,previous_value,next_value,
  previous_version,resulting_version,previous_provenance_hash,resulting_provenance_hash,reason)
  VALUES(candidate.id,p_org,p_workspace,p_actor,candidate.value,next_value,candidate.version,candidate.version+1,candidate.provenance_hash,next_hash,p_reason);END IF;
 UPDATE public.enterprise_evidence_candidates SET value=next_value,excerpt_hash=next_excerpt_hash,suggestion_status=p_status,reviewed_by=p_actor,reviewed_at=statement_timestamp(),
  updated_at=statement_timestamp(),version=version+CASE WHEN p_status='edited' THEN 1 ELSE 0 END,provenance_hash=next_hash WHERE id=candidate.id RETURNING * INTO candidate;
 INSERT INTO public.studio_source_candidate_decisions(candidate_id,job_id,binding_id,org_id,workspace_id,input_bundle_id,input_bundle_version_id,
  source_set_id,source_set_version_id,source_id,source_version_id,decision_status,candidate_version,candidate_provenance_hash,excerpt_hash,
  value_hash,reason_hash,reviewed_by,reviewer_authorization_version,receipt_id,execution_fence,reviewed_at)
 VALUES(candidate.id,p_job,binding.id,p_org,p_workspace,p_bundle,p_bundle_version,p_source_set,p_source_set_version,p_source,p_source_version,
  p_status,candidate.version,candidate.provenance_hash,candidate.excerpt_hash,
  encode(public.digest(convert_to(candidate.value,'UTF8'),'sha256'),'hex'),
  encode(public.digest(convert_to(COALESCE(p_reason,''),'UTF8'),'sha256'),'hex'),p_actor,p_authorization_version,p_receipt,p_execution_fence,candidate.reviewed_at);
 result:=jsonb_build_object('resourceId',candidate.id,'candidateId',candidate.id,'candidateVersion',candidate.version,
  'extractionJobId',p_job,'extractionBindingId',p_binding,'inputBundleId',p_bundle,'inputBundleVersionId',p_bundle_version,
  'sourceSetId',p_source_set,'sourceSetVersionId',p_source_set_version,'sourceId',p_source,'sourceVersionId',p_source_version,
  'status',p_status,'reviewedBy',p_actor,'excerptHash',next_excerpt_hash);
 PERFORM public.enterprise_ai_record_effect(p_receipt,p_org,p_workspace,p_execution_token,p_execution_fence,'studio.candidate.review','command',candidate.id,result,'committed');
 RETURN result;
END$$;

-- Direct Studio packages consume only Studio extraction bindings. Retain the
-- accepted Assess binding path for hybrid/Assess packages, but never treat an
-- Assess extraction as proof for a Studio-owned input bundle (or vice versa).
CREATE OR REPLACE FUNCTION public.studio_pr_b_candidate_manifest(
 p_org uuid,p_workspace uuid,p_bundle_version uuid
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE manifest jsonb;source_count integer;bundle_owner text;new_binding_count integer;legacy_binding_count integer;
BEGIN
 SELECT root.owner_module INTO bundle_owner
 FROM public.enterprise_module_input_bundle_versions version
 JOIN public.enterprise_module_input_bundles root ON root.id=version.input_bundle_id AND root.org_id=version.org_id AND root.workspace_id=version.workspace_id
 WHERE version.id=p_bundle_version AND version.org_id=p_org AND version.workspace_id=p_workspace;
 IF bundle_owner NOT IN('assess','studio') THEN RAISE EXCEPTION 'SOURCE_COVERAGE_INCOMPLETE';END IF;
 SELECT count(DISTINCT source_item.source_version_id)::integer INTO source_count
 FROM public.enterprise_module_input_bundle_items bundle_item
 JOIN public.enterprise_source_set_version_items source_item ON source_item.source_set_version_id=bundle_item.source_set_version_id
  AND source_item.org_id=bundle_item.org_id AND source_item.workspace_id=bundle_item.workspace_id
 WHERE bundle_item.input_bundle_version_id=p_bundle_version AND bundle_item.org_id=p_org AND bundle_item.workspace_id=p_workspace;
 IF source_count<1 OR source_count>20 THEN RAISE EXCEPTION 'SOURCE_COVERAGE_INCOMPLETE';END IF;
 SELECT count(*)::integer INTO new_binding_count FROM public.studio_source_extraction_bindings binding
  WHERE binding.input_bundle_version_id=p_bundle_version AND binding.org_id=p_org AND binding.workspace_id=p_workspace;
 SELECT count(*)::integer INTO legacy_binding_count FROM public.studio_legacy_extraction_binding_compatibility binding
  WHERE binding.input_bundle_version_id=p_bundle_version AND binding.org_id=p_org AND binding.workspace_id=p_workspace;
 IF bundle_owner='studio' AND new_binding_count>0 AND legacy_binding_count>0 THEN RAISE EXCEPTION 'SOURCE_COVERAGE_INCOMPLETE';END IF;
 IF bundle_owner='studio' AND new_binding_count>0 AND NOT EXISTS(
  SELECT 1 FROM public.enterprise_transcript_workspace_flags flags WHERE flags.org_id=p_org AND flags.workspace_id=p_workspace
   AND flags.studio_multisource_enabled AND flags.studio_source_integration_enabled
 ) THEN RAISE EXCEPTION 'STUDIO_FEATURE_DISABLED';END IF;
 WITH exact_bindings AS(
  SELECT binding.id,binding.job_id,binding.source_id,binding.source_version_id,'assess'::text binding_kind
  FROM public.enterprise_transcript_extraction_bindings binding
  WHERE bundle_owner='assess' AND binding.input_bundle_version_id=p_bundle_version AND binding.org_id=p_org AND binding.workspace_id=p_workspace
  UNION ALL
  SELECT binding.id,binding.job_id,binding.source_id,binding.source_version_id,'studio_new'::text binding_kind
  FROM public.studio_source_extraction_bindings binding
  WHERE bundle_owner='studio' AND binding.input_bundle_version_id=p_bundle_version AND binding.org_id=p_org AND binding.workspace_id=p_workspace
  UNION ALL
  SELECT binding.binding_id,binding.job_id,binding.source_id,binding.source_version_id,'studio_legacy_snapshot'::text binding_kind
  FROM public.studio_legacy_extraction_binding_compatibility binding
  WHERE bundle_owner='studio' AND binding.input_bundle_version_id=p_bundle_version AND binding.org_id=p_org AND binding.workspace_id=p_workspace
 ), covered AS(
  SELECT DISTINCT binding.source_version_id
  FROM exact_bindings binding JOIN public.enterprise_evidence_candidates candidate
   ON candidate.ai_job_id=binding.job_id AND candidate.source_id=binding.source_id AND candidate.source_version_id=binding.source_version_id
   AND candidate.org_id=p_org AND candidate.workspace_id=p_workspace
  LEFT JOIN public.studio_source_candidate_decisions decision ON decision.candidate_id=candidate.id AND decision.binding_id=binding.id
   AND decision.job_id=binding.job_id AND decision.org_id=p_org AND decision.workspace_id=p_workspace
  WHERE candidate.suggestion_status IN('accepted','edited') AND candidate.reviewed_by IS NOT NULL AND candidate.reviewed_at IS NOT NULL
   AND(binding.binding_kind<>'studio_new' OR(
    decision.decision_status=candidate.suggestion_status AND decision.candidate_version=candidate.version
    AND decision.candidate_provenance_hash=candidate.provenance_hash AND decision.excerpt_hash=candidate.excerpt_hash
    AND decision.source_id=candidate.source_id AND decision.source_version_id=candidate.source_version_id
    AND decision.reviewed_by=candidate.reviewed_by
    AND decision.value_hash=encode(public.digest(convert_to(candidate.value,'UTF8'),'sha256'),'hex')
   ))
 )
 SELECT COALESCE(jsonb_agg(jsonb_build_object(
  'candidateId',candidate.id,'candidateVersion',candidate.version,'candidateProvenanceHash',candidate.provenance_hash,
  'anchorHash',candidate.excerpt_hash,'sourceId',candidate.source_id,'sourceVersionId',candidate.source_version_id,
  'extractionJobId',binding.job_id,'fieldKey',candidate.field_key,'locator',candidate.source_locator
 ) ORDER BY candidate.source_version_id,candidate.field_key,candidate.id),'[]'::jsonb)
 INTO manifest
 FROM exact_bindings binding JOIN public.enterprise_evidence_candidates candidate
  ON candidate.ai_job_id=binding.job_id AND candidate.source_id=binding.source_id AND candidate.source_version_id=binding.source_version_id
  AND candidate.org_id=p_org AND candidate.workspace_id=p_workspace
 LEFT JOIN public.studio_source_candidate_decisions decision ON decision.candidate_id=candidate.id AND decision.binding_id=binding.id
  AND decision.job_id=binding.job_id AND decision.org_id=p_org AND decision.workspace_id=p_workspace
 WHERE candidate.suggestion_status IN('accepted','edited') AND candidate.reviewed_by IS NOT NULL AND candidate.reviewed_at IS NOT NULL
  AND(binding.binding_kind<>'studio_new' OR(
   decision.decision_status=candidate.suggestion_status AND decision.candidate_version=candidate.version
   AND decision.candidate_provenance_hash=candidate.provenance_hash AND decision.excerpt_hash=candidate.excerpt_hash
   AND decision.source_id=candidate.source_id AND decision.source_version_id=candidate.source_version_id
   AND decision.reviewed_by=candidate.reviewed_by
   AND decision.value_hash=encode(public.digest(convert_to(candidate.value,'UTF8'),'sha256'),'hex')
  ))
  AND EXISTS(SELECT 1 FROM public.enterprise_module_input_bundle_items bundle_item
   JOIN public.enterprise_source_set_version_items source_item ON source_item.source_set_version_id=bundle_item.source_set_version_id
    AND source_item.org_id=bundle_item.org_id AND source_item.workspace_id=bundle_item.workspace_id
   WHERE bundle_item.input_bundle_version_id=p_bundle_version AND bundle_item.org_id=p_org AND bundle_item.workspace_id=p_workspace
    AND source_item.source_version_id=candidate.source_version_id)
 HAVING (SELECT count(*) FROM covered)=source_count;
 IF manifest IS NULL OR jsonb_array_length(manifest)<source_count OR jsonb_array_length(manifest)>2000 THEN
  RAISE EXCEPTION 'SOURCE_COVERAGE_INCOMPLETE';
 END IF;
 RETURN manifest;
END$$;

-- A committed command receipt is the immutable replay authority. Replay is
-- resolved before feature gates or live manifest reconstruction, while every
-- new package still crosses the current feature and lineage checks.
CREATE OR REPLACE FUNCTION public.studio_artifact_source_package_create(p_command jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
#variable_conflict use_variable
DECLARE actor uuid;org uuid;workspace uuid;artifact_id uuid;source_package_id uuid;request_id uuid;authorization_version bigint;
 payload jsonb;source_mode text;artifact_type text;flags public.enterprise_transcript_workspace_flags;bundle public.enterprise_module_input_bundles;
 bundle_version public.enterprise_module_input_bundle_versions;artifact public.studio_artifact_aggregates;package public.studio_artifact_source_packages;
 material public.studio_artifact_manual_brief_materials;receipt public.studio_artifact_command_receipts;
 route_snapshot jsonb;route_hash text;package_hash text;manual_brief_hash text;candidate_manifest jsonb:='[]'::jsonb;
 candidate_manifest_hash text;anchor_manifest jsonb;anchor_manifest_hash text;
 idempotency_key text;request_hash text;result jsonb;audit_id uuid:=gen_random_uuid();
BEGIN
 IF p_command IS NULL OR jsonb_typeof(p_command)<>'object' OR NOT(p_command?&ARRAY['actorId','organizationId','workspaceId','artifactId','sourcePackageId','requestId','idempotencyKey','authorizationVersion','payload'])
    OR(p_command-ARRAY['actorId','organizationId','workspaceId','artifactId','sourcePackageId','requestId','idempotencyKey','authorizationVersion','payload'])<>'{}'::jsonb THEN RAISE EXCEPTION 'INVALID_COMMAND';END IF;
 BEGIN actor:=(p_command->>'actorId')::uuid;org:=(p_command->>'organizationId')::uuid;workspace:=(p_command->>'workspaceId')::uuid;
  artifact_id:=(p_command->>'artifactId')::uuid;source_package_id:=(p_command->>'sourcePackageId')::uuid;request_id:=(p_command->>'requestId')::uuid;
  authorization_version:=(p_command->>'authorizationVersion')::bigint;EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'INVALID_COMMAND';END;
 payload:=p_command->'payload';source_mode:=payload->>'sourceMode';artifact_type:=payload->>'artifactType';idempotency_key:=p_command->>'idempotencyKey';
 IF jsonb_typeof(payload)<>'object' OR source_mode NOT IN('direct_transcript_bundle','manual_brief') OR artifact_type NOT IN('brd','frd','pdd')
    OR length(idempotency_key) NOT BETWEEN 8 AND 200
    OR(payload-ARRAY['sourceMode','artifactType','studioInputBundleId','studioInputBundleVersionId','studioInputBundleVersion','manualBrief'])<>'{}'::jsonb THEN RAISE EXCEPTION 'INVALID_COMMAND';END IF;
 PERFORM public.pr1b_assert_command_authority(actor,org,workspace,'studio.artifacts.generate',authorization_version);
 request_hash:=public.enterprise_sha256_jsonb(p_command-'requestId');
 SELECT * INTO receipt FROM public.studio_artifact_command_receipts stored
  WHERE stored.org_id=org AND stored.actor_id=actor AND stored.command_type='studio.source-package.create' AND stored.idempotency_key=idempotency_key FOR UPDATE;
 IF receipt.id IS NOT NULL THEN
  IF receipt.workspace_id IS DISTINCT FROM workspace OR receipt.request_hash IS DISTINCT FROM request_hash THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';END IF;
  IF receipt.status='committed' THEN RETURN receipt.response||jsonb_build_object('outcome','replayed');END IF;
  RAISE EXCEPTION 'COMMAND_IN_PROGRESS';
 END IF;
 SELECT * INTO flags FROM public.enterprise_transcript_workspace_flags WHERE org_id=org AND workspace_id=workspace FOR SHARE;
 IF flags.org_id IS NULL OR NOT flags.direct_studio_planning_enabled OR NOT flags.studio_multisource_enabled THEN RAISE EXCEPTION 'STUDIO_FEATURE_DISABLED';END IF;
 IF source_mode='direct_transcript_bundle' THEN
  IF NOT(payload?&ARRAY['studioInputBundleId','studioInputBundleVersionId','studioInputBundleVersion']) OR payload?'manualBrief' THEN RAISE EXCEPTION 'INVALID_COMMAND';END IF;
  SELECT * INTO bundle_version FROM public.enterprise_module_input_bundle_versions WHERE id=(payload->>'studioInputBundleVersionId')::uuid
   AND input_bundle_id=(payload->>'studioInputBundleId')::uuid AND version=(payload->>'studioInputBundleVersion')::bigint
   AND org_id=org AND workspace_id=workspace AND status='locked' FOR SHARE;
  SELECT * INTO bundle FROM public.enterprise_module_input_bundles WHERE id=bundle_version.input_bundle_id AND org_id=org AND workspace_id=workspace AND owner_module='studio' FOR SHARE;
  IF bundle_version.id IS NULL OR bundle.id IS NULL OR bundle.current_version IS DISTINCT FROM bundle_version.version THEN RAISE EXCEPTION 'SOURCE_PACKAGE_STALE';END IF;
  candidate_manifest:=public.studio_pr_b_candidate_manifest(org,workspace,bundle_version.id);
 ELSE
  IF NOT(payload?'manualBrief') OR length(payload->>'manualBrief') NOT BETWEEN 1 AND 20000 OR payload?'studioInputBundleId' OR payload?'studioInputBundleVersionId' OR payload?'studioInputBundleVersion' THEN RAISE EXCEPTION 'INVALID_COMMAND';END IF;
  manual_brief_hash:=encode(public.digest(convert_to(payload->>'manualBrief','UTF8'),'sha256'),'hex');
 END IF;
 INSERT INTO public.studio_artifact_command_receipts(org_id,workspace_id,actor_id,command_type,idempotency_key,request_id,request_hash,status)
 VALUES(org,workspace,actor,'studio.source-package.create',idempotency_key,request_id,request_hash,'claimed') RETURNING * INTO receipt;
 candidate_manifest_hash:=public.enterprise_sha256_jsonb(candidate_manifest);
 anchor_manifest:=public.studio_pr_b_anchor_manifest(candidate_manifest,NULL,NULL);
 anchor_manifest_hash:=public.enterprise_sha256_jsonb(anchor_manifest);
 route_snapshot:=public.enterprise_direct_studio_route_policy();route_hash:=public.enterprise_sha256_jsonb(route_snapshot);
 package_hash:=public.enterprise_sha256_jsonb(jsonb_build_object('contractVersion','studio-source-package-1','sourceMode',source_mode,
  'upstreamHandoffId',NULL,'upstreamPackageHash',NULL,'studioInputBundleVersionId',bundle_version.id,'studioBundleHash',bundle_version.bundle_hash,'manualBriefHash',manual_brief_hash,
  'candidateManifestHash',candidate_manifest_hash,'anchorManifestHash',anchor_manifest_hash,
  'artifactType',artifact_type,'routePolicyVersion',1,'routePolicyHash',route_hash));
 SELECT * INTO artifact FROM public.studio_artifact_aggregates WHERE id=artifact_id FOR UPDATE;
 IF artifact.id IS NOT NULL THEN
  SELECT * INTO package FROM public.studio_artifact_source_packages WHERE id=source_package_id AND artifact_id=artifact.id;
  IF source_mode='manual_brief' THEN SELECT * INTO material FROM public.studio_artifact_manual_brief_materials WHERE source_package_id=package.id;END IF;
  IF artifact.org_id IS DISTINCT FROM org OR artifact.workspace_id IS DISTINCT FROM workspace OR package.package_hash IS DISTINCT FROM package_hash
     OR package.source_mode IS DISTINCT FROM source_mode OR(source_mode='manual_brief' AND material.manual_brief_hash IS DISTINCT FROM manual_brief_hash) THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';END IF;
  result:=jsonb_build_object('outcome','replayed','receiptId',receipt.id,'resourceId',artifact.id,'artifactId',artifact.id,'sourcePackageId',package.id,
   'sourcePackageHash',package.package_hash,'sourceMode',package.source_mode,'lineageClassification','not_assessed','planningOnly',true);
  UPDATE public.studio_artifact_command_receipts SET status='committed',resource_id=artifact.id,response=result,completed_at=statement_timestamp() WHERE id=receipt.id;
  RETURN result;
 END IF;
 INSERT INTO public.studio_artifact_aggregates(id,org_id,workspace_id,source_package_hash,source_schema_version,rule_set_version,review_schema_version,review_sequence,
  artifact_type,aggregate_version,lifecycle,created_by,source_package_id,source_mode,lineage_classification,planning_only)
 VALUES(artifact_id,org,workspace,package_hash,'studio-source-package-1','not-assessed-planning-only-1','studio-artifact-review-1',0,
  artifact_type,0,'draft',actor,source_package_id,source_mode,'not_assessed',true) RETURNING * INTO artifact;
 INSERT INTO public.studio_artifact_source_packages(id,artifact_id,org_id,workspace_id,version,source_mode,studio_input_bundle_id,studio_input_bundle_version_id,
  studio_input_bundle_version,studio_bundle_hash,manual_brief_hash,lineage_classification,planning_only,route_policy_version,route_policy_snapshot,route_policy_hash,package_hash,
  candidate_manifest,candidate_manifest_hash,candidate_count,anchor_manifest,anchor_manifest_hash,anchor_count,created_by)
 VALUES(source_package_id,artifact.id,org,workspace,1,source_mode,bundle.id,bundle_version.id,bundle_version.version,bundle_version.bundle_hash,
  CASE WHEN source_mode='manual_brief' THEN manual_brief_hash END,'not_assessed',true,1,route_snapshot,route_hash,package_hash,
  candidate_manifest,candidate_manifest_hash,jsonb_array_length(candidate_manifest),anchor_manifest,anchor_manifest_hash,jsonb_array_length(anchor_manifest),actor) RETURNING * INTO package;
 IF source_mode='manual_brief' THEN
  INSERT INTO public.studio_artifact_manual_brief_materials(source_package_id,artifact_id,org_id,workspace_id,manual_brief,manual_brief_hash,created_by)
  VALUES(package.id,artifact.id,org,workspace,payload->>'manualBrief',manual_brief_hash,actor);
 END IF;
 result:=jsonb_build_object('outcome','committed','receiptId',receipt.id,'resourceId',artifact.id,'artifactId',artifact.id,'sourcePackageId',package.id,
  'sourcePackageHash',package.package_hash,'sourceMode',package.source_mode,'lineageClassification','not_assessed','planningOnly',true);
 INSERT INTO public.privileged_audit_events(id,org_id,workspace_id,actor_id,request_id,action,resource_type,resource_id,outcome,resource_version,metadata)
 VALUES(audit_id,org,workspace,actor,request_id,'studio.source-package.create','studio_artifact',artifact.id,'succeeded',0,
  jsonb_build_object('sourcePackageId',package.id,'sourceMode',package.source_mode,'planningOnly',true));
 UPDATE public.studio_artifact_command_receipts SET status='committed',resource_id=artifact.id,response=result,completed_at=statement_timestamp() WHERE id=receipt.id;
 RETURN result;
END
$$;

REVOKE ALL ON FUNCTION
 public.enterprise_assert_assess_evidence_authority_v1(uuid,uuid,uuid,uuid),
 public.enterprise_assess_evidence_job_owner_guard_v1(),
 public.enterprise_assess_promotion_owner_guard_v1(),
 public.studio_source_append_only_guard_v1(),
 public.studio_source_assert_receipt_v1(uuid,uuid,uuid,uuid,text,bigint,uuid,bigint,boolean),
 public.studio_source_create_preflight_v1(uuid,uuid,uuid,bigint,uuid,uuid,bigint),
 public.studio_create_evidence_source_record_v1(jsonb,jsonb,uuid,bigint,uuid,uuid,bigint,jsonb),
 public.studio_record_source_extraction_success_v1(uuid,uuid,uuid,text,integer,uuid,bigint,uuid,uuid,bigint,jsonb),
 public.studio_record_source_extraction_failure_v1(uuid,uuid,uuid,text,uuid,bigint,uuid,uuid,bigint,jsonb),
 public.studio_claim_source_extraction_v1(uuid,uuid,uuid,bigint,jsonb,uuid,uuid,text,text,text,text,text,uuid,uuid,uuid,bigint,uuid,uuid,bigint),
 public.studio_stage_source_extraction_v1(uuid,jsonb,text,integer,integer,jsonb,uuid,uuid,uuid,bigint,uuid,uuid,bigint),
 public.studio_commit_source_extraction_v1(uuid,uuid,uuid,uuid,bigint,uuid,uuid,bigint),
 public.studio_fail_source_extraction_v1(uuid,text,uuid,uuid,uuid,bigint,uuid,uuid,bigint),
 public.studio_review_source_candidate_v1(uuid,bigint,uuid,uuid,uuid,uuid,bigint,uuid,uuid,bigint,uuid,uuid,text,text,text,uuid,uuid,uuid,bigint,uuid,uuid,bigint)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION
 public.studio_source_create_preflight_v1(uuid,uuid,uuid,bigint,uuid,uuid,bigint),
 public.studio_create_evidence_source_record_v1(jsonb,jsonb,uuid,bigint,uuid,uuid,bigint,jsonb),
 public.studio_record_source_extraction_success_v1(uuid,uuid,uuid,text,integer,uuid,bigint,uuid,uuid,bigint,jsonb),
 public.studio_record_source_extraction_failure_v1(uuid,uuid,uuid,text,uuid,bigint,uuid,uuid,bigint,jsonb),
 public.studio_claim_source_extraction_v1(uuid,uuid,uuid,bigint,jsonb,uuid,uuid,text,text,text,text,text,uuid,uuid,uuid,bigint,uuid,uuid,bigint),
 public.studio_stage_source_extraction_v1(uuid,jsonb,text,integer,integer,jsonb,uuid,uuid,uuid,bigint,uuid,uuid,bigint),
 public.studio_commit_source_extraction_v1(uuid,uuid,uuid,uuid,bigint,uuid,uuid,bigint),
 public.studio_fail_source_extraction_v1(uuid,text,uuid,uuid,uuid,bigint,uuid,uuid,bigint),
 public.studio_review_source_candidate_v1(uuid,bigint,uuid,uuid,uuid,uuid,bigint,uuid,uuid,bigint,uuid,uuid,text,text,text,uuid,uuid,uuid,bigint,uuid,uuid,bigint)
 TO service_role;

COMMENT ON TABLE public.studio_source_version_ownerships IS 'Exact Studio-owned source-version authority; rollback keeps rows read-only.';
COMMENT ON TABLE public.studio_source_extraction_runs IS 'Default-off Studio exact-bundle extraction attempts with staged/uncertain recovery.';
COMMENT ON TABLE public.studio_legacy_extraction_binding_compatibility IS 'Immutable one-time snapshot of pre-correction Studio bundle bindings; no new legacy binding is admitted.';
COMMENT ON TABLE public.studio_source_candidate_decisions IS 'Studio command-owned exact candidate decision authority required by new Studio package manifests.';

-- Advance only a fresh approved successor chain. The separately frozen PR C
-- controlled-human target remains 20260904120000 and is never rewritten here.
DO $studio_source_identity_forward$
DECLARE marker public.hosted_pilot_environment_identity;constraint_expression text;bootstrap_definition text;
 old_bootstrap text:='marker.migration_tip=''20260923190853''';
 new_bootstrap text:='marker.migration_tip=''20260924052038''';
 old_count integer;new_count integer;
BEGIN
 LOCK TABLE public.hosted_pilot_environment_identity IN SHARE ROW EXCLUSIVE MODE;
 SELECT * INTO STRICT marker FROM public.hosted_pilot_environment_identity WHERE singleton FOR UPDATE;
 IF marker.product_key<>'avalaos-core' OR marker.environment_class<>'hosted_nonproduction_pilot'
  OR marker.schema_contract<>'hosted-pilot-2026-08' OR marker.production_authorized
  OR marker.customer_data_authorized OR marker.real_provider_calls_authorized
 THEN RAISE EXCEPTION 'STUDIO_SOURCE_IDENTITY_MISMATCH';END IF;
 SELECT pg_get_expr(conbin,conrelid,false) INTO STRICT constraint_expression FROM pg_constraint
  WHERE conrelid='public.hosted_pilot_environment_identity'::regclass
   AND conname='hosted_pilot_environment_identity_migration_tip_check';
 SELECT pg_get_functiondef('public.synthetic_ai_campaign_bootstrap(uuid,uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,uuid,timestamptz)'::regprocedure)
  INTO STRICT bootstrap_definition;
 old_count:=(length(bootstrap_definition)-length(replace(bootstrap_definition,old_bootstrap,'')))/length(old_bootstrap);
 new_count:=(length(bootstrap_definition)-length(replace(bootstrap_definition,new_bootstrap,'')))/length(new_bootstrap);
 IF marker.migration_tip='20260923190853'
  AND constraint_expression='(migration_tip = ''20260923190853''::text)'
  AND old_count=1 AND new_count=0
 THEN
  EXECUTE replace(bootstrap_definition,old_bootstrap,new_bootstrap);
  ALTER TABLE public.hosted_pilot_environment_identity DROP CONSTRAINT hosted_pilot_environment_identity_migration_tip_check;
  UPDATE public.hosted_pilot_environment_identity SET migration_tip='20260924052038' WHERE singleton;
  ALTER TABLE public.hosted_pilot_environment_identity ADD CONSTRAINT hosted_pilot_environment_identity_migration_tip_check
   CHECK(migration_tip='20260924052038');
 ELSIF marker.migration_tip='20260924052038'
  AND constraint_expression='(migration_tip = ''20260924052038''::text)'
  AND old_count=0 AND new_count=1
 THEN NULL;
 ELSE RAISE EXCEPTION 'STUDIO_SOURCE_IDENTITY_SOURCE_MISMATCH';END IF;
END
$studio_source_identity_forward$;

-- Rollback/read-only fallback: keep studio_source_integration_enabled false,
-- disable the studio.evidence.extract route and preserve all source, review,
-- budget, receipt and campaign history. Correct forward; never drop evidence.
