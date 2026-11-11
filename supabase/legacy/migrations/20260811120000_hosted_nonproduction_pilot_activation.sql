-- Hosted non-production pilot identity and synthetic exercise authority.
-- Additive only. Applying this migration does not authorize production or real-provider traffic.
CREATE TABLE public.hosted_pilot_environment_identity (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  product_key text NOT NULL CHECK (product_key = 'avalaos-core'),
  environment_class text NOT NULL CHECK (environment_class = 'hosted_nonproduction_pilot'),
  schema_contract text NOT NULL CHECK (schema_contract = 'hosted-pilot-2026-08'),
  migration_tip text NOT NULL CHECK (migration_tip = '20260811120000'),
  production_authorized boolean NOT NULL DEFAULT false CHECK (NOT production_authorized),
  customer_data_authorized boolean NOT NULL DEFAULT false CHECK (NOT customer_data_authorized),
  real_provider_calls_authorized boolean NOT NULL DEFAULT false CHECK (NOT real_provider_calls_authorized),
  installed_at timestamptz NOT NULL DEFAULT statement_timestamp()
);
INSERT INTO public.hosted_pilot_environment_identity(singleton,product_key,environment_class,schema_contract,migration_tip)
VALUES(true,'avalaos-core','hosted_nonproduction_pilot','hosted-pilot-2026-08','20260811120000');
COMMENT ON TABLE public.hosted_pilot_environment_identity IS
  'Non-secret AvalaOS schema marker. Presence is not hosted verification or deployment evidence.';

CREATE TABLE public.hosted_pilot_synthetic_subjects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL,
  subject_key text NOT NULL CHECK (subject_key ~ '^synthetic_[a-z0-9_]{3,48}$'),
  test_role text NOT NULL CHECK (test_role IN ('owner','operator','reviewer','revoked','cross_tenant')),
  lifecycle text NOT NULL DEFAULT 'active' CHECK (lifecycle IN ('active','revoked','deprovisioned')),
  synthetic_only boolean NOT NULL DEFAULT true CHECK (synthetic_only),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  UNIQUE(org_id,workspace_id,subject_key),
  FOREIGN KEY(workspace_id,org_id) REFERENCES public.workspaces(id,org_id) ON DELETE RESTRICT
);

CREATE TABLE public.hosted_pilot_provider_simulations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES public.profiles(id),
  idempotency_key text NOT NULL CHECK (length(btrim(idempotency_key)) BETWEEN 8 AND 200),
  scenario text NOT NULL CHECK (scenario IN ('success','failure','timeout','revoked','rotated')),
  request_sha256 text NOT NULL CHECK (request_sha256 ~ '^[0-9a-f]{64}$'),
  result_sha256 text NOT NULL CHECK (result_sha256 ~ '^[0-9a-f]{64}$'),
  outcome text NOT NULL CHECK (outcome IN ('simulated_success','simulated_failure','simulated_timeout','simulated_revoked','simulated_rotated')),
  zero_egress boolean NOT NULL DEFAULT true CHECK (zero_egress),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  UNIQUE(org_id,workspace_id,actor_id,idempotency_key),
  FOREIGN KEY(workspace_id,org_id) REFERENCES public.workspaces(id,org_id) ON DELETE RESTRICT
);
CREATE TRIGGER hosted_pilot_provider_simulations_immutable BEFORE UPDATE OR DELETE
  ON public.hosted_pilot_provider_simulations FOR EACH ROW
  EXECUTE FUNCTION public.pilot_operations_immutable();

CREATE FUNCTION public.hosted_pilot_bootstrap_synthetic(
  p_actor uuid,p_org uuid,p_workspace uuid,p_authorization_version bigint,p_operation text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE lifecycle_value text; subject_count integer;
BEGIN
  PERFORM public.pr1b_assert_command_authority(p_actor,p_org,p_workspace,'org.admin',p_authorization_version);
  IF NOT EXISTS (SELECT 1 FROM public.hosted_pilot_environment_identity WHERE singleton
    AND product_key='avalaos-core' AND environment_class='hosted_nonproduction_pilot'
    AND migration_tip='20260811120000' AND NOT production_authorized
    AND NOT customer_data_authorized AND NOT real_provider_calls_authorized) THEN
    RAISE EXCEPTION 'HOSTED_PILOT_IDENTITY_MISMATCH';
  END IF;
  IF p_operation NOT IN ('bootstrap','deprovision','replay') THEN RAISE EXCEPTION 'VALIDATION_FAILED'; END IF;
  IF p_operation IN ('bootstrap','replay') THEN
    INSERT INTO public.hosted_pilot_synthetic_subjects(org_id,workspace_id,subject_key,test_role,lifecycle,created_by)
    SELECT p_org,p_workspace,v.subject_key,v.test_role,
      CASE WHEN v.test_role='revoked' THEN 'revoked' ELSE 'active' END,p_actor
    FROM (VALUES ('synthetic_owner','owner'),('synthetic_operator','operator'),
      ('synthetic_reviewer','reviewer'),('synthetic_revoked','revoked'),
      ('synthetic_cross_tenant','cross_tenant')) AS v(subject_key,test_role)
    ON CONFLICT(org_id,workspace_id,subject_key) DO UPDATE SET
      lifecycle=CASE WHEN public.hosted_pilot_synthetic_subjects.lifecycle='deprovisioned'
        THEN public.hosted_pilot_synthetic_subjects.lifecycle ELSE excluded.lifecycle END,
      updated_at=statement_timestamp();
  ELSE
    UPDATE public.hosted_pilot_synthetic_subjects SET lifecycle='deprovisioned',version=version+1,
      updated_at=statement_timestamp() WHERE org_id=p_org AND workspace_id=p_workspace
      AND lifecycle<>'deprovisioned';
  END IF;
  SELECT count(*),min(lifecycle) INTO subject_count,lifecycle_value
    FROM public.hosted_pilot_synthetic_subjects WHERE org_id=p_org AND workspace_id=p_workspace;
  RETURN jsonb_build_object('syntheticOnly',true,'customerDataUsed',false,'subjectCount',subject_count,
    'lifecycle',CASE WHEN p_operation='deprovision' THEN 'deprovisioned' ELSE 'bounded_synthetic' END,
    'productionAuthorized',false);
END$$;

CREATE FUNCTION public.hosted_pilot_simulate_provider(
  p_actor uuid,p_org uuid,p_workspace uuid,p_authorization_version bigint,
  p_idempotency_key text,p_scenario text,p_request_payload text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE request_digest text; result_digest text; existing public.hosted_pilot_provider_simulations; result jsonb;
BEGIN
  PERFORM public.pr1b_assert_command_authority(p_actor,p_org,p_workspace,'operations.manage',p_authorization_version);
  IF p_scenario NOT IN ('success','failure','timeout','revoked','rotated')
    OR length(btrim(p_idempotency_key)) NOT BETWEEN 8 AND 200
    OR length(p_request_payload)>16384 THEN RAISE EXCEPTION 'VALIDATION_FAILED'; END IF;
  request_digest:=encode(public.digest(convert_to(p_scenario||':'||p_request_payload,'UTF8'),'sha256'),'hex');
  -- Serialize the actor-bound receipt key so response-loss/concurrent retries converge.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_org::text||':'||p_workspace::text||':'||p_actor::text||':'||p_idempotency_key,0));
  SELECT * INTO existing FROM public.hosted_pilot_provider_simulations WHERE org_id=p_org
    AND workspace_id=p_workspace AND actor_id=p_actor AND idempotency_key=p_idempotency_key;
  IF FOUND THEN
    IF existing.request_sha256<>request_digest THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF;
    RETURN jsonb_build_object('outcome',existing.outcome,'resultSha256',existing.result_sha256,
      'zeroEgress',true,'realProviderCalled',false);
  END IF;
  result_digest:=encode(public.digest(convert_to('avalaos-deterministic-simulator-v1:'||request_digest,'UTF8'),'sha256'),'hex');
  INSERT INTO public.hosted_pilot_provider_simulations(org_id,workspace_id,actor_id,idempotency_key,
    scenario,request_sha256,result_sha256,outcome)
  VALUES(p_org,p_workspace,p_actor,p_idempotency_key,p_scenario,request_digest,result_digest,'simulated_'||p_scenario);
  RETURN jsonb_build_object('outcome','simulated_'||p_scenario,'resultSha256',result_digest,
    'zeroEgress',true,'realProviderCalled',false);
END$$;

ALTER TABLE public.hosted_pilot_environment_identity ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_pilot_environment_identity FORCE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_pilot_synthetic_subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_pilot_synthetic_subjects FORCE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_pilot_provider_simulations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_pilot_provider_simulations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.hosted_pilot_environment_identity,public.hosted_pilot_synthetic_subjects,
  public.hosted_pilot_provider_simulations FROM PUBLIC,anon,authenticated;
GRANT SELECT ON TABLE public.hosted_pilot_environment_identity TO service_role;
REVOKE ALL ON FUNCTION public.hosted_pilot_bootstrap_synthetic(uuid,uuid,uuid,bigint,text),
  public.hosted_pilot_simulate_provider(uuid,uuid,uuid,bigint,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.hosted_pilot_bootstrap_synthetic(uuid,uuid,uuid,bigint,text),
  public.hosted_pilot_simulate_provider(uuid,uuid,uuid,bigint,text,text,text) TO service_role;
