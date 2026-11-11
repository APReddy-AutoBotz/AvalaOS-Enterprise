-- One-time continuation of the already-expired, separately approved synthetic
-- AI campaign. This migration performs no provider effect, changes no historic
-- charge, and leaves both provider runtimes off. The original campaign remains
-- immutable; a single append-only renewal window can authorize at most six new
-- fixed-price effects under the original aggregate USD 10 cap.
DO $precondition$
DECLARE marker public.hosted_pilot_environment_identity;
BEGIN
  LOCK TABLE public.hosted_pilot_environment_identity IN SHARE ROW EXCLUSIVE MODE;
  SELECT * INTO STRICT marker FROM public.hosted_pilot_environment_identity WHERE singleton FOR UPDATE;
  IF marker.product_key<>'avalaos-core'
    OR marker.environment_class<>'hosted_nonproduction_pilot'
    OR marker.schema_contract<>'hosted-pilot-2026-08'
    OR marker.migration_tip<>'20260918082307'
    OR marker.production_authorized OR marker.customer_data_authorized OR marker.real_provider_calls_authorized
    OR pg_catalog.to_regclass('public.synthetic_ai_campaign_renewals') IS NOT NULL
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_attribute
      WHERE attrelid='public.synthetic_ai_campaign_effect_debits'::regclass
        AND attname='renewal_id' AND NOT attisdropped)
  THEN RAISE EXCEPTION 'SYNTHETIC_AI_CAMPAIGN_RENEWAL_MIGRATION_PRECONDITION_FAILED'; END IF;
END
$precondition$;

CREATE TABLE public.synthetic_ai_campaign_renewals(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL UNIQUE REFERENCES public.synthetic_ai_campaign_authorities(id) ON DELETE RESTRICT,
  renewed_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  authorization_version bigint NOT NULL CHECK(authorization_version>0),
  target_fingerprint text NOT NULL CHECK(target_fingerprint~'^sha256:[0-9a-f]{64}$'),
  project_ref text NOT NULL CHECK(project_ref~'^[a-z0-9]{20}$'),
  server_host text NOT NULL CHECK(server_host=project_ref||'.supabase.co'),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL,
  provider_config_id uuid NOT NULL,
  key_ref_id uuid NOT NULL,
  assess_route_id uuid NOT NULL,
  studio_route_id uuid NOT NULL,
  baseline_aggregate_usd_nanos bigint NOT NULL DEFAULT 1340779200
    CHECK(baseline_aggregate_usd_nanos=1340779200),
  baseline_debit_count integer NOT NULL DEFAULT 1 CHECK(baseline_debit_count=1),
  fixed_debit_usd_nanos bigint NOT NULL DEFAULT 471459200 CHECK(fixed_debit_usd_nanos=471459200),
  maximum_additional_effects integer NOT NULL DEFAULT 6 CHECK(maximum_additional_effects=6),
  maximum_aggregate_usd_nanos bigint NOT NULL DEFAULT 4169534400
    CHECK(maximum_aggregate_usd_nanos=4169534400),
  binding_digest text NOT NULL UNIQUE CHECK(binding_digest~'^sha256:[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  expires_at timestamptz NOT NULL,
  CHECK(expires_at>created_at AND expires_at<=created_at+interval '24 hours'),
  CHECK(maximum_aggregate_usd_nanos=baseline_aggregate_usd_nanos+maximum_additional_effects*fixed_debit_usd_nanos),
  FOREIGN KEY(workspace_id,org_id) REFERENCES public.workspaces(id,org_id) ON DELETE RESTRICT,
  FOREIGN KEY(provider_config_id,org_id) REFERENCES public.ai_provider_configs(id,org_id) ON DELETE RESTRICT,
  FOREIGN KEY(key_ref_id,org_id) REFERENCES public.ai_provider_key_refs(id,org_id) ON DELETE RESTRICT,
  FOREIGN KEY(assess_route_id,org_id,workspace_id) REFERENCES public.enterprise_ai_capability_routes(id,org_id,workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY(studio_route_id,org_id,workspace_id) REFERENCES public.enterprise_ai_capability_routes(id,org_id,workspace_id) ON DELETE RESTRICT
);

ALTER TABLE public.synthetic_ai_campaign_effect_debits
  ADD COLUMN renewal_id uuid REFERENCES public.synthetic_ai_campaign_renewals(id) ON DELETE RESTRICT;
CREATE INDEX synthetic_ai_campaign_debit_renewal_idx
  ON public.synthetic_ai_campaign_effect_debits(renewal_id,id) WHERE renewal_id IS NOT NULL;

CREATE FUNCTION public.synthetic_ai_campaign_renewal_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'SYNTHETIC_AI_CAMPAIGN_RENEWAL_IMMUTABLE';
END
$$;
CREATE TRIGGER synthetic_ai_campaign_renewal_immutable
  BEFORE UPDATE OR DELETE ON public.synthetic_ai_campaign_renewals
  FOR EACH ROW EXECUTE FUNCTION public.synthetic_ai_campaign_renewal_guard();

ALTER TABLE public.synthetic_ai_campaign_renewals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.synthetic_ai_campaign_renewals FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.synthetic_ai_campaign_renewals FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.synthetic_ai_campaign_renewals TO service_role;

-- Returns the active deadline without granting authority. It is deliberately
-- internal and is called only by reserve, consume and budget-capability paths.
CREATE FUNCTION public.synthetic_ai_campaign_active_until(p_campaign uuid)
RETURNS timestamptz LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT CASE
    WHEN NOT authority.enabled OR authority.disabled_at IS NOT NULL THEN NULL
    WHEN authority.expires_at>statement_timestamp() THEN authority.expires_at
    ELSE(SELECT renewal.expires_at FROM public.synthetic_ai_campaign_renewals renewal
      WHERE renewal.campaign_id=authority.id AND renewal.expires_at>statement_timestamp())
  END
  FROM public.synthetic_ai_campaign_authorities authority WHERE authority.id=p_campaign;
$$;

CREATE FUNCTION public.synthetic_ai_campaign_renew_once(
  p_actor uuid,p_org uuid,p_workspace uuid,p_authorization_version bigint,
  p_target_fingerprint text,p_project_ref text,p_campaign uuid,p_provider_config uuid,p_key_ref uuid,
  p_assess_route uuid,p_studio_route uuid,p_expected_baseline_usd_nanos bigint,p_window_seconds integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  target public.synthetic_admin_targets;campaign public.synthetic_ai_campaign_authorities;
  marker public.hosted_pilot_environment_identity;renewal public.synthetic_ai_campaign_renewals;
  enterprise_control public.enterprise_intelligence_runtime_control;
  studio_control public.studio_artifact_runtime_control;
  historical_debits integer;historical_consumed integer;historical_spend bigint;
  request_host text;created_at_value timestamptz:=statement_timestamp();digest_value text;
BEGIN
  IF p_actor IS NULL OR p_org IS NULL OR p_workspace IS NULL OR p_campaign IS NULL
    OR p_provider_config IS NULL OR p_key_ref IS NULL OR p_assess_route IS NULL OR p_studio_route IS NULL
    OR p_target_fingerprint IS NULL OR p_target_fingerprint!~'^sha256:[0-9a-f]{64}$'
    OR p_project_ref IS NULL OR p_project_ref!~'^[a-z0-9]{20}$'
    OR p_expected_baseline_usd_nanos IS NULL OR p_expected_baseline_usd_nanos<>1340779200
    OR p_window_seconds IS NULL OR p_window_seconds NOT BETWEEN 1 AND 86400
  THEN RAISE EXCEPTION 'SYNTHETIC_AI_CAMPAIGN_RENEWAL_INVALID'; END IF;

  PERFORM public.pr1b_assert_command_authority(p_actor,p_org,p_workspace,'org.admin',p_authorization_version);
  target:=public.synthetic_admin_assert_target(p_actor,p_org,p_workspace,p_authorization_version,p_target_fingerprint);
  request_host:=public.synthetic_ai_campaign_request_host();
  IF request_host IS DISTINCT FROM p_project_ref||'.supabase.co'
    OR target.org_id IS DISTINCT FROM p_org OR target.workspace_id IS DISTINCT FROM p_workspace
    OR target.operator_actor_id IS DISTINCT FROM p_actor OR NOT target.enabled OR NOT target.synthetic_only
    OR target.production_authorized OR target.customer_data_authorized OR target.real_provider_calls_authorized
  THEN RAISE EXCEPTION 'SYNTHETIC_AI_CAMPAIGN_RENEWAL_NOT_AUTHORIZED'; END IF;

  SELECT * INTO STRICT marker FROM public.hosted_pilot_environment_identity WHERE singleton FOR SHARE;
  SELECT * INTO STRICT enterprise_control FROM public.enterprise_intelligence_runtime_control WHERE singleton FOR SHARE;
  SELECT * INTO STRICT studio_control FROM public.studio_artifact_runtime_control WHERE singleton FOR SHARE;
  IF marker.product_key<>'avalaos-core' OR marker.environment_class<>'hosted_nonproduction_pilot'
    OR marker.schema_contract<>'hosted-pilot-2026-08' OR marker.migration_tip<>'20260922112911'
    OR marker.production_authorized OR marker.customer_data_authorized OR marker.real_provider_calls_authorized
    OR enterprise_control.provider_enabled OR studio_control.provider_enabled
  THEN RAISE EXCEPTION 'SYNTHETIC_AI_CAMPAIGN_RENEWAL_RUNTIME_NOT_OFF'; END IF;

  SELECT * INTO campaign FROM public.synthetic_ai_campaign_authorities authority
    WHERE authority.id=p_campaign AND authority.target_id=target.id
      AND authority.target_fingerprint=p_target_fingerprint AND authority.project_ref=p_project_ref
      AND authority.server_host=request_host AND authority.org_id=p_org AND authority.workspace_id=p_workspace
      AND authority.operator_actor_id=p_actor AND authority.provider_config_id=p_provider_config
      AND authority.key_ref_id=p_key_ref AND authority.assess_route_id=p_assess_route
      AND authority.studio_route_id=p_studio_route FOR UPDATE;
  IF campaign.id IS NULL OR NOT campaign.enabled OR campaign.disabled_at IS NOT NULL
    OR campaign.expires_at>=created_at_value OR campaign.created_at>=campaign.expires_at
    OR campaign.provider<>'openai' OR campaign.endpoint<>'https://api.openai.com'
    OR campaign.model<>'gpt-4.1-mini-2025-04-14'
    OR campaign.allowed_operations IS DISTINCT FROM ARRAY['assess.evidence.extract','provider.validate','studio.document.generate']::text[]
    OR campaign.campaign_cap_usd_nanos<>10000000000 OR campaign.carried_usd_nanos<>869320000
    OR campaign.fixed_debit_usd_nanos<>471459200 OR campaign.max_input_tokens<>1047576
    OR campaign.max_output_tokens<>32768 OR campaign.input_price_usd_nanos<>400 OR campaign.output_price_usd_nanos<>1600
    OR campaign.price_policy_version<>'openai-gpt-4.1-mini-2025-04-14-full-max-2026-09-17-v1'
    OR EXISTS(SELECT 1 FROM public.synthetic_ai_campaign_renewals prior WHERE prior.campaign_id=campaign.id)
  THEN RAISE EXCEPTION 'SYNTHETIC_AI_CAMPAIGN_RENEWAL_NOT_AUTHORIZED'; END IF;

  IF (SELECT count(*) FROM public.synthetic_ai_campaign_authorities)<>1
    OR (SELECT count(*) FROM public.ai_provider_configs)<>1
    OR (SELECT count(*) FROM public.ai_provider_key_refs)<>1
    OR (SELECT count(*) FROM public.enterprise_ai_capability_routes)<>2
    OR NOT EXISTS(SELECT 1 FROM public.ai_provider_configs config
      WHERE config.id=p_provider_config AND config.org_id=p_org AND config.provider='openai'
        AND config.key_ref_id=p_key_ref AND config.endpoint_url='https://api.openai.com'
        AND config.default_model='gpt-4.1-mini-2025-04-14'
        AND config.model_allowlist=ARRAY['gpt-4.1-mini-2025-04-14']::text[]
        AND config.status='active' AND config.deleted_at IS NULL)
    OR NOT EXISTS(SELECT 1 FROM public.ai_provider_key_refs key_ref
      WHERE key_ref.id=p_key_ref AND key_ref.org_id=p_org AND key_ref.provider='openai'
        AND key_ref.resolver_type='server_reference' AND key_ref.status='active' AND key_ref.deleted_at IS NULL
        AND(key_ref.expires_at IS NULL OR key_ref.expires_at>created_at_value))
    OR NOT EXISTS(SELECT 1 FROM public.enterprise_ai_capability_routes route
      WHERE route.id=p_assess_route AND route.org_id=p_org AND route.workspace_id=p_workspace
        AND route.provider_config_id=p_provider_config AND route.capability='assess.evidence.extract'
        AND route.model='gpt-4.1-mini-2025-04-14' AND route.enabled AND route.deleted_at IS NULL)
    OR NOT EXISTS(SELECT 1 FROM public.enterprise_ai_capability_routes route
      WHERE route.id=p_studio_route AND route.org_id=p_org AND route.workspace_id=p_workspace
        AND route.provider_config_id=p_provider_config AND route.capability='studio.document.generate'
        AND route.model='gpt-4.1-mini-2025-04-14' AND route.enabled AND route.deleted_at IS NULL)
  THEN RAISE EXCEPTION 'SYNTHETIC_AI_CAMPAIGN_RENEWAL_BINDING_STALE'; END IF;

  SELECT count(*)::integer,count(*) FILTER(WHERE consumed_at IS NOT NULL)::integer,
    COALESCE(sum(debit_usd_nanos),0)::bigint
    INTO historical_debits,historical_consumed,historical_spend
    FROM public.synthetic_ai_campaign_effect_debits debit WHERE debit.campaign_id=campaign.id;
  IF historical_debits<>1 OR historical_consumed<>1 OR historical_spend<>471459200
    OR campaign.carried_usd_nanos+historical_spend<>p_expected_baseline_usd_nanos
    OR NOT EXISTS(SELECT 1 FROM public.synthetic_ai_campaign_effect_debits debit
      WHERE debit.campaign_id=campaign.id AND debit.operation='provider.validate'
        AND debit.authority_kind='enterprise' AND debit.consumed_at IS NOT NULL AND debit.renewal_id IS NULL)
    OR EXISTS(SELECT 1 FROM public.synthetic_ai_campaign_effect_debits debit
      WHERE debit.campaign_id=campaign.id AND debit.consumed_at IS NULL)
    OR EXISTS(SELECT 1 FROM public.enterprise_ai_budget_reservations reservation
      WHERE reservation.org_id=p_org AND reservation.workspace_id=p_workspace
        AND reservation.provider_config_id=p_provider_config
        AND(reservation.state IN('reserved','uncertain')
          OR reservation.studio_transfer_pending OR reservation.assess_mapping_transfer_pending))
  THEN RAISE EXCEPTION 'SYNTHETIC_AI_CAMPAIGN_RENEWAL_HISTORY_UNSAFE'; END IF;

  digest_value:='sha256:'||encode(public.digest(convert_to(concat_ws('|','synthetic-ai-renewal-v1',campaign.id::text,
    p_target_fingerprint,p_project_ref,p_org::text,p_workspace::text,p_actor::text,p_authorization_version::text,
    p_provider_config::text,p_key_ref::text,p_assess_route::text,p_studio_route::text,
    p_expected_baseline_usd_nanos::text,p_window_seconds::text,created_at_value::text),'UTF8'),'sha256'),'hex');
  INSERT INTO public.synthetic_ai_campaign_renewals(campaign_id,renewed_by,authorization_version,target_fingerprint,
    project_ref,server_host,org_id,workspace_id,provider_config_id,key_ref_id,assess_route_id,studio_route_id,
    binding_digest,created_at,expires_at)
  VALUES(campaign.id,p_actor,p_authorization_version,p_target_fingerprint,p_project_ref,request_host,p_org,p_workspace,
    p_provider_config,p_key_ref,p_assess_route,p_studio_route,digest_value,created_at_value,
    created_at_value+make_interval(secs=>p_window_seconds)) RETURNING * INTO renewal;
  RETURN jsonb_build_object('status','renewed','renewalId',renewal.id,'campaignId',campaign.id,
    'expiresAt',renewal.expires_at,'baselineAggregateUsdNanos',renewal.baseline_aggregate_usd_nanos,
    'fixedDebitUsdNanos',renewal.fixed_debit_usd_nanos,'maximumAdditionalEffects',renewal.maximum_additional_effects,
    'maximumAggregateUsdNanos',renewal.maximum_aggregate_usd_nanos,'bindingDigest',renewal.binding_digest);
END
$$;

-- Patch only exact predecessor fragments. Any source drift aborts the migration.
DO $reserve_forward$
DECLARE fn regprocedure:='public.synthetic_ai_campaign_reserve_effect(uuid,uuid,uuid,bigint,text,text,uuid,uuid,uuid,bigint,uuid,uuid,uuid,text,text,text,text,text,integer)'::regprocedure;
  definition text;old text;replacement text;
BEGIN
  SELECT pg_get_functiondef(fn) INTO STRICT definition;
  old:=' prior public.synthetic_ai_campaign_effect_debits;spent bigint;request_host text;';
  replacement:=' prior public.synthetic_ai_campaign_effect_debits;renewal public.synthetic_ai_campaign_renewals;spent bigint;renewal_count integer;slot_count integer;request_host text;';
  IF length(definition)-length(replace(definition,old,''))<>length(old) THEN RAISE EXCEPTION 'SYNTHETIC_AI_RENEWAL_RESERVE_DECLARATION_DRIFT';END IF;
  definition:=replace(definition,old,replacement);
  old:='IF campaign.id IS NULL OR campaign.expires_at<=statement_timestamp() OR NOT p_operation=ANY(campaign.allowed_operations)';
  replacement:='IF campaign.id IS NULL OR (public.synthetic_ai_campaign_active_until(campaign.id)>statement_timestamp()) IS NOT TRUE OR NOT p_operation=ANY(campaign.allowed_operations)';
  IF length(definition)-length(replace(definition,old,''))<>length(old) THEN RAISE EXCEPTION 'SYNTHETIC_AI_RENEWAL_RESERVE_WINDOW_DRIFT';END IF;
  definition:=replace(definition,old,replacement);
  old:=E' END IF;\n SELECT COALESCE(sum(debit_usd_nanos),0) INTO spent FROM public.synthetic_ai_campaign_effect_debits WHERE campaign_id=campaign.id;';
  replacement:=E' END IF;\n IF campaign.expires_at<=statement_timestamp() THEN\n  SELECT * INTO renewal FROM public.synthetic_ai_campaign_renewals active\n   WHERE active.campaign_id=campaign.id AND active.expires_at>statement_timestamp() FOR SHARE;\n  SELECT count(*)::integer INTO renewal_count FROM public.synthetic_ai_campaign_effect_debits debit WHERE debit.renewal_id=renewal.id;\n  IF renewal.id IS NULL OR renewal_count>=renewal.maximum_additional_effects THEN RAISE EXCEPTION ''SYNTHETIC_AI_CAMPAIGN_EFFECT_LIMIT_REACHED'';END IF;\n  SELECT count(*)::integer INTO slot_count FROM public.synthetic_ai_campaign_effect_debits debit WHERE debit.renewal_id=renewal.id AND(\n   (kind=''enterprise'' AND p_operation=''provider.validate'' AND debit.authority_kind=''enterprise'' AND debit.operation=''provider.validate'')\n   OR(kind=''enterprise'' AND p_operation=''assess.evidence.extract'' AND debit.authority_kind=''enterprise'' AND debit.operation=''assess.evidence.extract'')\n   OR(kind=''assess_mapping'' AND p_operation=''assess.evidence.extract'' AND debit.authority_kind=''assess_mapping'' AND debit.operation=''assess.evidence.extract'')\n   OR(kind=''studio'' AND p_operation=''studio.document.generate'' AND debit.authority_kind=''studio'' AND debit.operation=''studio.document.generate''));\n  IF NOT ((kind=''enterprise'' AND p_operation=''provider.validate'' AND slot_count<1)\n    OR(kind=''enterprise'' AND p_operation=''assess.evidence.extract'' AND slot_count<1)\n    OR(kind=''assess_mapping'' AND p_operation=''assess.evidence.extract'' AND slot_count<1)\n    OR(kind=''studio'' AND p_operation=''studio.document.generate'' AND slot_count<3))\n  THEN RAISE EXCEPTION ''SYNTHETIC_AI_CAMPAIGN_EFFECT_SLOT_NOT_AUTHORIZED'';END IF;\n END IF;\n SELECT COALESCE(sum(debit_usd_nanos),0) INTO spent FROM public.synthetic_ai_campaign_effect_debits WHERE campaign_id=campaign.id;\n IF renewal.id IS NOT NULL AND campaign.carried_usd_nanos+spent+campaign.fixed_debit_usd_nanos>renewal.maximum_aggregate_usd_nanos\n THEN RAISE EXCEPTION ''SYNTHETIC_AI_CAMPAIGN_EFFECT_LIMIT_REACHED'';END IF;';
  IF length(definition)-length(replace(definition,old,''))<>length(old) THEN RAISE EXCEPTION 'SYNTHETIC_AI_RENEWAL_RESERVE_LIMIT_DRIFT';END IF;
  definition:=replace(definition,old,replacement);
  old:='  campaign_id,receipt_id,effect_id,authority_kind,assess_mapping_run_id,studio_receipt_id,studio_attempt_id,';
  replacement:='  campaign_id,renewal_id,receipt_id,effect_id,authority_kind,assess_mapping_run_id,studio_receipt_id,studio_attempt_id,';
  IF length(definition)-length(replace(definition,old,''))<>length(old) THEN RAISE EXCEPTION 'SYNTHETIC_AI_RENEWAL_RESERVE_INSERT_DRIFT';END IF;
  definition:=replace(definition,old,replacement);
  old:=' VALUES(campaign.id,CASE WHEN kind IN(''enterprise'',''assess_mapping'') THEN p_receipt END,p_effect,kind,';
  replacement:=' VALUES(campaign.id,renewal.id,CASE WHEN kind IN(''enterprise'',''assess_mapping'') THEN p_receipt END,p_effect,kind,';
  IF length(definition)-length(replace(definition,old,''))<>length(old) THEN RAISE EXCEPTION 'SYNTHETIC_AI_RENEWAL_RESERVE_VALUES_DRIFT';END IF;
  EXECUTE replace(definition,old,replacement);
END
$reserve_forward$;

DO $consume_forward$
DECLARE fn regprocedure:='public.synthetic_ai_campaign_consume_effect(uuid,uuid,uuid,uuid,bigint,text,text,uuid,uuid,uuid,bigint,uuid,uuid,uuid,text,text,text,text,text,integer)'::regprocedure;
  definition text;old text;replacement text;
BEGIN
  SELECT pg_get_functiondef(fn) INTO STRICT definition;
  old:=' debit public.synthetic_ai_campaign_effect_debits;request_host text;';
  replacement:=' debit public.synthetic_ai_campaign_effect_debits;renewal public.synthetic_ai_campaign_renewals;request_host text;';
  IF length(definition)-length(replace(definition,old,''))<>length(old) THEN RAISE EXCEPTION 'SYNTHETIC_AI_RENEWAL_CONSUME_DECLARATION_DRIFT';END IF;
  definition:=replace(definition,old,replacement);
  old:=E' SELECT * INTO debit FROM public.synthetic_ai_campaign_effect_debits stored\n  WHERE stored.id=p_reservation AND stored.campaign_id=campaign.id FOR UPDATE;\n IF campaign.id IS NULL OR campaign.expires_at<=statement_timestamp() OR debit.id IS NULL OR debit.consumed_at IS NOT NULL';
  replacement:=E' SELECT * INTO debit FROM public.synthetic_ai_campaign_effect_debits stored\n  WHERE stored.id=p_reservation AND stored.campaign_id=campaign.id FOR UPDATE;\n IF campaign.expires_at<=statement_timestamp() THEN\n  SELECT * INTO renewal FROM public.synthetic_ai_campaign_renewals active\n   WHERE active.campaign_id=campaign.id AND active.expires_at>statement_timestamp() FOR SHARE;\n END IF;\n IF campaign.id IS NULL OR (public.synthetic_ai_campaign_active_until(campaign.id)>statement_timestamp()) IS NOT TRUE OR debit.id IS NULL OR debit.consumed_at IS NOT NULL\n  OR(campaign.expires_at<=statement_timestamp() AND(renewal.id IS NULL OR debit.renewal_id IS DISTINCT FROM renewal.id\n    OR debit.reserved_at<renewal.created_at OR debit.reserved_at>=renewal.expires_at))';
  IF length(definition)-length(replace(definition,old,''))<>length(old) THEN RAISE EXCEPTION 'SYNTHETIC_AI_RENEWAL_CONSUME_WINDOW_DRIFT';END IF;
  EXECUTE replace(definition,old,replacement);
END
$consume_forward$;

DO $capability_forward$
DECLARE fn regprocedure:='public.synthetic_ai_campaign_required_budget_capability(uuid,uuid,uuid,uuid,text,text,text)'::regprocedure;
  definition text;old text;replacement text;
BEGIN
  SELECT pg_get_functiondef(fn) INTO STRICT definition;
  old:=E'    AND authority.provider_config_id=p_provider_config AND authority.enabled\n    AND authority.disabled_at IS NULL AND authority.expires_at>statement_timestamp()';
  replacement:=E'    AND authority.provider_config_id=p_provider_config AND authority.enabled\n    AND authority.disabled_at IS NULL AND public.synthetic_ai_campaign_active_until(authority.id)>statement_timestamp()';
  IF length(definition)-length(replace(definition,old,''))<>length(old) THEN RAISE EXCEPTION 'SYNTHETIC_AI_RENEWAL_CAPABILITY_DRIFT';END IF;
  EXECUTE replace(definition,old,replacement);
END
$capability_forward$;

-- Fresh disposable databases bootstrap against the new exact migration tip.
DO $bootstrap_forward$
DECLARE fn regprocedure:='public.synthetic_ai_campaign_bootstrap(uuid,uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,uuid,timestamptz)'::regprocedure;
  definition text;old text:='marker.migration_tip=''20260918082307''';replacement text:='marker.migration_tip=''20260922112911''';
BEGIN
  SELECT pg_get_functiondef(fn) INTO STRICT definition;
  IF length(definition)-length(replace(definition,old,''))<>length(old)
    OR position(replacement IN definition)>0 THEN RAISE EXCEPTION 'SYNTHETIC_AI_RENEWAL_BOOTSTRAP_DRIFT';END IF;
  EXECUTE replace(definition,old,replacement);
END
$bootstrap_forward$;

REVOKE ALL ON FUNCTION public.synthetic_ai_campaign_renewal_guard(),
  public.synthetic_ai_campaign_active_until(uuid),
  public.synthetic_ai_campaign_renew_once(uuid,uuid,uuid,bigint,text,text,uuid,uuid,uuid,uuid,uuid,bigint,integer)
FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION
  public.synthetic_ai_campaign_renew_once(uuid,uuid,uuid,bigint,text,text,uuid,uuid,uuid,uuid,uuid,bigint,integer)
TO service_role;

ALTER TABLE public.hosted_pilot_environment_identity DROP CONSTRAINT hosted_pilot_environment_identity_migration_tip_check;
UPDATE public.hosted_pilot_environment_identity SET migration_tip='20260922112911'
 WHERE singleton AND migration_tip='20260918082307'
  AND NOT production_authorized AND NOT customer_data_authorized AND NOT real_provider_calls_authorized;
DO $tip$
BEGIN
 IF(SELECT count(*) FROM public.hosted_pilot_environment_identity WHERE singleton
   AND migration_tip='20260922112911' AND NOT production_authorized
   AND NOT customer_data_authorized AND NOT real_provider_calls_authorized)<>1
 THEN RAISE EXCEPTION 'SYNTHETIC_AI_CAMPAIGN_RENEWAL_MIGRATION_TIP_FAILED';END IF;
END
$tip$;
ALTER TABLE public.hosted_pilot_environment_identity ADD CONSTRAINT hosted_pilot_environment_identity_migration_tip_check
  CHECK(migration_tip='20260922112911');

COMMENT ON TABLE public.synthetic_ai_campaign_renewals IS
  'Append-only single renewal of the expired synthetic AI campaign. Six fixed-debit effects maximum; original campaign, debits, failures and aggregate USD 10 cap remain authoritative.';
COMMENT ON COLUMN public.synthetic_ai_campaign_effect_debits.renewal_id IS
  'Immutable binding to the one-time renewal window. Null on every original campaign debit.';

-- Rollback/read-only fallback: leave both provider runtimes off or invoke the
-- existing synthetic_ai_campaign_disable RPC. Never delete the renewal or any
-- debit, never clear disabled history, and forward-fix additive schema only.
