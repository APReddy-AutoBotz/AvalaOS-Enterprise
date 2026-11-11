-- Bounded real-provider authority for the separately approved synthetic AI
-- campaign. Provider-free markers stay false; only an exact, charged permit
-- issued from this authority may cross the secret/provider boundary.
DO $precondition$
DECLARE marker public.hosted_pilot_environment_identity;
BEGIN
 LOCK TABLE public.hosted_pilot_environment_identity IN SHARE ROW EXCLUSIVE MODE;
 SELECT * INTO STRICT marker FROM public.hosted_pilot_environment_identity WHERE singleton FOR UPDATE;
 IF marker.product_key<>'avalaos-core' OR marker.environment_class<>'hosted_nonproduction_pilot'
  OR marker.schema_contract<>'hosted-pilot-2026-08' OR marker.migration_tip<>'20260916203406'
  OR marker.production_authorized OR marker.customer_data_authorized OR marker.real_provider_calls_authorized
 THEN RAISE EXCEPTION 'SYNTHETIC_AI_CAMPAIGN_MIGRATION_PRECONDITION_FAILED'; END IF;
END $precondition$;

CREATE TABLE public.synthetic_ai_campaign_authorities(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),target_id uuid NOT NULL UNIQUE,
 target_fingerprint text NOT NULL UNIQUE CHECK(target_fingerprint~'^sha256:[0-9a-f]{64}$'),
 project_ref text NOT NULL UNIQUE CHECK(project_ref~'^[a-z0-9]{20}$'),
 server_host text NOT NULL UNIQUE CHECK(server_host=project_ref||'.supabase.co'),
 local_carry_seal_digest text NOT NULL UNIQUE CHECK(local_carry_seal_digest~'^sha256:[0-9a-f]{64}$'),
 price_policy_version text NOT NULL DEFAULT 'openai-gpt-4.1-mini-2025-04-14-full-max-2026-09-17-v1'
  CHECK(price_policy_version='openai-gpt-4.1-mini-2025-04-14-full-max-2026-09-17-v1'),
 org_id uuid NOT NULL,workspace_id uuid NOT NULL,operator_actor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
 provider_config_id uuid NOT NULL,key_ref_id uuid NOT NULL,assess_route_id uuid NOT NULL,studio_route_id uuid NOT NULL,
 provider text NOT NULL DEFAULT 'openai' CHECK(provider='openai'),
 endpoint text NOT NULL DEFAULT 'https://api.openai.com' CHECK(endpoint='https://api.openai.com'),
 model text NOT NULL DEFAULT 'gpt-4.1-mini-2025-04-14' CHECK(model='gpt-4.1-mini-2025-04-14'),
 allowed_operations text[] NOT NULL DEFAULT ARRAY['assess.evidence.extract','provider.validate','studio.document.generate']::text[]
  CHECK(allowed_operations=ARRAY['assess.evidence.extract','provider.validate','studio.document.generate']::text[]),
 campaign_cap_usd_nanos bigint NOT NULL DEFAULT 10000000000 CHECK(campaign_cap_usd_nanos=10000000000),
 carried_usd_nanos bigint NOT NULL DEFAULT 869320000 CHECK(carried_usd_nanos=869320000),
 fixed_debit_usd_nanos bigint NOT NULL DEFAULT 471459200 CHECK(fixed_debit_usd_nanos=471459200),
 max_input_tokens integer NOT NULL DEFAULT 1047576 CHECK(max_input_tokens=1047576),
 max_output_tokens integer NOT NULL DEFAULT 32768 CHECK(max_output_tokens=32768),
 input_price_usd_nanos integer NOT NULL DEFAULT 400 CHECK(input_price_usd_nanos=400),
 output_price_usd_nanos integer NOT NULL DEFAULT 1600 CHECK(output_price_usd_nanos=1600),
 enabled boolean NOT NULL DEFAULT true,expires_at timestamptz NOT NULL,disabled_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 CHECK(expires_at>created_at AND expires_at<=created_at+interval '24 hours'),
 CHECK((enabled AND disabled_at IS NULL) OR (NOT enabled AND disabled_at IS NOT NULL)),
 CHECK(carried_usd_nanos+19*fixed_debit_usd_nanos<=campaign_cap_usd_nanos),
 CHECK(carried_usd_nanos+20*fixed_debit_usd_nanos>campaign_cap_usd_nanos),
 FOREIGN KEY(target_id,org_id,workspace_id) REFERENCES public.synthetic_admin_targets(id,org_id,workspace_id) ON DELETE RESTRICT,
 FOREIGN KEY(provider_config_id,org_id) REFERENCES public.ai_provider_configs(id,org_id) ON DELETE RESTRICT,
 FOREIGN KEY(key_ref_id,org_id) REFERENCES public.ai_provider_key_refs(id,org_id) ON DELETE RESTRICT,
 FOREIGN KEY(assess_route_id,org_id,workspace_id) REFERENCES public.enterprise_ai_capability_routes(id,org_id,workspace_id) ON DELETE RESTRICT,
 FOREIGN KEY(studio_route_id,org_id,workspace_id) REFERENCES public.enterprise_ai_capability_routes(id,org_id,workspace_id) ON DELETE RESTRICT);

CREATE TABLE public.synthetic_ai_campaign_effect_debits(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),campaign_id uuid NOT NULL REFERENCES public.synthetic_ai_campaign_authorities(id) ON DELETE RESTRICT,
 receipt_id uuid NOT NULL REFERENCES public.enterprise_ai_command_receipts(id) ON DELETE RESTRICT,effect_id uuid NOT NULL,
 actor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 workspace_id uuid NOT NULL,authorization_version bigint NOT NULL CHECK(authorization_version>0),execution_token uuid NOT NULL,
 execution_fence bigint NOT NULL CHECK(execution_fence>0),command_request_hash text NOT NULL CHECK(command_request_hash~'^[0-9a-f]{64}$'),
 effect_request_hash text NOT NULL CHECK(effect_request_hash~'^[0-9a-f]{64}$'),maximum_output_tokens integer NOT NULL CHECK(maximum_output_tokens BETWEEN 1 AND 64000),
 operation text NOT NULL CHECK(operation IN('assess.evidence.extract','studio.document.generate','provider.validate')),route_id uuid,
 provider_config_id uuid NOT NULL,key_ref_id uuid NOT NULL,provider text NOT NULL CHECK(provider='openai'),
 endpoint text NOT NULL CHECK(endpoint='https://api.openai.com'),model text NOT NULL CHECK(model='gpt-4.1-mini-2025-04-14'),
 debit_usd_nanos bigint NOT NULL CHECK(debit_usd_nanos=471459200),reserved_at timestamptz NOT NULL DEFAULT statement_timestamp(),consumed_at timestamptz,
 UNIQUE(campaign_id,receipt_id),UNIQUE(campaign_id,effect_id),
 FOREIGN KEY(workspace_id,org_id) REFERENCES public.workspaces(id,org_id) ON DELETE RESTRICT,
 FOREIGN KEY(provider_config_id,org_id) REFERENCES public.ai_provider_configs(id,org_id) ON DELETE RESTRICT,
 FOREIGN KEY(key_ref_id,org_id) REFERENCES public.ai_provider_key_refs(id,org_id) ON DELETE RESTRICT,
 CHECK((operation='provider.validate' AND route_id IS NULL) OR (operation IN('assess.evidence.extract','studio.document.generate') AND route_id IS NOT NULL)));

CREATE FUNCTION public.synthetic_ai_campaign_debit_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' OR (to_jsonb(NEW)-'consumed_at') IS DISTINCT FROM (to_jsonb(OLD)-'consumed_at')
  OR OLD.consumed_at IS NOT NULL OR NEW.consumed_at IS NULL THEN RAISE EXCEPTION 'SYNTHETIC_AI_CAMPAIGN_DEBIT_IMMUTABLE'; END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION public.synthetic_ai_campaign_assert_effect_binding(p_actor uuid,p_org uuid,p_workspace uuid,p_authorization_version bigint,
 p_receipt uuid,p_effect uuid,p_execution_token uuid,p_execution_fence bigint,p_route uuid,p_provider_config uuid,p_key_ref uuid,
 p_provider text,p_endpoint text,p_model text,p_operation text,p_effect_request_hash text,p_maximum_output_tokens integer)
RETURNS public.enterprise_ai_command_receipts LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE receipt public.enterprise_ai_command_receipts;config public.ai_provider_configs;
 key_row public.ai_provider_key_refs;route public.enterprise_ai_capability_routes;
BEGIN
 IF p_effect IS NULL OR p_execution_token IS NULL OR p_execution_fence IS NULL OR p_execution_fence<1
  OR p_provider NOT IN('gemini','groq','openai','azure_openai','anthropic','openai_compatible')
  OR length(btrim(COALESCE(p_endpoint,''))) NOT BETWEEN 1 AND 500 OR p_endpoint!~'^https://'
  OR length(btrim(COALESCE(p_model,''))) NOT BETWEEN 1 AND 200 OR length(btrim(COALESCE(p_operation,''))) NOT BETWEEN 1 AND 120
  OR p_effect_request_hash!~'^[0-9a-f]{64}$' OR p_maximum_output_tokens NOT BETWEEN 1 AND 64000
  OR (p_operation='provider.validate') IS DISTINCT FROM (p_route IS NULL)
 THEN RAISE EXCEPTION 'SYNTHETIC_AI_CAMPAIGN_BINDING_INVALID';END IF;
 SELECT * INTO receipt FROM public.enterprise_ai_command_receipts WHERE id=p_receipt AND org_id=p_org AND workspace_id=p_workspace AND actor_id=p_actor FOR UPDATE;
 IF receipt.id IS NULL OR receipt.status<>'claimed' OR receipt.execution_token IS DISTINCT FROM p_execution_token
  OR receipt.execution_fence IS DISTINCT FROM p_execution_fence THEN RAISE EXCEPTION 'SYNTHETIC_AI_CAMPAIGN_RECEIPT_STALE';END IF;
 SELECT * INTO config FROM public.ai_provider_configs WHERE id=p_provider_config AND org_id=p_org AND provider=p_provider
  AND key_ref_id=p_key_ref AND endpoint_url=p_endpoint AND default_model=p_model AND model_allowlist=ARRAY[p_model]
  AND status='active' AND deleted_at IS NULL FOR SHARE;
 SELECT * INTO key_row FROM public.ai_provider_key_refs WHERE id=p_key_ref AND org_id=p_org AND provider=p_provider
  AND resolver_type='server_reference' AND status IN('pending_review','active') AND deleted_at IS NULL FOR SHARE;
 IF config.id IS NULL OR key_row.id IS NULL THEN RAISE EXCEPTION 'SYNTHETIC_AI_CAMPAIGN_PROVIDER_STALE';END IF;
 IF p_route IS NOT NULL THEN
  SELECT * INTO route FROM public.enterprise_ai_capability_routes WHERE id=p_route AND org_id=p_org AND workspace_id=p_workspace
   AND provider_config_id=p_provider_config AND capability=p_operation AND model=p_model AND enabled AND deleted_at IS NULL FOR SHARE;
  IF route.id IS NULL OR config.last_validated_at IS NULL OR config.last_validated_at>statement_timestamp()
   OR config.last_validated_at<statement_timestamp()-interval '24 hours' THEN RAISE EXCEPTION 'SYNTHETIC_AI_CAMPAIGN_PROVIDER_STALE';END IF;
 END IF;
 RETURN receipt;
END $$;

CREATE FUNCTION public.synthetic_ai_campaign_reserve_effect(p_actor uuid,p_org uuid,p_workspace uuid,p_authorization_version bigint,
 p_target_fingerprint text,p_project_ref text,p_receipt uuid,p_effect uuid,p_execution_token uuid,p_execution_fence bigint,
 p_route uuid,p_provider_config uuid,p_key_ref uuid,p_provider text,p_endpoint text,p_model text,p_operation text,
 p_effect_request_hash text,p_maximum_output_tokens integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE receipt public.enterprise_ai_command_receipts;campaign public.synthetic_ai_campaign_authorities;
 prior public.synthetic_ai_campaign_effect_debits;spent bigint;request_host text;
BEGIN
 receipt:=public.synthetic_ai_campaign_assert_effect_binding(p_actor,p_org,p_workspace,p_authorization_version,p_receipt,p_effect,
  p_execution_token,p_execution_fence,p_route,p_provider_config,p_key_ref,p_provider,p_endpoint,p_model,p_operation,
  p_effect_request_hash,p_maximum_output_tokens);
 IF p_target_fingerprint IS NULL AND p_project_ref IS NULL THEN
  IF EXISTS(SELECT 1 FROM public.synthetic_admin_targets t WHERE t.org_id=p_org AND t.workspace_id=p_workspace
   AND t.enabled AND NOT t.real_provider_calls_authorized) THEN RAISE EXCEPTION 'SYNTHETIC_AI_CAMPAIGN_BINDING_REQUIRED';END IF;
  IF EXISTS(SELECT 1 FROM public.synthetic_ai_campaign_authorities a WHERE a.org_id=p_org AND a.workspace_id=p_workspace
   AND a.provider_config_id=p_provider_config) THEN RAISE EXCEPTION 'SYNTHETIC_AI_CAMPAIGN_BINDING_REQUIRED';END IF;
  RETURN jsonb_build_object('mode','ordinary','ownsProviderEffect',true,'replayed',false);
 END IF;
 request_host:=public.synthetic_ai_campaign_request_host();
 SELECT * INTO campaign FROM public.synthetic_ai_campaign_authorities a WHERE a.target_fingerprint=p_target_fingerprint
  AND a.project_ref=p_project_ref AND a.server_host=request_host AND a.org_id=p_org AND a.workspace_id=p_workspace
  AND a.provider_config_id=p_provider_config AND a.key_ref_id=p_key_ref AND a.provider=p_provider
  AND a.endpoint=p_endpoint AND a.model=p_model AND a.enabled FOR UPDATE;
 IF campaign.id IS NULL OR campaign.expires_at<=statement_timestamp() OR NOT p_operation=ANY(campaign.allowed_operations)
  OR (p_operation='assess.evidence.extract' AND p_route IS DISTINCT FROM campaign.assess_route_id)
  OR (p_operation='studio.document.generate' AND p_route IS DISTINCT FROM campaign.studio_route_id)
  OR (p_operation='provider.validate' AND p_actor IS DISTINCT FROM campaign.operator_actor_id)
  OR p_maximum_output_tokens>campaign.max_output_tokens
 THEN RAISE EXCEPTION 'SYNTHETIC_AI_CAMPAIGN_NOT_AUTHORIZED';END IF;
 PERFORM public.pr1b_assert_command_authority(p_actor,p_org,p_workspace,
  CASE p_operation WHEN 'assess.evidence.extract' THEN 'assess.v2.draft.write'
   WHEN 'studio.document.generate' THEN 'studio.artifacts.generate' ELSE 'org.admin' END,
  p_authorization_version);
 SELECT * INTO prior FROM public.synthetic_ai_campaign_effect_debits d WHERE d.campaign_id=campaign.id
  AND (d.receipt_id=p_receipt OR d.effect_id=p_effect) FOR UPDATE;
 IF prior.id IS NOT NULL THEN
  IF prior.receipt_id IS DISTINCT FROM p_receipt OR prior.effect_id IS DISTINCT FROM p_effect
   OR prior.actor_id IS DISTINCT FROM p_actor OR prior.org_id IS DISTINCT FROM p_org OR prior.workspace_id IS DISTINCT FROM p_workspace
   OR prior.authorization_version IS DISTINCT FROM p_authorization_version OR prior.execution_token IS DISTINCT FROM p_execution_token
   OR prior.execution_fence IS DISTINCT FROM p_execution_fence OR prior.command_request_hash IS DISTINCT FROM receipt.request_hash
   OR prior.effect_request_hash IS DISTINCT FROM p_effect_request_hash OR prior.maximum_output_tokens IS DISTINCT FROM p_maximum_output_tokens
   OR prior.operation IS DISTINCT FROM p_operation OR prior.route_id IS DISTINCT FROM p_route
   OR prior.provider_config_id IS DISTINCT FROM p_provider_config OR prior.key_ref_id IS DISTINCT FROM p_key_ref
   OR prior.provider IS DISTINCT FROM p_provider OR prior.endpoint IS DISTINCT FROM p_endpoint OR prior.model IS DISTINCT FROM p_model
  THEN RAISE EXCEPTION 'SYNTHETIC_AI_CAMPAIGN_REPLAY_SUBSTITUTION';END IF;
  RETURN jsonb_build_object('mode','campaign','reservationId',prior.id,'ownsProviderEffect',false,'replayed',true,'consumed',prior.consumed_at IS NOT NULL);
 END IF;
 SELECT COALESCE(sum(debit_usd_nanos),0) INTO spent FROM public.synthetic_ai_campaign_effect_debits WHERE campaign_id=campaign.id;
 IF campaign.carried_usd_nanos+spent+campaign.fixed_debit_usd_nanos>campaign.campaign_cap_usd_nanos
 THEN RAISE EXCEPTION 'SYNTHETIC_AI_CAMPAIGN_BUDGET_EXHAUSTED';END IF;
 INSERT INTO public.synthetic_ai_campaign_effect_debits(campaign_id,receipt_id,effect_id,actor_id,org_id,workspace_id,authorization_version,
  execution_token,execution_fence,command_request_hash,effect_request_hash,maximum_output_tokens,operation,route_id,provider_config_id,key_ref_id,provider,endpoint,model,debit_usd_nanos)
 VALUES(campaign.id,p_receipt,p_effect,p_actor,p_org,p_workspace,p_authorization_version,p_execution_token,p_execution_fence,receipt.request_hash,
  p_effect_request_hash,p_maximum_output_tokens,p_operation,p_route,p_provider_config,p_key_ref,p_provider,p_endpoint,p_model,campaign.fixed_debit_usd_nanos) RETURNING * INTO prior;
 RETURN jsonb_build_object('mode','campaign','reservationId',prior.id,'ownsProviderEffect',true,'replayed',false,'consumed',false,
  'debitUsdNanos',campaign.fixed_debit_usd_nanos,
  'remainingUsdNanos',campaign.campaign_cap_usd_nanos-campaign.carried_usd_nanos-spent-campaign.fixed_debit_usd_nanos);
END $$;

CREATE FUNCTION public.synthetic_ai_campaign_consume_effect(p_reservation uuid,p_actor uuid,p_org uuid,p_workspace uuid,p_authorization_version bigint,
 p_target_fingerprint text,p_project_ref text,p_receipt uuid,p_effect uuid,p_execution_token uuid,p_execution_fence bigint,
 p_route uuid,p_provider_config uuid,p_key_ref uuid,p_provider text,p_endpoint text,p_model text,p_operation text,
 p_effect_request_hash text,p_maximum_output_tokens integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE receipt public.enterprise_ai_command_receipts;campaign public.synthetic_ai_campaign_authorities;
 debit public.synthetic_ai_campaign_effect_debits;request_host text;
BEGIN
 receipt:=public.synthetic_ai_campaign_assert_effect_binding(p_actor,p_org,p_workspace,p_authorization_version,p_receipt,p_effect,
  p_execution_token,p_execution_fence,p_route,p_provider_config,p_key_ref,p_provider,p_endpoint,p_model,p_operation,
  p_effect_request_hash,p_maximum_output_tokens);
 IF p_target_fingerprint IS NULL AND p_project_ref IS NULL AND p_reservation IS NULL THEN
  IF EXISTS(SELECT 1 FROM public.synthetic_admin_targets t WHERE t.org_id=p_org AND t.workspace_id=p_workspace
   AND t.enabled AND NOT t.real_provider_calls_authorized) THEN RAISE EXCEPTION 'SYNTHETIC_AI_CAMPAIGN_BINDING_REQUIRED';END IF;
  IF EXISTS(SELECT 1 FROM public.synthetic_ai_campaign_authorities a WHERE a.org_id=p_org AND a.workspace_id=p_workspace
   AND a.provider_config_id=p_provider_config) THEN RAISE EXCEPTION 'SYNTHETIC_AI_CAMPAIGN_BINDING_REQUIRED';END IF;
  RETURN jsonb_build_object('mode','ordinary','consumed',true);
 END IF;
 request_host:=public.synthetic_ai_campaign_request_host();
 SELECT * INTO campaign FROM public.synthetic_ai_campaign_authorities a WHERE a.target_fingerprint=p_target_fingerprint
  AND a.project_ref=p_project_ref AND a.server_host=request_host AND a.org_id=p_org AND a.workspace_id=p_workspace
  AND a.provider_config_id=p_provider_config AND a.key_ref_id=p_key_ref AND a.enabled FOR UPDATE;
 SELECT * INTO debit FROM public.synthetic_ai_campaign_effect_debits d WHERE d.id=p_reservation AND d.campaign_id=campaign.id FOR UPDATE;
 IF campaign.id IS NULL OR campaign.expires_at<=statement_timestamp() OR debit.id IS NULL OR debit.consumed_at IS NOT NULL
  OR debit.receipt_id IS DISTINCT FROM p_receipt OR debit.effect_id IS DISTINCT FROM p_effect OR debit.actor_id IS DISTINCT FROM p_actor
  OR debit.org_id IS DISTINCT FROM p_org OR debit.workspace_id IS DISTINCT FROM p_workspace
  OR debit.authorization_version IS DISTINCT FROM p_authorization_version OR debit.execution_token IS DISTINCT FROM p_execution_token
  OR debit.execution_fence IS DISTINCT FROM p_execution_fence OR debit.command_request_hash IS DISTINCT FROM receipt.request_hash
  OR debit.effect_request_hash IS DISTINCT FROM p_effect_request_hash OR debit.maximum_output_tokens IS DISTINCT FROM p_maximum_output_tokens
  OR debit.operation IS DISTINCT FROM p_operation OR debit.route_id IS DISTINCT FROM p_route
  OR debit.provider_config_id IS DISTINCT FROM p_provider_config OR debit.key_ref_id IS DISTINCT FROM p_key_ref
  OR debit.provider IS DISTINCT FROM p_provider OR debit.endpoint IS DISTINCT FROM p_endpoint OR debit.model IS DISTINCT FROM p_model
 THEN RAISE EXCEPTION 'SYNTHETIC_AI_CAMPAIGN_PERMIT_INVALID_OR_REPLAYED';END IF;
 UPDATE public.synthetic_ai_campaign_effect_debits SET consumed_at=statement_timestamp() WHERE id=debit.id;
 RETURN jsonb_build_object('mode','campaign','reservationId',debit.id,'consumed',true);
END $$;

CREATE FUNCTION public.synthetic_ai_campaign_disable(p_actor uuid,p_org uuid,p_workspace uuid,p_authorization_version bigint,
 p_target_fingerprint text,p_project_ref text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE campaign public.synthetic_ai_campaign_authorities;
BEGIN
 PERFORM public.pr1b_assert_command_authority(p_actor,p_org,p_workspace,'org.admin',p_authorization_version);
 IF public.synthetic_ai_campaign_request_host() IS DISTINCT FROM p_project_ref||'.supabase.co'
 THEN RAISE EXCEPTION 'SYNTHETIC_AI_CAMPAIGN_SERVER_CONTEXT_REQUIRED';END IF;
 SELECT * INTO campaign FROM public.synthetic_ai_campaign_authorities WHERE target_fingerprint=p_target_fingerprint
  AND project_ref=p_project_ref AND org_id=p_org AND workspace_id=p_workspace FOR UPDATE;
 IF campaign.id IS NULL THEN RAISE EXCEPTION 'SYNTHETIC_AI_CAMPAIGN_NOT_AUTHORIZED';END IF;
 IF campaign.enabled THEN
  UPDATE public.enterprise_ai_capability_routes SET enabled=false,version=version+1,updated_by=p_actor,updated_at=statement_timestamp()
   WHERE id IN(campaign.assess_route_id,campaign.studio_route_id) AND org_id=p_org AND workspace_id=p_workspace;
  UPDATE public.ai_provider_configs SET status='disabled',updated_by=p_actor,updated_at=statement_timestamp()
   WHERE id=campaign.provider_config_id AND org_id=p_org;
  UPDATE public.synthetic_ai_campaign_authorities SET enabled=false,disabled_at=statement_timestamp() WHERE id=campaign.id;
 END IF;
 RETURN jsonb_build_object('status','disabled','campaignId',campaign.id);
END $$;

ALTER TABLE public.hosted_pilot_environment_identity DROP CONSTRAINT hosted_pilot_environment_identity_migration_tip_check;
UPDATE public.hosted_pilot_environment_identity SET migration_tip='20260917173445' WHERE singleton AND migration_tip='20260916203406'
 AND NOT production_authorized AND NOT customer_data_authorized AND NOT real_provider_calls_authorized;
DO $tip$ BEGIN
 IF (SELECT count(*) FROM public.hosted_pilot_environment_identity WHERE singleton AND migration_tip='20260917173445'
  AND NOT production_authorized AND NOT customer_data_authorized AND NOT real_provider_calls_authorized)<>1
 THEN RAISE EXCEPTION 'SYNTHETIC_AI_CAMPAIGN_MIGRATION_TIP_FAILED';END IF;
END $tip$;
ALTER TABLE public.hosted_pilot_environment_identity ADD CONSTRAINT hosted_pilot_environment_identity_migration_tip_check CHECK(migration_tip='20260917173445');
CREATE TRIGGER synthetic_ai_campaign_debit_immutable BEFORE UPDATE OR DELETE ON public.synthetic_ai_campaign_effect_debits
 FOR EACH ROW EXECUTE FUNCTION public.synthetic_ai_campaign_debit_guard();
ALTER TABLE public.synthetic_ai_campaign_authorities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.synthetic_ai_campaign_authorities FORCE ROW LEVEL SECURITY;
ALTER TABLE public.synthetic_ai_campaign_effect_debits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.synthetic_ai_campaign_effect_debits FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.synthetic_ai_campaign_authorities,public.synthetic_ai_campaign_effect_debits FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.synthetic_ai_campaign_authorities,public.synthetic_ai_campaign_effect_debits TO service_role;

CREATE FUNCTION public.synthetic_ai_campaign_request_host() RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE headers jsonb;host text;
BEGIN
 BEGIN headers:=NULLIF(current_setting('request.headers',true),'')::jsonb;EXCEPTION WHEN OTHERS THEN headers:=NULL;END;
 host:=lower(split_part(COALESCE(headers->>'host',''),':',1));
 IF host!~'^[a-z0-9]{20}[.]supabase[.]co$' THEN RAISE EXCEPTION 'SYNTHETIC_AI_CAMPAIGN_SERVER_CONTEXT_REQUIRED';END IF;
 RETURN host;
END $$;

CREATE FUNCTION public.synthetic_ai_campaign_assert_lifecycle_registration(
 p_org uuid,p_workspace uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF p_org IS NULL OR p_workspace IS NULL OR EXISTS(
  SELECT 1 FROM public.synthetic_admin_targets target
   WHERE target.org_id=p_org AND target.workspace_id=p_workspace AND target.enabled
     AND NOT target.real_provider_calls_authorized
 ) THEN RAISE EXCEPTION 'SYNTHETIC_AI_PROVIDER_REGISTRATION_DENIED';END IF;
 RETURN jsonb_build_object('allowed',true,'mode','ordinary');
END $$;

CREATE FUNCTION public.synthetic_ai_campaign_assert_lifecycle_operation(
 p_org uuid,p_workspace uuid,p_provider_config uuid,p_operation text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE config public.ai_provider_configs;campaign public.synthetic_ai_campaign_authorities;
BEGIN
 SELECT * INTO config FROM public.ai_provider_configs WHERE id=p_provider_config AND org_id=p_org AND deleted_at IS NULL FOR SHARE;
 IF config.id IS NULL THEN RAISE EXCEPTION 'SYNTHETIC_AI_PROVIDER_NOT_FOUND';END IF;
 SELECT * INTO campaign FROM public.synthetic_ai_campaign_authorities WHERE org_id=p_org AND workspace_id=p_workspace
  AND provider_config_id=p_provider_config FOR SHARE;
 IF campaign.id IS NOT NULL AND p_operation<>'provider.validate' THEN RAISE EXCEPTION 'SYNTHETIC_AI_CAMPAIGN_LIFECYCLE_DENIED';END IF;
 IF campaign.id IS NULL AND EXISTS(SELECT 1 FROM public.synthetic_admin_targets t WHERE t.org_id=p_org AND t.workspace_id=p_workspace
  AND t.enabled AND NOT t.real_provider_calls_authorized) THEN RAISE EXCEPTION 'SYNTHETIC_AI_PROVIDER_FREE_TARGET';END IF;
 RETURN jsonb_build_object('allowed',true,'mode',CASE WHEN campaign.id IS NULL THEN 'ordinary' ELSE 'campaign' END);
END $$;

CREATE FUNCTION public.synthetic_ai_campaign_assert_legacy_resolver(
 p_org uuid,p_workspace uuid,p_provider_config uuid,p_key_ref uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE config public.ai_provider_configs;
BEGIN
 SELECT * INTO config FROM public.ai_provider_configs WHERE id=p_provider_config AND org_id=p_org AND key_ref_id=p_key_ref
  AND status='active' AND deleted_at IS NULL FOR SHARE;
 IF config.id IS NULL OR EXISTS(SELECT 1 FROM public.synthetic_ai_campaign_authorities a WHERE a.org_id=p_org
  AND a.provider_config_id=p_provider_config) THEN RAISE EXCEPTION 'SYNTHETIC_AI_LEGACY_RESOLVER_DENIED';END IF;
 IF p_workspace IS NOT NULL AND EXISTS(SELECT 1 FROM public.synthetic_admin_targets t WHERE t.org_id=p_org AND t.workspace_id=p_workspace
  AND t.enabled AND NOT t.real_provider_calls_authorized) THEN RAISE EXCEPTION 'SYNTHETIC_AI_PROVIDER_FREE_TARGET';END IF;
 RETURN jsonb_build_object('allowed',true,'mode','ordinary');
END $$;

CREATE FUNCTION public.synthetic_ai_campaign_bootstrap(p_actor uuid,p_org uuid,p_workspace uuid,p_authorization_version bigint,
 p_target_fingerprint text,p_project_ref text,p_local_carry_seal_digest text,p_secret_reference text,
 p_provider_config uuid,p_key_ref uuid,p_assess_route uuid,p_studio_route uuid,p_expires_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target public.synthetic_admin_targets;author_role uuid;request_host text;tenant_segment text:=upper(replace(p_org::text,'-',''));campaign_id uuid;
BEGIN
 request_host:=public.synthetic_ai_campaign_request_host();
 IF request_host IS DISTINCT FROM p_project_ref||'.supabase.co' OR p_target_fingerprint!~'^sha256:[0-9a-f]{64}$'
  OR p_local_carry_seal_digest!~'^sha256:[0-9a-f]{64}$'
  OR p_secret_reference!~('^AVALA_PROVIDER_SECRET_OPENAI_'||tenant_segment||'_[A-Z0-9]+$')
  OR p_expires_at<=statement_timestamp() OR p_expires_at>statement_timestamp()+interval '24 hours'
  OR p_provider_config IS NULL OR p_key_ref IS NULL OR p_assess_route IS NULL OR p_studio_route IS NULL
  OR (SELECT count(DISTINCT value) FROM unnest(ARRAY[p_provider_config,p_key_ref,p_assess_route,p_studio_route]) value)<>4
 THEN RAISE EXCEPTION 'SYNTHETIC_AI_CAMPAIGN_BOOTSTRAP_INVALID';END IF;
 target:=public.synthetic_admin_assert_target(p_actor,p_org,p_workspace,p_authorization_version,p_target_fingerprint);
 IF target.production_authorized OR target.customer_data_authorized OR target.real_provider_calls_authorized OR NOT target.synthetic_only
  OR EXISTS(SELECT 1 FROM public.ai_provider_configs) OR EXISTS(SELECT 1 FROM public.ai_provider_key_refs)
  OR EXISTS(SELECT 1 FROM public.enterprise_ai_capability_routes) OR EXISTS(SELECT 1 FROM public.synthetic_ai_campaign_authorities)
  OR EXISTS(SELECT 1 FROM public.synthetic_ai_campaign_effect_debits)
  OR NOT EXISTS(SELECT 1 FROM public.hosted_pilot_environment_identity marker WHERE marker.singleton AND marker.migration_tip='20260917173445'
   AND NOT marker.production_authorized AND NOT marker.customer_data_authorized AND NOT marker.real_provider_calls_authorized)
 THEN RAISE EXCEPTION 'SYNTHETIC_AI_CAMPAIGN_TARGET_NOT_EMPTY';END IF;
 SELECT preset.role_id INTO STRICT author_role FROM public.synthetic_admin_preset_roles preset JOIN public.roles r ON r.id=preset.role_id
 WHERE preset.target_id=target.id AND preset.preset='author' AND r.org_id=p_org AND r.workspace_id=p_workspace AND r.scope='workspace' AND r.status='active';
 INSERT INTO public.ai_provider_key_refs(id,org_id,provider,resolver_type,secret_ref,safe_label,status,rotation_status,created_by,updated_by)
 VALUES(p_key_ref,p_org,'openai','server_reference',p_secret_reference,'Bounded synthetic AI campaign key reference','pending_review','not_started',p_actor,p_actor);
 INSERT INTO public.ai_provider_configs(id,org_id,provider,display_name,key_ref_id,default_model,model_policy,allowed_modes,allowed_operations,
  evidence_ref,status,created_by,updated_by,endpoint_url,model_allowlist,budget_policy)
 VALUES(p_provider_config,p_org,'openai','Bounded synthetic AI campaign',p_key_ref,'gpt-4.1-mini-2025-04-14','{}',ARRAY['pilot'],
  ARRAY['generate_document','test_provider_connection'],p_local_carry_seal_digest,'active',p_actor,p_actor,'https://api.openai.com',
  ARRAY['gpt-4.1-mini-2025-04-14'],jsonb_build_object('dailyRequests',20,'monthlyTokens',20500000));
 INSERT INTO public.enterprise_ai_capability_routes(id,org_id,workspace_id,provider_config_id,capability,model,enabled,allowed_roles,created_by,updated_by)
 VALUES(p_assess_route,p_org,p_workspace,p_provider_config,'assess.evidence.extract','gpt-4.1-mini-2025-04-14',true,ARRAY[author_role::text],p_actor,p_actor),
 (p_studio_route,p_org,p_workspace,p_provider_config,'studio.document.generate','gpt-4.1-mini-2025-04-14',true,ARRAY[author_role::text],p_actor,p_actor);
 INSERT INTO public.synthetic_ai_campaign_authorities(target_id,target_fingerprint,project_ref,server_host,local_carry_seal_digest,org_id,workspace_id,
  operator_actor_id,provider_config_id,key_ref_id,assess_route_id,studio_route_id,expires_at)
 VALUES(target.id,p_target_fingerprint,p_project_ref,request_host,p_local_carry_seal_digest,p_org,p_workspace,p_actor,p_provider_config,p_key_ref,p_assess_route,p_studio_route,p_expires_at)
 RETURNING id INTO campaign_id;
 RETURN jsonb_build_object('status','enabled','campaignId',campaign_id,'providerConfigId',p_provider_config,'keyRefId',p_key_ref,
 'assessRouteId',p_assess_route,'studioRouteId',p_studio_route,'carriedUsdNanos',869320000,'fixedDebitUsdNanos',471459200,'capUsdNanos',10000000000);
END $$;

CREATE FUNCTION public.synthetic_ai_campaign_required_budget_capability(
 p_org uuid,p_workspace uuid,p_route uuid,p_provider_config uuid,p_provider text,p_capability text,p_model text
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE campaign public.synthetic_ai_campaign_authorities;
BEGIN
 SELECT * INTO campaign FROM public.synthetic_ai_campaign_authorities authority
  WHERE authority.org_id=p_org AND authority.workspace_id=p_workspace
    AND authority.provider_config_id=p_provider_config AND authority.enabled
    AND authority.disabled_at IS NULL AND authority.expires_at>statement_timestamp()
  FOR SHARE;
 IF campaign.id IS NOT NULL THEN
  IF p_provider<>'openai' OR p_model<>'gpt-4.1-mini-2025-04-14'
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
  WHEN p_capability='delivery.work_items.draft' THEN 'project.manage'
  WHEN p_capability='modernization.rationale.draft' THEN 'portfolio.manage'
  WHEN p_capability='assemble.blueprint.draft' THEN 'assemble.manage'
  WHEN p_capability='studio.document.generate' THEN 'docs.approve'
 END;
END $$;

DO $$
DECLARE predecessor regprocedure:='public.enterprise_ai_reserve_provider_budget(uuid,uuid,uuid,bigint,uuid,uuid,uuid,bigint,uuid,uuid,text,text,text,integer,integer)'::regprocedure;
 body text;definition text;old_mapping text:=E'required_capability := CASE\n    WHEN p_capability LIKE ''assess.%'' THEN ''evidence.write''\n    WHEN p_capability=''delivery.work_items.draft'' THEN ''project.manage''\n    WHEN p_capability=''modernization.rationale.draft'' THEN ''portfolio.manage''\n    WHEN p_capability=''assemble.blueprint.draft'' THEN ''assemble.manage''\n    WHEN p_capability=''studio.document.generate'' THEN ''docs.approve''\n  END;';
 new_mapping text:=E'required_capability := public.synthetic_ai_campaign_required_budget_capability(\n    p_org,p_workspace,p_route,p_provider_config,p_provider,p_capability,p_model\n  );';
BEGIN
 SELECT prosrc,pg_get_functiondef(oid) INTO body,definition FROM pg_proc WHERE oid=predecessor;
 IF md5(replace(body,E'\r\n',E'\n'))<>'73871c974b0b4146e6c608e40e3895f6' THEN
  RAISE EXCEPTION 'SYNTHETIC_AI_CAMPAIGN_BUDGET_BODY_DRIFT';
 END IF;
 IF (SELECT NOT prosecdef OR proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] FROM pg_proc WHERE oid=predecessor) THEN
  RAISE EXCEPTION 'SYNTHETIC_AI_CAMPAIGN_BUDGET_METADATA_DRIFT';
 END IF;
 definition:=replace(definition,E'\r\n',E'\n');
 IF length(definition)-length(replace(definition,old_mapping,''))<>length(old_mapping) THEN
  RAISE EXCEPTION 'SYNTHETIC_AI_CAMPAIGN_BUDGET_MAPPING_DRIFT';
 END IF;
 EXECUTE replace(definition,old_mapping,new_mapping);
 SELECT prosrc INTO body FROM pg_proc WHERE oid=predecessor;
 IF length(body)-length(replace(body,'synthetic_ai_campaign_required_budget_capability',''))
      <>length('synthetic_ai_campaign_required_budget_capability')
   OR position(old_mapping IN body)>0 THEN
  RAISE EXCEPTION 'SYNTHETIC_AI_CAMPAIGN_BUDGET_PATCH_FAILED';
 END IF;
END $$;

REVOKE ALL ON FUNCTION public.synthetic_ai_campaign_debit_guard(),public.synthetic_ai_campaign_request_host(),
 public.synthetic_ai_campaign_bootstrap(uuid,uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,uuid,timestamptz),
 public.synthetic_ai_campaign_assert_effect_binding(uuid,uuid,uuid,bigint,uuid,uuid,uuid,bigint,uuid,uuid,uuid,text,text,text,text,text,integer),
 public.synthetic_ai_campaign_reserve_effect(uuid,uuid,uuid,bigint,text,text,uuid,uuid,uuid,bigint,uuid,uuid,uuid,text,text,text,text,text,integer),
 public.synthetic_ai_campaign_consume_effect(uuid,uuid,uuid,uuid,bigint,text,text,uuid,uuid,uuid,bigint,uuid,uuid,uuid,text,text,text,text,text,integer),
 public.synthetic_ai_campaign_disable(uuid,uuid,uuid,bigint,text,text),
 public.synthetic_ai_campaign_required_budget_capability(uuid,uuid,uuid,uuid,text,text,text),
 public.synthetic_ai_campaign_assert_lifecycle_registration(uuid,uuid),
 public.synthetic_ai_campaign_assert_lifecycle_operation(uuid,uuid,uuid,text),
 public.synthetic_ai_campaign_assert_legacy_resolver(uuid,uuid,uuid,uuid)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.synthetic_ai_campaign_bootstrap(uuid,uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,uuid,timestamptz),
 public.synthetic_ai_campaign_reserve_effect(uuid,uuid,uuid,bigint,text,text,uuid,uuid,uuid,bigint,uuid,uuid,uuid,text,text,text,text,text,integer),
 public.synthetic_ai_campaign_consume_effect(uuid,uuid,uuid,uuid,bigint,text,text,uuid,uuid,uuid,bigint,uuid,uuid,uuid,text,text,text,text,text,integer),
 public.synthetic_ai_campaign_disable(uuid,uuid,uuid,bigint,text,text),
 public.synthetic_ai_campaign_assert_lifecycle_registration(uuid,uuid),
 public.synthetic_ai_campaign_assert_lifecycle_operation(uuid,uuid,uuid,text),
 public.synthetic_ai_campaign_assert_legacy_resolver(uuid,uuid,uuid,uuid)
 TO service_role;
