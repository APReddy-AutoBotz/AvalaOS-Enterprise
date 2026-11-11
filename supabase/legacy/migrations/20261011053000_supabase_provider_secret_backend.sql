-- Synthetic-only Supabase Vault provider-secret backend.
--
-- Installation is inert on ordinary PostgreSQL: the wrappers exist but
-- capability remains false when the Supabase Vault objects are unavailable.
-- Existing key references retain NULL backend ownership and are never
-- reinterpreted as Supabase Vault material.

DO $supabase_provider_secret_source$
DECLARE marker public.hosted_pilot_environment_identity;
BEGIN
  LOCK TABLE public.hosted_pilot_environment_identity IN SHARE ROW EXCLUSIVE MODE;
  SELECT * INTO STRICT marker
  FROM public.hosted_pilot_environment_identity
  WHERE singleton
  FOR UPDATE;
  IF marker.product_key <> 'avalaos-core'
    OR marker.environment_class <> 'hosted_nonproduction_pilot'
    OR marker.schema_contract <> 'hosted-pilot-2026-08'
    OR marker.migration_tip <> '20261010144356'
    OR marker.production_authorized
    OR marker.customer_data_authorized
    OR marker.real_provider_calls_authorized
    OR to_regclass('public.enterprise_provider_secret_backend_ownerships') IS NOT NULL
  THEN
    RAISE EXCEPTION 'SUPABASE_PROVIDER_SECRET_SOURCE_MISMATCH';
  END IF;
END
$supabase_provider_secret_source$;

ALTER TABLE public.ai_provider_key_refs
  ADD COLUMN secret_backend_kind text
  CONSTRAINT ai_provider_key_refs_secret_backend_kind_check
  CHECK(secret_backend_kind IS NULL OR secret_backend_kind IN('hashicorp_vault','supabase_vault'));

ALTER TABLE public.enterprise_provider_secret_cleanup_jobs
  ADD COLUMN secret_backend_kind text
    CHECK(secret_backend_kind IS NULL OR secret_backend_kind IN('hashicorp_vault','supabase_vault')),
  ADD COLUMN safe_fingerprint text
    CHECK(safe_fingerprint IS NULL OR safe_fingerprint~'^sha256:[0-9a-f]{24}$'),
  ADD COLUMN execution_fence bigint NOT NULL DEFAULT 0 CHECK(execution_fence>=0);

CREATE TABLE public.enterprise_provider_secret_backend_ownerships(
  key_ref_id uuid PRIMARY KEY,
  exercise_id uuid NOT NULL REFERENCES public.authenticated_synthetic_exercises(id) ON DELETE RESTRICT,
  receipt_id uuid NOT NULL REFERENCES public.enterprise_ai_command_receipts(id) ON DELETE RESTRICT,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL,
  provider text NOT NULL CHECK(provider IN('openai','azure_openai','anthropic','gemini','groq','openai_compatible')),
  backend_kind text NOT NULL CHECK(backend_kind='supabase_vault'),
  secret_reference_hash text NOT NULL CHECK(secret_reference_hash~'^[0-9a-f]{64}$'),
  safe_fingerprint text NOT NULL CHECK(safe_fingerprint~'^sha256:[0-9a-f]{24}$'),
  vault_secret_id uuid,
  state text NOT NULL CHECK(state IN('planned','written','deleted')),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  deleted_at timestamptz,
  CHECK(
    (state='planned' AND vault_secret_id IS NULL AND deleted_at IS NULL)
    OR(state='written' AND vault_secret_id IS NOT NULL AND deleted_at IS NULL)
    OR(state='deleted' AND vault_secret_id IS NOT NULL AND deleted_at IS NOT NULL)
  ),
  UNIQUE(backend_kind,secret_reference_hash),
  UNIQUE(key_ref_id,org_id),
  FOREIGN KEY(workspace_id,org_id) REFERENCES public.workspaces(id,org_id) ON DELETE RESTRICT
);
ALTER TABLE public.enterprise_provider_secret_backend_ownerships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enterprise_provider_secret_backend_ownerships FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.enterprise_provider_secret_backend_ownerships FROM PUBLIC,anon,authenticated,service_role;

DO $supabase_provider_secret_browser_vault_denial$
BEGIN
  IF to_regnamespace('vault') IS NOT NULL THEN
    EXECUTE 'REVOKE USAGE ON SCHEMA vault FROM PUBLIC,anon,authenticated';
    IF to_regclass('vault.secrets') IS NOT NULL THEN
      EXECUTE 'REVOKE ALL ON TABLE vault.secrets FROM PUBLIC,anon,authenticated';
    END IF;
    IF to_regclass('vault.decrypted_secrets') IS NOT NULL THEN
      EXECUTE 'REVOKE ALL ON TABLE vault.decrypted_secrets FROM PUBLIC,anon,authenticated';
    END IF;
  END IF;
END
$supabase_provider_secret_browser_vault_denial$;

COMMENT ON TABLE public.enterprise_provider_secret_backend_ownerships IS
  'Service-only immutable Supabase Vault ownership metadata. Stores digests and selectors only; never secret values or secret references.';
COMMENT ON COLUMN public.ai_provider_key_refs.secret_backend_kind IS
  'Explicit managed backend identity. NULL preserves legacy or pre-provisioned ownership and must not be guessed.';

CREATE OR REPLACE FUNCTION public.enterprise_provider_secret_backend_capability()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE marker public.hosted_pilot_environment_identity;
  enterprise public.enterprise_intelligence_runtime_control;
  studio public.studio_artifact_runtime_control;
  exercise_active boolean:=false;
  available boolean:=false;
BEGIN
  SELECT * INTO marker FROM public.hosted_pilot_environment_identity WHERE singleton;
  SELECT * INTO enterprise FROM public.enterprise_intelligence_runtime_control WHERE singleton;
  SELECT * INTO studio FROM public.studio_artifact_runtime_control WHERE singleton;
  available:=to_regclass('vault.secrets') IS NOT NULL
    AND to_regclass('vault.decrypted_secrets') IS NOT NULL
    AND to_regprocedure('vault.create_secret(text,text,text,uuid)') IS NOT NULL;
  SELECT EXISTS(
    SELECT 1 FROM public.authenticated_synthetic_exercises
    WHERE lifecycle='active' AND expires_at>statement_timestamp()
  ) INTO exercise_active;
  RETURN jsonb_build_object(
    'backendKind','supabase_vault',
    'available',available,
    'migrationTip',COALESCE(marker.migration_tip,''),
    'exerciseActive',exercise_active,
    'providerCallsAuthorized',COALESCE(marker.real_provider_calls_authorized,false)
      OR COALESCE(enterprise.provider_enabled,false)
      OR COALESCE(studio.provider_enabled,false)
  );
END
$$;

REVOKE ALL ON FUNCTION public.enterprise_provider_secret_backend_capability() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enterprise_provider_secret_backend_capability() TO service_role;

CREATE OR REPLACE FUNCTION public.enterprise_provider_secret_stamp_key_ref_backend()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ownership public.enterprise_provider_secret_backend_ownerships;
  reference_hash text;
BEGIN
  IF TG_OP='UPDATE' AND NEW.secret_backend_kind IS DISTINCT FROM OLD.secret_backend_kind THEN
    RAISE EXCEPTION 'ENTERPRISE_PROVIDER_SECRET_BACKEND_IMMUTABLE';
  END IF;
  IF TG_OP='UPDATE' THEN RETURN NEW; END IF;
  reference_hash:=encode(public.digest(convert_to(NEW.secret_ref,'UTF8'),'sha256'),'hex');
  SELECT * INTO ownership
  FROM public.enterprise_provider_secret_backend_ownerships
  WHERE key_ref_id=NEW.id
  FOR SHARE;
  IF ownership.key_ref_id IS NULL THEN
    IF NEW.secret_backend_kind IS NOT NULL THEN
      RAISE EXCEPTION 'ENTERPRISE_PROVIDER_SECRET_OWNERSHIP_REQUIRED';
    END IF;
    RETURN NEW;
  END IF;
  IF ownership.state<>'written'
    OR ownership.backend_kind<>'supabase_vault'
    OR ownership.org_id IS DISTINCT FROM NEW.org_id
    OR ownership.provider IS DISTINCT FROM NEW.provider
    OR ownership.secret_reference_hash IS DISTINCT FROM reference_hash
    OR ownership.safe_fingerprint IS DISTINCT FROM NEW.safe_fingerprint
  THEN
    RAISE EXCEPTION 'ENTERPRISE_PROVIDER_SECRET_OWNERSHIP_MISMATCH';
  END IF;
  NEW.secret_backend_kind:='supabase_vault';
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS enterprise_provider_secret_stamp_key_ref_backend ON public.ai_provider_key_refs;
CREATE TRIGGER enterprise_provider_secret_stamp_key_ref_backend
BEFORE INSERT OR UPDATE OF secret_backend_kind ON public.ai_provider_key_refs
FOR EACH ROW EXECUTE FUNCTION public.enterprise_provider_secret_stamp_key_ref_backend();

REVOKE ALL ON FUNCTION public.enterprise_provider_secret_stamp_key_ref_backend() FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.enterprise_ai_enqueue_retired_provider_secret_cleanup()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF NEW.resolver_type='server_reference'
    AND NEW.provider IN('openai','azure_openai','anthropic','gemini','groq','openai_compatible')
    AND ((OLD.status IS DISTINCT FROM NEW.status AND NEW.status IN('retired','revoked'))
      OR(OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL))
  THEN
    INSERT INTO public.enterprise_provider_secret_cleanup_jobs(
      key_ref_id,org_id,provider,secret_backend_kind,safe_fingerprint
    ) VALUES(
      NEW.id,NEW.org_id,NEW.provider,NEW.secret_backend_kind,NEW.safe_fingerprint
    )
    ON CONFLICT(key_ref_id,org_id) DO UPDATE SET
      state=CASE WHEN public.enterprise_provider_secret_cleanup_jobs.state='completed' THEN 'completed' ELSE 'pending' END,
      secret_backend_kind=EXCLUDED.secret_backend_kind,
      safe_fingerprint=EXCLUDED.safe_fingerprint,
      execution_token=NULL,
      lease_expires_at=NULL,
      next_attempt_at=statement_timestamp(),
      updated_at=statement_timestamp();
  END IF;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.enterprise_ai_enqueue_retired_provider_secret_cleanup() FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.enterprise_provider_secret_write(
  p_receipt uuid,p_execution_token uuid,p_execution_fence bigint,p_key_ref uuid,
  p_org uuid,p_provider text,p_secret_ref text,p_safe_fingerprint text,p_secret_value text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE receipt public.enterprise_ai_command_receipts;
  marker public.hosted_pilot_environment_identity;
  enterprise public.enterprise_intelligence_runtime_control;
  studio public.studio_artifact_runtime_control;
  exercise public.authenticated_synthetic_exercises;
  ownership public.enterprise_provider_secret_backend_ownerships;
  reference_hash text;
  value_fingerprint text;
  stored_value text;
  named_id uuid;
  created_id uuid;
  session_valid boolean:=false;
BEGIN
  IF p_receipt IS NULL OR p_execution_token IS NULL OR p_execution_fence IS NULL OR p_execution_fence<1
    OR p_key_ref IS NULL OR p_org IS NULL
    OR p_provider NOT IN('openai','azure_openai','anthropic','gemini','groq','openai_compatible')
    OR p_secret_ref IS NULL OR length(p_secret_ref)>512
    OR p_secret_ref !~ ('^AVALA_PROVIDER_SECRET_'||upper(p_provider)||'_'||upper(replace(p_org::text,'-',''))||'_[A-Z0-9]+$')
    OR p_safe_fingerprint!~'^sha256:[0-9a-f]{24}$'
    OR p_secret_value IS NULL OR length(p_secret_value) NOT BETWEEN 8 AND 16384
  THEN RAISE EXCEPTION 'ENTERPRISE_PROVIDER_SECRET_REFERENCE_INVALID'; END IF;

  value_fingerprint:='sha256:'||left(encode(public.digest(convert_to(p_secret_value,'UTF8'),'sha256'),'hex'),24);
  IF value_fingerprint IS DISTINCT FROM p_safe_fingerprint THEN
    RAISE EXCEPTION 'ENTERPRISE_PROVIDER_SECRET_CONFLICT';
  END IF;
  reference_hash:=encode(public.digest(convert_to(p_secret_ref,'UTF8'),'sha256'),'hex');

  SELECT * INTO STRICT marker FROM public.hosted_pilot_environment_identity WHERE singleton FOR SHARE;
  SELECT * INTO STRICT enterprise FROM public.enterprise_intelligence_runtime_control WHERE singleton FOR SHARE;
  SELECT * INTO STRICT studio FROM public.studio_artifact_runtime_control WHERE singleton FOR SHARE;
  IF marker.product_key<>'avalaos-core' OR marker.environment_class<>'hosted_nonproduction_pilot'
    OR marker.migration_tip<>'20261011053000' OR marker.production_authorized
    OR marker.customer_data_authorized OR marker.real_provider_calls_authorized
    OR enterprise.provider_enabled OR studio.provider_enabled
    OR to_regclass('vault.secrets') IS NULL OR to_regclass('vault.decrypted_secrets') IS NULL
    OR to_regprocedure('vault.create_secret(text,text,text,uuid)') IS NULL
  THEN RAISE EXCEPTION 'ENTERPRISE_PROVIDER_SECRET_BACKEND_UNAVAILABLE'; END IF;

  SELECT * INTO receipt FROM public.enterprise_ai_command_receipts
  WHERE id=p_receipt AND org_id=p_org FOR UPDATE;
  IF receipt.id IS NULL OR receipt.runtime_area<>'provider'
    OR receipt.command_type NOT IN('provider.secret.bind','provider.secret.rotate')
    OR receipt.status<>'claimed' OR receipt.execution_token IS DISTINCT FROM p_execution_token
    OR receipt.execution_fence IS DISTINCT FROM p_execution_fence
    OR receipt.lease_expires_at IS NULL OR receipt.lease_expires_at<=statement_timestamp()
    OR receipt.execution_plan->>'secretOwnership' IS DISTINCT FROM 'managed_write'
    OR receipt.execution_plan->>'secretBackendKind' IS DISTINCT FROM 'supabase_vault'
    OR receipt.execution_plan->>'secretPlanReceiptId' IS DISTINCT FROM p_receipt::text
    OR receipt.execution_plan->>'keyRefId' IS DISTINCT FROM p_key_ref::text
    OR receipt.execution_plan->>'provider' IS DISTINCT FROM p_provider
    OR receipt.execution_plan->>'secretReference' IS DISTINCT FROM p_secret_ref
    OR receipt.execution_plan->>'safeFingerprint' IS DISTINCT FROM p_safe_fingerprint
    OR receipt.execution_plan->>'writeState' IS NULL
    OR receipt.execution_plan->>'writeState' NOT IN('planned','written')
  THEN RAISE EXCEPTION 'ENTERPRISE_PROVIDER_SECRET_STALE_FENCE'; END IF;

  SELECT exercise_row.* INTO exercise
  FROM public.authenticated_synthetic_exercises exercise_row
  JOIN public.authenticated_synthetic_actor_sessions binding
    ON binding.exercise_id=exercise_row.id AND binding.actor_id=receipt.actor_id AND binding.state='active'
  WHERE exercise_row.lifecycle='active' AND exercise_row.expires_at>statement_timestamp()
    AND exercise_row.org_id=receipt.org_id AND exercise_row.workspace_id=receipt.workspace_id
  ORDER BY exercise_row.activated_at DESC LIMIT 1 FOR SHARE OF exercise_row;
  IF exercise.id IS NULL THEN RAISE EXCEPTION 'ENTERPRISE_PROVIDER_SECRET_EXERCISE_REQUIRED'; END IF;
  IF to_regclass('auth.sessions') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS(SELECT 1 FROM public.authenticated_synthetic_actor_sessions binding JOIN auth.sessions session ON session.id=binding.session_id AND session.user_id=binding.actor_id WHERE binding.exercise_id=$1 AND binding.actor_id=$2 AND binding.state=''active'' AND (session.not_after IS NULL OR session.not_after>statement_timestamp()))'
      INTO session_valid USING exercise.id,receipt.actor_id;
  END IF;
  IF NOT session_valid THEN RAISE EXCEPTION 'ENTERPRISE_PROVIDER_SECRET_EXERCISE_REQUIRED'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(reference_hash,0));
  SELECT * INTO ownership FROM public.enterprise_provider_secret_backend_ownerships
  WHERE key_ref_id=p_key_ref OR(backend_kind='supabase_vault' AND secret_reference_hash=reference_hash)
  ORDER BY key_ref_id=p_key_ref DESC LIMIT 1 FOR UPDATE;
  IF ownership.key_ref_id IS NOT NULL THEN
    IF ownership.key_ref_id IS DISTINCT FROM p_key_ref OR ownership.exercise_id IS DISTINCT FROM exercise.id
      OR ownership.receipt_id IS DISTINCT FROM p_receipt OR ownership.org_id IS DISTINCT FROM p_org
      OR ownership.workspace_id IS DISTINCT FROM receipt.workspace_id OR ownership.provider IS DISTINCT FROM p_provider
      OR ownership.backend_kind<>'supabase_vault' OR ownership.secret_reference_hash IS DISTINCT FROM reference_hash
      OR ownership.safe_fingerprint IS DISTINCT FROM p_safe_fingerprint OR ownership.vault_secret_id IS NULL
      OR ownership.state<>'written'
    THEN RAISE EXCEPTION 'ENTERPRISE_PROVIDER_SECRET_CONFLICT'; END IF;
    EXECUTE 'SELECT decrypted_secret FROM vault.decrypted_secrets WHERE id=$1 AND name=$2'
      INTO stored_value USING ownership.vault_secret_id,p_secret_ref;
    IF stored_value IS NULL OR 'sha256:'||left(encode(public.digest(convert_to(stored_value,'UTF8'),'sha256'),'hex'),24)
      IS DISTINCT FROM p_safe_fingerprint
    THEN RAISE EXCEPTION 'ENTERPRISE_PROVIDER_SECRET_CONFLICT'; END IF;
    RETURN jsonb_build_object('outcome','replayed','backendKind','supabase_vault','safeFingerprint',p_safe_fingerprint);
  END IF;

  EXECUTE 'SELECT id FROM vault.decrypted_secrets WHERE name=$1' INTO named_id USING p_secret_ref;
  IF named_id IS NOT NULL THEN
    RAISE EXCEPTION 'ENTERPRISE_PROVIDER_SECRET_CONFLICT';
  END IF;

  INSERT INTO public.enterprise_provider_secret_backend_ownerships(
    key_ref_id,exercise_id,receipt_id,org_id,workspace_id,provider,backend_kind,
    secret_reference_hash,safe_fingerprint,vault_secret_id,state
  ) VALUES(
    p_key_ref,exercise.id,p_receipt,p_org,receipt.workspace_id,p_provider,'supabase_vault',
    reference_hash,p_safe_fingerprint,NULL,'planned'
  );
  EXECUTE 'SELECT vault.create_secret($1,$2,$3)'
    INTO created_id USING p_secret_value,p_secret_ref,'AvalaOS managed provider secret';
  IF created_id IS NULL THEN RAISE EXCEPTION 'ENTERPRISE_PROVIDER_SECRET_BACKEND_UNAVAILABLE'; END IF;
  UPDATE public.enterprise_provider_secret_backend_ownerships SET state='written',vault_secret_id=created_id
  WHERE key_ref_id=p_key_ref AND state='planned';
  RETURN jsonb_build_object('outcome','created','backendKind','supabase_vault','safeFingerprint',p_safe_fingerprint);
END
$$;

CREATE OR REPLACE FUNCTION public.enterprise_provider_secret_resolve(
  p_key_ref uuid,p_org uuid,p_provider text,p_secret_ref text,p_safe_fingerprint text
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ownership public.enterprise_provider_secret_backend_ownerships;
  key_ref public.ai_provider_key_refs;
  marker public.hosted_pilot_environment_identity;
  enterprise public.enterprise_intelligence_runtime_control;
  studio public.studio_artifact_runtime_control;
  value text;
  reference_hash text;
BEGIN
  IF p_key_ref IS NULL OR p_org IS NULL
    OR p_provider NOT IN('openai','azure_openai','anthropic','gemini','groq','openai_compatible')
    OR p_secret_ref IS NULL OR p_safe_fingerprint!~'^sha256:[0-9a-f]{24}$'
  THEN RAISE EXCEPTION 'ENTERPRISE_PROVIDER_SECRET_REFERENCE_INVALID'; END IF;
  reference_hash:=encode(public.digest(convert_to(p_secret_ref,'UTF8'),'sha256'),'hex');
  SELECT * INTO STRICT marker FROM public.hosted_pilot_environment_identity WHERE singleton FOR SHARE;
  SELECT * INTO STRICT enterprise FROM public.enterprise_intelligence_runtime_control WHERE singleton FOR SHARE;
  SELECT * INTO STRICT studio FROM public.studio_artifact_runtime_control WHERE singleton FOR SHARE;
  IF marker.migration_tip<>'20261011053000' OR marker.production_authorized OR marker.customer_data_authorized
    OR marker.real_provider_calls_authorized OR enterprise.provider_enabled OR studio.provider_enabled
    OR NOT EXISTS(SELECT 1 FROM public.authenticated_synthetic_exercises e
      WHERE e.id=(SELECT exercise_id FROM public.enterprise_provider_secret_backend_ownerships WHERE key_ref_id=p_key_ref)
        AND e.lifecycle='active' AND e.expires_at>statement_timestamp())
  THEN RAISE EXCEPTION 'ENTERPRISE_PROVIDER_SECRET_EXERCISE_REQUIRED'; END IF;
  SELECT * INTO ownership FROM public.enterprise_provider_secret_backend_ownerships
  WHERE key_ref_id=p_key_ref AND org_id=p_org AND provider=p_provider
    AND backend_kind='supabase_vault' AND secret_reference_hash=reference_hash
    AND safe_fingerprint=p_safe_fingerprint AND state='written' FOR SHARE;
  SELECT * INTO key_ref FROM public.ai_provider_key_refs
  WHERE id=p_key_ref AND org_id=p_org AND provider=p_provider AND resolver_type='server_reference'
    AND secret_ref=p_secret_ref AND safe_fingerprint=p_safe_fingerprint
    AND secret_backend_kind='supabase_vault' AND status IN('pending_review','active')
    AND deleted_at IS NULL FOR SHARE;
  IF ownership.key_ref_id IS NULL OR key_ref.id IS NULL THEN
    RAISE EXCEPTION 'ENTERPRISE_PROVIDER_SECRET_OWNERSHIP_REQUIRED';
  END IF;
  EXECUTE 'SELECT decrypted_secret FROM vault.decrypted_secrets WHERE id=$1 AND name=$2'
    INTO value USING ownership.vault_secret_id,p_secret_ref;
  IF value IS NULL OR 'sha256:'||left(encode(public.digest(convert_to(value,'UTF8'),'sha256'),'hex'),24)
    IS DISTINCT FROM p_safe_fingerprint
  THEN RAISE EXCEPTION 'ENTERPRISE_PROVIDER_SECRET_CONFLICT'; END IF;
  RETURN value;
END
$$;

CREATE OR REPLACE FUNCTION public.enterprise_provider_secret_resolve_for_receipt(
  p_receipt uuid,p_execution_token uuid,p_execution_fence bigint,p_key_ref uuid,
  p_org uuid,p_provider text,p_secret_ref text,p_safe_fingerprint text
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE receipt public.enterprise_ai_command_receipts;
  ownership public.enterprise_provider_secret_backend_ownerships;
  marker public.hosted_pilot_environment_identity;
  enterprise public.enterprise_intelligence_runtime_control;
  studio public.studio_artifact_runtime_control;
  value text;
  reference_hash text;
BEGIN
  IF p_receipt IS NULL OR p_execution_token IS NULL OR p_execution_fence IS NULL OR p_execution_fence<1
    OR p_key_ref IS NULL OR p_org IS NULL
    OR p_provider NOT IN('openai','azure_openai','anthropic','gemini','groq','openai_compatible')
    OR p_secret_ref IS NULL OR p_safe_fingerprint!~'^sha256:[0-9a-f]{24}$'
  THEN RAISE EXCEPTION 'ENTERPRISE_PROVIDER_SECRET_REFERENCE_INVALID'; END IF;
  reference_hash:=encode(public.digest(convert_to(p_secret_ref,'UTF8'),'sha256'),'hex');
  SELECT * INTO STRICT marker FROM public.hosted_pilot_environment_identity WHERE singleton FOR SHARE;
  SELECT * INTO STRICT enterprise FROM public.enterprise_intelligence_runtime_control WHERE singleton FOR SHARE;
  SELECT * INTO STRICT studio FROM public.studio_artifact_runtime_control WHERE singleton FOR SHARE;
  SELECT * INTO receipt FROM public.enterprise_ai_command_receipts
  WHERE id=p_receipt AND org_id=p_org FOR SHARE;
  SELECT * INTO ownership FROM public.enterprise_provider_secret_backend_ownerships
  WHERE key_ref_id=p_key_ref AND receipt_id=p_receipt AND org_id=p_org AND provider=p_provider
    AND backend_kind='supabase_vault' AND secret_reference_hash=reference_hash
    AND safe_fingerprint=p_safe_fingerprint AND state='written' FOR SHARE;
  IF marker.migration_tip<>'20261011053000' OR marker.production_authorized OR marker.customer_data_authorized
    OR marker.real_provider_calls_authorized OR enterprise.provider_enabled OR studio.provider_enabled
    OR receipt.id IS NULL OR receipt.status<>'claimed'
    OR receipt.execution_token IS DISTINCT FROM p_execution_token
    OR receipt.execution_fence IS DISTINCT FROM p_execution_fence
    OR receipt.lease_expires_at IS NULL OR receipt.lease_expires_at<=statement_timestamp()
    OR receipt.execution_plan->>'secretOwnership' IS DISTINCT FROM 'managed_write'
    OR receipt.execution_plan->>'secretBackendKind' IS DISTINCT FROM 'supabase_vault'
    OR receipt.execution_plan->>'secretPlanReceiptId' IS DISTINCT FROM p_receipt::text
    OR receipt.execution_plan->>'keyRefId' IS DISTINCT FROM p_key_ref::text
    OR receipt.execution_plan->>'provider' IS DISTINCT FROM p_provider
    OR receipt.execution_plan->>'secretReference' IS DISTINCT FROM p_secret_ref
    OR receipt.execution_plan->>'safeFingerprint' IS DISTINCT FROM p_safe_fingerprint
    OR NOT EXISTS(SELECT 1 FROM public.authenticated_synthetic_exercises e
      JOIN public.authenticated_synthetic_actor_sessions binding
        ON binding.exercise_id=e.id AND binding.actor_id=receipt.actor_id AND binding.state='active'
      WHERE e.org_id=receipt.org_id AND e.workspace_id=receipt.workspace_id
        AND e.lifecycle='active' AND e.expires_at>statement_timestamp())
  THEN RAISE EXCEPTION 'ENTERPRISE_PROVIDER_SECRET_STALE_FENCE'; END IF;
  IF ownership.key_ref_id IS NULL THEN
    IF EXISTS(SELECT 1 FROM public.enterprise_provider_secret_backend_ownerships owned
      WHERE owned.key_ref_id=p_key_ref OR owned.secret_reference_hash=reference_hash)
    THEN RAISE EXCEPTION 'ENTERPRISE_PROVIDER_SECRET_CONFLICT'; END IF;
    RETURN NULL;
  END IF;
  EXECUTE 'SELECT decrypted_secret FROM vault.decrypted_secrets WHERE id=$1 AND name=$2'
    INTO value USING ownership.vault_secret_id,p_secret_ref;
  IF value IS NULL OR 'sha256:'||left(encode(public.digest(convert_to(value,'UTF8'),'sha256'),'hex'),24)
    IS DISTINCT FROM p_safe_fingerprint
  THEN RAISE EXCEPTION 'ENTERPRISE_PROVIDER_SECRET_CONFLICT'; END IF;
  RETURN value;
END
$$;

CREATE OR REPLACE FUNCTION public.enterprise_provider_secret_observe(
  p_exercise_id uuid,p_key_ref uuid,p_org uuid,p_provider text,p_safe_fingerprint text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ownership public.enterprise_provider_secret_backend_ownerships;
  marker public.hosted_pilot_environment_identity;
  enterprise public.enterprise_intelligence_runtime_control;
  studio public.studio_artifact_runtime_control;
  value text;
  exists_physical boolean:=false;
  fingerprint_matches boolean:=false;
BEGIN
  SELECT * INTO STRICT marker FROM public.hosted_pilot_environment_identity WHERE singleton FOR SHARE;
  SELECT * INTO STRICT enterprise FROM public.enterprise_intelligence_runtime_control WHERE singleton FOR SHARE;
  SELECT * INTO STRICT studio FROM public.studio_artifact_runtime_control WHERE singleton FOR SHARE;
  IF marker.migration_tip<>'20261011053000' OR marker.production_authorized OR marker.customer_data_authorized
    OR marker.real_provider_calls_authorized OR enterprise.provider_enabled OR studio.provider_enabled
    OR NOT EXISTS(SELECT 1 FROM public.authenticated_synthetic_exercises e
      WHERE e.id=p_exercise_id AND e.org_id=p_org AND e.lifecycle IN('active','quiesced')
        AND statement_timestamp()<=e.expires_at+interval '6 hours')
  THEN RAISE EXCEPTION 'ENTERPRISE_PROVIDER_SECRET_EXERCISE_REQUIRED'; END IF;
  SELECT * INTO ownership FROM public.enterprise_provider_secret_backend_ownerships
  WHERE exercise_id=p_exercise_id AND key_ref_id=p_key_ref AND org_id=p_org
    AND provider=p_provider AND backend_kind='supabase_vault' AND safe_fingerprint=p_safe_fingerprint;
  IF ownership.key_ref_id IS NULL THEN
    RETURN jsonb_build_object('backendKind','supabase_vault','exists',false,'fingerprintMatches',false,'state','unowned');
  END IF;
  IF to_regclass('vault.decrypted_secrets') IS NOT NULL THEN
    EXECUTE 'SELECT decrypted_secret FROM vault.decrypted_secrets WHERE id=$1' INTO value USING ownership.vault_secret_id;
  END IF;
  exists_physical:=value IS NOT NULL;
  fingerprint_matches:=value IS NOT NULL AND
    ('sha256:'||left(encode(public.digest(convert_to(value,'UTF8'),'sha256'),'hex'),24)=p_safe_fingerprint);
  RETURN jsonb_build_object(
    'backendKind','supabase_vault','exists',exists_physical,
    'fingerprintMatches',fingerprint_matches,'state',ownership.state
  );
END
$$;

CREATE OR REPLACE FUNCTION public.enterprise_provider_secret_inventory(p_exercise_id uuid,p_org uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE marker public.hosted_pilot_environment_identity;
  enterprise public.enterprise_intelligence_runtime_control;
  studio public.studio_artifact_runtime_control;
  result jsonb;
BEGIN
  SELECT * INTO STRICT marker FROM public.hosted_pilot_environment_identity WHERE singleton FOR SHARE;
  SELECT * INTO STRICT enterprise FROM public.enterprise_intelligence_runtime_control WHERE singleton FOR SHARE;
  SELECT * INTO STRICT studio FROM public.studio_artifact_runtime_control WHERE singleton FOR SHARE;
  IF p_exercise_id IS NULL OR p_org IS NULL OR marker.migration_tip<>'20261011053000'
    OR marker.production_authorized OR marker.customer_data_authorized OR marker.real_provider_calls_authorized
    OR enterprise.provider_enabled OR studio.provider_enabled
    OR NOT EXISTS(SELECT 1 FROM public.authenticated_synthetic_exercises e
      WHERE e.id=p_exercise_id AND e.org_id=p_org AND e.lifecycle IN('active','quiesced')
        AND statement_timestamp()<=e.expires_at+interval '6 hours')
  THEN RAISE EXCEPTION 'ENTERPRISE_PROVIDER_SECRET_EXERCISE_REQUIRED'; END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'keyRefId',owned.key_ref_id,'provider',owned.provider,'backendKind',owned.backend_kind,
    'safeFingerprint',owned.safe_fingerprint,'state',owned.state
  ) ORDER BY owned.key_ref_id),'[]'::jsonb) INTO result
  FROM public.enterprise_provider_secret_backend_ownerships owned
  WHERE owned.exercise_id=p_exercise_id AND owned.org_id=p_org AND owned.backend_kind='supabase_vault';
  RETURN result;
END
$$;

REVOKE ALL ON FUNCTION
  public.enterprise_provider_secret_write(uuid,uuid,bigint,uuid,uuid,text,text,text,text),
  public.enterprise_provider_secret_resolve(uuid,uuid,text,text,text),
  public.enterprise_provider_secret_resolve_for_receipt(uuid,uuid,bigint,uuid,uuid,text,text,text),
  public.enterprise_provider_secret_observe(uuid,uuid,uuid,text,text),
  public.enterprise_provider_secret_inventory(uuid,uuid)
FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION
  public.enterprise_provider_secret_write(uuid,uuid,bigint,uuid,uuid,text,text,text,text),
  public.enterprise_provider_secret_resolve(uuid,uuid,text,text,text),
  public.enterprise_provider_secret_resolve_for_receipt(uuid,uuid,bigint,uuid,uuid,text,text,text),
  public.enterprise_provider_secret_observe(uuid,uuid,uuid,text,text),
  public.enterprise_provider_secret_inventory(uuid,uuid)
TO service_role;

CREATE OR REPLACE FUNCTION public.enterprise_provider_secret_delete_for_receipt(
  p_receipt uuid,p_execution_token uuid,p_execution_fence bigint,p_key_ref uuid,
  p_org uuid,p_provider text,p_secret_ref text,p_safe_fingerprint text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE receipt public.enterprise_ai_command_receipts;
  ownership public.enterprise_provider_secret_backend_ownerships;
  marker public.hosted_pilot_environment_identity;
  enterprise public.enterprise_intelligence_runtime_control;
  studio public.studio_artifact_runtime_control;
  value text;
  deleted_count integer:=0;
  reference_hash text;
BEGIN
  reference_hash:=encode(public.digest(convert_to(COALESCE(p_secret_ref,''),'UTF8'),'sha256'),'hex');
  SELECT * INTO STRICT marker FROM public.hosted_pilot_environment_identity WHERE singleton FOR SHARE;
  SELECT * INTO STRICT enterprise FROM public.enterprise_intelligence_runtime_control WHERE singleton FOR SHARE;
  SELECT * INTO STRICT studio FROM public.studio_artifact_runtime_control WHERE singleton FOR SHARE;
  SELECT * INTO receipt FROM public.enterprise_ai_command_receipts
  WHERE id=p_receipt AND org_id=p_org FOR UPDATE;
  SELECT * INTO ownership FROM public.enterprise_provider_secret_backend_ownerships
  WHERE key_ref_id=p_key_ref AND org_id=p_org AND provider=p_provider
    AND backend_kind='supabase_vault' AND secret_reference_hash=reference_hash
    AND safe_fingerprint=p_safe_fingerprint FOR UPDATE;
  IF receipt.id IS NULL OR receipt.runtime_area<>'provider'
    OR receipt.command_type NOT IN('provider.secret.bind','provider.secret.rotate')
    OR receipt.status<>'claimed' OR receipt.execution_token IS DISTINCT FROM p_execution_token
    OR receipt.execution_fence IS DISTINCT FROM p_execution_fence
    OR receipt.lease_expires_at IS NULL OR receipt.lease_expires_at<=statement_timestamp()
    OR(ownership.key_ref_id IS NOT NULL AND ownership.receipt_id IS DISTINCT FROM p_receipt)
    OR receipt.execution_plan->>'secretOwnership' IS DISTINCT FROM 'managed_write'
    OR receipt.execution_plan->>'secretBackendKind' IS DISTINCT FROM 'supabase_vault'
    OR receipt.execution_plan->>'secretPlanReceiptId' IS DISTINCT FROM p_receipt::text
    OR receipt.execution_plan->>'keyRefId' IS DISTINCT FROM p_key_ref::text
    OR receipt.execution_plan->>'provider' IS DISTINCT FROM p_provider
    OR receipt.execution_plan->>'secretReference' IS DISTINCT FROM p_secret_ref
    OR receipt.execution_plan->>'safeFingerprint' IS DISTINCT FROM p_safe_fingerprint
    OR receipt.execution_plan->>'cleanupRequired' IS DISTINCT FROM 'true'
    OR EXISTS(SELECT 1 FROM public.ai_provider_key_refs active_ref
      WHERE active_ref.id=p_key_ref AND active_ref.org_id=p_org AND active_ref.provider=p_provider
        AND active_ref.status IN('pending_review','active') AND active_ref.deleted_at IS NULL)
    OR NOT EXISTS(SELECT 1 FROM public.authenticated_synthetic_exercises e
      JOIN public.authenticated_synthetic_actor_sessions binding
        ON binding.exercise_id=e.id AND binding.actor_id=receipt.actor_id AND binding.state='active'
      WHERE e.org_id=receipt.org_id AND e.workspace_id=receipt.workspace_id
        AND e.lifecycle='active' AND e.expires_at>statement_timestamp())
    OR marker.migration_tip<>'20261011053000' OR marker.production_authorized
    OR marker.customer_data_authorized OR marker.real_provider_calls_authorized
    OR enterprise.provider_enabled OR studio.provider_enabled
  THEN RAISE EXCEPTION 'ENTERPRISE_PROVIDER_SECRET_STALE_FENCE'; END IF;
  IF ownership.key_ref_id IS NULL THEN
    IF EXISTS(SELECT 1 FROM public.enterprise_provider_secret_backend_ownerships owned
      WHERE owned.key_ref_id=p_key_ref OR owned.secret_reference_hash=reference_hash)
    THEN RAISE EXCEPTION 'ENTERPRISE_PROVIDER_SECRET_CONFLICT'; END IF;
    RETURN jsonb_build_object('outcome','absent','backendKind','supabase_vault','safeFingerprint',p_safe_fingerprint);
  END IF;
  IF to_regclass('vault.secrets') IS NULL OR to_regclass('vault.decrypted_secrets') IS NULL THEN
    RAISE EXCEPTION 'ENTERPRISE_PROVIDER_SECRET_BACKEND_UNAVAILABLE';
  END IF;
  EXECUTE 'SELECT decrypted_secret FROM vault.decrypted_secrets WHERE id=$1 AND name=$2'
    INTO value USING ownership.vault_secret_id,p_secret_ref;
  IF value IS NOT NULL AND
    'sha256:'||left(encode(public.digest(convert_to(value,'UTF8'),'sha256'),'hex'),24) IS DISTINCT FROM p_safe_fingerprint
  THEN RAISE EXCEPTION 'ENTERPRISE_PROVIDER_SECRET_CONFLICT'; END IF;
  IF ownership.state='deleted' THEN
    IF value IS NOT NULL THEN RAISE EXCEPTION 'ENTERPRISE_PROVIDER_SECRET_CONFLICT'; END IF;
    RETURN jsonb_build_object('outcome','absent','backendKind','supabase_vault','safeFingerprint',p_safe_fingerprint);
  END IF;
  IF ownership.state<>'written' THEN RAISE EXCEPTION 'ENTERPRISE_PROVIDER_SECRET_CONFLICT'; END IF;
  IF value IS NOT NULL THEN
    EXECUTE 'DELETE FROM vault.secrets WHERE id=$1 AND name=$2' USING ownership.vault_secret_id,p_secret_ref;
    GET DIAGNOSTICS deleted_count=ROW_COUNT;
    IF deleted_count<>1 THEN RAISE EXCEPTION 'ENTERPRISE_PROVIDER_SECRET_CONFLICT'; END IF;
  END IF;
  UPDATE public.enterprise_provider_secret_backend_ownerships
  SET state='deleted',deleted_at=statement_timestamp()
  WHERE key_ref_id=p_key_ref AND state='written';
  RETURN jsonb_build_object(
    'outcome',CASE WHEN value IS NULL THEN 'absent' ELSE 'deleted' END,
    'backendKind','supabase_vault','safeFingerprint',p_safe_fingerprint
  );
END
$$;

CREATE OR REPLACE FUNCTION public.enterprise_provider_secret_delete_for_cleanup(
  p_job uuid,p_execution_token uuid,p_execution_fence bigint,p_key_ref uuid,
  p_org uuid,p_provider text,p_secret_ref text,p_safe_fingerprint text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE job public.enterprise_provider_secret_cleanup_jobs;
  ownership public.enterprise_provider_secret_backend_ownerships;
  key_ref public.ai_provider_key_refs;
  marker public.hosted_pilot_environment_identity;
  enterprise public.enterprise_intelligence_runtime_control;
  studio public.studio_artifact_runtime_control;
  value text;
  deleted_count integer:=0;
  reference_hash text;
BEGIN
  reference_hash:=encode(public.digest(convert_to(COALESCE(p_secret_ref,''),'UTF8'),'sha256'),'hex');
  SELECT * INTO STRICT marker FROM public.hosted_pilot_environment_identity WHERE singleton FOR SHARE;
  SELECT * INTO STRICT enterprise FROM public.enterprise_intelligence_runtime_control WHERE singleton FOR SHARE;
  SELECT * INTO STRICT studio FROM public.studio_artifact_runtime_control WHERE singleton FOR SHARE;
  SELECT * INTO job FROM public.enterprise_provider_secret_cleanup_jobs
  WHERE id=p_job AND key_ref_id=p_key_ref AND org_id=p_org AND provider=p_provider FOR UPDATE;
  SELECT * INTO ownership FROM public.enterprise_provider_secret_backend_ownerships
  WHERE key_ref_id=p_key_ref AND org_id=p_org AND provider=p_provider
    AND backend_kind='supabase_vault' AND secret_reference_hash=reference_hash
    AND safe_fingerprint=p_safe_fingerprint FOR UPDATE;
  SELECT * INTO key_ref FROM public.ai_provider_key_refs
  WHERE id=p_key_ref AND org_id=p_org AND provider=p_provider FOR SHARE;
  IF job.id IS NULL OR ownership.key_ref_id IS NULL OR job.state<>'claimed'
    OR job.execution_token IS DISTINCT FROM p_execution_token
    OR job.execution_fence IS DISTINCT FROM p_execution_fence
    OR job.lease_expires_at IS NULL OR job.lease_expires_at<=statement_timestamp()
    OR job.secret_backend_kind IS DISTINCT FROM 'supabase_vault'
    OR job.safe_fingerprint IS DISTINCT FROM p_safe_fingerprint
    OR key_ref.id IS NULL OR key_ref.resolver_type<>'server_reference'
    OR key_ref.secret_ref IS DISTINCT FROM p_secret_ref
    OR key_ref.safe_fingerprint IS DISTINCT FROM p_safe_fingerprint
    OR key_ref.secret_backend_kind IS DISTINCT FROM 'supabase_vault'
    OR(key_ref.deleted_at IS NULL AND key_ref.status NOT IN('retired','revoked'))
    OR NOT EXISTS(SELECT 1 FROM public.authenticated_synthetic_exercises e
      WHERE e.id=ownership.exercise_id AND e.lifecycle IN('active','quiesced')
        AND statement_timestamp()<=e.expires_at+interval '6 hours')
    OR marker.migration_tip<>'20261011053000' OR marker.production_authorized
    OR marker.customer_data_authorized OR marker.real_provider_calls_authorized
    OR enterprise.provider_enabled OR studio.provider_enabled
  THEN RAISE EXCEPTION 'ENTERPRISE_PROVIDER_SECRET_STALE_FENCE'; END IF;
  IF to_regclass('vault.secrets') IS NULL OR to_regclass('vault.decrypted_secrets') IS NULL THEN
    RAISE EXCEPTION 'ENTERPRISE_PROVIDER_SECRET_BACKEND_UNAVAILABLE';
  END IF;
  EXECUTE 'SELECT decrypted_secret FROM vault.decrypted_secrets WHERE id=$1 AND name=$2'
    INTO value USING ownership.vault_secret_id,p_secret_ref;
  IF value IS NOT NULL AND
    'sha256:'||left(encode(public.digest(convert_to(value,'UTF8'),'sha256'),'hex'),24) IS DISTINCT FROM p_safe_fingerprint
  THEN RAISE EXCEPTION 'ENTERPRISE_PROVIDER_SECRET_CONFLICT'; END IF;
  IF ownership.state='deleted' THEN
    IF value IS NOT NULL THEN RAISE EXCEPTION 'ENTERPRISE_PROVIDER_SECRET_CONFLICT'; END IF;
    RETURN jsonb_build_object('outcome','absent','backendKind','supabase_vault','safeFingerprint',p_safe_fingerprint);
  END IF;
  IF ownership.state<>'written' THEN RAISE EXCEPTION 'ENTERPRISE_PROVIDER_SECRET_CONFLICT'; END IF;
  IF value IS NOT NULL THEN
    EXECUTE 'DELETE FROM vault.secrets WHERE id=$1 AND name=$2' USING ownership.vault_secret_id,p_secret_ref;
    GET DIAGNOSTICS deleted_count=ROW_COUNT;
    IF deleted_count<>1 THEN RAISE EXCEPTION 'ENTERPRISE_PROVIDER_SECRET_CONFLICT'; END IF;
  END IF;
  UPDATE public.enterprise_provider_secret_backend_ownerships
  SET state='deleted',deleted_at=statement_timestamp()
  WHERE key_ref_id=p_key_ref AND state='written';
  RETURN jsonb_build_object(
    'outcome',CASE WHEN value IS NULL THEN 'absent' ELSE 'deleted' END,
    'backendKind','supabase_vault','safeFingerprint',p_safe_fingerprint
  );
END
$$;

DROP FUNCTION public.enterprise_ai_complete_provider_secret_cleanup_job(uuid,uuid);
DROP FUNCTION public.enterprise_ai_fail_provider_secret_cleanup_job(uuid,uuid,text);

CREATE OR REPLACE FUNCTION public.enterprise_ai_claim_provider_secret_cleanup_job(p_execution_token uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE job public.enterprise_provider_secret_cleanup_jobs;
BEGIN
  IF p_execution_token IS NULL THEN RAISE EXCEPTION 'ENTERPRISE_PROVIDER_CLEANUP_NOT_ALLOWED'; END IF;
  SELECT * INTO job FROM public.enterprise_provider_secret_cleanup_jobs
  WHERE attempt_count<20 AND(
    (state='pending' AND next_attempt_at<=statement_timestamp())
    OR(state='claimed' AND lease_expires_at<=statement_timestamp())
  ) ORDER BY next_attempt_at,id FOR UPDATE SKIP LOCKED LIMIT 1;
  IF job.id IS NULL THEN RETURN jsonb_build_object('state','empty'); END IF;
  UPDATE public.enterprise_provider_secret_cleanup_jobs
  SET state='claimed',execution_token=p_execution_token,
    execution_fence=execution_fence+1,
    lease_expires_at=statement_timestamp()+interval '45 seconds',
    attempt_count=attempt_count+1,updated_at=statement_timestamp()
  WHERE id=job.id RETURNING * INTO job;
  RETURN jsonb_build_object(
    'state','claimed','jobId',job.id,'keyRefId',job.key_ref_id,
    'organizationId',job.org_id,'provider',job.provider,'attemptCount',job.attempt_count,
    'backendKind',job.secret_backend_kind,'safeFingerprint',job.safe_fingerprint,
    'executionFence',job.execution_fence
  );
END
$$;

CREATE FUNCTION public.enterprise_ai_complete_provider_secret_cleanup_job(
  p_job uuid,p_execution_token uuid,p_execution_fence bigint
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE job public.enterprise_provider_secret_cleanup_jobs;
BEGIN
  UPDATE public.enterprise_provider_secret_cleanup_jobs
  SET state='completed',execution_token=NULL,lease_expires_at=NULL,last_failure_class=NULL,
    completed_at=statement_timestamp(),updated_at=statement_timestamp()
  WHERE id=p_job AND state='claimed' AND execution_token=p_execution_token
    AND execution_fence=p_execution_fence AND lease_expires_at>statement_timestamp()
  RETURNING * INTO job;
  IF job.id IS NULL THEN RAISE EXCEPTION 'ENTERPRISE_PROVIDER_CLEANUP_NOT_ALLOWED'; END IF;
  RETURN jsonb_build_object('state','completed','jobId',job.id,'attemptCount',job.attempt_count,'executionFence',job.execution_fence);
END
$$;

CREATE FUNCTION public.enterprise_ai_fail_provider_secret_cleanup_job(
  p_job uuid,p_execution_token uuid,p_execution_fence bigint,p_failure_class text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE job public.enterprise_provider_secret_cleanup_jobs;
BEGIN
  IF p_failure_class!~'^[a-z0-9_]{1,80}$' THEN RAISE EXCEPTION 'ENTERPRISE_PROVIDER_CLEANUP_NOT_ALLOWED'; END IF;
  UPDATE public.enterprise_provider_secret_cleanup_jobs
  SET state='pending',execution_token=NULL,lease_expires_at=NULL,last_failure_class=p_failure_class,
    next_attempt_at=statement_timestamp()+make_interval(secs=>LEAST(3600,5*(2^LEAST(attempt_count,9))::integer)),
    updated_at=statement_timestamp()
  WHERE id=p_job AND state='claimed' AND execution_token=p_execution_token
    AND execution_fence=p_execution_fence AND lease_expires_at>statement_timestamp()
  RETURNING * INTO job;
  IF job.id IS NULL THEN RAISE EXCEPTION 'ENTERPRISE_PROVIDER_CLEANUP_NOT_ALLOWED'; END IF;
  RETURN jsonb_build_object('state','pending','jobId',job.id,'attemptCount',job.attempt_count,'executionFence',job.execution_fence);
END
$$;

REVOKE ALL ON FUNCTION
  public.enterprise_provider_secret_delete_for_receipt(uuid,uuid,bigint,uuid,uuid,text,text,text),
  public.enterprise_provider_secret_delete_for_cleanup(uuid,uuid,bigint,uuid,uuid,text,text,text),
  public.enterprise_ai_claim_provider_secret_cleanup_job(uuid),
  public.enterprise_ai_complete_provider_secret_cleanup_job(uuid,uuid,bigint),
  public.enterprise_ai_fail_provider_secret_cleanup_job(uuid,uuid,bigint,text)
FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION
  public.enterprise_provider_secret_delete_for_receipt(uuid,uuid,bigint,uuid,uuid,text,text,text),
  public.enterprise_provider_secret_delete_for_cleanup(uuid,uuid,bigint,uuid,uuid,text,text,text),
  public.enterprise_ai_claim_provider_secret_cleanup_job(uuid),
  public.enterprise_ai_complete_provider_secret_cleanup_job(uuid,uuid,bigint),
  public.enterprise_ai_fail_provider_secret_cleanup_job(uuid,uuid,bigint,text)
TO service_role;

DO $supabase_provider_secret_marker$
DECLARE final_activation_definition text;
  bootstrap_definition text;
  assert_marker_definition text;
  brd_v3_activation_definition text;
  authenticated_activation_definition text;
  old_not_equal text:='marker.migration_tip<>''20261010144356''';
  new_not_equal text:='marker.migration_tip<>''20261011053000''';
  old_equal text:='marker.migration_tip=''20261010144356''';
  new_equal text:='marker.migration_tip=''20261011053000''';
  old_assert text:='marker.migration_tip = ''20261010144356''';
  new_assert text:='marker.migration_tip = ''20261011053000''';
BEGIN
  SELECT replace(pg_get_functiondef('public.synthetic_ai_campaign_activate_final_continuation(uuid,uuid,uuid,bigint,text,text,uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,integer)'::regprocedure),chr(13)||chr(10),chr(10))
    INTO STRICT final_activation_definition;
  SELECT replace(pg_get_functiondef('public.synthetic_ai_campaign_bootstrap(uuid,uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,uuid,timestamptz)'::regprocedure),chr(13)||chr(10),chr(10))
    INTO STRICT bootstrap_definition;
  SELECT replace(pg_get_functiondef('public.pr_c_controlled_human_assert_marker()'::regprocedure),chr(13)||chr(10),chr(10))
    INTO STRICT assert_marker_definition;
  SELECT replace(pg_get_functiondef('public.synthetic_ai_campaign_activate_brd_v3_quality_validation(uuid,uuid,uuid,bigint,text,text,uuid,uuid,uuid,uuid,uuid,uuid,uuid,bigint,uuid,text,uuid,uuid,uuid,uuid,text,text,integer)'::regprocedure),chr(13)||chr(10),chr(10))
    INTO STRICT brd_v3_activation_definition;
  SELECT replace(pg_get_functiondef('public.authenticated_synthetic_exercise_activate(uuid,text,text,text,text,text,text,text,text,text,text,uuid,uuid,timestamptz)'::regprocedure),chr(13)||chr(10),chr(10))
    INTO STRICT authenticated_activation_definition;
  IF position(old_not_equal in final_activation_definition)=0
    OR position(old_equal in bootstrap_definition)=0
    OR position(old_assert in assert_marker_definition)=0
    OR position(old_not_equal in brd_v3_activation_definition)=0
    OR position('20261010144356' in authenticated_activation_definition)=0
    OR position('hosted-authenticated-synthetic-profile-v2' in authenticated_activation_definition)=0
  THEN RAISE EXCEPTION 'SUPABASE_PROVIDER_SECRET_MARKER_SOURCE_MISMATCH'; END IF;
  EXECUTE replace(final_activation_definition,old_not_equal,new_not_equal);
  EXECUTE replace(bootstrap_definition,old_equal,new_equal);
  EXECUTE replace(assert_marker_definition,old_assert,new_assert);
  EXECUTE replace(brd_v3_activation_definition,old_not_equal,new_not_equal);
  authenticated_activation_definition:=replace(authenticated_activation_definition,'20261010144356','20261011053000');
  EXECUTE replace(authenticated_activation_definition,
    'hosted-authenticated-synthetic-profile-v2','hosted-authenticated-synthetic-profile-v3');

  ALTER TABLE public.pr_c_controlled_human_exercises
    DROP CONSTRAINT pr_c_controlled_human_exercises_migration_tip_check;
  ALTER TABLE public.pr_c_controlled_human_exercises
    ADD CONSTRAINT pr_c_controlled_human_exercises_migration_tip_check
    CHECK(migration_tip IN(
      '20260904120000','20260924113000','20260926053818','20260928060000',
      '20261003015246','20261003055918','20261003123459','20261003150800',
      '20261004025101','20261004112232','20261008022445','20261009162752',
      '20261010025331','20261010051100','20261010051413','20261010144356','20261011053000'
    ));
  ALTER TABLE public.authenticated_synthetic_exercises
    DROP CONSTRAINT authenticated_synthetic_exercises_migration_tip_check;
  ALTER TABLE public.authenticated_synthetic_exercises
    ADD CONSTRAINT authenticated_synthetic_exercises_migration_tip_check
    CHECK(migration_tip IN('20261010144356','20261011053000'));
  ALTER TABLE public.authenticated_synthetic_exercises
    DROP CONSTRAINT authenticated_synthetic_exercises_profile_version_check;
  ALTER TABLE public.authenticated_synthetic_exercises
    ADD CONSTRAINT authenticated_synthetic_exercises_profile_version_check
    CHECK(profile_version IN('hosted-authenticated-synthetic-profile-v2','hosted-authenticated-synthetic-profile-v3'));
  ALTER TABLE public.hosted_pilot_environment_identity
    DROP CONSTRAINT hosted_pilot_environment_identity_migration_tip_check;
  UPDATE public.hosted_pilot_environment_identity
  SET migration_tip='20261011053000'
  WHERE singleton;
  ALTER TABLE public.hosted_pilot_environment_identity
    ADD CONSTRAINT hosted_pilot_environment_identity_migration_tip_check
    CHECK(migration_tip='20261011053000');
END
$supabase_provider_secret_marker$;

COMMENT ON FUNCTION public.enterprise_provider_secret_backend_capability() IS
  'Value-free native backend capability. Service role remains broadly privileged by platform configuration; wrapper scope does not narrow the credential itself.';
COMMENT ON FUNCTION public.enterprise_provider_secret_observe(uuid,uuid,uuid,text,text) IS
  'Value-free exact exercise/key ownership and physical-presence observation for independent cleanup verification.';
COMMENT ON FUNCTION public.enterprise_provider_secret_inventory(uuid,uuid) IS
  'Value-free exact exercise ownership inventory for recovery and cleanup; never returns secret references, values, or physical Vault identifiers.';
