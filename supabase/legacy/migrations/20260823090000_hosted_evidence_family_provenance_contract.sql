-- Hosted activation family provenance contract.
-- Additive and fail closed: existing hash-only rows are retained as historical data
-- but can no longer satisfy hosted status or final verification.

CREATE FUNCTION public.hosted_pilot_evidence_family_contract(p_family text)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE test_ids jsonb; assertion_ids jsonb; assertions jsonb; canonical_contract text; scenario_source_sha text;
BEGIN
  SELECT 'sha256:'||content_sha256 INTO scenario_source_sha
    FROM avalaos_migrations.applied
    WHERE filename='20260823090000_hosted_evidence_family_provenance_contract.sql';
  IF scenario_source_sha IS NULL OR scenario_source_sha !~ '^sha256:[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'HOSTED_EVIDENCE_EXECUTABLE_SOURCE_LEDGER_MISSING';
  END IF;
  CASE p_family
    WHEN 'tenant-adversarial' THEN
      test_ids='["SAFETY-005"]'::jsonb;
      assertion_ids='["hosted-database--synthetic-subject-role-matrix","hosted-database--cross-tenant-nondisclosure","hosted-database--revocation-version-bound","hosted-database--response-loss-exact-replay"]'::jsonb;
    WHEN 'provider-simulation-zero-egress' THEN
      test_ids='["AI-006"]'::jsonb;
      assertion_ids='["hosted-provider--five-scenarios-executed","hosted-provider--zero-egress-recorded","hosted-provider--real-provider-calls-not-authorized"]'::jsonb;
    WHEN 'canonical-journey' THEN
      test_ids='["E2E-001"]'::jsonb;
      assertion_ids='["hosted-journey--exact-release-ingestion","hosted-journey--recovery-evidence-bound","hosted-journey--rollback-event-bound"]'::jsonb;
    WHEN 'backup-restore' THEN
      test_ids='["ADMIN-004"]'::jsonb;
      assertion_ids='["hosted-backup--exact-release-recovery-ingestion","hosted-backup--canonical-migration-ledger","hosted-backup--target-fingerprint-bound"]'::jsonb;
    WHEN 'recovery-rollback' THEN
      test_ids='["SAFETY-005"]'::jsonb;
      assertion_ids='["hosted-recovery--current-operator-authority","hosted-recovery--exact-release-rollback-event","hosted-recovery--recovery-evidence-bound"]'::jsonb;
    ELSE RAISE EXCEPTION 'HOSTED_EVIDENCE_FAMILY_CONTRACT_UNKNOWN';
  END CASE;
  SELECT jsonb_agg(jsonb_build_object(
      'assertionId',assertion_id,
      'sourcePath','supabase/migrations/20260823090000_hosted_evidence_family_provenance_contract.sql',
      'sourceSha256',scenario_source_sha
    ) ORDER BY ordinal)
    INTO assertions
    FROM jsonb_array_elements_text(assertion_ids) WITH ORDINALITY assertion(assertion_id,ordinal);
  SELECT p_family||'|'||(SELECT string_agg(item,',' ORDER BY ordinal) FROM jsonb_array_elements_text(test_ids) WITH ORDINALITY AS test(item,ordinal))
    ||'|'||(SELECT string_agg(((item::jsonb)->>'assertionId')||'@'||((item::jsonb)->>'sourcePath')||'@'||((item::jsonb)->>'sourceSha256'),',' ORDER BY ordinal) FROM jsonb_array_elements(assertions) WITH ORDINALITY AS assertion(item,ordinal))
    INTO canonical_contract;
  RETURN jsonb_build_object('family',p_family,'testIds',test_ids,'assertions',assertions,
    'contractSha256','sha256:'||encode(public.digest(convert_to(canonical_contract,'UTF8'),'sha256'),'hex'));
END$$;
REVOKE ALL ON FUNCTION public.hosted_pilot_evidence_family_contract(text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.hosted_pilot_evidence_family_provenance_valid(
  p_family text,p_environment text,p_test_ids jsonb,p_contract_sha256 text,
  p_assertion_outcomes jsonb,p_source_artifacts jsonb
) RETURNS boolean LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE contract jsonb;
BEGIN
  IF p_environment IS DISTINCT FROM 'hosted_nonproduction_pilot' THEN RAISE EXCEPTION 'HOSTED_FAMILY_PROVENANCE_ENVIRONMENT_INVALID'; END IF;
  IF jsonb_typeof(p_test_ids) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'HOSTED_FAMILY_PROVENANCE_TEST_IDS_SHAPE_INVALID'; END IF;
  IF jsonb_typeof(p_assertion_outcomes) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'HOSTED_FAMILY_PROVENANCE_ASSERTIONS_SHAPE_INVALID'; END IF;
  IF jsonb_typeof(p_source_artifacts) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'HOSTED_FAMILY_PROVENANCE_SOURCES_SHAPE_INVALID'; END IF;
  BEGIN contract:=public.hosted_pilot_evidence_family_contract(p_family); EXCEPTION WHEN others THEN RETURN false; END;
  IF p_test_ids<>contract->'testIds' OR p_contract_sha256 IS DISTINCT FROM contract->>'contractSha256' THEN RAISE EXCEPTION 'HOSTED_FAMILY_PROVENANCE_CONTRACT_MISMATCH'; END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(p_source_artifacts))<>(SELECT count(DISTINCT item->>'sourcePath') FROM jsonb_array_elements(contract->'assertions') AS owned(item)) THEN RAISE EXCEPTION 'HOSTED_FAMILY_PROVENANCE_SOURCE_COUNT_MISMATCH'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_source_artifacts) AS source(item)
      WHERE jsonb_typeof(item)<>'object' OR item->>'path' IS NULL OR item->>'sha256' !~ '^sha256:[0-9a-f]{64}$'
        OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(contract->'assertions') AS owned(owned_item)
          WHERE owned_item->>'sourcePath'=item->>'path' AND owned_item->>'sourceSha256'=item->>'sha256')) THEN RAISE EXCEPTION 'HOSTED_FAMILY_PROVENANCE_SOURCE_INVALID'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(contract->'assertions') AS owned(item)
      WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_source_artifacts) AS source(source_item) WHERE source_item->>'path'=item->>'sourcePath')) THEN RAISE EXCEPTION 'HOSTED_FAMILY_PROVENANCE_SOURCE_MISSING'; END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(p_assertion_outcomes))<>(SELECT count(*) FROM jsonb_array_elements(contract->'assertions'))
    OR (SELECT count(DISTINCT value->>'assertionId') FROM jsonb_array_elements(p_assertion_outcomes))<>(SELECT count(*) FROM jsonb_array_elements(contract->'assertions')) THEN RAISE EXCEPTION 'HOSTED_FAMILY_PROVENANCE_ASSERTION_COUNT_MISMATCH'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(contract->'assertions') AS owned(item)
      WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_assertion_outcomes) AS outcome(outcome_item)
        JOIN jsonb_array_elements(p_source_artifacts) AS source(source_item) ON source_item->>'path'=item->>'sourcePath'
        WHERE outcome_item->>'assertionId'=item->>'assertionId' AND outcome_item->>'status'='PASS'
          AND outcome_item->>'observationSha256' ~ '^sha256:[0-9a-f]{64}$'
          AND outcome_item->>'sourceArtifactSha256'=source_item->>'sha256')) THEN RAISE EXCEPTION 'HOSTED_FAMILY_PROVENANCE_ASSERTION_BINDING_MISMATCH'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_assertion_outcomes) AS outcome(item)
      WHERE jsonb_typeof(item)<>'object' OR item->>'status'<>'PASS'
        OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(contract->'assertions') AS owned(owned_item) WHERE owned_item->>'assertionId'=item->>'assertionId')) THEN RAISE EXCEPTION 'HOSTED_FAMILY_PROVENANCE_ASSERTION_INVALID'; END IF;
  RETURN true;
END$$;
REVOKE ALL ON FUNCTION public.hosted_pilot_evidence_family_provenance_valid(text,text,jsonb,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;

ALTER TABLE public.hosted_pilot_exercise_evidence_families
  ADD COLUMN provenance_schema_version text,
  ADD COLUMN environment text,
  ADD COLUMN test_ids jsonb,
  ADD COLUMN contract_sha256 text,
  ADD COLUMN assertion_outcomes jsonb,
  ADD COLUMN source_artifacts jsonb,
  ADD COLUMN observation_schema_version text,
  ADD COLUMN observation_binding jsonb,
  ADD COLUMN observation_set_sha256 text;

-- Permanently retire the hash-only path. It remains present solely so stale
-- callers fail with an explicit code instead of silently writing legacy proof.
CREATE OR REPLACE FUNCTION public.hosted_pilot_ingest_exercise_evidence_family(
  p_org uuid,p_workspace uuid,p_exercise_run uuid,p_release_sha text,
  p_producer_workflow_path text,p_producer_run_id text,p_producer_run_attempt bigint,
  p_target_fingerprint text,p_deployment_fingerprint text,p_hosted_target text,
  p_evidence_family text,p_evidence_sha256 text,p_disposition text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'HOSTED_EVIDENCE_LEGACY_INGEST_DISABLED'; END$$;
REVOKE ALL ON FUNCTION public.hosted_pilot_ingest_exercise_evidence_family(uuid,uuid,uuid,text,text,text,bigint,text,text,text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.hosted_pilot_ingest_exercise_evidence_family_v2(
  p_org uuid,p_workspace uuid,p_exercise_run uuid,p_release_sha text,
  p_producer_workflow_path text,p_producer_run_id text,p_producer_run_attempt bigint,
  p_target_fingerprint text,p_deployment_fingerprint text,p_hosted_target text,
  p_evidence_family text,p_environment text,p_test_ids jsonb,p_contract_sha256 text,
  p_assertion_outcomes jsonb,p_source_artifacts jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'HOSTED_EVIDENCE_CALLER_ASSERTIONS_DISABLED';
END$$;
REVOKE ALL ON FUNCTION public.hosted_pilot_ingest_exercise_evidence_family_v2(uuid,uuid,uuid,text,text,text,bigint,text,text,text,text,text,jsonb,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE public.hosted_pilot_evidence_observations (
  org_id uuid NOT NULL,workspace_id uuid NOT NULL,exercise_run_id uuid NOT NULL,
  release_sha text NOT NULL CHECK(release_sha ~ '^[0-9a-f]{40}$'),
  producer_workflow_path text NOT NULL CHECK(producer_workflow_path='.github/workflows/hosted-pilot-activation-evidence-producer.yml'),
  producer_run_id text NOT NULL CHECK(producer_run_id ~ '^[1-9][0-9]{0,19}$'),producer_run_attempt bigint NOT NULL CHECK(producer_run_attempt>0),
  target_fingerprint text NOT NULL CHECK(target_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  deployment_fingerprint text NOT NULL CHECK(deployment_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  evidence_family text NOT NULL,assertion_id text NOT NULL,source_path text NOT NULL,
  source_sha256 text NOT NULL CHECK(source_sha256 ~ '^[0-9a-f]{64}$'),
  observation_schema_version text NOT NULL CHECK(observation_schema_version='hosted-family-derived-observation-v1'),
  observation_payload jsonb NOT NULL CHECK(jsonb_typeof(observation_payload)='object'),
  observation_sha256 text NOT NULL CHECK(observation_sha256 ~ '^[0-9a-f]{64}$'),recorded_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY(org_id,workspace_id,exercise_run_id,evidence_family,assertion_id),
  FOREIGN KEY(workspace_id,org_id) REFERENCES public.workspaces(id,org_id) ON DELETE RESTRICT
);
ALTER TABLE public.hosted_pilot_evidence_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_pilot_evidence_observations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.hosted_pilot_evidence_observations FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER hosted_pilot_evidence_observations_immutable BEFORE UPDATE OR DELETE ON public.hosted_pilot_evidence_observations
  FOR EACH ROW EXECUTE FUNCTION public.hosted_pilot_exercise_evidence_immutable();

-- This is the DB-owned execution record beneath the family observation.  A
-- family wrapper cannot become proof unless an immutable scenario row exists
-- for every exact selector of the current OIDC invocation.
CREATE TABLE public.hosted_pilot_evidence_scenario_observations (
  org_id uuid NOT NULL,workspace_id uuid NOT NULL,exercise_run_id uuid NOT NULL,
  release_sha text NOT NULL CHECK(release_sha ~ '^[0-9a-f]{40}$'),
  producer_workflow_path text NOT NULL CHECK(producer_workflow_path='.github/workflows/hosted-pilot-activation-evidence-producer.yml'),
  producer_run_id text NOT NULL CHECK(producer_run_id ~ '^[1-9][0-9]{0,19}$'),producer_run_attempt bigint NOT NULL CHECK(producer_run_attempt>0),
  target_fingerprint text NOT NULL CHECK(target_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  deployment_fingerprint text NOT NULL CHECK(deployment_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  evidence_family text NOT NULL,assertion_id text NOT NULL,source_path text NOT NULL,
  source_sha256 text NOT NULL CHECK(source_sha256 ~ '^[0-9a-f]{64}$'),
  scenario_schema_version text NOT NULL CHECK(scenario_schema_version='hosted-exact-run-scenario-v1'),
  scenario_payload jsonb NOT NULL CHECK(jsonb_typeof(scenario_payload)='object'),
  scenario_sha256 text NOT NULL CHECK(scenario_sha256 ~ '^[0-9a-f]{64}$'),
  scenario_resource_id uuid,scenario_receipt_id uuid,recorded_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY(org_id,workspace_id,exercise_run_id,evidence_family,assertion_id),
  FOREIGN KEY(workspace_id,org_id) REFERENCES public.workspaces(id,org_id) ON DELETE RESTRICT
);
ALTER TABLE public.hosted_pilot_evidence_scenario_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_pilot_evidence_scenario_observations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.hosted_pilot_evidence_scenario_observations FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER hosted_pilot_evidence_scenario_observations_immutable BEFORE UPDATE OR DELETE ON public.hosted_pilot_evidence_scenario_observations
  FOR EACH ROW EXECUTE FUNCTION public.hosted_pilot_exercise_evidence_immutable();

-- The first command response in the response-loss scenario is intentionally
-- withheld from the caller.  This immutable row proves that the committed
-- receipt belongs to an earlier transaction with the exact current-run
-- selectors before a later invocation is allowed to exercise the retry.
CREATE TABLE public.hosted_pilot_response_loss_preparations (
  org_id uuid NOT NULL,workspace_id uuid NOT NULL,exercise_run_id uuid NOT NULL,
  release_sha text NOT NULL CHECK(release_sha ~ '^[0-9a-f]{40}$'),
  producer_workflow_path text NOT NULL CHECK(producer_workflow_path='.github/workflows/hosted-pilot-activation-evidence-producer.yml'),
  producer_run_id text NOT NULL CHECK(producer_run_id ~ '^[1-9][0-9]{0,19}$'),producer_run_attempt bigint NOT NULL CHECK(producer_run_attempt>0),
  target_fingerprint text NOT NULL CHECK(target_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  deployment_fingerprint text NOT NULL CHECK(deployment_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  actor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL CHECK(length(btrim(idempotency_key)) BETWEEN 8 AND 200),
  request_sha256 text NOT NULL CHECK(request_sha256 ~ '^[0-9a-f]{64}$'),
  receipt_id uuid NOT NULL REFERENCES public.pilot_operations_command_receipts(id) ON DELETE RESTRICT,
  resource_id uuid NOT NULL,preparation_txid bigint NOT NULL,
  first_response_disposition text NOT NULL CHECK(first_response_disposition='discarded_before_retry'),
  recorded_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY(org_id,workspace_id,exercise_run_id),
  FOREIGN KEY(workspace_id,org_id) REFERENCES public.workspaces(id,org_id) ON DELETE RESTRICT
);
ALTER TABLE public.hosted_pilot_response_loss_preparations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_pilot_response_loss_preparations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.hosted_pilot_response_loss_preparations FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER hosted_pilot_response_loss_preparations_immutable BEFORE UPDATE OR DELETE ON public.hosted_pilot_response_loss_preparations
  FOR EACH ROW EXECUTE FUNCTION public.hosted_pilot_exercise_evidence_immutable();

CREATE FUNCTION public.hosted_pilot_prepare_response_loss_scenario(
  p_org uuid,p_workspace uuid,p_exercise_run uuid,p_release_sha text,
  p_producer_workflow_path text,p_producer_run_id text,p_producer_run_attempt bigint,
  p_target_fingerprint text,p_deployment_fingerprint text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog AS $$
DECLARE actor uuid; authorization_version bigint; environment public.pilot_operations_environments;
  scenario_key text; payload jsonb; request_payload text; receipt public.pilot_operations_command_receipts;
  candidate public.pilot_operations_release_candidates; preparation public.hosted_pilot_response_loss_preparations;
  receipt_count bigint; effect_count bigint; audit_count bigint; request_sha text;
BEGIN
  IF current_user IS DISTINCT FROM (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database()) THEN
    RAISE EXCEPTION 'HOSTED_RESPONSE_LOSS_PREPARER_OWNER_REQUIRED';
  END IF;
  SELECT profile.id,version.version INTO actor,authorization_version
    FROM public.profiles profile
    JOIN public.organization_members member ON member.org_id=p_org AND member.user_id=profile.id
      AND member.status='active' AND member.disabled_at IS NULL AND member.deleted_at IS NULL
    JOIN public.authorization_versions version ON version.org_id=p_org AND version.user_id=profile.id
    WHERE profile.status='active' AND profile.deleted_at IS NULL
      AND EXISTS(SELECT 1 FROM public.role_capabilities capability
        WHERE capability.role_id=member.role_id AND capability.capability_key='release.manage')
    ORDER BY profile.id LIMIT 1;
  SELECT * INTO environment FROM public.pilot_operations_environments
    WHERE org_id=p_org AND workspace_id=p_workspace AND environment_type='pilot_candidate' AND lifecycle<>'deactivated';
  IF actor IS NULL OR authorization_version IS NULL OR environment.id IS NULL
    OR EXISTS(SELECT 1 FROM public.pilot_operations_tenants WHERE org_id=p_org AND workspace_id=p_workspace AND lifecycle<>'active') THEN
    RAISE EXCEPTION 'HOSTED_RESPONSE_LOSS_SCENARIO_AUTHORITY_MISSING';
  END IF;
  scenario_key:='hosted-response-replay-'||replace(p_exercise_run::text,'-','');
  payload:=jsonb_build_object('environmentId',environment.id,'gitSha',p_release_sha,
    'buildIdentity','hosted-exact-replay-'||p_producer_run_id||'-'||p_producer_run_attempt::text,
    'evidenceManifestSha256',encode(public.digest(convert_to(p_exercise_run::text||'|'||p_target_fingerprint||'|'||p_deployment_fingerprint,'UTF8'),'sha256'),'hex'),
    'schemaVersion',environment.expected_schema_version);
  request_payload:=payload::text;
  request_sha:=encode(public.digest(convert_to(request_payload,'UTF8'),'sha256'),'hex');
  SELECT * INTO preparation FROM public.hosted_pilot_response_loss_preparations
    WHERE org_id=p_org AND workspace_id=p_workspace AND exercise_run_id=p_exercise_run;
  IF FOUND THEN
    IF preparation.release_sha IS DISTINCT FROM p_release_sha OR preparation.producer_workflow_path IS DISTINCT FROM p_producer_workflow_path
      OR preparation.producer_run_id IS DISTINCT FROM p_producer_run_id OR preparation.producer_run_attempt IS DISTINCT FROM p_producer_run_attempt
      OR preparation.target_fingerprint IS DISTINCT FROM p_target_fingerprint OR preparation.deployment_fingerprint IS DISTINCT FROM p_deployment_fingerprint
      OR preparation.actor_id IS DISTINCT FROM actor OR preparation.idempotency_key IS DISTINCT FROM scenario_key
      OR preparation.request_sha256 IS DISTINCT FROM request_sha OR preparation.first_response_disposition IS DISTINCT FROM 'discarded_before_retry'
      THEN RAISE EXCEPTION 'HOSTED_RESPONSE_LOSS_PREPARATION_CONFLICT'; END IF;
    RETURN jsonb_build_object('status','response_loss_ready','businessResponseExposed',false,'productionAuthorized',false);
  END IF;
  SELECT count(*) INTO receipt_count FROM public.pilot_operations_command_receipts
    WHERE org_id=p_org AND workspace_id=p_workspace AND actor_id=actor AND operation='register_release_candidate' AND idempotency_key=scenario_key;
  IF receipt_count<>0 THEN RAISE EXCEPTION 'HOSTED_RESPONSE_LOSS_UNBOUND_STALE_RECEIPT'; END IF;
  -- PERFORM deliberately discards the business response.  The OIDC wrapper
  -- returns only a phase marker, and the transaction commits before retry.
  PERFORM public.pilot_operations_command(actor,p_org,p_workspace,'register_release_candidate',gen_random_uuid(),scenario_key,request_payload,authorization_version,0,payload);
  SELECT * INTO receipt FROM public.pilot_operations_command_receipts
    WHERE org_id=p_org AND workspace_id=p_workspace AND actor_id=actor AND operation='register_release_candidate' AND idempotency_key=scenario_key;
  SELECT * INTO candidate FROM public.pilot_operations_release_candidates
    WHERE id=receipt.resource_id AND org_id=p_org AND workspace_id=p_workspace;
  SELECT count(*) INTO effect_count FROM public.pilot_operations_candidate_history
    WHERE org_id=p_org AND workspace_id=p_workspace AND candidate_id=receipt.resource_id;
  SELECT count(*) INTO audit_count FROM public.pilot_operations_audit_events
    WHERE org_id=p_org AND workspace_id=p_workspace AND receipt_id=receipt.id AND action='register_release_candidate'
      AND resource_id=receipt.resource_id AND result='committed';
  IF receipt.id IS NULL OR receipt.status<>'committed' OR receipt.request_hash<>request_sha
    OR receipt.response_body->>'resourceId' IS DISTINCT FROM receipt.resource_id::text
    OR candidate.id IS NULL OR candidate.git_sha<>p_release_sha OR candidate.build_identity<>payload->>'buildIdentity'
    OR candidate.evidence_manifest_sha256<>payload->>'evidenceManifestSha256' OR candidate.schema_version<>payload->>'schemaVersion'
    OR effect_count<>1 OR audit_count<>1 THEN RAISE EXCEPTION 'HOSTED_RESPONSE_LOSS_FIRST_COMMIT_INVALID'; END IF;
  INSERT INTO public.hosted_pilot_response_loss_preparations(org_id,workspace_id,exercise_run_id,release_sha,producer_workflow_path,
    producer_run_id,producer_run_attempt,target_fingerprint,deployment_fingerprint,actor_id,idempotency_key,request_sha256,
    receipt_id,resource_id,preparation_txid,first_response_disposition)
  VALUES(p_org,p_workspace,p_exercise_run,p_release_sha,p_producer_workflow_path,p_producer_run_id,p_producer_run_attempt,
    p_target_fingerprint,p_deployment_fingerprint,actor,scenario_key,request_sha,receipt.id,receipt.resource_id,
    txid_current(),'discarded_before_retry');
  RETURN jsonb_build_object('status','response_loss_committed','businessResponseExposed',false,'productionAuthorized',false);
END$$;
REVOKE ALL ON FUNCTION public.hosted_pilot_prepare_response_loss_scenario(uuid,uuid,uuid,text,text,text,bigint,text,text) FROM PUBLIC,anon,authenticated,service_role;

-- Recovery and rollback tables predate the hosted run-attempt, target, and
-- deployment selectors.  This immutable bridge can only be written by the
-- database owner after genuinely canonical operations have committed.  It
-- validates those operations and selector-derived keys/hashes instead of
-- stamping current metadata onto ambient rows.
CREATE TABLE public.hosted_pilot_exact_run_operational_executions (
  org_id uuid NOT NULL,workspace_id uuid NOT NULL,exercise_run_id uuid NOT NULL,
  release_sha text NOT NULL CHECK(release_sha ~ '^[0-9a-f]{40}$'),
  producer_workflow_path text NOT NULL CHECK(producer_workflow_path='.github/workflows/hosted-pilot-activation-evidence-producer.yml'),
  producer_run_id text NOT NULL CHECK(producer_run_id ~ '^[1-9][0-9]{0,19}$'),producer_run_attempt bigint NOT NULL CHECK(producer_run_attempt>0),
  target_fingerprint text NOT NULL CHECK(target_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  deployment_fingerprint text NOT NULL CHECK(deployment_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  response_loss_receipt_id uuid NOT NULL REFERENCES public.pilot_operations_command_receipts(id) ON DELETE RESTRICT,
  response_loss_resource_id uuid NOT NULL,
  recovery_drill_id uuid NOT NULL REFERENCES public.pilot_operations_recovery_evidence_ingestions(recovery_drill_id) ON DELETE RESTRICT,
  rollback_event_id uuid NOT NULL REFERENCES public.pilot_operations_rollback_events(id) ON DELETE RESTRICT,
  rollback_receipt_id uuid NOT NULL REFERENCES public.pilot_operations_command_receipts(id) ON DELETE RESTRICT,
  binding_txid bigint NOT NULL,recorded_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY(org_id,workspace_id,exercise_run_id),
  FOREIGN KEY(workspace_id,org_id) REFERENCES public.workspaces(id,org_id) ON DELETE RESTRICT
);
ALTER TABLE public.hosted_pilot_exact_run_operational_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_pilot_exact_run_operational_executions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.hosted_pilot_exact_run_operational_executions FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER hosted_pilot_exact_run_operational_executions_immutable BEFORE UPDATE OR DELETE ON public.hosted_pilot_exact_run_operational_executions
  FOR EACH ROW EXECUTE FUNCTION public.hosted_pilot_exercise_evidence_immutable();

CREATE FUNCTION public.hosted_pilot_bind_exact_run_operational_execution(
  p_org uuid,p_workspace uuid,p_exercise_run uuid,p_release_sha text,
  p_producer_workflow_path text,p_producer_run_id text,p_producer_run_attempt bigint,
  p_target_fingerprint text,p_deployment_fingerprint text,
  p_recovery_drill uuid,p_rollback_event uuid,p_rollback_receipt uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog AS $$
DECLARE preparation public.hosted_pilot_response_loss_preparations;
  recovery public.pilot_operations_recovery_evidence_ingestions;
  rollback public.pilot_operations_rollback_events; receipt public.pilot_operations_command_receipts;
  exact_candidate public.pilot_operations_release_candidates; response_candidate public.pilot_operations_release_candidates;
  existing public.hosted_pilot_exact_run_operational_executions;
  selector_material text; expected_artifact text; expected_evidence text; expected_rollback_key text; audit_count bigint;
BEGIN
  IF current_user IS DISTINCT FROM (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database()) THEN
    RAISE EXCEPTION 'HOSTED_EXACT_RUN_BINDER_OWNER_REQUIRED';
  END IF;
  selector_material:=p_org::text||'|'||p_workspace::text||'|'||p_exercise_run::text||'|'||p_release_sha||'|'||
    p_producer_workflow_path||'|'||p_producer_run_id||'|'||p_producer_run_attempt::text||'|'||p_target_fingerprint||'|'||p_deployment_fingerprint;
  expected_artifact:=encode(public.digest(convert_to('hosted-exact-recovery-artifact|'||selector_material,'UTF8'),'sha256'),'hex');
  expected_evidence:=encode(public.digest(convert_to('hosted-exact-recovery-evidence|'||selector_material,'UTF8'),'sha256'),'hex');
  expected_rollback_key:='hosted-exact-rollback-'||replace(p_exercise_run::text,'-','')||'-'||p_producer_run_id||'-'||p_producer_run_attempt::text;
  SELECT * INTO preparation FROM public.hosted_pilot_response_loss_preparations
    WHERE org_id=p_org AND workspace_id=p_workspace AND exercise_run_id=p_exercise_run
      AND release_sha=p_release_sha AND producer_workflow_path=p_producer_workflow_path
      AND producer_run_id=p_producer_run_id AND producer_run_attempt=p_producer_run_attempt
      AND target_fingerprint=p_target_fingerprint AND deployment_fingerprint=p_deployment_fingerprint
      AND first_response_disposition='discarded_before_retry';
  SELECT * INTO response_candidate FROM public.pilot_operations_release_candidates
    WHERE id=preparation.resource_id AND org_id=p_org AND workspace_id=p_workspace AND git_sha=p_release_sha;
  SELECT * INTO recovery FROM public.pilot_operations_recovery_evidence_ingestions WHERE recovery_drill_id=p_recovery_drill;
  SELECT * INTO rollback FROM public.pilot_operations_rollback_events WHERE id=p_rollback_event;
  SELECT * INTO receipt FROM public.pilot_operations_command_receipts WHERE id=p_rollback_receipt;
  SELECT * INTO exact_candidate FROM public.pilot_operations_release_candidates WHERE id=rollback.from_candidate_id;
  SELECT count(*) INTO audit_count FROM public.pilot_operations_audit_events
    WHERE receipt_id=receipt.id AND org_id=p_org AND workspace_id=p_workspace AND actor_id=rollback.actor_id
      AND action='rollback_non_live_promotion' AND resource_id=rollback.target_candidate_id AND result='committed';
  IF preparation.receipt_id IS NULL OR response_candidate.id IS NULL
    OR recovery.recovery_drill_id IS NULL OR recovery.org_id IS DISTINCT FROM p_org OR recovery.workspace_id IS DISTINCT FROM p_workspace
    OR recovery.environment_id IS DISTINCT FROM response_candidate.environment_id OR recovery.workflow_name IS DISTINCT FROM 'Pilot Operations'
    OR recovery.workflow_run_id IS DISTINCT FROM p_producer_run_id OR recovery.workflow_head_sha IS DISTINCT FROM p_release_sha
    OR recovery.artifact_sha256 IS DISTINCT FROM expected_artifact OR recovery.evidence_sha256 IS DISTINCT FROM expected_evidence
    OR recovery.ingested_at<preparation.recorded_at
    OR rollback.id IS NULL OR rollback.org_id IS DISTINCT FROM p_org OR rollback.workspace_id IS DISTINCT FROM p_workspace
    OR rollback.environment_id IS DISTINCT FROM response_candidate.environment_id OR rollback.created_at<preparation.recorded_at
    OR exact_candidate.id IS NULL OR exact_candidate.org_id IS DISTINCT FROM p_org OR exact_candidate.workspace_id IS DISTINCT FROM p_workspace
    OR exact_candidate.environment_id IS DISTINCT FROM response_candidate.environment_id OR exact_candidate.git_sha IS DISTINCT FROM p_release_sha
    OR receipt.id IS NULL OR receipt.org_id IS DISTINCT FROM p_org OR receipt.workspace_id IS DISTINCT FROM p_workspace
    OR receipt.actor_id IS DISTINCT FROM rollback.actor_id OR receipt.operation IS DISTINCT FROM 'rollback_non_live_promotion'
    OR receipt.idempotency_key IS DISTINCT FROM expected_rollback_key OR receipt.initial_request_id IS DISTINCT FROM rollback.request_id
    OR receipt.resource_id IS DISTINCT FROM rollback.target_candidate_id OR receipt.response_body->>'resourceId' IS DISTINCT FROM rollback.target_candidate_id::text
    OR receipt.status IS DISTINCT FROM 'committed' OR audit_count<>1
    OR NOT EXISTS(SELECT 1 FROM public.hosted_pilot_recovery_operators operator
      WHERE operator.org_id=p_org AND operator.workspace_id=p_workspace AND operator.actor_id=rollback.actor_id
        AND operator.lifecycle='active' AND operator.synthetic_only AND NOT operator.production_authorized
        AND NOT operator.customer_data_authorized AND NOT operator.real_provider_calls_authorized)
    THEN RAISE EXCEPTION 'HOSTED_EXACT_RUN_OPERATIONAL_PREPARATION_INVALID'; END IF;
  SELECT * INTO existing FROM public.hosted_pilot_exact_run_operational_executions
    WHERE org_id=p_org AND workspace_id=p_workspace AND exercise_run_id=p_exercise_run;
  IF FOUND THEN
    IF existing.release_sha IS DISTINCT FROM p_release_sha OR existing.producer_workflow_path IS DISTINCT FROM p_producer_workflow_path
      OR existing.producer_run_id IS DISTINCT FROM p_producer_run_id OR existing.producer_run_attempt IS DISTINCT FROM p_producer_run_attempt
      OR existing.target_fingerprint IS DISTINCT FROM p_target_fingerprint OR existing.deployment_fingerprint IS DISTINCT FROM p_deployment_fingerprint
      OR existing.response_loss_receipt_id IS DISTINCT FROM preparation.receipt_id OR existing.response_loss_resource_id IS DISTINCT FROM preparation.resource_id
      OR existing.recovery_drill_id IS DISTINCT FROM p_recovery_drill OR existing.rollback_event_id IS DISTINCT FROM p_rollback_event
      OR existing.rollback_receipt_id IS DISTINCT FROM p_rollback_receipt THEN RAISE EXCEPTION 'HOSTED_EXACT_RUN_OPERATIONAL_BINDING_CONFLICT'; END IF;
    RETURN jsonb_build_object('status','exact_replay','exerciseRunId',p_exercise_run,'productionAuthorized',false);
  END IF;
  INSERT INTO public.hosted_pilot_exact_run_operational_executions(org_id,workspace_id,exercise_run_id,release_sha,
    producer_workflow_path,producer_run_id,producer_run_attempt,target_fingerprint,deployment_fingerprint,
    response_loss_receipt_id,response_loss_resource_id,recovery_drill_id,rollback_event_id,rollback_receipt_id,binding_txid)
  VALUES(p_org,p_workspace,p_exercise_run,p_release_sha,p_producer_workflow_path,p_producer_run_id,p_producer_run_attempt,
    p_target_fingerprint,p_deployment_fingerprint,preparation.receipt_id,preparation.resource_id,p_recovery_drill,p_rollback_event,p_rollback_receipt,txid_current());
  RETURN jsonb_build_object('status','bound','exerciseRunId',p_exercise_run,'productionAuthorized',false);
END$$;
REVOKE ALL ON FUNCTION public.hosted_pilot_bind_exact_run_operational_execution(uuid,uuid,uuid,text,text,text,bigint,text,text,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.hosted_pilot_exact_run_operational_execution_valid(
  p_org uuid,p_workspace uuid,p_exercise_run uuid,p_release_sha text,
  p_producer_workflow_path text,p_producer_run_id text,p_producer_run_attempt bigint,
  p_target_fingerprint text,p_deployment_fingerprint text
) RETURNS boolean LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE n bigint; selector_material text; expected_artifact text; expected_evidence text; expected_rollback_key text;
BEGIN
  selector_material:=p_org::text||'|'||p_workspace::text||'|'||p_exercise_run::text||'|'||p_release_sha||'|'||
    p_producer_workflow_path||'|'||p_producer_run_id||'|'||p_producer_run_attempt::text||'|'||p_target_fingerprint||'|'||p_deployment_fingerprint;
  expected_artifact:=encode(public.digest(convert_to('hosted-exact-recovery-artifact|'||selector_material,'UTF8'),'sha256'),'hex');
  expected_evidence:=encode(public.digest(convert_to('hosted-exact-recovery-evidence|'||selector_material,'UTF8'),'sha256'),'hex');
  expected_rollback_key:='hosted-exact-rollback-'||replace(p_exercise_run::text,'-','')||'-'||p_producer_run_id||'-'||p_producer_run_attempt::text;
  SELECT count(*) INTO n
    FROM public.hosted_pilot_exact_run_operational_executions execution
    JOIN public.hosted_pilot_response_loss_preparations preparation
      ON (preparation.org_id,preparation.workspace_id,preparation.exercise_run_id)=(execution.org_id,execution.workspace_id,execution.exercise_run_id)
      AND (preparation.receipt_id,preparation.resource_id)=(execution.response_loss_receipt_id,execution.response_loss_resource_id)
    JOIN public.pilot_operations_release_candidates response_candidate ON response_candidate.id=preparation.resource_id
    JOIN public.pilot_operations_recovery_evidence_ingestions recovery ON recovery.recovery_drill_id=execution.recovery_drill_id
    JOIN public.pilot_operations_rollback_events rollback ON rollback.id=execution.rollback_event_id
    JOIN public.pilot_operations_release_candidates from_candidate ON from_candidate.id=rollback.from_candidate_id
    JOIN public.pilot_operations_command_receipts receipt ON receipt.id=execution.rollback_receipt_id
    WHERE (execution.org_id,execution.workspace_id,execution.exercise_run_id)=(p_org,p_workspace,p_exercise_run)
      AND (execution.release_sha,execution.producer_workflow_path,execution.producer_run_id,execution.producer_run_attempt,
        execution.target_fingerprint,execution.deployment_fingerprint)=(p_release_sha,p_producer_workflow_path,p_producer_run_id,
        p_producer_run_attempt,p_target_fingerprint,p_deployment_fingerprint)
      AND (preparation.release_sha,preparation.producer_workflow_path,preparation.producer_run_id,preparation.producer_run_attempt,
        preparation.target_fingerprint,preparation.deployment_fingerprint)=(p_release_sha,p_producer_workflow_path,p_producer_run_id,
        p_producer_run_attempt,p_target_fingerprint,p_deployment_fingerprint)
      AND preparation.first_response_disposition='discarded_before_retry'
      AND (response_candidate.org_id,response_candidate.workspace_id,response_candidate.git_sha)=(p_org,p_workspace,p_release_sha)
      AND (recovery.org_id,recovery.workspace_id,recovery.environment_id)=(p_org,p_workspace,response_candidate.environment_id)
      AND (recovery.workflow_name,recovery.workflow_run_id,recovery.workflow_head_sha)=('Pilot Operations',p_producer_run_id,p_release_sha)
      AND (recovery.artifact_sha256,recovery.evidence_sha256)=(expected_artifact,expected_evidence)
      AND recovery.ingested_at>=preparation.recorded_at
      AND (rollback.org_id,rollback.workspace_id,rollback.environment_id)=(p_org,p_workspace,response_candidate.environment_id)
      AND rollback.created_at>=preparation.recorded_at
      AND (from_candidate.org_id,from_candidate.workspace_id,from_candidate.environment_id,from_candidate.git_sha)=
        (p_org,p_workspace,response_candidate.environment_id,p_release_sha)
      AND (receipt.org_id,receipt.workspace_id,receipt.actor_id)=(p_org,p_workspace,rollback.actor_id)
      AND receipt.operation='rollback_non_live_promotion' AND receipt.idempotency_key=expected_rollback_key
      AND receipt.initial_request_id=rollback.request_id AND receipt.resource_id=rollback.target_candidate_id
      AND receipt.response_body->>'resourceId'=rollback.target_candidate_id::text AND receipt.status='committed'
      AND (SELECT count(*) FROM public.pilot_operations_audit_events audit WHERE audit.receipt_id=receipt.id
        AND audit.action='rollback_non_live_promotion' AND audit.resource_id=rollback.target_candidate_id AND audit.result='committed')=1
      AND EXISTS(SELECT 1 FROM public.hosted_pilot_recovery_operators operator
        WHERE (operator.org_id,operator.workspace_id,operator.actor_id)=(p_org,p_workspace,rollback.actor_id)
          AND operator.lifecycle='active' AND operator.synthetic_only AND NOT operator.production_authorized
          AND NOT operator.customer_data_authorized AND NOT operator.real_provider_calls_authorized);
  RETURN n=1;
EXCEPTION WHEN others THEN RETURN false;
END$$;
REVOKE ALL ON FUNCTION public.hosted_pilot_exact_run_operational_execution_valid(uuid,uuid,uuid,text,text,text,bigint,text,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.hosted_pilot_execute_assertion_scenario(
  p_assertion_id text,p_org uuid,p_workspace uuid,p_exercise_run uuid,p_release_sha text,
  p_producer_workflow_path text,p_producer_run_id text,p_producer_run_attempt bigint,
  p_target_fingerprint text,p_deployment_fingerprint text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog AS $$
DECLARE n bigint; m bigint; actual_target text; capabilities text[];
  unauthorized_read_denied boolean:=false; unauthorized_mutation_denied boolean:=false;
  denial_error_nondisclosing boolean:=false; mutation_error_nondisclosing boolean:=false;
  receipts_before bigint; receipts_after bigint; audits_before bigint; audits_after bigint; candidates_before bigint; candidates_after bigint;
  actor uuid; authorization_version bigint; foreign_org uuid; foreign_workspace uuid;
  environment public.pilot_operations_environments; foreign_environment public.pilot_operations_environments;
  foreign_protected_candidate public.pilot_operations_release_candidates; source_projection jsonb;
  source_scope_projection_authorized boolean:=false; foreign_org_membership_absent boolean:=false;
  foreign_workspace_membership_absent boolean:=false; foreign_scope_exists boolean:=false;
  foreign_protected_resource_exists boolean:=false;
  scenario_key text; scenario_request uuid; payload jsonb; changed_payload jsonb; request_payload text;
  replay_response jsonb; receipt public.pilot_operations_command_receipts; preparation public.hosted_pilot_response_loss_preparations;
  provider_prefix text; provider_scenario text;
  effect_count bigint; audit_count bigint; conflict_rejected boolean:=false;
BEGIN
  IF current_user IS DISTINCT FROM (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database()) THEN
    RAISE EXCEPTION 'HOSTED_SCENARIO_EXECUTOR_OWNER_REQUIRED';
  END IF;
  IF p_org IS NULL OR p_workspace IS NULL OR p_exercise_run IS NULL OR p_release_sha !~ '^[0-9a-f]{40}$'
    OR p_producer_workflow_path IS DISTINCT FROM '.github/workflows/hosted-pilot-activation-evidence-producer.yml'
    OR p_producer_run_id !~ '^[1-9][0-9]{0,19}$' OR p_producer_run_attempt<1
    OR p_target_fingerprint !~ '^sha256:[0-9a-f]{64}$' OR p_deployment_fingerprint !~ '^sha256:[0-9a-f]{64}$'
    THEN RAISE EXCEPTION 'HOSTED_SCENARIO_EXECUTOR_INPUT_INVALID'; END IF;
  IF p_assertion_id LIKE 'hosted-provider--%' THEN
    SELECT profile.id,version.version INTO actor,authorization_version
      FROM public.profiles profile
      JOIN public.organization_members member ON member.org_id=p_org AND member.user_id=profile.id
        AND member.status='active' AND member.disabled_at IS NULL AND member.deleted_at IS NULL
      JOIN public.authorization_versions version ON version.org_id=p_org AND version.user_id=profile.id
      WHERE profile.status='active' AND profile.deleted_at IS NULL
        AND EXISTS(SELECT 1 FROM public.role_capabilities capability
          WHERE capability.role_id=member.role_id AND capability.capability_key='operations.manage')
      ORDER BY profile.id LIMIT 1;
    IF actor IS NULL OR authorization_version IS NULL THEN
      RETURN jsonb_build_object('passed',false,'predicate',jsonb_build_object('exactRunProviderAuthorityReady',false));
    END IF;
    provider_prefix:='hosted-provider-'||replace(p_exercise_run::text,'-','')||'-'||p_producer_run_id||'-'||p_producer_run_attempt::text;
    FOREACH provider_scenario IN ARRAY ARRAY['success','failure','timeout','revoked','rotated'] LOOP
      request_payload:=jsonb_build_object('schemaVersion','hosted-provider-exact-run-v1','exerciseRunId',p_exercise_run,
        'producerRunId',p_producer_run_id,'producerRunAttempt',p_producer_run_attempt,'targetFingerprint',p_target_fingerprint,
        'deploymentFingerprint',p_deployment_fingerprint,'scenario',provider_scenario,'syntheticOnly',true)::text;
      PERFORM public.hosted_pilot_simulate_provider(actor,p_org,p_workspace,authorization_version,
        provider_prefix||'-'||provider_scenario,provider_scenario,request_payload);
    END LOOP;
  END IF;
  CASE p_assertion_id
    WHEN 'hosted-database--synthetic-subject-role-matrix' THEN
      SELECT count(*),count(DISTINCT test_role) INTO n,m FROM public.hosted_pilot_synthetic_subjects
        WHERE org_id=p_org AND workspace_id=p_workspace AND synthetic_only AND test_role=ANY(ARRAY['cross_tenant','operator','owner','reviewer','revoked']);
      RETURN jsonb_build_object('passed',n=5 AND m=5,'predicate',jsonb_build_object('subjectCount',n,'distinctRoleCount',m));
    WHEN 'hosted-database--cross-tenant-nondisclosure' THEN
      SELECT profile.id,version.version INTO actor,authorization_version
        FROM public.profiles profile
        JOIN public.organization_members member ON member.org_id=p_org AND member.user_id=profile.id
          AND member.status='active' AND member.disabled_at IS NULL AND member.deleted_at IS NULL
        JOIN public.authorization_versions version ON version.org_id=p_org AND version.user_id=profile.id
        WHERE profile.status='active' AND profile.deleted_at IS NULL
          AND EXISTS(SELECT 1 FROM public.role_capabilities capability
            WHERE capability.role_id=member.role_id AND capability.capability_key='operations.read')
          AND EXISTS(SELECT 1 FROM public.role_capabilities capability
            WHERE capability.role_id=member.role_id AND capability.capability_key='release.manage')
        ORDER BY profile.id LIMIT 1;
      IF actor IS NULL OR authorization_version IS NULL THEN
        RETURN jsonb_build_object('passed',false,'predicate',jsonb_build_object('activeForeignScopeActor',false));
      END IF;
      -- First prove that the selected actor is positively authorized in the
      -- source scope.  A denial by an already-invalid actor is not cross-tenant
      -- nondisclosure evidence.
      BEGIN
        source_projection:=public.pilot_operations_projection(actor,p_org,p_workspace,authorization_version);
        source_scope_projection_authorized:=source_projection->>'truthClassification'='configured_not_live_verified';
      EXCEPTION WHEN others THEN source_scope_projection_authorized:=false; END;
      LOOP
        foreign_org:=gen_random_uuid(); foreign_workspace:=gen_random_uuid();
        EXIT WHEN NOT EXISTS(SELECT 1 FROM public.organizations WHERE id=foreign_org)
          AND NOT EXISTS(SELECT 1 FROM public.workspaces WHERE id=foreign_workspace);
      END LOOP;
      -- Build a real second synthetic tenant boundary and a protected resource
      -- before attempting either RPC.  Random nonexistent identifiers can only
      -- prove not-found behavior, not isolation from another tenant's data.
      INSERT INTO public.organizations(id,name,slug,status,settings,is_trial,created_by,updated_by)
        VALUES(foreign_org,'Hosted cross-tenant evidence scope','hosted-cross-tenant-'||replace(foreign_org::text,'-',''),'active',
          jsonb_build_object('syntheticOnly',true,'exerciseRunId',p_exercise_run),false,actor,actor);
      INSERT INTO public.workspaces(id,org_id,name,slug,status,metadata,created_by,updated_by)
        VALUES(foreign_workspace,foreign_org,'Hosted protected foreign workspace','protected-'||replace(foreign_workspace::text,'-',''),'active',
          jsonb_build_object('syntheticOnly',true,'exerciseRunId',p_exercise_run),actor,actor);
      INSERT INTO public.pilot_operations_environments(org_id,workspace_id,environment_type,lifecycle,expected_schema_version,
        required_capabilities,maintenance,read_only,version,created_by)
        VALUES(foreign_org,foreign_workspace,'pilot_candidate','configured','hosted-cross-tenant-v1','[]',false,false,1,actor)
        RETURNING * INTO foreign_environment;
      INSERT INTO public.pilot_operations_release_candidates(org_id,workspace_id,environment_id,git_sha,build_identity,
        evidence_manifest_sha256,schema_version,lifecycle,version,created_by)
        VALUES(foreign_org,foreign_workspace,foreign_environment.id,p_release_sha,
          'hosted-protected-foreign-'||p_producer_run_id||'-'||p_producer_run_attempt::text,
          encode(public.digest(convert_to('protected-foreign|'||p_exercise_run::text||'|'||p_target_fingerprint,'UTF8'),'sha256'),'hex'),
          foreign_environment.expected_schema_version,'draft',1,actor)
        RETURNING * INTO foreign_protected_candidate;
      foreign_org_membership_absent:=NOT EXISTS(SELECT 1 FROM public.organization_members
        WHERE org_id=foreign_org AND user_id=actor AND status='active' AND disabled_at IS NULL AND deleted_at IS NULL);
      foreign_workspace_membership_absent:=NOT EXISTS(SELECT 1 FROM public.workspace_memberships
        WHERE org_id=foreign_org AND workspace_id=foreign_workspace AND user_id=actor
          AND status='active' AND disabled_at IS NULL AND deleted_at IS NULL);
      foreign_scope_exists:=EXISTS(SELECT 1 FROM public.organizations WHERE id=foreign_org AND status='active' AND deleted_at IS NULL)
        AND EXISTS(SELECT 1 FROM public.workspaces WHERE id=foreign_workspace AND org_id=foreign_org AND status='active' AND deleted_at IS NULL);
      foreign_protected_resource_exists:=EXISTS(SELECT 1 FROM public.pilot_operations_release_candidates
        WHERE id=foreign_protected_candidate.id AND org_id=foreign_org AND workspace_id=foreign_workspace
          AND environment_id=foreign_environment.id);
      scenario_key:='hosted-cross-tenant-'||replace(p_exercise_run::text,'-','');
      SELECT count(*) INTO receipts_before FROM public.pilot_operations_command_receipts
        WHERE operation='register_release_candidate' AND idempotency_key=scenario_key;
      SELECT count(*) INTO audits_before FROM public.pilot_operations_audit_events audit
        JOIN public.pilot_operations_command_receipts command_receipt ON command_receipt.id=audit.receipt_id
        WHERE command_receipt.operation='register_release_candidate' AND command_receipt.idempotency_key=scenario_key;
      SELECT count(*) INTO candidates_before FROM public.pilot_operations_release_candidates
        WHERE build_identity='hosted-cross-tenant-denial-'||p_producer_run_id||'-'||p_producer_run_attempt::text;
      BEGIN
        PERFORM public.pilot_operations_projection(actor,foreign_org,foreign_workspace,authorization_version);
      EXCEPTION WHEN others THEN
        unauthorized_read_denied:=true;
        denial_error_nondisclosing:=position('PR1B_NOT_FOUND' in SQLERRM)>0
          AND position(p_org::text in SQLERRM)=0 AND position(p_workspace::text in SQLERRM)=0
          AND position(foreign_org::text in SQLERRM)=0 AND position(foreign_workspace::text in SQLERRM)=0;
      END;
      payload:=jsonb_build_object('environmentId',foreign_environment.id,'gitSha',p_release_sha,
        'buildIdentity','hosted-cross-tenant-denial-'||p_producer_run_id||'-'||p_producer_run_attempt::text,
        'evidenceManifestSha256',encode(public.digest(convert_to('cross-tenant|'||p_exercise_run::text||'|'||p_deployment_fingerprint,'UTF8'),'sha256'),'hex'),
        'schemaVersion',foreign_environment.expected_schema_version);
      BEGIN
        PERFORM public.pilot_operations_command(actor,foreign_org,foreign_workspace,'register_release_candidate',gen_random_uuid(),scenario_key,payload::text,authorization_version,0,payload);
      EXCEPTION WHEN others THEN
        unauthorized_mutation_denied:=true;
        mutation_error_nondisclosing:=position('PR1B_NOT_FOUND' in SQLERRM)>0
          AND position(p_org::text in SQLERRM)=0 AND position(p_workspace::text in SQLERRM)=0
          AND position(foreign_org::text in SQLERRM)=0 AND position(foreign_workspace::text in SQLERRM)=0;
      END;
      SELECT count(*) INTO receipts_after FROM public.pilot_operations_command_receipts
        WHERE operation='register_release_candidate' AND idempotency_key=scenario_key;
      SELECT count(*) INTO audits_after FROM public.pilot_operations_audit_events audit
        JOIN public.pilot_operations_command_receipts command_receipt ON command_receipt.id=audit.receipt_id
        WHERE command_receipt.operation='register_release_candidate' AND command_receipt.idempotency_key=scenario_key;
      SELECT count(*) INTO candidates_after FROM public.pilot_operations_release_candidates
        WHERE build_identity='hosted-cross-tenant-denial-'||p_producer_run_id||'-'||p_producer_run_attempt::text;
      RETURN jsonb_build_object('passed',source_scope_projection_authorized AND foreign_scope_exists AND foreign_protected_resource_exists
          AND foreign_org_membership_absent AND foreign_workspace_membership_absent
          AND unauthorized_read_denied AND unauthorized_mutation_denied AND denial_error_nondisclosing AND mutation_error_nondisclosing
          AND receipts_before=0 AND receipts_after=0 AND audits_before=0 AND audits_after=0 AND candidates_before=0 AND candidates_after=0,
        'predicate',jsonb_build_object('unauthorizedReadDenied',unauthorized_read_denied,'unauthorizedMutationDenied',unauthorized_mutation_denied,
          'readErrorNondisclosing',denial_error_nondisclosing,'mutationErrorNondisclosing',mutation_error_nondisclosing,
          'activeForeignScopeActor',true,'sourceScopeProjectionAuthorized',source_scope_projection_authorized,
          'foreignScopeExists',foreign_scope_exists,'foreignProtectedResourceExists',foreign_protected_resource_exists,
          'foreignOrganizationMembershipAbsent',foreign_org_membership_absent,
          'foreignWorkspaceMembershipAbsent',foreign_workspace_membership_absent,
          'rowsDisclosed',0,'receiptSideEffects',receipts_after-receipts_before,'auditSideEffects',audits_after-audits_before,
          'businessSideEffects',candidates_after-candidates_before));
    WHEN 'hosted-database--revocation-version-bound' THEN
      SELECT count(*) INTO n FROM public.hosted_pilot_synthetic_subjects WHERE org_id=p_org AND workspace_id=p_workspace AND test_role='revoked' AND lifecycle='revoked' AND version>0;
      RETURN jsonb_build_object('passed',n=1,'predicate',jsonb_build_object('revokedVersionBoundCount',n));
    WHEN 'hosted-database--response-loss-exact-replay' THEN
      SELECT profile.id,version.version INTO actor,authorization_version
        FROM public.profiles profile
        JOIN public.organization_members member ON member.org_id=p_org AND member.user_id=profile.id
          AND member.status='active' AND member.disabled_at IS NULL AND member.deleted_at IS NULL
        JOIN public.authorization_versions version ON version.org_id=p_org AND version.user_id=profile.id
        WHERE profile.status='active' AND profile.deleted_at IS NULL
          AND EXISTS(SELECT 1 FROM public.role_capabilities capability
            WHERE capability.role_id=member.role_id AND capability.capability_key='release.manage')
        ORDER BY profile.id LIMIT 1;
      SELECT * INTO environment FROM public.pilot_operations_environments
        WHERE org_id=p_org AND workspace_id=p_workspace AND environment_type='pilot_candidate' AND lifecycle<>'deactivated';
      IF actor IS NULL OR authorization_version IS NULL OR environment.id IS NULL
        OR EXISTS(SELECT 1 FROM public.pilot_operations_tenants WHERE org_id=p_org AND workspace_id=p_workspace AND lifecycle<>'active') THEN
        RETURN jsonb_build_object('passed',false,'predicate',jsonb_build_object('scenarioAuthorityReady',false));
      END IF;
      scenario_key:='hosted-response-replay-'||replace(p_exercise_run::text,'-','');
      scenario_request:=gen_random_uuid();
      payload:=jsonb_build_object('environmentId',environment.id,'gitSha',p_release_sha,
        'buildIdentity','hosted-exact-replay-'||p_producer_run_id||'-'||p_producer_run_attempt::text,
        'evidenceManifestSha256',encode(public.digest(convert_to(p_exercise_run::text||'|'||p_target_fingerprint||'|'||p_deployment_fingerprint,'UTF8'),'sha256'),'hex'),
        'schemaVersion',environment.expected_schema_version);
      request_payload:=payload::text;
      SELECT * INTO preparation FROM public.hosted_pilot_response_loss_preparations
        WHERE org_id=p_org AND workspace_id=p_workspace AND exercise_run_id=p_exercise_run;
      IF NOT FOUND OR preparation.release_sha IS DISTINCT FROM p_release_sha
        OR preparation.producer_workflow_path IS DISTINCT FROM p_producer_workflow_path
        OR preparation.producer_run_id IS DISTINCT FROM p_producer_run_id OR preparation.producer_run_attempt IS DISTINCT FROM p_producer_run_attempt
        OR preparation.target_fingerprint IS DISTINCT FROM p_target_fingerprint OR preparation.deployment_fingerprint IS DISTINCT FROM p_deployment_fingerprint
        OR preparation.actor_id IS DISTINCT FROM actor OR preparation.idempotency_key IS DISTINCT FROM scenario_key
        OR preparation.request_sha256 IS DISTINCT FROM encode(public.digest(convert_to(request_payload,'UTF8'),'sha256'),'hex')
        OR preparation.first_response_disposition IS DISTINCT FROM 'discarded_before_retry'
        OR preparation.preparation_txid=txid_current() THEN
        RETURN jsonb_build_object('passed',false,'predicate',jsonb_build_object('durableCommitBeforeRetry',false));
      END IF;
      SELECT count(*) INTO receipts_before FROM public.pilot_operations_command_receipts
        WHERE org_id=p_org AND workspace_id=p_workspace AND operation='register_release_candidate' AND idempotency_key=scenario_key;
      replay_response:=public.pilot_operations_command(actor,p_org,p_workspace,'register_release_candidate',scenario_request,scenario_key,request_payload,authorization_version,0,payload);
      SELECT * INTO receipt FROM public.pilot_operations_command_receipts
        WHERE org_id=p_org AND workspace_id=p_workspace AND actor_id=actor AND operation='register_release_candidate' AND idempotency_key=scenario_key;
      SELECT count(*) INTO receipts_after FROM public.pilot_operations_command_receipts
        WHERE org_id=p_org AND workspace_id=p_workspace AND actor_id=actor AND operation='register_release_candidate' AND idempotency_key=scenario_key;
      SELECT count(*) INTO effect_count FROM public.pilot_operations_candidate_history
        WHERE org_id=p_org AND workspace_id=p_workspace AND candidate_id=receipt.resource_id;
      SELECT count(*) INTO audit_count FROM public.pilot_operations_audit_events
        WHERE org_id=p_org AND workspace_id=p_workspace AND receipt_id=receipt.id AND action='register_release_candidate'
          AND resource_id=receipt.resource_id AND result='committed';
      changed_payload:=payload||jsonb_build_object('buildIdentity',(payload->>'buildIdentity')||'-changed');
      BEGIN
        PERFORM public.pilot_operations_command(actor,p_org,p_workspace,'register_release_candidate',gen_random_uuid(),scenario_key,changed_payload::text,authorization_version,0,changed_payload);
      EXCEPTION WHEN others THEN conflict_rejected:=position('IDEMPOTENCY_CONFLICT' in SQLERRM)>0; END;
      RETURN jsonb_build_object('passed',replay_response=receipt.response_body AND receipt.status='committed'
          AND receipt.id=preparation.receipt_id AND receipt.resource_id=preparation.resource_id
          AND receipts_before=1 AND receipts_after=1 AND effect_count=1 AND audit_count=1 AND conflict_rejected,
        'predicate',jsonb_build_object('responseDiscardedBeforeRetry',true,'durableCommitBeforeRetry',true,
          'exactReplayResponseMatched',replay_response=receipt.response_body,
          'committedReceiptCount',receipts_after,'businessEffectDelta',1,'resourceBusinessEffectCount',effect_count,
          'canonicalAuditEventCount',audit_count,'changedPayloadConflictRejected',conflict_rejected),
        'resourceId',receipt.resource_id,'receiptId',receipt.id);
    WHEN 'hosted-provider--five-scenarios-executed' THEN
      SELECT count(DISTINCT scenario) INTO n FROM public.hosted_pilot_provider_simulations WHERE org_id=p_org AND workspace_id=p_workspace
        AND actor_id=actor AND idempotency_key LIKE provider_prefix||'-%'
        AND scenario=ANY(ARRAY['success','failure','timeout','revoked','rotated']);
      RETURN jsonb_build_object('passed',n=5,'predicate',jsonb_build_object('scenarioCount',n,'exactRunScenarioSetBound',n=5));
    WHEN 'hosted-provider--zero-egress-recorded' THEN
      SELECT count(*) FILTER(WHERE zero_egress),count(*) INTO n,m FROM public.hosted_pilot_provider_simulations
        WHERE org_id=p_org AND workspace_id=p_workspace AND actor_id=actor AND idempotency_key LIKE provider_prefix||'-%';
      RETURN jsonb_build_object('passed',n=5 AND m=5,'predicate',jsonb_build_object('zeroEgressCount',n,'totalCount',m,'exactRunScenarioSetBound',m=5));
    WHEN 'hosted-provider--real-provider-calls-not-authorized' THEN
      SELECT count(*) INTO n FROM public.hosted_pilot_environment_identity WHERE singleton AND NOT real_provider_calls_authorized;
      SELECT count(*) INTO m FROM public.hosted_pilot_provider_simulations
        WHERE org_id=p_org AND workspace_id=p_workspace AND actor_id=actor AND idempotency_key LIKE provider_prefix||'-%' AND zero_egress;
      RETURN jsonb_build_object('passed',n=1 AND m=5,'predicate',jsonb_build_object('nonAuthorizationMarkerCount',n,'exactRunZeroEgressCount',m));
    WHEN 'hosted-journey--exact-release-ingestion' THEN
      SELECT count(*) INTO n
        FROM public.hosted_pilot_response_loss_preparations exact_preparation
        JOIN public.pilot_operations_command_receipts exact_receipt
          ON exact_receipt.id=exact_preparation.receipt_id AND exact_receipt.resource_id=exact_preparation.resource_id
          AND exact_receipt.org_id=exact_preparation.org_id AND exact_receipt.workspace_id=exact_preparation.workspace_id
          AND exact_receipt.operation='register_release_candidate' AND exact_receipt.idempotency_key=exact_preparation.idempotency_key
        JOIN public.pilot_operations_release_candidates exact_candidate
          ON exact_candidate.id=exact_preparation.resource_id AND exact_candidate.org_id=exact_preparation.org_id
          AND exact_candidate.workspace_id=exact_preparation.workspace_id
        WHERE exact_preparation.org_id=p_org AND exact_preparation.workspace_id=p_workspace
          AND exact_preparation.exercise_run_id=p_exercise_run AND exact_preparation.release_sha=p_release_sha
          AND exact_preparation.producer_workflow_path=p_producer_workflow_path
          AND exact_preparation.producer_run_id=p_producer_run_id AND exact_preparation.producer_run_attempt=p_producer_run_attempt
          AND exact_preparation.target_fingerprint=p_target_fingerprint
          AND exact_preparation.deployment_fingerprint=p_deployment_fingerprint
          AND exact_candidate.git_sha=p_release_sha AND exact_receipt.status='committed'
          AND exact_preparation.first_response_disposition='discarded_before_retry';
      RETURN jsonb_build_object('passed',n=1,'predicate',jsonb_build_object(
        'exactPreparationCandidateCount',n,'exactResponseLossPreparationBound',n=1));
    WHEN 'hosted-journey--recovery-evidence-bound','hosted-backup--exact-release-recovery-ingestion','hosted-recovery--recovery-evidence-bound' THEN
      SELECT count(*) INTO n FROM public.pilot_operations_recovery_evidence_ingestions WHERE org_id=p_org AND workspace_id=p_workspace AND workflow_name='Pilot Operations' AND workflow_head_sha=p_release_sha;
      m:=CASE WHEN public.hosted_pilot_exact_run_operational_execution_valid(p_org,p_workspace,p_exercise_run,p_release_sha,
        p_producer_workflow_path,p_producer_run_id,p_producer_run_attempt,p_target_fingerprint,p_deployment_fingerprint) THEN 1 ELSE 0 END;
      RETURN jsonb_build_object('passed',m=1,'predicate',jsonb_build_object(
        'ambientReleaseRecoveryEvidenceCount',n,'exactRunRecoveryExecutionCount',m,
        'exactRunRecoveryExecutionBound',m=1,'historicalRecoveryRowsExcluded',true));
    WHEN 'hosted-journey--rollback-event-bound','hosted-recovery--exact-release-rollback-event' THEN
      SELECT count(*) INTO n FROM public.pilot_operations_rollback_events rollback JOIN public.pilot_operations_release_candidates candidate
        ON candidate.id=rollback.from_candidate_id AND candidate.org_id=rollback.org_id AND candidate.workspace_id=rollback.workspace_id
        WHERE rollback.org_id=p_org AND rollback.workspace_id=p_workspace AND candidate.git_sha=p_release_sha;
      m:=CASE WHEN public.hosted_pilot_exact_run_operational_execution_valid(p_org,p_workspace,p_exercise_run,p_release_sha,
        p_producer_workflow_path,p_producer_run_id,p_producer_run_attempt,p_target_fingerprint,p_deployment_fingerprint) THEN 1 ELSE 0 END;
      RETURN jsonb_build_object('passed',m=1,'predicate',jsonb_build_object(
        'ambientReleaseRollbackEventCount',n,'exactRunRollbackExecutionCount',m,
        'exactRunRollbackExecutionBound',m=1,'historicalRollbackRowsExcluded',true));
    WHEN 'hosted-backup--canonical-migration-ledger' THEN
      SELECT count(*) INTO n FROM avalaos_migrations.applied;
      RETURN jsonb_build_object('passed',n>=1,'predicate',jsonb_build_object('migrationLedgerCount',n));
    WHEN 'hosted-backup--target-fingerprint-bound' THEN
      actual_target:='sha256:'||encode(public.digest(convert_to((SELECT system_identifier::text FROM pg_control_system()),'UTF8')||decode('00','hex')||convert_to(current_database(),'UTF8')||decode('00','hex')||convert_to(current_user,'UTF8'),'sha256'),'hex');
      RETURN jsonb_build_object('passed',actual_target=p_target_fingerprint,'predicate',jsonb_build_object('targetFingerprintMatched',actual_target=p_target_fingerprint));
    WHEN 'hosted-recovery--current-operator-authority' THEN
      SELECT count(*) INTO n FROM public.hosted_pilot_recovery_operators o
        JOIN public.profiles p ON p.id=o.actor_id AND p.status='active' AND p.deleted_at IS NULL
        JOIN public.organization_members om ON om.org_id=o.org_id AND om.user_id=o.actor_id AND om.status='active' AND om.disabled_at IS NULL AND om.deleted_at IS NULL
        JOIN public.workspace_memberships wm ON wm.org_id=o.org_id AND wm.workspace_id=o.workspace_id AND wm.user_id=o.actor_id AND wm.role_id=o.role_id AND wm.status='active' AND wm.disabled_at IS NULL AND wm.deleted_at IS NULL
        WHERE o.org_id=p_org AND o.workspace_id=p_workspace AND o.lifecycle='active' AND o.synthetic_only AND NOT o.production_authorized AND NOT o.customer_data_authorized AND NOT o.real_provider_calls_authorized;
      SELECT array_agg(capability_key ORDER BY capability_key) INTO capabilities FROM public.role_capabilities WHERE role_id=(SELECT role_id FROM public.hosted_pilot_recovery_operators WHERE org_id=p_org AND workspace_id=p_workspace AND lifecycle='active');
      RETURN jsonb_build_object('passed',n=1 AND capabilities=ARRAY['operations.read','release.promote']::text[],'predicate',jsonb_build_object('activeOperatorCount',n,'capabilities',to_jsonb(coalesce(capabilities,ARRAY[]::text[]))));
    ELSE RAISE EXCEPTION 'HOSTED_ASSERTION_EXECUTOR_UNKNOWN_ASSERTION';
  END CASE;
END$$;
REVOKE ALL ON FUNCTION public.hosted_pilot_execute_assertion_scenario(text,uuid,uuid,uuid,text,text,text,bigint,text,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.hosted_pilot_assertion_predicate_valid(p_assertion_id text,p_predicate jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
BEGIN
  IF jsonb_typeof(p_predicate) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  RETURN CASE p_assertion_id
    WHEN 'hosted-database--synthetic-subject-role-matrix' THEN p_predicate->'subjectCount'='5'::jsonb AND p_predicate->'distinctRoleCount'='5'::jsonb
    WHEN 'hosted-database--cross-tenant-nondisclosure' THEN p_predicate->'unauthorizedReadDenied'='true'::jsonb
      AND p_predicate->'unauthorizedMutationDenied'='true'::jsonb AND p_predicate->'readErrorNondisclosing'='true'::jsonb
      AND p_predicate->'mutationErrorNondisclosing'='true'::jsonb AND p_predicate->'rowsDisclosed'='0'::jsonb
      AND p_predicate->'activeForeignScopeActor'='true'::jsonb AND p_predicate->'sourceScopeProjectionAuthorized'='true'::jsonb
      AND p_predicate->'foreignScopeExists'='true'::jsonb AND p_predicate->'foreignProtectedResourceExists'='true'::jsonb
      AND p_predicate->'foreignOrganizationMembershipAbsent'='true'::jsonb
      AND p_predicate->'foreignWorkspaceMembershipAbsent'='true'::jsonb
      AND p_predicate->'receiptSideEffects'='0'::jsonb AND p_predicate->'auditSideEffects'='0'::jsonb
      AND p_predicate->'businessSideEffects'='0'::jsonb
    WHEN 'hosted-database--revocation-version-bound' THEN p_predicate->'revokedVersionBoundCount'='1'::jsonb
    WHEN 'hosted-database--response-loss-exact-replay' THEN p_predicate->'responseDiscardedBeforeRetry'='true'::jsonb
      AND p_predicate->'durableCommitBeforeRetry'='true'::jsonb
      AND p_predicate->'exactReplayResponseMatched'='true'::jsonb AND p_predicate->'committedReceiptCount'='1'::jsonb
      AND p_predicate->'businessEffectDelta'='1'::jsonb AND p_predicate->'resourceBusinessEffectCount'='1'::jsonb
      AND p_predicate->'canonicalAuditEventCount'='1'::jsonb AND p_predicate->'changedPayloadConflictRejected'='true'::jsonb
    WHEN 'hosted-provider--five-scenarios-executed' THEN p_predicate->'scenarioCount'='5'::jsonb
      AND p_predicate->'exactRunScenarioSetBound'='true'::jsonb
    WHEN 'hosted-provider--zero-egress-recorded' THEN p_predicate->'zeroEgressCount'=p_predicate->'totalCount'
      AND p_predicate->'zeroEgressCount'='5'::jsonb AND p_predicate->'totalCount'='5'::jsonb
      AND p_predicate->'exactRunScenarioSetBound'='true'::jsonb
    WHEN 'hosted-provider--real-provider-calls-not-authorized' THEN p_predicate->'nonAuthorizationMarkerCount'='1'::jsonb
      AND p_predicate->'exactRunZeroEgressCount'='5'::jsonb
    WHEN 'hosted-journey--exact-release-ingestion' THEN p_predicate->'exactPreparationCandidateCount'='1'::jsonb
      AND p_predicate->'exactResponseLossPreparationBound'='true'::jsonb
    WHEN 'hosted-journey--recovery-evidence-bound' THEN
      p_predicate->'exactRunRecoveryExecutionCount'='1'::jsonb AND p_predicate->'exactRunRecoveryExecutionBound'='true'::jsonb
      AND p_predicate->'historicalRecoveryRowsExcluded'='true'::jsonb
    WHEN 'hosted-backup--exact-release-recovery-ingestion' THEN
      p_predicate->'exactRunRecoveryExecutionCount'='1'::jsonb AND p_predicate->'exactRunRecoveryExecutionBound'='true'::jsonb
      AND p_predicate->'historicalRecoveryRowsExcluded'='true'::jsonb
    WHEN 'hosted-recovery--recovery-evidence-bound' THEN
      p_predicate->'exactRunRecoveryExecutionCount'='1'::jsonb AND p_predicate->'exactRunRecoveryExecutionBound'='true'::jsonb
      AND p_predicate->'historicalRecoveryRowsExcluded'='true'::jsonb
    WHEN 'hosted-journey--rollback-event-bound' THEN
      p_predicate->'exactRunRollbackExecutionCount'='1'::jsonb AND p_predicate->'exactRunRollbackExecutionBound'='true'::jsonb
      AND p_predicate->'historicalRollbackRowsExcluded'='true'::jsonb
    WHEN 'hosted-recovery--exact-release-rollback-event' THEN
      p_predicate->'exactRunRollbackExecutionCount'='1'::jsonb AND p_predicate->'exactRunRollbackExecutionBound'='true'::jsonb
      AND p_predicate->'historicalRollbackRowsExcluded'='true'::jsonb
    WHEN 'hosted-backup--canonical-migration-ledger' THEN jsonb_typeof(p_predicate->'migrationLedgerCount')='number' AND (p_predicate->>'migrationLedgerCount')::bigint>=1
    WHEN 'hosted-backup--target-fingerprint-bound' THEN p_predicate->'targetFingerprintMatched'='true'::jsonb
    WHEN 'hosted-recovery--current-operator-authority' THEN p_predicate->'activeOperatorCount'='1'::jsonb
      AND p_predicate->'capabilities'='["operations.read","release.promote"]'::jsonb
    ELSE false
  END;
EXCEPTION WHEN others THEN RETURN false;
END$$;
REVOKE ALL ON FUNCTION public.hosted_pilot_assertion_predicate_valid(text,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.hosted_pilot_evidence_family_derived_valid(p_org uuid,p_workspace uuid,p_exercise_run uuid,p_family text)
RETURNS boolean LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE contract jsonb; expected_set text; e public.hosted_pilot_exercise_evidence_families;
BEGIN
  SELECT * INTO e FROM public.hosted_pilot_exercise_evidence_families WHERE org_id=p_org AND workspace_id=p_workspace AND exercise_run_id=p_exercise_run AND evidence_family=p_family;
  IF NOT FOUND THEN RETURN false; END IF;
  IF e.provenance_schema_version IS DISTINCT FROM 'hosted-family-assertion-v2' OR e.observation_schema_version IS DISTINCT FROM 'hosted-family-derived-observation-v1'
    OR e.observation_set_sha256 IS NULL OR e.observation_set_sha256 !~ '^[0-9a-f]{64}$'
    OR NOT public.hosted_pilot_evidence_family_provenance_valid(e.evidence_family,e.environment,e.test_ids,e.contract_sha256,e.assertion_outcomes,e.source_artifacts) THEN RETURN false; END IF;
  IF p_family=ANY(ARRAY['canonical-journey','backup-restore','recovery-rollback'])
    AND NOT public.hosted_pilot_exact_run_operational_execution_valid(e.org_id,e.workspace_id,e.exercise_run_id,e.release_sha,
      e.producer_workflow_path,e.producer_run_id,e.producer_run_attempt,e.target_fingerprint,e.deployment_fingerprint)
    THEN RETURN false; END IF;
  contract:=public.hosted_pilot_evidence_family_contract(e.evidence_family);
  IF (SELECT count(*) FROM public.hosted_pilot_evidence_observations o WHERE o.org_id=e.org_id AND o.workspace_id=e.workspace_id
      AND o.exercise_run_id=e.exercise_run_id AND o.evidence_family=e.evidence_family)<>jsonb_array_length(contract->'assertions') THEN RETURN false; END IF;
  IF (SELECT count(*) FROM public.hosted_pilot_evidence_scenario_observations scenario WHERE scenario.org_id=e.org_id AND scenario.workspace_id=e.workspace_id
      AND scenario.exercise_run_id=e.exercise_run_id AND scenario.evidence_family=e.evidence_family)<>jsonb_array_length(contract->'assertions') THEN RETURN false; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(e.assertion_outcomes) outcome(item) WHERE NOT EXISTS(
      SELECT 1 FROM public.hosted_pilot_evidence_observations o WHERE o.org_id=e.org_id AND o.workspace_id=e.workspace_id
        AND o.exercise_run_id=e.exercise_run_id AND o.release_sha=e.release_sha AND o.producer_workflow_path=e.producer_workflow_path
        AND o.producer_run_id=e.producer_run_id AND o.producer_run_attempt=e.producer_run_attempt AND o.target_fingerprint=e.target_fingerprint
        AND o.deployment_fingerprint=e.deployment_fingerprint AND o.evidence_family=e.evidence_family AND o.assertion_id=item->>'assertionId'
        AND 'sha256:'||o.observation_sha256=item->>'observationSha256' AND 'sha256:'||o.source_sha256=item->>'sourceArtifactSha256'
        AND o.observation_payload->'binding'=e.observation_binding
        AND o.observation_sha256=encode(public.digest(convert_to(o.observation_payload::text,'UTF8'),'sha256'),'hex')
        AND EXISTS(SELECT 1 FROM public.hosted_pilot_evidence_scenario_observations scenario
          WHERE scenario.org_id=o.org_id AND scenario.workspace_id=o.workspace_id AND scenario.exercise_run_id=o.exercise_run_id
            AND scenario.release_sha=o.release_sha AND scenario.producer_workflow_path=o.producer_workflow_path
            AND scenario.producer_run_id=o.producer_run_id AND scenario.producer_run_attempt=o.producer_run_attempt
            AND scenario.target_fingerprint=o.target_fingerprint AND scenario.deployment_fingerprint=o.deployment_fingerprint
            AND scenario.evidence_family=o.evidence_family AND scenario.assertion_id=o.assertion_id
            AND scenario.source_path=o.source_path AND scenario.source_sha256=o.source_sha256
            AND scenario.scenario_schema_version='hosted-exact-run-scenario-v1'
            AND scenario.scenario_payload->'binding'=e.observation_binding AND scenario.scenario_payload->>'result'='PASS'
            AND public.hosted_pilot_assertion_predicate_valid(scenario.assertion_id,scenario.scenario_payload->'predicate')
            AND scenario.scenario_sha256=encode(public.digest(convert_to(scenario.scenario_payload::text,'UTF8'),'sha256'),'hex')
            AND o.observation_payload->>'scenarioObservationSha256'='sha256:'||scenario.scenario_sha256))) THEN RETURN false; END IF;
  SELECT encode(public.digest(convert_to(e.evidence_family||'|'||e.release_sha||'|'||e.producer_workflow_path||'|'||e.producer_run_id||'|'||e.producer_run_attempt::text||'|'||e.org_id::text||'|'||e.workspace_id::text||'|'||e.exercise_run_id::text||'|'||e.target_fingerprint||'|'||e.deployment_fingerprint||'|'||
    (SELECT string_agg((item->>'assertionId')||'@'||(item->>'observationSha256'),',' ORDER BY ordinal) FROM jsonb_array_elements(e.assertion_outcomes) WITH ORDINALITY outcome(item,ordinal)),'UTF8'),'sha256'),'hex') INTO expected_set;
  RETURN expected_set=e.observation_set_sha256;
END$$;
REVOKE ALL ON FUNCTION public.hosted_pilot_evidence_family_derived_valid(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.hosted_pilot_execute_evidence_families_internal(
  p_org uuid,p_workspace uuid,p_exercise_run uuid,p_release_sha text,p_producer_workflow_path text,p_producer_run_id text,p_producer_run_attempt bigint,
  p_target_fingerprint text,p_deployment_fingerprint text
) RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE family text; contract jsonb; assertion jsonb; observation jsonb; binding jsonb; observation_body jsonb;
  scenario_body jsonb; assertion_outcomes jsonb; source_artifacts jsonb; source_sha text; scenario_sha text; observation_sha text;
  observation_set text; evidence_hash text; existing public.hosted_pilot_exercise_evidence_families;
  scenario public.hosted_pilot_evidence_scenario_observations;
BEGIN
  IF current_user IS DISTINCT FROM (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database()) THEN RAISE EXCEPTION 'HOSTED_EVIDENCE_EXECUTOR_OWNER_REQUIRED'; END IF;
  IF p_org IS NULL OR p_workspace IS NULL OR p_exercise_run IS NULL OR p_release_sha !~ '^[0-9a-f]{40}$'
    OR p_producer_workflow_path IS DISTINCT FROM '.github/workflows/hosted-pilot-activation-evidence-producer.yml' OR p_producer_run_id !~ '^[1-9][0-9]{0,19}$'
    OR p_producer_run_attempt<1 OR p_target_fingerprint !~ '^sha256:[0-9a-f]{64}$' OR p_deployment_fingerprint !~ '^sha256:[0-9a-f]{64}$' THEN RAISE EXCEPTION 'HOSTED_EVIDENCE_EXECUTOR_INPUT_INVALID'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('hosted-derived-evidence:'||p_org::text||':'||p_workspace::text||':'||p_exercise_run::text,0));
  FOREACH family IN ARRAY ARRAY['tenant-adversarial','provider-simulation-zero-egress','canonical-journey','backup-restore','recovery-rollback'] LOOP
    contract:=public.hosted_pilot_evidence_family_contract(family); assertion_outcomes:='[]'::jsonb;
    binding:=jsonb_build_object('family',family,'releaseSha',p_release_sha,'producerWorkflowPath',p_producer_workflow_path,'producerRunId',p_producer_run_id,
      'producerRunAttempt',p_producer_run_attempt,'organizationId',p_org,'workspaceId',p_workspace,'exerciseRunId',p_exercise_run,
      'targetFingerprint',p_target_fingerprint,'deploymentFingerprint',p_deployment_fingerprint);
    FOR assertion IN SELECT value FROM jsonb_array_elements(contract->'assertions') LOOP
      SELECT 'sha256:'||content_sha256 INTO source_sha FROM avalaos_migrations.applied WHERE filename=regexp_replace(assertion->>'sourcePath','^.*/','');
      IF source_sha IS DISTINCT FROM assertion->>'sourceSha256' THEN RAISE EXCEPTION 'HOSTED_ASSERTION_SOURCE_LEDGER_MISMATCH'; END IF;
      SELECT * INTO scenario FROM public.hosted_pilot_evidence_scenario_observations
        WHERE org_id=p_org AND workspace_id=p_workspace AND exercise_run_id=p_exercise_run
          AND evidence_family=family AND assertion_id=assertion->>'assertionId';
      IF FOUND THEN
        IF scenario.release_sha IS DISTINCT FROM p_release_sha OR scenario.producer_workflow_path IS DISTINCT FROM p_producer_workflow_path
          OR scenario.producer_run_id IS DISTINCT FROM p_producer_run_id OR scenario.producer_run_attempt IS DISTINCT FROM p_producer_run_attempt
          OR scenario.target_fingerprint IS DISTINCT FROM p_target_fingerprint OR scenario.deployment_fingerprint IS DISTINCT FROM p_deployment_fingerprint
          OR scenario.source_path IS DISTINCT FROM assertion->>'sourcePath' OR 'sha256:'||scenario.source_sha256 IS DISTINCT FROM source_sha
          OR scenario.scenario_schema_version IS DISTINCT FROM 'hosted-exact-run-scenario-v1'
          OR scenario.scenario_payload->'binding' IS DISTINCT FROM binding OR scenario.scenario_payload->>'result' IS DISTINCT FROM 'PASS'
          OR NOT public.hosted_pilot_assertion_predicate_valid(scenario.assertion_id,scenario.scenario_payload->'predicate')
          OR scenario.scenario_sha256 IS DISTINCT FROM encode(public.digest(convert_to(scenario.scenario_payload::text,'UTF8'),'sha256'),'hex')
          THEN RAISE EXCEPTION 'HOSTED_SCENARIO_OBSERVATION_CONFLICT'; END IF;
        observation:=jsonb_build_object('passed',true,'predicate',scenario.scenario_payload->'predicate');
        scenario_sha:=scenario.scenario_sha256;
      ELSE
        observation:=public.hosted_pilot_execute_assertion_scenario(assertion->>'assertionId',p_org,p_workspace,p_exercise_run,p_release_sha,
          p_producer_workflow_path,p_producer_run_id,p_producer_run_attempt,p_target_fingerprint,p_deployment_fingerprint);
        IF (observation->>'passed')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION USING MESSAGE='HOSTED_ASSERTION_EXECUTION_FAILED_'||upper(regexp_replace(assertion->>'assertionId','[^a-zA-Z0-9]+','_','g')); END IF;
        scenario_body:=jsonb_build_object('schemaVersion','hosted-exact-run-scenario-v1','binding',binding,'assertionId',assertion->>'assertionId',
          'result','PASS','predicate',observation->'predicate','sourcePath',assertion->>'sourcePath','sourceSha256',source_sha);
        scenario_sha:=encode(public.digest(convert_to(scenario_body::text,'UTF8'),'sha256'),'hex');
        INSERT INTO public.hosted_pilot_evidence_scenario_observations(org_id,workspace_id,exercise_run_id,release_sha,producer_workflow_path,
          producer_run_id,producer_run_attempt,target_fingerprint,deployment_fingerprint,evidence_family,assertion_id,source_path,source_sha256,
          scenario_schema_version,scenario_payload,scenario_sha256,scenario_resource_id,scenario_receipt_id)
        VALUES(p_org,p_workspace,p_exercise_run,p_release_sha,p_producer_workflow_path,p_producer_run_id,p_producer_run_attempt,
          p_target_fingerprint,p_deployment_fingerprint,family,assertion->>'assertionId',assertion->>'sourcePath',substring(source_sha from 8),
          'hosted-exact-run-scenario-v1',scenario_body,scenario_sha,(observation->>'resourceId')::uuid,(observation->>'receiptId')::uuid);
      END IF;
      observation_body:=jsonb_build_object('schemaVersion','hosted-family-derived-observation-v1','binding',binding,'assertionId',assertion->>'assertionId',
        'predicate',observation->'predicate','scenarioObservationSha256','sha256:'||scenario_sha,
        'sourcePath',assertion->>'sourcePath','sourceSha256',source_sha);
      observation_sha:=encode(public.digest(convert_to(observation_body::text,'UTF8'),'sha256'),'hex');
      INSERT INTO public.hosted_pilot_evidence_observations(org_id,workspace_id,exercise_run_id,release_sha,producer_workflow_path,producer_run_id,producer_run_attempt,target_fingerprint,deployment_fingerprint,evidence_family,assertion_id,source_path,source_sha256,observation_schema_version,observation_payload,observation_sha256)
        VALUES(p_org,p_workspace,p_exercise_run,p_release_sha,p_producer_workflow_path,p_producer_run_id,p_producer_run_attempt,p_target_fingerprint,p_deployment_fingerprint,family,assertion->>'assertionId',assertion->>'sourcePath',substring(source_sha from 8),'hosted-family-derived-observation-v1',observation_body,observation_sha)
        ON CONFLICT DO NOTHING;
      assertion_outcomes:=assertion_outcomes||jsonb_build_array(jsonb_build_object('assertionId',assertion->>'assertionId','status','PASS','sourceArtifactSha256',source_sha,'observationSha256','sha256:'||observation_sha));
    END LOOP;
    SELECT jsonb_agg(jsonb_build_object('path',path,'sha256',sha) ORDER BY path) INTO source_artifacts FROM
      (SELECT DISTINCT item->>'sourcePath' path,item->>'sourceSha256' sha FROM jsonb_array_elements(contract->'assertions') item) sources;
    observation_set:=encode(public.digest(convert_to(family||'|'||p_release_sha||'|'||p_producer_workflow_path||'|'||p_producer_run_id||'|'||p_producer_run_attempt::text||'|'||p_org::text||'|'||p_workspace::text||'|'||p_exercise_run::text||'|'||p_target_fingerprint||'|'||p_deployment_fingerprint||'|'||
      (SELECT string_agg((item->>'assertionId')||'@'||(item->>'observationSha256'),',' ORDER BY ordinal) FROM jsonb_array_elements(assertion_outcomes) WITH ORDINALITY outcome(item,ordinal)),'UTF8'),'sha256'),'hex');
    evidence_hash:=encode(public.digest(convert_to(binding::text||'|'||contract::text||'|'||assertion_outcomes::text||'|'||source_artifacts::text||'|'||observation_set,'UTF8'),'sha256'),'hex');
    SELECT * INTO existing FROM public.hosted_pilot_exercise_evidence_families WHERE org_id=p_org AND workspace_id=p_workspace AND exercise_run_id=p_exercise_run AND evidence_family=family;
    IF FOUND THEN
      IF existing.evidence_sha256<>evidence_hash OR NOT public.hosted_pilot_evidence_family_derived_valid(p_org,p_workspace,p_exercise_run,family) THEN RAISE EXCEPTION 'HOSTED_DERIVED_EVIDENCE_CONFLICT'; END IF;
    ELSE
      INSERT INTO public.hosted_pilot_exercise_evidence_families(org_id,workspace_id,exercise_run_id,release_sha,producer_workflow_path,producer_run_id,producer_run_attempt,target_fingerprint,deployment_fingerprint,hosted_target,evidence_family,evidence_sha256,disposition,provenance_schema_version,environment,test_ids,contract_sha256,assertion_outcomes,source_artifacts,observation_schema_version,observation_binding,observation_set_sha256)
      VALUES(p_org,p_workspace,p_exercise_run,p_release_sha,p_producer_workflow_path,p_producer_run_id,p_producer_run_attempt,p_target_fingerprint,p_deployment_fingerprint,'hosted_nonproduction_pilot',family,evidence_hash,'executed_hosted_evidence','hosted-family-assertion-v2','hosted_nonproduction_pilot',contract->'testIds',contract->>'contractSha256',assertion_outcomes,source_artifacts,'hosted-family-derived-observation-v1',binding,observation_set);
      -- A conflicting owner-inserted observation must not be masked by the
      -- idempotent observation insert above.  Validate the stored rows before
      -- returning so fabricated state rolls this entire execution back.
      IF NOT public.hosted_pilot_evidence_family_derived_valid(p_org,p_workspace,p_exercise_run,family) THEN
        RAISE EXCEPTION 'HOSTED_DERIVED_EVIDENCE_VALIDATION_FAILED';
      END IF;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('status','derived','exerciseRunId',p_exercise_run,'evidenceFamilyCount',5,'productionAuthorized',false);
END$$;
REVOKE ALL ON FUNCTION public.hosted_pilot_execute_evidence_families_internal(uuid,uuid,uuid,text,text,text,bigint,text,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.hosted_pilot_oidc_execute(
  p_org uuid,p_workspace uuid,p_exercise_run uuid,p_release_sha text,p_producer_workflow_path text,p_producer_run_id text,p_producer_run_attempt bigint,
  p_target_fingerprint text,p_deployment_fingerprint text,p_expected_migration_count bigint,p_expected_ledger_digest text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE preflight jsonb; preparation jsonb; executed jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc routine
    JOIN pg_database database_record ON database_record.datname=current_database()
    WHERE routine.oid='public.hosted_pilot_oidc_execute(uuid,uuid,uuid,text,text,text,bigint,text,text,bigint,text)'::regprocedure
      AND routine.prosecdef
      AND routine.proowner=database_record.datdba
      AND has_function_privilege('service_role',routine.oid,'EXECUTE')
      AND NOT has_function_privilege('anon',routine.oid,'EXECUTE')
      AND NOT has_function_privilege('authenticated',routine.oid,'EXECUTE')
      AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(routine.proacl,acldefault('f',routine.proowner))) acl
        WHERE acl.grantee=0 AND acl.privilege_type='EXECUTE')
  ) THEN RAISE EXCEPTION 'HOSTED_OIDC_EXECUTOR_ACL_MISMATCH'; END IF;
  preflight:=public.hosted_pilot_oidc_preflight(p_target_fingerprint,p_expected_migration_count,p_expected_ledger_digest);
  preparation:=public.hosted_pilot_prepare_response_loss_scenario(p_org,p_workspace,p_exercise_run,p_release_sha,
    p_producer_workflow_path,p_producer_run_id,p_producer_run_attempt,p_target_fingerprint,p_deployment_fingerprint);
  IF preparation->>'status'='response_loss_committed' THEN
    RETURN preparation||jsonb_build_object('preflight',preflight,'evidenceFamilyCount',0);
  END IF;
  IF preparation->>'status'<>'response_loss_ready' THEN RAISE EXCEPTION 'HOSTED_RESPONSE_LOSS_PHASE_INVALID'; END IF;
  executed:=public.hosted_pilot_execute_evidence_families_internal(p_org,p_workspace,p_exercise_run,p_release_sha,p_producer_workflow_path,p_producer_run_id,p_producer_run_attempt,p_target_fingerprint,p_deployment_fingerprint);
  RETURN executed||jsonb_build_object('preflight',preflight);
END$$;
REVOKE ALL ON FUNCTION public.hosted_pilot_oidc_execute(uuid,uuid,uuid,text,text,text,bigint,text,text,bigint,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.hosted_pilot_oidc_execute(uuid,uuid,uuid,text,text,text,bigint,text,text,bigint,text) TO service_role;

-- Preserve the prior exhaustive preflight and extend it additively for the
-- derived-observation table and selector-only executor introduced above.
ALTER FUNCTION public.hosted_pilot_oidc_preflight(text,bigint,text)
  RENAME TO hosted_pilot_oidc_preflight_legacy_internal;
REVOKE ALL ON FUNCTION public.hosted_pilot_oidc_preflight_legacy_internal(text,bigint,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.hosted_pilot_oidc_preflight(
  p_expected_target_fingerprint text,p_expected_migration_count bigint,p_expected_ledger_digest text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE base jsonb;
BEGIN
  base:=public.hosted_pilot_oidc_preflight_legacy_internal(p_expected_target_fingerprint,p_expected_migration_count,p_expected_ledger_digest);
  IF NOT EXISTS (
    SELECT 1 FROM pg_class relation
    JOIN pg_database database_record ON database_record.datname=current_database()
    WHERE relation.oid='public.hosted_pilot_evidence_observations'::regclass
      AND relation.relowner=database_record.datdba AND relation.relrowsecurity AND relation.relforcerowsecurity
      AND NOT has_table_privilege('service_role',relation.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      AND NOT has_table_privilege('anon',relation.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      AND NOT has_table_privilege('authenticated',relation.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(relation.relacl,acldefault('r',relation.relowner))) acl
        WHERE acl.grantee=0 AND acl.privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'))
  ) THEN RAISE EXCEPTION 'HOSTED_EVIDENCE_OBSERVATION_TABLE_ACL_MISMATCH'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_class relation
    JOIN pg_database database_record ON database_record.datname=current_database()
    WHERE relation.oid='public.hosted_pilot_evidence_scenario_observations'::regclass
      AND relation.relowner=database_record.datdba AND relation.relrowsecurity AND relation.relforcerowsecurity
      AND NOT has_table_privilege('service_role',relation.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      AND NOT has_table_privilege('anon',relation.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      AND NOT has_table_privilege('authenticated',relation.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(relation.relacl,acldefault('r',relation.relowner))) acl
        WHERE acl.grantee=0 AND acl.privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'))
  ) THEN RAISE EXCEPTION 'HOSTED_EVIDENCE_SCENARIO_TABLE_ACL_MISMATCH'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_class relation
    JOIN pg_database database_record ON database_record.datname=current_database()
    WHERE relation.oid='public.hosted_pilot_response_loss_preparations'::regclass
      AND relation.relowner=database_record.datdba AND relation.relrowsecurity AND relation.relforcerowsecurity
      AND NOT has_table_privilege('service_role',relation.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      AND NOT has_table_privilege('anon',relation.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      AND NOT has_table_privilege('authenticated',relation.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(relation.relacl,acldefault('r',relation.relowner))) acl
        WHERE acl.grantee=0 AND acl.privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'))
  ) THEN RAISE EXCEPTION 'HOSTED_RESPONSE_LOSS_PREPARATION_TABLE_ACL_MISMATCH'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_class relation
    JOIN pg_database database_record ON database_record.datname=current_database()
    WHERE relation.oid='public.hosted_pilot_exact_run_operational_executions'::regclass
      AND relation.relowner=database_record.datdba AND relation.relrowsecurity AND relation.relforcerowsecurity
      AND NOT has_table_privilege('service_role',relation.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      AND NOT has_table_privilege('anon',relation.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      AND NOT has_table_privilege('authenticated',relation.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(relation.relacl,acldefault('r',relation.relowner))) acl
        WHERE acl.grantee=0 AND acl.privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'))
  ) THEN RAISE EXCEPTION 'HOSTED_EXACT_RUN_EXECUTION_TABLE_ACL_MISMATCH'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc routine
    JOIN pg_database database_record ON database_record.datname=current_database()
    WHERE routine.oid='public.hosted_pilot_oidc_execute(uuid,uuid,uuid,text,text,text,bigint,text,text,bigint,text)'::regprocedure
      AND routine.prosecdef AND routine.proowner=database_record.datdba
      AND has_function_privilege('service_role',routine.oid,'EXECUTE')
      AND NOT has_function_privilege('anon',routine.oid,'EXECUTE')
      AND NOT has_function_privilege('authenticated',routine.oid,'EXECUTE')
      AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(routine.proacl,acldefault('f',routine.proowner))) acl
        WHERE acl.grantee=0 AND acl.privilege_type='EXECUTE')
  ) THEN RAISE EXCEPTION 'HOSTED_OIDC_EXECUTOR_ACL_MISMATCH'; END IF;
  RETURN base||jsonb_build_object('evidenceObservationAuthority','database_owner_only','scenarioObservationAuthority','database_owner_only',
    'responseLossPreparationAuthority','database_owner_only','exactRunOperationalExecutionAuthority','database_owner_only');
END$$;
REVOKE ALL ON FUNCTION public.hosted_pilot_oidc_preflight(text,bigint,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.hosted_pilot_oidc_preflight(text,bigint,text) TO service_role;

CREATE OR REPLACE FUNCTION public.hosted_pilot_record_verification_result(
  p_org uuid,p_workspace uuid,p_exercise_run uuid,p_release_sha text,
  p_producer_workflow_path text,p_producer_run_id text,p_producer_run_attempt bigint,
  p_target_fingerprint text,p_deployment_fingerprint text,
  p_recovery_actor uuid,p_recovery_authorization_version bigint
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE existing public.hosted_pilot_verification_run_results; computed_hash text; family_digest jsonb;
BEGIN
  IF p_org IS NULL OR p_workspace IS NULL OR p_exercise_run IS NULL OR p_recovery_actor IS NULL
    OR p_recovery_authorization_version IS NULL OR p_recovery_authorization_version<1
    OR p_release_sha IS NULL OR p_release_sha !~ '^[0-9a-f]{40}$'
    OR p_producer_workflow_path IS DISTINCT FROM '.github/workflows/hosted-pilot-activation-evidence-producer.yml'
    OR p_producer_run_id IS NULL OR p_producer_run_id !~ '^[1-9][0-9]{0,19}$' OR p_producer_run_attempt IS NULL OR p_producer_run_attempt<1
    OR p_target_fingerprint IS NULL OR p_target_fingerprint !~ '^sha256:[0-9a-f]{64}$'
    OR p_deployment_fingerprint IS NULL OR p_deployment_fingerprint !~ '^sha256:[0-9a-f]{64}$' THEN RAISE EXCEPTION 'HOSTED_EXECUTED_EVIDENCE_INVALID'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.hosted_pilot_recovery_operators o
    JOIN public.profiles p ON p.id=o.actor_id AND p.status='active' AND p.deleted_at IS NULL
    JOIN public.organization_members om ON om.org_id=o.org_id AND om.user_id=o.actor_id AND om.status='active' AND om.disabled_at IS NULL AND om.deleted_at IS NULL
    JOIN public.workspace_memberships wm ON wm.org_id=o.org_id AND wm.workspace_id=o.workspace_id AND wm.user_id=o.actor_id AND wm.role_id=o.role_id AND wm.status='active' AND wm.disabled_at IS NULL AND wm.deleted_at IS NULL
    JOIN public.roles r ON r.id=o.role_id AND r.org_id=o.org_id AND r.workspace_id=o.workspace_id AND r.scope='workspace' AND r.status='active' AND r.deleted_at IS NULL
    JOIN public.authorization_versions av ON av.org_id=o.org_id AND av.user_id=o.actor_id AND av.version=p_recovery_authorization_version
    WHERE o.org_id=p_org AND o.workspace_id=p_workspace AND o.actor_id=p_recovery_actor AND o.lifecycle='active'
      AND o.synthetic_only AND NOT o.production_authorized AND NOT o.customer_data_authorized AND NOT o.real_provider_calls_authorized
      AND (SELECT array_agg(rc.capability_key ORDER BY rc.capability_key) FROM public.role_capabilities rc WHERE rc.role_id=o.role_id)=ARRAY['operations.read','release.promote']::text[])
    THEN RAISE EXCEPTION 'PR1B_NOT_FOUND'; END IF;
  SELECT jsonb_agg(jsonb_build_object('family',e.evidence_family,'evidenceSha256','sha256:'||e.evidence_sha256,
      'contractSha256',e.contract_sha256,'observationSetSha256','sha256:'||e.observation_set_sha256) ORDER BY e.evidence_family) INTO family_digest
    FROM public.hosted_pilot_exercise_evidence_families e
    WHERE e.org_id=p_org AND e.workspace_id=p_workspace AND e.exercise_run_id=p_exercise_run AND e.release_sha=p_release_sha
      AND e.producer_workflow_path=p_producer_workflow_path AND e.producer_run_id=p_producer_run_id AND e.producer_run_attempt=p_producer_run_attempt
      AND e.target_fingerprint=p_target_fingerprint AND e.deployment_fingerprint=p_deployment_fingerprint
      AND e.hosted_target='hosted_nonproduction_pilot' AND e.disposition='executed_hosted_evidence'
      AND e.provenance_schema_version='hosted-family-assertion-v2'
      AND public.hosted_pilot_evidence_family_derived_valid(e.org_id,e.workspace_id,e.exercise_run_id,e.evidence_family);
  IF jsonb_array_length(coalesce(family_digest,'[]'::jsonb))<>5 THEN RAISE EXCEPTION 'HOSTED_CURRENT_EXERCISE_PROOF_MISSING'; END IF;
  computed_hash:=encode(public.digest(convert_to(jsonb_build_array(p_release_sha,p_producer_workflow_path,p_producer_run_id,
    p_producer_run_attempt,p_target_fingerprint,p_deployment_fingerprint,p_org,p_workspace,p_exercise_run,p_recovery_actor,
    p_recovery_authorization_version,family_digest)::text,'UTF8'),'sha256'),'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended('hosted-verification:'||p_org::text||':'||p_workspace::text||':'||p_exercise_run::text,0));
  SELECT * INTO existing FROM public.hosted_pilot_verification_run_results WHERE org_id=p_org AND workspace_id=p_workspace AND exercise_run_id=p_exercise_run FOR UPDATE;
  IF FOUND THEN
    IF existing.result_sha256<>computed_hash OR existing.release_sha<>p_release_sha OR existing.producer_workflow_path<>p_producer_workflow_path
      OR existing.producer_run_id<>p_producer_run_id OR existing.producer_run_attempt<>p_producer_run_attempt
      OR existing.target_fingerprint<>p_target_fingerprint OR existing.deployment_fingerprint<>p_deployment_fingerprint
      OR existing.recovery_actor_id<>p_recovery_actor OR existing.recovery_authorization_version<>p_recovery_authorization_version
      THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF;
    RETURN jsonb_build_object('status','exact_replay','exerciseRunId',p_exercise_run,'familyDigest',family_digest,'productionAuthorized',false);
  END IF;
  INSERT INTO public.hosted_pilot_verification_run_results(org_id,workspace_id,exercise_run_id,release_sha,recovery_actor_id,recovery_authorization_version,result_sha256,
    tenant_adversarial,provider_zero_egress,canonical_journey,backup_restore,recovery_rollback,producer_workflow_path,producer_run_id,producer_run_attempt,target_fingerprint,deployment_fingerprint)
  VALUES(p_org,p_workspace,p_exercise_run,p_release_sha,p_recovery_actor,p_recovery_authorization_version,computed_hash,true,true,true,true,true,
    p_producer_workflow_path,p_producer_run_id,p_producer_run_attempt,p_target_fingerprint,p_deployment_fingerprint);
  RETURN jsonb_build_object('status','recorded','exerciseRunId',p_exercise_run,'familyDigest',family_digest,'productionAuthorized',false);
END$$;
REVOKE ALL ON FUNCTION public.hosted_pilot_record_verification_result(uuid,uuid,uuid,text,text,text,bigint,text,text,uuid,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.hosted_pilot_record_verification_result(uuid,uuid,uuid,text,text,text,bigint,text,text,uuid,bigint) TO service_role;

CREATE OR REPLACE FUNCTION public.hosted_pilot_oidc_status(
  p_org uuid,p_workspace uuid,p_exercise_run uuid,p_release_sha text,p_producer_workflow_path text,
  p_producer_run_id text,p_producer_run_attempt bigint,p_target_fingerprint text,p_deployment_fingerprint text,
  p_expected_migration_count bigint,p_expected_ledger_digest text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE preflight jsonb; family_state jsonb; family_count bigint; result_count bigint; operational_preparation_ready boolean;
BEGIN
  preflight:=public.hosted_pilot_oidc_preflight(p_target_fingerprint,p_expected_migration_count,p_expected_ledger_digest);
  IF p_org IS NULL OR p_workspace IS NULL OR p_exercise_run IS NULL OR p_release_sha IS NULL OR p_release_sha !~ '^[0-9a-f]{40}$'
    OR p_producer_workflow_path IS DISTINCT FROM '.github/workflows/hosted-pilot-activation-evidence-producer.yml'
    OR p_producer_run_id IS NULL OR p_producer_run_id !~ '^[1-9][0-9]{0,19}$' OR p_producer_run_attempt IS NULL OR p_producer_run_attempt<1
    OR p_deployment_fingerprint IS NULL OR p_deployment_fingerprint !~ '^sha256:[0-9a-f]{64}$' THEN RAISE EXCEPTION 'HOSTED_OIDC_STATUS_INPUT_INVALID'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('schemaVersion','hosted-family-assertion-v2','family',e.evidence_family,'result','passed',
      'disposition',e.disposition,'environment',e.environment,'targetFingerprint',e.target_fingerprint,
      'deploymentTargetFingerprint',e.deployment_fingerprint,'testIds',e.test_ids,
      'contractSha256',e.contract_sha256,'execution',jsonb_build_object('releaseSha',e.release_sha,'producerWorkflowPath',e.producer_workflow_path,
        'producerRunId',e.producer_run_id,'producerRunAttempt',e.producer_run_attempt),
      'scope',jsonb_build_object('organizationId',e.org_id,'workspaceId',e.workspace_id,'exerciseRunId',e.exercise_run_id),
      'assertionOutcomes',e.assertion_outcomes,'sourceArtifacts',e.source_artifacts,'observedAt',e.recorded_at,
      'observationSchemaVersion',e.observation_schema_version,'observationBinding',e.observation_binding,
      'observationSetSha256','sha256:'||e.observation_set_sha256,
      'evidenceSha256','sha256:'||e.evidence_sha256) ORDER BY e.evidence_family),'[]'::jsonb),count(*)::bigint
    INTO family_state,family_count FROM public.hosted_pilot_exercise_evidence_families e
    WHERE e.org_id=p_org AND e.workspace_id=p_workspace AND e.exercise_run_id=p_exercise_run AND e.release_sha=p_release_sha
      AND e.producer_workflow_path=p_producer_workflow_path AND e.producer_run_id=p_producer_run_id AND e.producer_run_attempt=p_producer_run_attempt
      AND e.target_fingerprint=p_target_fingerprint AND e.deployment_fingerprint=p_deployment_fingerprint
      AND e.hosted_target='hosted_nonproduction_pilot' AND e.disposition='executed_hosted_evidence'
      AND e.provenance_schema_version='hosted-family-assertion-v2'
      AND public.hosted_pilot_evidence_family_derived_valid(e.org_id,e.workspace_id,e.exercise_run_id,e.evidence_family);
  SELECT count(*)::bigint INTO result_count FROM public.hosted_pilot_verification_run_results
    WHERE org_id=p_org AND workspace_id=p_workspace AND exercise_run_id=p_exercise_run AND release_sha=p_release_sha
      AND producer_workflow_path=p_producer_workflow_path AND producer_run_id=p_producer_run_id AND producer_run_attempt=p_producer_run_attempt
      AND target_fingerprint=p_target_fingerprint AND deployment_fingerprint=p_deployment_fingerprint;
  operational_preparation_ready:=public.hosted_pilot_exact_run_operational_execution_valid(
    p_org,p_workspace,p_exercise_run,p_release_sha,p_producer_workflow_path,p_producer_run_id,p_producer_run_attempt,
    p_target_fingerprint,p_deployment_fingerprint);
  RETURN jsonb_build_object('status',CASE WHEN family_count=5 THEN 'ready' ELSE 'waiting' END,'evidenceFamilyCount',family_count,
    'evidenceFamilyState',family_state,'verificationResultCount',result_count,
    'operationalPreparationReady',operational_preparation_ready,'preflight',preflight,'productionAuthorized',false);
END$$;
REVOKE ALL ON FUNCTION public.hosted_pilot_oidc_status(uuid,uuid,uuid,text,text,text,bigint,text,text,bigint,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.hosted_pilot_oidc_status(uuid,uuid,uuid,text,text,text,bigint,text,text,bigint,text) TO service_role;

ALTER TABLE public.hosted_pilot_environment_identity DROP CONSTRAINT hosted_pilot_environment_identity_migration_tip_check;
UPDATE public.hosted_pilot_environment_identity SET migration_tip='20260823090000' WHERE singleton;
ALTER TABLE public.hosted_pilot_environment_identity ADD CONSTRAINT hosted_pilot_environment_identity_migration_tip_check CHECK(migration_tip='20260823090000');
